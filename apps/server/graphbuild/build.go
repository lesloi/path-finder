// Package graphbuild turns OSM PBF files and BD ALTI tiles into the graph file the engine maps. It runs
// ahead of serving, as a job: it needs far more memory than serving does.
package graphbuild

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"

	"github.com/lesloi/path-finder/apps/server/elevation"
	"github.com/lesloi/path-finder/apps/server/engine"
)

// rawWay is a way of the extract that at least one travel mode may use, with what it says of both modes.
type rawWay struct {
	kind, surf, flags, modes uint8
	ids                      []int64
	idx                      []uint32
}

// The modes byte of a way, before it is turned into the modes of each of its two edges: the access bits of the
// engine, and the direction a bike may ride when oneway leaves only one.
const (
	bikeForward  uint8 = 1 << 2
	bikeBackward uint8 = 1 << 3
)

// edgeModes is the modes byte of the edge of a way in one direction: its access, and whether this direction is the
// one a bike may ride against a oneway.
func edgeModes(wayModes uint8, forward bool) uint8 {
	out := wayModes & engine.EdgeAllModes
	if out&engine.EdgeBike == 0 {
		return out // no bike may ride the way: a direction of it means nothing
	}
	if forward && wayModes&bikeForward != 0 || !forward && wayModes&bikeBackward != 0 {
		out |= engine.EdgeBikeThisWay
	}
	return out
}

var highwayKinds = map[string]uint8{
	"path": engine.KindPath, "footway": engine.KindFootway, "pedestrian": engine.KindPedestrian, "bridleway": engine.KindBridleway, "track": engine.KindTrack,
	"cycleway": engine.KindCycleway, "steps": engine.KindSteps, "living_street": engine.KindLivingStreet, "residential": engine.KindResidential,
	"service": engine.KindService, "unclassified": engine.KindUnclassified, "tertiary": engine.KindTertiary, "tertiary_link": engine.KindTertiary,
	"secondary": engine.KindSecondary, "secondary_link": engine.KindSecondary, "primary": engine.KindPrimary, "primary_link": engine.KindPrimary,
	"trunk": engine.KindTrunk, "trunk_link": engine.KindTrunk,
}

var surfaceGroups = map[string]uint8{
	"asphalt": engine.SurfacePaved, "paved": engine.SurfacePaved, "concrete": engine.SurfacePaved, "concrete:plates": engine.SurfacePaved, "concrete:lanes": engine.SurfacePaved,
	"brick": engine.SurfacePaved, "bricks": engine.SurfacePaved, "cement": engine.SurfacePaved, "chipseal": engine.SurfacePaved,
	"paving_stones": engine.SurfacePaved, "metal": engine.SurfacePaved, "wood": engine.SurfacePaved, "sett": engine.SurfacePaved,
	"compacted": engine.SurfaceCompact, "fine_gravel": engine.SurfaceCompact, "gravel": engine.SurfaceCompact, "unpaved": engine.SurfaceCompact,
	"dirt": engine.SurfaceRough, "earth": engine.SurfaceRough, "ground": engine.SurfaceRough, "grass": engine.SurfaceRough, "sand": engine.SurfaceRough, "mud": engine.SurfaceRough,
	"rock": engine.SurfaceRough, "pebblestone": engine.SurfaceRough, "cobblestone": engine.SurfaceRough, "unhewn_cobblestone": engine.SurfaceRough, "stepping_stones": engine.SurfaceRough, "grass_paver": engine.SurfaceRough, "woodchips": engine.SurfaceRough,
}

// explicitFoot tells whether a foot tag opens a way the access tag closes.
func explicitFoot(tags osm.Tags) bool {
	switch tags.Find("foot") {
	case "yes", "designated", "permissive":
		return true
	}
	return false
}

// bikeAllowedTag tells whether a bicycle tag opens a way that an access tag closes. A dismount does not: it is an
// access, not a key.
func bikeAllowedTag(tags osm.Tags) bool {
	switch tags.Find("bicycle") {
	case "yes", "designated", "permissive":
		return true
	}
	return false
}

