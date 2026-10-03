package main

import (
	"context"
	"fmt"
	"math"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"
)

type rawWay struct {
	kind, surf uint8
	ids        []int64
	idx        []uint32
}

var highwayKinds = map[string]uint8{
	"path": kPath, "footway": kFootway, "pedestrian": kPedestrian, "bridleway": kBridleway, "track": kTrack,
	"cycleway": kCycleway, "steps": kSteps, "living_street": kLivingStreet, "residential": kResidential,
	"service": kService, "unclassified": kUnclassified, "tertiary": kTertiary, "tertiary_link": kTertiary,
	"secondary": kSecondary, "secondary_link": kSecondary, "primary": kPrimary, "primary_link": kPrimary,
	"trunk": kTrunk, "trunk_link": kTrunk,
}

var surfaceGroups = map[string]uint8{
	"asphalt": sPaved, "paved": sPaved, "concrete": sPaved, "concrete:plates": sPaved, "concrete:lanes": sPaved,
	"paving_stones": sPaved, "metal": sPaved, "wood": sPaved, "sett": sPaved,
	"compacted": sCompact, "fine_gravel": sCompact, "gravel": sCompact, "unpaved": sCompact,
	"dirt": sRough, "earth": sRough, "ground": sRough, "grass": sRough, "sand": sRough, "mud": sRough,
	"rock": sRough, "pebblestone": sRough, "cobblestone": sRough, "grass_paver": sRough, "woodchips": sRough,
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
	if kind == kTrunk && !explicit {
		return 0, 0, false
	}
	if kind == kCycleway && !explicit && foot != "" {
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

func logStep(start time.Time, format string, args ...any) {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	fmt.Fprintf(os.Stderr, "[%6.1fs heap=%4dMB] %s\n", time.Since(start).Seconds(), ms.HeapAlloc>>20, fmt.Sprintf(format, args...))
}

// buildGraph turns an OSM PBF and BD ALTI tiles into a graph file with elevation on every node.
func buildGraph(pbfPaths []string, demDir, outPath string) error {
	start := time.Now()
	dem, err := loadDEM(demDir)
	if err != nil {
		return err
	}
	logStep(start, "BD ALTI: %d tiles", len(dem.tiles))

	var ways []rawWay
	for _, path := range pbfPaths {
		w, err := readWays(path)
		if err != nil {
			return err
		}
		ways = append(ways, w...)
	}
	logStep(start, "pass 1: %d walkable ways", len(ways))

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
	logStep(start, "%d candidate nodes", n)

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
	logStep(start, "pass 2: node coordinates read")

	elev := make([]int16, n)
	var wg sync.WaitGroup
	chunk := (n + runtime.NumCPU() - 1) / runtime.NumCPU()
	for lo := 0; lo < n; lo += chunk {
		hi := min(lo+chunk, n)
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := lo; i < hi; i++ {
				elev[i] = elevUnknown
				if lat[i] == math.MinInt32 {
					continue
				}
				if z := dem.elevation(float64(lat[i])*1e-7, float64(lon[i])*1e-7); !math.IsNaN(float64(z)) {
					elev[i] = int16(math.Round(float64(z) * 10))
				}
			}
		}()
	}
	wg.Wait()
	logStep(start, "elevation sampled")

	deg := make([]uint32, n)
	for _, w := range ways {
		for i := 1; i < len(w.idx); i++ {
			a, b := w.idx[i-1], w.idx[i]
			if a != b && elev[a] != elevUnknown && elev[b] != elevUnknown {
				deg[a]++
				deg[b]++
			}
		}
	}
	remap := make([]uint32, n)
	var kept uint32
	for i, d := range deg {
		if d > 0 {
			remap[i] = kept
			kept++
		} else {
			remap[i] = math.MaxUint32
		}
	}
	nodes := make([]nodeV2, kept)
	off := make([]uint32, kept+1)
	for i, d := range deg {
		if r := remap[i]; r != math.MaxUint32 {
			nodes[r] = nodeV2{Lat: lat[i], Lon: lon[i], Elev: elev[i]}
			off[r+1] = d
		}
	}
	for i := uint32(0); i < kept; i++ {
		off[i+1] += off[i]
	}
	edgeCount := off[kept]
	edges := make([]edgeV2, edgeCount)
	fill := make([]uint32, kept)
	add := func(a, b uint32, l float32, kind, surf uint8) {
		e := off[a] + fill[a]
		fill[a]++
		edges[e] = edgeV2{To: b, Len: l, Kind: kind, Surf: surf}
	}
	for _, w := range ways {
		for i := 1; i < len(w.idx); i++ {
			a, b := w.idx[i-1], w.idx[i]
			if a == b || elev[a] == elevUnknown || elev[b] == elevUnknown {
				continue
			}
			ra, rb := remap[a], remap[b]
			l := float32(haversineM(lat[a], lon[a], lat[b], lon[b]))
			add(ra, rb, l, w.kind, w.surf)
			add(rb, ra, l, w.kind, w.surf)
		}
	}
	logStep(start, "graph: %d nodes, %d directed edges", kept, edgeCount)

	if err := writeGraphV2(outPath, nodes, off, edges); err != nil {
		return err
	}
	st, _ := os.Stat(outPath)
	logStep(start, "written %s (%d MB)", outPath, st.Size()>>20)
	return nil
}

const (
	elevUnknown  = math.MinInt16
	earthRadiusM = 6371008.8
)

// haversineM returns the great-circle distance in metres between two 1e-7 degree points.
func haversineM(lat1, lon1, lat2, lon2 int32) float64 {
	p1, p2 := float64(lat1)*1e-7*rad, float64(lat2)*1e-7*rad
	dphi := p2 - p1
	dl := (float64(lon2) - float64(lon1)) * 1e-7 * rad
	a := math.Sin(dphi/2)*math.Sin(dphi/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(a)))
}
