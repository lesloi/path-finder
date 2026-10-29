package engine

import (
	"context"
	"testing"
)

// TestDirectLoopShortestIsTheShortestLength checks that the bound is the shortest length through the waypoints, not
// the cheapest chain for the profile: a steep way costs more to climb but can be shorter.
func TestDirectLoopShortestIsTheShortestLength(t *testing.T) {
	// Arrange: a flat way, and two steep ways that are shorter but cost more to climb; a loop cannot retrace one way.
	g := &testGraph{}
	start := g.addNode(0, 0, 100)
	wp := g.addNode(0, 1000, 100)
	steep1 := g.addNode(0, 500, 300)
	steep2 := g.addNode(0, 500, 400)
	flat := g.addNode(-300, 500, 100)
	for _, n := range []int{steep1, steep2, flat} {
		g.connect(start, n, KindPath)
		g.connect(n, wp, KindPath)
	}
	e := openTest(t, g, false)

	// Act
	r, err := e.DirectLoop(context.Background(), DirectLoopRequest{Start: pointOf(g, start), Waypoints: []Point{pointOf(g, wp)}})

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if !(r.Shortest > 0 && r.Shortest < r.Distance) {
		t.Errorf("shortest = %v, distance = %v: the steep ways are shorter but cost more to climb", r.Shortest, r.Distance)
	}
}