// bikeMayRide tells whether a bicycle tag lets a bike onto a way that is ordinarily not open to one, such as a
// footway or a stair. A dismount counts: the bike is pushed.
func bikeMayRide(tags osm.Tags) bool {
	switch tags.Find("bicycle") {
	case "yes", "designated", "permissive", "dismount":
		return true
	}
	return false
}

// bikeDirection says, for each direction of a way, whether a bike may ride it: no oneway leaves both, oneway one, and
// oneway:bicycle or a contraflow cycleway lane overrides oneway.
func bikeDirection(tags osm.Tags) (forward, backward bool) {
	forward, backward = true, true
	switch tags.Find("oneway") {
	case "yes", "true", "1":
		backward = false
	case "-1", "reverse":
		forward = false
	}
	switch tags.Find("oneway:bicycle") {
	case "yes", "true", "1":
		forward, backward = true, false
	case "-1", "reverse":
		forward, backward = false, true
	case "no":
		forward, backward = true, true
	}
	if strings.HasPrefix(tags.Find("cycleway:forward"), "opposite") {
		forward = true
	}
	if strings.HasPrefix(tags.Find("cycleway:backward"), "opposite") {
		backward = true
	}
	return forward, backward
}

// classifyWay decides which travel modes may use a way, and under which kind and surface group, with the edge flags
// each mode carries. A way no mode may use is left out. A foot way with no sac_scale is neither flagged nor left out:
// one of T3 (ropes, chains, hands for balance) is flagged technical, one of T4 and up, an alpine route, is left out,
// and T1 and T2 are ordinary hiking and trail running. A bike way with an mtb:scale of 0 to 3 is flagged technical,
// and one of 4 and up is left out.
func classifyWay(tags osm.Tags) (w rawWay, ok bool) {
	kind, ok := highwayKinds[tags.Find("highway")]
	if !ok || tags.Find("area") == "yes" {
		return rawWay{}, false
	}
	w.kind, w.surf = kind, surfaceGroups[tags.Find("surface")]
	foot, bicycle, access := tags.Find("foot"), tags.Find("bicycle"), tags.Find("access")

	// access=no or private closes a way to both modes, unless the mode's own tag opens it. A dismount does not open
	// a way the access tag closes.
	closedByAccess := access == "no" || access == "private"
	footOK := !closedByAccess || explicitFoot(tags)
	bikeOK := !closedByAccess || bikeAllowedTag(tags)
	if foot == "no" || foot == "private" {
		footOK = false
	}
	if bicycle == "no" || bicycle == "private" {
		bikeOK = false
	}
	// A trunk road or a motorway is no place for a walker unless a foot tag says so; a motorroad is none for a bike.
	if kind == engine.KindTrunk && !explicitFoot(tags) {
		footOK = false
	}
	if tags.Find("motorroad") == "yes" {
		bikeOK = false
	}
	// A cycleway is open to walkers unless a foot tag says otherwise; a footway, a stair or a pedestrian way is open
	// to a bike only when a bicycle tag says so, a dismount included.
	if kind == engine.KindCycleway && !explicitFoot(tags) && foot != "" {
		footOK = false
	}
	switch kind {
	case engine.KindFootway, engine.KindSteps, engine.KindPedestrian:
		bikeOK = bikeOK && bikeMayRide(tags)
	}
	// A way can carry several scales, such as hiking;demanding_mountain_hiking: one value from T3 up is enough.
	for _, scale := range strings.Split(tags.Find("sac_scale"), ";") {
		switch strings.TrimSpace(scale) {
		case "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking":
			footOK = false
		case "demanding_mountain_hiking":
			w.flags |= engine.EdgeTechnical
		}
	}
	for _, scale := range strings.Split(tags.Find("mtb:scale"), ";") {
		switch strings.TrimSpace(scale) {
		case "0", "1", "2", "3":
			w.flags |= engine.EdgeTechnicalBike
		case "4", "5", "6":
			bikeOK = false
		}
	}
	// A mode that may not use the way keeps no technical bit: the flags only tell a route that holds the way.
	if !footOK {
		w.flags &^= engine.EdgeTechnical
	}
	if !bikeOK {
		w.flags &^= engine.EdgeTechnicalBike
	}
	if footOK {
		w.modes |= engine.EdgeFoot
	}
	if bikeOK {
		w.modes |= engine.EdgeBike
		forward, backward := bikeDirection(tags)
		if forward {
			w.modes |= bikeForward
		}
		if backward {
			w.modes |= bikeBackward
		}
	}
	if w.modes&engine.EdgeAllModes == 0 {
		return rawWay{}, false
	}
	return w, true
}

