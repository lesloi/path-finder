package engine

import (
	"context"
	"math"
	"slices"
	"testing"
)

// TestTerrainHeadingPointsToTheHighGround checks that the direction of the highest ground around the start is the one
// a loop with an elevation gain to make heads off in.
func TestTerrainHeadingPointsToTheHighGround(t *testing.T) {
	// Arrange: a lattice rising towards the east, the start in the middle.
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(x)*20 })
	e := openTest(t, g, false)

	// Act
	heading, ok := e.terrainHeading(uint32(at(20, 20)), 2000, nil)

	// Assert
	if !ok {
		t.Fatal("no heading on a slope")
	}
	if math.Abs(heading) > math.Pi/8 {
		t.Errorf("heading = %v rad, want east", heading)
	}
}

// TestTerrainHeadingLeavesAFlatAreaAlone checks that no direction is forced where the ground is the same all round.
func TestTerrainHeadingLeavesAFlatAreaAlone(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, flat)
	e := openTest(t, g, false)

	if heading, ok := e.terrainHeading(uint32(at(20, 20)), 2000, nil); ok {
		t.Errorf("a flat area has a heading of %v rad", heading)
	}
}

// TestACandidateHeadsForItsHeading checks that the search uses the heading, not just computes it: the same candidate
// with an east heading loops east, and with a west heading loops west.
func TestACandidateHeadsForItsHeading(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(x)*20 })
	e := openTest(t, g, false)
	start := uint32(at(20, 20))

	east := candidateAt(t, e, start, 0, 0)
	west := candidateAt(t, e, start, math.Pi, 0)

	if meanLon(e.g, east.nodes, start) <= 0 {
		t.Errorf("heading east: the loop is not east (%.1f)", meanLon(e.g, east.nodes, start))
	}
	if meanLon(e.g, west.nodes, start) >= 0 {
		t.Errorf("heading west: the loop is not west (%.1f)", meanLon(e.g, west.nodes, start))
	}
}

// TestAnOddCandidateKeepsARandomDirection checks the half of the candidates that must not read the heading, so a high
// sector that fails cannot empty a whole request.
func TestAnOddCandidateKeepsARandomDirection(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(x)*20 })
	e := openTest(t, g, false)
	start := uint32(at(20, 20))

	for _, index := range []int{1, 3} {
		east := candidateAt(t, e, start, 0, index)
		west := candidateAt(t, e, start, math.Pi, index)
		if !slices.Equal(east.nodes, west.nodes) {
			t.Errorf("candidate %d changed with the heading: an odd candidate must keep a random direction", index)
		}
	}
}

func candidateAt(t *testing.T, e *Engine, start uint32, heading float64, index int) *loopResult {
	t.Helper()
	lp := &loopParams{distM: 10_000, candidates: 1, seed: 7, heading: heading, hasHeading: true}
	best, cause := candidateLoop(context.Background(), e, e.sp, newSearcher(), lp, start, index)
	if best == nil {
		t.Fatalf("no loop for heading %v, candidate %d: %v", heading, index, cause)
	}
	return best
}

// meanLon is the mean longitude of a loop's nodes, in 1e-7 degrees, from the start.
func meanLon(g *graph, nodes []uint32, start uint32) float64 {
	var sum float64
	for _, n := range nodes {
		sum += float64(g.nodes[n].Lon)
	}
	return sum/float64(len(nodes)) - float64(g.nodes[start].Lon)
}

// TestTerrainHeadingSkipsAnAvoidedSector checks that high ground a route may not enter does not pull the loops.
func TestTerrainHeadingSkipsAnAvoidedSector(t *testing.T) {
	g := &testGraph{}
	start := g.addNode(0, 0, 100)
	high := g.addNode(0, 1000, 300)
	g.addNode(0, -1000, 100)
	e := openTest(t, g, false)
	f := e.g.forbiddenFor([]Circle{{Center: pointOf(g, high), RadiusM: 200}})

	if heading, ok := e.terrainHeading(uint32(start), 2000, f); ok {
		t.Errorf("the avoided high ground gave a heading of %v rad", heading)
	}
}

// TestTerrainHeadingAtTheWestSeam checks the western edge of the sectors, where the bearing wraps around pi.
func TestTerrainHeadingAtTheWestSeam(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(40-x)*20 })
	e := openTest(t, g, false)

	heading, ok := e.terrainHeading(uint32(at(20, 20)), 2000, nil)

	if !ok {
		t.Fatal("no heading on a westward slope")
	}
	if math.Abs(math.Abs(heading)-math.Pi) > math.Pi/8 {
		t.Errorf("heading = %v rad, want west", heading)
	}
}

// TestTerrainHeadingIgnoresTheStartGround checks that a hill right beside the start does not give a direction.
func TestTerrainHeadingIgnoresTheStartGround(t *testing.T) {
	g := &testGraph{}
	start := g.addNode(0, 0, 100)
	g.addNode(0, 100, 300) // inside reach/4 of a 2 km scan
	g.addNode(0, -1000, 100)
	e := openTest(t, g, false)

	if heading, ok := e.terrainHeading(uint32(start), 2000, nil); ok {
		t.Errorf("the ground beside the start gave a heading of %v rad", heading)
	}
}

// TestExtraIsTheDetourOfAWaypointLoop checks the length a waypoint loop has to add, which also sizes the ground the
// heading looks at.
func TestExtraIsTheDetourOfAWaypointLoop(t *testing.T) {
	lp := &loopParams{distM: 30_000, anchors: []uint32{1, 2, 1}, baseM: 25_000}
	if got := lp.extra(); got != 5_000 {
		t.Errorf("detour = %v, want 5000", got)
	}
	lp.baseM = 29_000
	if got := lp.extra(); got != 4_500 {
		t.Errorf("detour under the floor = %v, want 4500", got)
	}
	lp.effort = &EffortTarget{Metres: 30_000}
	lp.baseEffort = 20_000
	if got := lp.extra(); got != 10_000 {
		t.Errorf("effort detour = %v, want 10000", got)
	}
	lp.anchors = nil
	if got := lp.extra(); got != 30_000 {
		t.Errorf("a loop without waypoints = %v, want its whole distance", got)
	}
}
