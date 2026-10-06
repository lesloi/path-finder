// Package graphbuild turns OSM PBF files and BD ALTI tiles into the graph file the engine maps. It runs
// ahead of serving, as a job: it needs far more memory than serving does.
package graphbuild

import (
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"sort"
	"time"

	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"

	"github.com/lesloi/path-finder/apps/server/elevation"
	"github.com/lesloi/path-finder/apps/server/engine"
)

type rawWay struct {
	kind, surf uint8
	ids        []int64
	idx        []uint32
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
	"paving_stones": engine.SurfacePaved, "metal": engine.SurfacePaved, "wood": engine.SurfacePaved, "sett": engine.SurfacePaved,
	"compacted": engine.SurfaceCompact, "fine_gravel": engine.SurfaceCompact, "gravel": engine.SurfaceCompact, "unpaved": engine.SurfaceCompact,
	"dirt": engine.SurfaceRough, "earth": engine.SurfaceRough, "ground": engine.SurfaceRough, "grass": engine.SurfaceRough, "sand": engine.SurfaceRough, "mud": engine.SurfaceRough,
	"rock": engine.SurfaceRough, "pebblestone": engine.SurfaceRough, "cobblestone": engine.SurfaceRough, "grass_paver": engine.SurfaceRough, "woodchips": engine.SurfaceRough,
}

// classifyWay decides whether a pedestrian can use a way, and under which kind and surface group.
func classifyWay(tags osm.Tags) (kind, surf uint8, ok bool) {
	hw := tags.Find("highway")
	kind, ok = highwayKinds[hw]
	if !ok {
		return 0, 0, false
	}
	foot := tags.Find("foot")
	if foot == "no" || tags.Find("area") == "yes" {
		return 0, 0, false
	}
	explicit := foot == "yes" || foot == "designated" || foot == "permissive"
	switch tags.Find("access") {
	case "no", "private":
		if !explicit {
			return 0, 0, false
		}
	}
	if kind == engine.KindTrunk && !explicit {
		return 0, 0, false
	}
	if kind == engine.KindCycleway && !explicit && foot != "" {
		return 0, 0, false
	}
	return kind, surfaceGroups[tags.Find("surface")], true
}

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
		kind, surf, ok := classifyWay(w.Tags)
		if !ok || len(w.Nodes) < 2 {
			continue
		}
		ids := make([]int64, len(w.Nodes))
		for i, n := range w.Nodes {
			ids[i] = int64(n.ID)
		}
		ways = append(ways, rawWay{kind: kind, surf: surf, ids: ids})
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
// on every node, and reports its steps to log.
func Build(pbfPaths []string, demDir, outPath string, log io.Writer) error {
	p := progress{log, time.Now()}
	dem, err := elevation.Load(demDir)
	if err != nil {
		return err
	}
	p.step("BD ALTI: %d tiles", dem.Tiles())

	var ways []rawWay
	for _, path := range pbfPaths {
		w, err := readWays(path)
		if err != nil {
			return err
		}
		ways = append(ways, w...)
	}
	p.step("pass 1: %d walkable ways", len(ways))

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

	elev := dem.Sample(lat, lon)
	p.step("elevation sampled")

	nodes, off, edges := assemble(ways, lat, lon, elev)
	p.step("graph: %d nodes, %d directed edges", len(nodes), len(edges))
	if len(edges) == 0 {
		return fmt.Errorf("no walkable way has elevation: check that %s holds the BD ALTI tiles of the area the extracts cover", demDir)
	}

	if err := engine.WriteGraph(outPath, nodes, off, edges); err != nil {
		return err
	}
	st, _ := os.Stat(outPath)
	p.step("written %s (%d MB)", outPath, st.Size()>>20)
	return nil
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
	add := func(a, b uint32, l float32, kind, surf uint8) {
		e := off[a] + fill[a]
		fill[a]++
		edges[e] = engine.Edge{To: b, Len: l, Kind: kind, Surf: surf}
	}
	for _, w := range ways {
		for i := 1; i < len(w.idx); i++ {
			a, b := w.idx[i-1], w.idx[i]
			if a == b || elev[a] == elevation.Unknown || elev[b] == elevation.Unknown {
				continue
			}
			ra, rb := remap[a], remap[b]
			l := float32(haversineM(lat[a], lon[a], lat[b], lon[b]))
			add(ra, rb, l, w.kind, w.surf)
			add(rb, ra, l, w.kind, w.surf)
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
	// One square cell size for both axes, so that the curve does not stretch along one of them.
	span := max(int64(maxLat)-int64(minLat), int64(maxLon)-int64(minLon))
	cell := span>>hilbertOrder + 1

	type keyed struct {
		key  uint64
		node uint32
	}
	order := make([]keyed, 0, len(deg))
	for i, d := range deg {
		if d > 0 {
			x, y := uint32((int64(lon[i])-int64(minLon))/cell), uint32((int64(lat[i])-int64(minLat))/cell)
			order = append(order, keyed{hilbertKey(x, y, hilbertOrder), uint32(i)})
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
	a := math.Sin(dphi/2)*math.Sin(dphi/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(a)))
}