// wayAttrs packs what a way says of both modes into the 32 bits of a wayInfo or an outEdge: the kind, the surface,
// the flags of each mode and the modes byte.
func wayAttrs(w rawWay) uint32 {
	return uint32(w.kind) | uint32(w.surf)<<8 | uint32(w.flags)<<16 | uint32(w.modes)<<24
}

// readWays reads the ways of an extract that at least one travel mode can use.
func readWays(path string) ([]rawWay, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := osmpbf.New(context.Background(), f, runtime.GOMAXPROCS(0))
	defer sc.Close()
	sc.SkipNodes, sc.SkipRelations = true, true
	var ways []rawWay
	for sc.Scan() {
		w, isWay := sc.Object().(*osm.Way)
		if !isWay {
			continue
		}
		way, ok := classifyWay(w.Tags)
		if !ok || len(w.Nodes) < 2 {
			continue
		}
		way.ids = make([]int64, len(w.Nodes))
		for i, n := range w.Nodes {
			way.ids[i] = int64(n.ID)
		}
		ways = append(ways, way)
	}
	return ways, sc.Err()
}

func readNodes(path string, idx map[int64]uint32, lat, lon []int32) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := osmpbf.New(context.Background(), f, runtime.GOMAXPROCS(0))
	defer sc.Close()
	sc.SkipWays, sc.SkipRelations = true, true
	for sc.Scan() {
		n, isNode := sc.Object().(*osm.Node)
		if !isNode {
			continue
		}
		if i, ok := idx[int64(n.ID)]; ok {
			lat[i], lon[i] = int32(math.Round(n.Lat*1e7)), int32(math.Round(n.Lon*1e7))
		}
	}
	return sc.Err()
}

// progress writes a line per step with the time and the heap, for the person watching a long build.
type progress struct {
	w     io.Writer
	start time.Time
}

func (p progress) step(format string, args ...any) {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	fmt.Fprintf(p.w, "[%6.1fs heap=%4dMB] %s\n", time.Since(p.start).Seconds(), ms.HeapAlloc>>20, fmt.Sprintf(format, args...))
}

// Build turns OSM PBF files and the BD ALTI ASC tiles below demDir into a graph file with elevation
// on every node, and reports its steps to log. The tiles are written in the projection proj.
func Build(pbfPaths []string, demDir string, proj elevation.Projection, outPath string, log io.Writer) error {
	p := progress{log, time.Now()}
	// The tiles are read after the extract, when the memory of the nodes' index is free: the two never sit in
	// memory together. That there are tiles is checked first, so that a job without them fails at once.
	if n, err := elevation.CountTiles(demDir); err != nil {
		return err
	} else if n == 0 {
		return fmt.Errorf("%w in %s", elevation.ErrNoTile, demDir)
	}

	var ways []rawWay
	for _, path := range pbfPaths {
		w, err := readWays(path)
		if err != nil {
			return err
		}
		ways = append(ways, w...)
	}
	p.step("pass 1: %d ways open to a mode", len(ways))

	idx := make(map[int64]uint32, 1<<22)
	for wi := range ways {
		w := &ways[wi]
		w.idx = make([]uint32, len(w.ids))
		for i, id := range w.ids {
			v, ok := idx[id]
			if !ok {
				v = uint32(len(idx))
				idx[id] = v
			}
			w.idx[i] = v
		}
		w.ids = nil
	}
	n := len(idx)
	p.step("%d candidate nodes", n)

	lat, lon := make([]int32, n), make([]int32, n)
	for i := range lat {
		lat[i] = math.MinInt32
	}
	for _, path := range pbfPaths {
		if err := readNodes(path, idx, lat, lon); err != nil {
			return err
		}
	}
	idx = nil
	runtime.GC()
	p.step("pass 2: node coordinates read")

	elev, err := sample(p, func() (*elevation.DEM, error) { return elevation.Load(demDir, proj) }, lat, lon)
	if err != nil {
		return err
	}
	return finish(p, demDir, ways, lat, lon, elev, outPath)
}

