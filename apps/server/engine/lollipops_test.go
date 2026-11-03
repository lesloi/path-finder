package engine

import (
	"context"
	"math"
	"testing"
)

// lollipopTestGraph is an 8 km plain with a cluster of three peaks about 5 km from a low start, just beyond the
// summit source's reach (a quarter of 16 km), so the lollipop is what can reach it.
func lollipopTestGraph() (*testGraph, func(x, y int) int) {
	g := &testGraph{}
	at := g.grid(81, 81, func(x, y int) float64 {
		z := 100.0
		for _, p := range [][3]float64{{42, 45, 80}, {48, 45, 80}, {45, 51, 80}} {
			dx, dy := float64(x)-p[0], float64(y)-p[1]
			z += p[2] * math.Exp(-(dx*dx+dy*dy)/18)
		}
		return z
	})
	return g, at
}

func lollipopStart(t *testing.T, g *testGraph, at func(x, y int) int, x, y int) *Engine {
	t.Helper()
	e := openTest(t, g, false)
	if _, err := e.snapLoopStart(pointOf(g, at(x, y)), nil); err != nil {
		t.Fatal(err)
	}
	return e
}

func TestLollipopReachesAFarCluster(t *testing.T) {
	// Arrange
	g, at := lollipopTestGraph()
	e := lollipopStart(t, g, at, 10, 10)
	start, err := e.snapLoopStart(pointOf(g, at(10, 10)), nil)
	if err != nil {
		t.Fatal(err)
	}
	lp := &loopParams{distM: 16000, ascentM: 300, ascentBand: AscentBand{Share: 0.2, FloorM: 50}}

	// Act
	routes := e.lollipopLoops(context.Background(), start, lp)

	// Assert
	if len(routes) == 0 {
		t.Fatal("no lollipop")
	}
	best := routes[0]
	for _, r := range routes {
		if math.Abs(r.Distance-16000) < math.Abs(best.Distance-16000) {
			best = r
		}
	}
	if best.Ascent < 80 {
		t.Errorf("ascent = %.0f, want the cluster's climb", best.Ascent)
	}
	if best.Distance < 12000 || best.Distance > 20000 {
		t.Errorf("distance = %.0f, want about 16000", best.Distance)
	}
	high := 0.0
	for _, p := range best.Points {
		high = math.Max(high, p.Elevation)
	}
	if high < 150 {
		t.Errorf("highest point = %.0f, want a summit of the far cluster", high)
	}
	if !best.Lollipop {
		t.Error("the route is not marked as a lollipop")
	}
}

func TestLollipopFindNothingOnFlatGround(t *testing.T) {
	// Arrange
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := lollipopStart(t, g, at, 10, 10)
	start, err := e.snapLoopStart(pointOf(g, at(10, 10)), nil)
	if err != nil {
		t.Fatal(err)
	}

	// Act
	routes := e.lollipopLoops(context.Background(), start, &loopParams{
		distM: 3000, ascentM: 100, ascentBand: AscentBand{Share: 0.2, FloorM: 50},
	})

	// Assert
	if len(routes) != 0 {
		t.Errorf("routes = %d, want none", len(routes))
	}
}

func TestLollipopAreDeterministic(t *testing.T) {
	// Arrange
	g, at := lollipopTestGraph()
	e := lollipopStart(t, g, at, 10, 10)
	start, err := e.snapLoopStart(pointOf(g, at(10, 10)), nil)
	if err != nil {
		t.Fatal(err)
	}
	lp := &loopParams{distM: 16000, ascentM: 300, ascentBand: AscentBand{Share: 0.2, FloorM: 50}}

	// Act
	first := e.lollipopLoops(context.Background(), start, lp)
	second := e.lollipopLoops(context.Background(), start, lp)

	// Assert
	if len(first) != len(second) || len(first) == 0 {
		t.Fatalf("routes = %d then %d, want the same non-zero count", len(first), len(second))
	}
	for i := range first {
		if first[i].Distance != second[i].Distance || first[i].Ascent != second[i].Ascent ||
			len(first[i].Points) != len(second[i].Points) {
			t.Errorf("route %d changed between runs", i)
			continue
		}
		for k := range first[i].Points {
			if first[i].Points[k] != second[i].Points[k] {
				t.Errorf("route %d changed at point %d", i, k)
				break
			}
		}
	}
}

func TestLoopsAddALollipopWhenTheGainIsStillMissed(t *testing.T) {
	// Arrange
	g, at := lollipopTestGraph()
	e := openTest(t, g, false)
	request := LoopRequest{
		Start: pointOf(g, at(10, 10)), Distance: 16000, Ascent: 300, Candidates: 3, Seed: 1,
		AscentBand: AscentBand{Share: 0.2, FloorM: 50},
	}

	// Act
	routes, err := e.Loops(context.Background(), request)

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, r := range routes {
		found = found || r.Lollipop
	}
	if !found {
		t.Errorf("routes = %d, no lollipop among them", len(routes))
	}
}

func TestRoutesMetGain(t *testing.T) {
	band := AscentBand{Share: 0.2, FloorM: 50}
	if !routesMetGain([]*Route{{Ascent: 300}}, 300, band) {
		t.Error("a route at the target is not within its band")
	}
	if routesMetGain([]*Route{{Ascent: 100}}, 300, band) {
		t.Error("a route 200 m below the target is within its band")
	}
	if routesMetGain(nil, 300, band) {
		t.Error("no route met the gain")
	}
}

func TestLollipopLocalFindsNothingOnANode(t *testing.T) {
	// Arrange
	g := &testGraph{}
	at := g.grid(1, 1, flat)
	e := openTest(t, g, false)
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	lp := &loopParams{distM: 3000, ascentM: 100, ascentBand: AscentBand{Share: 0.2, FloorM: 50}}

	// Act
	paths := e.lollipopLocal(context.Background(), uint32(at(0, 0)), lp, s)

	// Assert
	if len(paths) != 0 {
		t.Errorf("paths = %d, want none on a graph with one node", len(paths))
	}
}
