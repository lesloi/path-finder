package engine

import (
	"context"
	"math"
	"testing"
)

// summitTestGraph is a 4 km square of paths with three peaks around a low start, so the circles cannot reach
// every summit within one loop of 8 km.
func summitTestGraph() (*testGraph, func(x, y int) int) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 {
		z := 100.0
		for _, p := range [][3]float64{{10, 10, 80}, {30, 10, 80}, {20, 30, 80}} {
			dx, dy := float64(x)-p[0], float64(y)-p[1]
			z += p[2] * math.Exp(-(dx*dx+dy*dy)/18)
		}
		return z
	})
	return g, at
}

func summitStart(t *testing.T, g *testGraph, at func(x, y int) int, x, y int) *Engine {
	t.Helper()
	e := openTest(t, g, false)
	if _, err := e.snapLoopStart(pointOf(g, at(x, y)), nil); err != nil {
		t.Fatal(err)
	}
	return e
}

func TestSummitLoopsClimbThePeaks(t *testing.T) {
	// Arrange
	g, at := summitTestGraph()
	e := openTest(t, g, false)
	start, err := e.snapLoopStart(pointOf(g, at(20, 20)), nil)
	if err != nil {
		t.Fatal(err)
	}
	lp := &loopParams{distM: 8000, ascentM: 180}

	// Act
	routes := e.summitLoops(context.Background(), start, lp)

	// Assert
	if len(routes) == 0 {
		t.Fatal("no summit loop")
	}
	best := routes[0]
	for _, r := range routes {
		if r.Ascent > best.Ascent {
			best = r
		}
	}
	if best.Ascent < 120 {
		t.Errorf("ascent = %.0f, want at least 120", best.Ascent)
	}
	if best.Distance < 6000 || best.Distance > 10000 {
		t.Errorf("distance = %.0f, want about 8000", best.Distance)
	}
	high := 0.0
	for _, p := range best.Points {
		high = math.Max(high, p.Elevation)
	}
	if high < 170 {
		t.Errorf("highest point = %.0f, want a summit", high)
	}
}

func TestSummitLoopsFindNothingOnFlatGround(t *testing.T) {
	// Arrange
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	start, err := e.snapLoopStart(pointOf(g, at(10, 10)), nil)
	if err != nil {
		t.Fatal(err)
	}

	// Act
	routes := e.summitLoops(context.Background(), start, &loopParams{distM: 3000, ascentM: 100})

	// Assert
	if len(routes) != 0 {
		t.Errorf("routes = %d, want none", len(routes))
	}
}

func TestSummitLoopsAreDeterministic(t *testing.T) {
	// Arrange
	g, at := summitTestGraph()
	e := openTest(t, g, false)
	start, err := e.snapLoopStart(pointOf(g, at(20, 20)), nil)
	if err != nil {
		t.Fatal(err)
	}
	lp := &loopParams{distM: 8000, ascentM: 180}

	// Act
	first := e.summitLoops(context.Background(), start, lp)
	second := e.summitLoops(context.Background(), start, lp)

	// Assert
	if len(first) != len(second) || len(first) == 0 {
		t.Fatalf("routes = %d then %d, want the same non-zero count", len(first), len(second))
	}
	for i := range first {
		if first[i].Distance != second[i].Distance || first[i].Ascent != second[i].Ascent ||
			len(first[i].Points) != len(second[i].Points) {
			t.Errorf("route %d changed between runs: %+v then %+v", i, first[i], second[i])
		}
	}
}

func TestCirclesMetGain(t *testing.T) {
	band := AscentBand{Share: 0.2, FloorM: 50}
	found := []*loopResult{{ascent: 180}, {ascent: 100}}

	if !circlesMetGain(found, 180, band) {
		t.Error("a loop at the target is not within its band")
	}
	if circlesMetGain(found, 300, band) {
		t.Error("a loop 120 m below a 300 m target is within its band")
	}
	if circlesMetGain(nil, 180, band) {
		t.Error("no circle met the gain")
	}
}

func TestSummitWanted(t *testing.T) {
	band := AscentBand{Share: 0.2, FloorM: 50}
	base := LoopRequest{Ascent: 500, AscentBand: band}
	if summitWanted(base, []*loopResult{{ascent: 450}}) {
		t.Error("a circle within the band still wants the summit source")
	}
	if !summitWanted(base, []*loopResult{{ascent: 300}}) {
		t.Error("a circle 200 m below the target does not want the summit source")
	}

	withWaypoint := base
	withWaypoint.Waypoints = []Point{{}}
	if summitWanted(withWaypoint, []*loopResult{{ascent: 300}}) {
		t.Error("a waypoint request wants the summit source")
	}
	withEffort := base
	withEffort.Effort = &EffortTarget{Metres: 5000}
	if summitWanted(withEffort, []*loopResult{{ascent: 300}}) {
		t.Error("a duration target wants the summit source")
	}
	withoutGain := base
	withoutGain.Ascent = 0
	if summitWanted(withoutGain, []*loopResult{{ascent: 300}}) {
		t.Error("a request without a gain target wants the summit source")
	}
}

func TestSummitLoopsStopWhenCancelled(t *testing.T) {
	g, at := summitTestGraph()
	e := openTest(t, g, false)
	start, err := e.snapLoopStart(pointOf(g, at(20, 20)), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if routes := e.summitLoops(ctx, start, &loopParams{distM: 8000, ascentM: 180}); len(routes) != 0 {
		t.Errorf("routes = %d, want none", len(routes))
	}
}

func TestLoopsAddSummitsWhenTheGainIsNotMet(t *testing.T) {
	// Arrange
	g, at := summitTestGraph()
	e := openTest(t, g, false)
	request := LoopRequest{
		Start: pointOf(g, at(20, 20)), Distance: 8000, Ascent: 250, Candidates: 3, Seed: 1,
		AscentBand: AscentBand{Share: 0.2, FloorM: 50},
	}

	// Act
	routes, err := e.Loops(context.Background(), request)

	// Assert: the circles cannot reach 250 m here, so the summit source adds its tours behind them.
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) <= 3 {
		t.Errorf("routes = %d, want the summit source to add some", len(routes))
	}
}