// sample reads the tiles that load gives and returns the elevation of the candidate nodes. The tiles are
// local to it: they are the biggest thing in memory, and they are out of reach once it returns.
func sample(p progress, load func() (*elevation.DEM, error), lat, lon []int32) ([]int32, error) {
	dem, err := load()
	if err != nil {
		return nil, err
	}
	p.step("BD ALTI: %d tiles", dem.Tiles())
	return dem.Sample(lat, lon), nil
}

// finish assembles the graph from the ways and the elevation of the candidate nodes, and writes it.
func finish(p progress, demDir string, ways []rawWay, lat, lon []int32, elev []int32, outPath string) error {
	// Go gives the tiles back at the next collection: it is asked for before the graph takes its memory.
	runtime.GC()
	p.step("elevation sampled")

	nodes, off, edges := assemble(ways, lat, lon, elev)
	p.step("graph: %d nodes, %d directed edges", len(nodes), len(edges))
	if len(edges) == 0 {
		return errors.New(noEdges(demDir))
	}

	if err := engine.WriteGraph(outPath, nodes, off, edges); err != nil {
		return err
	}
	st, _ := os.Stat(outPath)
	p.step("written %s (%d MB)", outPath, st.Size()>>20)
	return nil
}

// noEdges is what a build says when no way has elevation, which is nearly always tiles of another area or in another
// projection.
func noEdges(demDir string) string {
	return fmt.Sprintf("no walkable way has elevation: check that %s holds the BD ALTI tiles of the area the extracts cover, and that -dem-crs names their projection (lambert93 by default)", demDir)
}

// assemble builds the graph from the ways, each a run of candidate nodes, their coordinates in 1e-7
// degrees and their elevations. A way is cut into one pair of edges per step, and a node with no edge,
// or no elevation, is left out.
func assemble(ways []rawWay, lat, lon []int32, elev []int32) ([]engine.Node, []uint32, []engine.Edge) {
	n := len(lat)
	deg := make([]uint32, n)
	for _, w := range ways {
		for i := 1; i < len(w.idx); i++ {
			a, b := w.idx[i-1], w.idx[i]
			if a != b && elev[a] != elevation.Unknown && elev[b] != elevation.Unknown {
				deg[a]++
				deg[b]++
			}
		}
	}
	remap, kept := spatialOrder(deg, lat, lon)
	nodes := make([]engine.Node, kept)
	off := make([]uint32, kept+1)
	for i, d := range deg {
		if r := remap[i]; r != math.MaxUint32 {
			nodes[r] = engine.Node{Lat: lat[i], Lon: lon[i], Elev: elev[i]}
			off[r+1] = d
		}
	}
	for i := uint32(0); i < kept; i++ {
		off[i+1] += off[i]
	}
	edgeCount := off[kept]
	edges := make([]engine.Edge, edgeCount)
	fill := make([]uint32, kept)
	add := func(a, b uint32, l float32, kind, surf, flags, modes uint8) {
		e := off[a] + fill[a]
		fill[a]++
		edges[e] = engine.Edge{To: b, Len: l, Kind: kind, Surf: surf, Flags: flags, Modes: modes}
	}
	for _, w := range ways {
		for i := 1; i < len(w.idx); i++ {
			a, b := w.idx[i-1], w.idx[i]
			if a == b || elev[a] == elevation.Unknown || elev[b] == elevation.Unknown {
				continue
			}
			ra, rb := remap[a], remap[b]
			l := float32(haversineM(lat[a], lon[a], lat[b], lon[b]))
			add(ra, rb, l, w.kind, w.surf, w.flags, edgeModes(w.modes, true))
			add(rb, ra, l, w.kind, w.surf, w.flags, edgeModes(w.modes, false))
		}
	}
	return nodes, off, edges
}

