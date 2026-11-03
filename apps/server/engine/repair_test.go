package engine

import (
	"context"
	"math"
	"testing"
)

// repairTestGraph is an 8 km grid with one 150 m summit 200 m off the bottom side of a 4 km square.
func repairTestGraph() (*testGraph, func(x, y int) int) {
	g := &testGraph{}
	at := g.grid(81, 81, func(x, y int) float64 {
		z := 100.0
		dx, dy := float64(x)-30, float64(y)-12
		z += 150 * math.Exp(-(dx*dx+dy*dy)/18)
		return z
	})
	return g, at
}

func pathBetween(t *testing.T, e *Engine, corners []uint32) summitPath {
	t.Helper()
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	var path summitPath
	for i := 1; i < len(corners); i++ {
		r := s.route(context.Background(), e, e.prof.UpPerMeter, nil, searchLimits{}, corners[i-1], corners[i])
		if r == nil {
			t.Fatalf("no leg from %d to %d", corners[i-1], corners[i])
		}
		if len(path.nodes) == 0 {
			path.nodes = append(path.nodes, r.nodes...)
		} else {
			path.nodes = append(path.nodes, r.nodes[1:]...)
		}
		path.edges = append(path.edges, r.edges...)
	}
	if len(path.edges) != len(path.nodes)-1 {
		t.Fatalf("path has %d nodes and %d edges", len(path.nodes), len(path.edges))
	}
	return path
}

func TestRepairDetoursALoopThroughASummit(t *testing.T) {
	// Arrange
	g, at := repairTestGraph()
	e := openTest(t, g, false)
	path := pathBetween(t, e, []uint32{
		uint32(at(10, 10)), uint32(at(10, 50)), uint32(at(50, 50)), uint32(at(50, 10)), uint32(at(10, 10)),
	})
	lp := &loopParams{
		distM: 16000, ascentM: 200, ascentBand: AscentBand{Share: 0.2, FloorM: 50}, distanceBand: 0.1,
	}

	// Act
	repaired := e.repairPaths(context.Background(), []summitPath{path}, lp)

	// Assert
	if len(repaired) != 1 {
		t.Fatalf("%d repaired paths, want 1", len(repaired))
	}
	dist, _, _ := measure(e.g, repaired[0].nodes, repaired[0].edges)
	gain := ascent(e.g, repaired[0].nodes)
	if gain < 100 {
		t.Errorf("gain = %.0f, want the summit's climb", gain)
	}
	if math.Abs(dist-16000) > lp.distanceBand*16000 {
		t.Errorf("distance = %.0f, want inside the 10 %% band of 16000", dist)
	}
	if len(repaired[0].edges) != len(repaired[0].nodes)-1 {
		t.Errorf("repaired path has %d nodes and %d edges", len(repaired[0].nodes), len(repaired[0].edges))
	}
}

func TestRepairLeavesAPathOutsideTheLengthBand(t *testing.T) {
	g, at := repairTestGraph()
	e := openTest(t, g, false)
	path := pathBetween(t, e, []uint32{
		uint32(at(10, 10)), uint32(at(10, 50)), uint32(at(50, 50)), uint32(at(50, 10)), uint32(at(10, 10)),
	})
	lp := &loopParams{
		distM: 20000, ascentM: 200, ascentBand: AscentBand{Share: 0.2, FloorM: 50}, distanceBand: 0.1,
	}

	if repaired := e.repairPaths(context.Background(), []summitPath{path}, lp); len(repaired) != 0 {
		t.Errorf("%d repaired paths, want none outside the band", len(repaired))
	}
}

func TestRepairLeavesAPathAlreadyInTheGainBand(t *testing.T) {
	g, at := repairTestGraph()
	e := openTest(t, g, false)
	path := pathBetween(t, e, []uint32{
		uint32(at(10, 10)), uint32(at(10, 50)), uint32(at(50, 50)), uint32(at(50, 10)), uint32(at(10, 10)),
	})
	lp := &loopParams{
		distM: 16000, ascentM: 50, ascentBand: AscentBand{Share: 0.2, FloorM: 50}, distanceBand: 0.1,
	}

	if repaired := e.repairPaths(context.Background(), []summitPath{path}, lp); len(repaired) != 0 {
		t.Errorf("%d repaired paths, want none already in the gain band", len(repaired))
	}
}

func TestRepairNeedsALengthBand(t *testing.T) {
	g, at := repairTestGraph()
	e := openTest(t, g, false)
	path := pathBetween(t, e, []uint32{
		uint32(at(10, 10)), uint32(at(10, 50)), uint32(at(50, 50)), uint32(at(50, 10)), uint32(at(10, 10)),
	})
	lp := &loopParams{distM: 16000, ascentM: 200, ascentBand: AscentBand{Share: 0.2, FloorM: 50}}

	if repaired := e.repairPaths(context.Background(), []summitPath{path}, lp); len(repaired) != 0 {
		t.Errorf("%d repaired paths, want none without a length band", len(repaired))
	}
}

func TestLoopsRepairAFlatLoopThroughASummit(t *testing.T) {
	// Arrange
	g, at := repairTestGraph()
	e := openTest(t, g, false)
	request := LoopRequest{
		Start: pointOf(g, at(10, 10)), Distance: 16000, Ascent: 200, Candidates: 5, Seed: 1,
		AscentBand: AscentBand{Share: 0.2, FloorM: 50}, DistanceBand: 0.1,
	}

	// Act
	routes, err := e.Loops(context.Background(), request)

	// Assert: the set holds a route near the target with a gain no circle reaches; the summit source or the repair
	// may supply it, so this test asserts the set, not which source.
	if err != nil {
		t.Fatal(err)
	}
	best := 0.0
	for _, r := range routes {
		best = math.Max(best, r.Ascent)
	}
	if best < 100 {
		t.Errorf("best gain = %.0f, want the repaired summit", best)
	}
}

func TestLollipopLocalRepairsTheLocalLoop(t *testing.T) {
	// Arrange: a flat 8 km grid with one 150 m summit 200 m from the start.
	g := &testGraph{}
	at := g.grid(81, 81, func(x, y int) float64 {
		z := 100.0
		dx, dy := float64(x)-12, float64(y)-10
		z += 150 * math.Exp(-(dx*dx+dy*dy)/18)
		return z
	})
	e := openTest(t, g, false)
	base, err := e.snapLoopStart(pointOf(g, at(10, 10)), nil)
	if err != nil {
		t.Fatal(err)
	}
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	lp := &loopParams{
		distM: 6100, ascentM: 300, ascentBand: AscentBand{Share: 0.2, FloorM: 50}, distanceBand: 0.1,
	}

	// Act
	paths := e.lollipopLocal(context.Background(), base, lp, s)

	// Assert: the local circle alone is flat; the repair detours it through the summit inside the band.
	found := false
	for _, p := range paths {
		dist, _, _ := measure(e.g, p.nodes, p.edges)
		if ascent(e.g, p.nodes) >= 100 && math.Abs(dist-lp.distM) <= lp.distanceBand*lp.distM {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("no repaired local loop: %d paths", len(paths))
	}
}
