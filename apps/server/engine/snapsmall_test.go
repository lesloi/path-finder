package engine

import (
	"context"
	"errors"
	"testing"
)

// islandBeside is a 1,200-node lattice from (0, 0) to (3,900 m, 2,900 m), and a two-node island at latM
// south of it, in the middle of its width.
func islandBeside(latM float64) (g *testGraph, island int) {
	g = &testGraph{}
	g.grid(30, 40, flat)
	island = g.addNode(latM, 1500, 100)
	g.connect(island, g.addNode(latM-50, 1500, 100), KindPath)
	return g, island
}

func islandLoops(g *testGraph, n int) LoopRequest {
	return LoopRequest{Start: pointOf(g, n), Distance: 3000, Candidates: 12, Seed: 7}
}

func TestAStartOnAnIslandIsServedFromTheNearbyLattice(t *testing.T) {
	// Arrange
	g, island := islandBeside(-300)
	e := openTest(t, g, false)
	if !e.g.small.has(uint32(island)) {
		t.Fatal("the island is not small")
	}
	// Act
	loops, err := e.Loops(context.Background(), islandLoops(g, island))
	// Assert
	if err != nil || len(loops) == 0 {
		t.Fatalf("%d loops, err = %v: want loops from the lattice", len(loops), err)
	}
	if lat := loops[0].Points[0].Lat; lat < baseLat-1e-6 {
		t.Errorf("the loop starts at latitude %v, on the island", lat)
	}
}

func TestAnIslandAloneAnswersNoLoopWithoutSearching(t *testing.T) {
	// Arrange: the lattice is 1,000 m away, out of the snap reach
	g, island := islandBeside(-1000)
	e := openTest(t, g, false)
	if !e.g.small.has(uint32(island)) {
		t.Fatal("the island is not small")
	}
	// A search that ran would end on the cancelled context.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// Act
	loops, err := e.Loops(ctx, islandLoops(g, island))
	// Assert
	if !errors.Is(err, ErrNoLoop) || loops != nil {
		t.Fatalf("loops = %d, err = %v, want ErrNoLoop", len(loops), err)
	}
}

func TestAStartFarFromEveryWayIsStillOffTheGraph(t *testing.T) {
	// Arrange
	g, _ := islandBeside(-300)
	e := openTest(t, g, false)
	req := islandLoops(g, 0)
	req.Start.Lat -= 0.02 // about 2 km south of the island
	// Act
	_, err := e.Loops(context.Background(), req)
	// Assert
	if !errors.Is(err, ErrOffGraph) {
		t.Errorf("err = %v, want ErrOffGraph", err)
	}
}

func TestAWaypointOnAnIslandIsMovedToTheNearbyLattice(t *testing.T) {
	// Arrange
	g, island := islandBeside(-200)
	e := openTest(t, g, false)
	req := islandLoops(g, 15*30+15)
	req.Waypoints = []Point{pointOf(g, island)}
	// Act
	loops, err := e.Loops(context.Background(), req)
	// Assert
	if err != nil || len(loops) == 0 {
		t.Fatalf("%d loops, err = %v", len(loops), err)
	}
	for _, p := range loops[0].Points {
		if p.Lat < baseLat-1e-6 {
			t.Fatalf("the loop goes to latitude %v, on the island", p.Lat)
		}
	}
}

func TestAWaypointWithOnlyAnIslandInReachFindsNoRoute(t *testing.T) {
	// Arrange
	g, island := islandBeside(-1000)
	e := openTest(t, g, false)
	req := islandLoops(g, 15*30+15)
	req.Waypoints = []Point{pointOf(g, island)}
	// Act
	_, err := e.Loops(context.Background(), req)
	_, direct := e.DirectLoop(context.Background(), DirectLoopRequest{Start: req.Start, Waypoints: req.Waypoints})
	// Assert
	if !errors.Is(err, ErrNoRoute) || !errors.Is(direct, ErrNoRoute) {
		t.Errorf("loops: %v, direct loop: %v, want ErrNoRoute", err, direct)
	}
}

func TestADirectLoopKeepsAWaypointOnAnIslandWhereItIs(t *testing.T) {
	// Arrange: the lattice is within a waypoint's reach, which only loops use to move off islands
	g, island := islandBeside(-200)
	e := openTest(t, g, false)
	// Act
	_, err := e.DirectLoop(context.Background(), DirectLoopRequest{Start: pointOf(g, 15*30+15), Waypoints: []Point{pointOf(g, island)}})
	// Assert
	if !errors.Is(err, ErrNoRoute) {
		t.Errorf("err = %v, want ErrNoRoute", err)
	}
}

func TestNearestOutsideStopsAtItsReach(t *testing.T) {
	// Arrange
	g := &testGraph{}
	here := g.addNode(0, 0, 100)
	g.addNode(0, 390, 100)
	g.addNode(390, 0, 100)
	e := openTest(t, g, false)
	skip := make(nodeSet, 1)
	skip[0] = 1 << uint(here)
	p := pointOf(g, here)
	// Act
	_, dFar, okFar := e.sp.nearestOutside(e.g, p.Lat, p.Lon, skip, 400)
	_, dNear, okNear := e.sp.nearestOutside(e.g, p.Lat, p.Lon, skip, 150)
	// Assert
	if !okFar || dFar > 400 {
		t.Errorf("reach 400: ok = %v, d = %v, want a node 390 m away", okFar, dFar)
	}
	if okNear && dNear <= 150 {
		t.Errorf("reach 150: found a node at %v m", dNear)
	}
}

func TestTheShortestWaypointLoopFollowsTheLoopsOffAnIsland(t *testing.T) {
	// Arrange: a start and a waypoint on a small island with a detour, and a lattice 150 m away; the loop search moves
	// the two points to the lattice, where the loop is shorter than the island's.
	g := &testGraph{}
	g.grid(30, 40, flat)
	start := g.addNode(-150, 1000, 100)
	mid := g.addNode(-600, 1500, 100)
	wp := g.addNode(-150, 2000, 100)
	g.connect(start, mid, KindPath)
	g.connect(mid, wp, KindPath)
	e := openTest(t, g, false)
	if !e.g.small.has(uint32(start)) {
		t.Fatal("the island is not small")
	}
	// Act
	r, err := e.DirectLoop(context.Background(), DirectLoopRequest{Start: pointOf(g, start), Waypoints: []Point{pointOf(g, wp)}})
	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if !(r.Shortest > 0 && r.Shortest < r.Distance) {
		t.Errorf("shortest = %v, distance = %v: the loops move off the island, so their bound is not the island's loop", r.Shortest, r.Distance)
	}
}
