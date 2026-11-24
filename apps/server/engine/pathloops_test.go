package engine

import (
	"context"
	"errors"
	"math"
	"testing"
)

// pathRequest asks for routes of 3 km from one side of the lattice to the other, 1.4 km apart in a straight line.
func pathRequest(g *testGraph, at func(x, y int) int) LoopRequest {
	end := pointOf(g, at(17, 10))
	return LoopRequest{Start: pointOf(g, at(3, 10)), End: &end, Distance: 3000, Candidates: 16, Seed: 7}
}

func TestLoopsWithAnEndPointFinishThereAndDetourToTheTarget(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := pathRequest(g, at)

	routes, err := e.Loops(context.Background(), req)

	if err != nil {
		t.Fatal(err)
	}
	var close int
	for _, r := range routes {
		if first, last := r.Points[0], r.Points[len(r.Points)-1]; first.Point != req.Start || last.Point != *req.End {
			t.Fatalf("a route runs from %v to %v, want %v to %v", first.Point, last.Point, req.Start, *req.End)
		}
		if math.Abs(r.Distance-3000) < 450 {
			close++
		}
	}
	if close == 0 {
		t.Errorf("none of %d routes is within 450 m of the 3 km target", len(routes))
	}
}

func TestLoopsWithAnEndPointGoThroughTheWaypointsInOrder(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := pathRequest(g, at)
	via := []Point{pointOf(g, at(8, 14)), pointOf(g, at(13, 6))}
	req.Waypoints = via

	routes, err := e.Loops(context.Background(), req)

	if err != nil {
		t.Fatal(err)
	}
	for _, r := range routes {
		if !visitOrder(r, via...) || r.Points[len(r.Points)-1].Point != *req.End {
			t.Errorf("a route does not go through the waypoints in order and end at the end point")
		}
	}
}

func TestLoopsWithAnEndPointAreTheSameForTheSameSeed(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := pathRequest(g, at)

	a, errA := e.Loops(context.Background(), req)
	b, errB := e.Loops(context.Background(), req)

	// The workers finish in no particular order: the routes are compared as a set.
	sum := func(routes []*Route) (total float64) {
		for _, r := range routes {
			total += r.Distance
		}
		return
	}
	if errA != nil || errB != nil || len(a) != len(b) || sum(a) != sum(b) {
		t.Errorf("%d routes (%.0f m, %v) against %d (%.0f m, %v)", len(a), sum(a), errA, len(b), sum(b), errB)
	}
}

func TestDirectRouteToAnEndPointOnAnIslandFinishesOffTheIsland(t *testing.T) {
	// Arrange: a valley of 1,771 nodes and a small island 250 m from the start, where the end point is
	g := &testGraph{}
	start := valleyBand(g)
	island := g.addNode(250, 0, 900)
	g.connect(island, g.addNode(300, 0, 900), KindPath)
	e := openTest(t, g, false)
	end := pointOf(g, island)
	// Act
	r, err := e.DirectLoop(context.Background(), DirectLoopRequest{Start: pointOf(g, start), End: &end})
	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if last := r.Points[len(r.Points)-1].Point; last == end {
		t.Error("the route finishes on the island, where the detour search never goes")
	}
}

func TestLoopsWithAnEndPointFailWhenTheEndIsOffTheWays(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := pathRequest(g, at)
	off := Point{46, 7}
	req.End = &off

	_, err := e.Loops(context.Background(), req)

	if !errors.Is(err, ErrEndOffGraph) {
		t.Errorf("err = %v, want ErrEndOffGraph", err)
	}
}