// hilbertOrder is the resolution of the curve nodes are ordered along: 2^16 cells on a side.
const hilbertOrder = 16

// spatialOrder numbers the nodes that have an edge along a Hilbert curve over their bounding box, so that
// nodes close on the map are close in the file, and a search reads few pages. It returns, for each
// candidate node, its number, or MaxUint32 for a node left out, and how many nodes are kept.
func spatialOrder(deg []uint32, lat, lon []int32) (remap []uint32, kept uint32) {
	minLat, minLon := int32(math.MaxInt32), int32(math.MaxInt32)
	maxLat, maxLon := int32(math.MinInt32), int32(math.MinInt32)
	for i, d := range deg {
		if d > 0 {
			minLat, maxLat = min(minLat, lat[i]), max(maxLat, lat[i])
			minLon, maxLon = min(minLon, lon[i]), max(maxLon, lon[i])
		}
	}
	cv := newCurve(minLat, minLon, maxLat, maxLon)

	type keyed struct {
		key  uint64
		node uint32
	}
	order := make([]keyed, 0, len(deg))
	for i, d := range deg {
		if d > 0 {
			order = append(order, keyed{cv.key(lat[i], lon[i]), uint32(i)})
		}
	}
	sort.Slice(order, func(a, b int) bool {
		if order[a].key != order[b].key {
			return order[a].key < order[b].key
		}
		return order[a].node < order[b].node // stable: the same input gives the same file
	})
	remap = make([]uint32, len(deg))
	for i := range remap {
		remap[i] = math.MaxUint32
	}
	for r, k := range order {
		remap[k.node] = uint32(r)
	}
	return remap, uint32(len(order))
}

// curve is the Hilbert curve laid over the bounding box of the nodes that are kept.
type curve struct {
	minLat, minLon int32
	cell           int64
}

func newCurve(minLat, minLon, maxLat, maxLon int32) curve {
	// One square cell size for both axes, so that the curve does not stretch along one of them.
	span := max(int64(maxLat)-int64(minLat), int64(maxLon)-int64(minLon))
	return curve{minLat, minLon, span>>hilbertOrder + 1}
}

func (c curve) key(lat, lon int32) uint64 {
	x, y := uint32((int64(lon)-int64(c.minLon))/c.cell), uint32((int64(lat)-int64(c.minLat))/c.cell)
	return hilbertKey(x, y, hilbertOrder)
}

// hilbertKey is the position of cell (x, y) along the Hilbert curve that fills a square of 2^order cells
// a side.
func hilbertKey(x, y uint32, order int) uint64 {
	var key uint64
	for s := uint32(1) << (order - 1); s > 0; s >>= 1 {
		var rx, ry uint32
		if x&s != 0 {
			rx = 1
		}
		if y&s != 0 {
			ry = 1
		}
		key += uint64(s) * uint64(s) * uint64((3*rx)^ry)
		if ry == 0 { // rotate the quadrant so that the curve stays continuous
			if rx == 1 {
				x, y = s-1-x&(s-1), s-1-y&(s-1)
			}
			x, y = y, x
		}
	}
	return key
}

const (
	earthRadiusM = 6371008.8
	rad          = math.Pi / 180
)

// haversineM returns the great-circle distance in metres between two 1e-7 degree points.
func haversineM(lat1, lon1, lat2, lon2 int32) float64 {
	p1, p2 := float64(lat1)*1e-7*rad, float64(lat2)*1e-7*rad
	dphi := p2 - p1
	dl := (float64(lon2) - float64(lon1)) * 1e-7 * rad
	// The compiler does not fold two identical calls of math.Sin into one, so each half-angle is computed once.
	sd, sl := math.Sin(dphi/2), math.Sin(dl/2)
	a := sd*sd + math.Cos(p1)*math.Cos(p2)*sl*sl
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(a)))
}
