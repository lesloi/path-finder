package engine

import (
	"context"
	"math"
	"testing"
)

// segmentDistanceM is how far the segment between two points passes from c, in metres.
func segmentDistanceM(a, b, c Point) float64 {
	cosl := math.Cos(c.Lat * rad)
	xy := func(p Point) (x, y float64) {
		return (p.Lon - c.Lon) * metersPerDegree * cosl, (p.Lat - c.Lat) * metersPerDegree
	}
	ax, ay := xy(a)
	bx, by := xy(b)
	dx, dy := bx-ax, by-ay
	t := 0.0
	if l := dx*dx + dy*dy; l > 0 {
		t = max(0, min(1, -(ax*dx+ay*dy)/l))
	}
	return math.Hypot(ax+t*dx, ay+t*dy)
}

func circleAt(g *testGraph, latM, lonM, radiusM float64) Circle {
	n := g.addNode(latM, lonM, 100) // a node to read the position from, joined to nothing
	return Circle{Center: pointOf(g, n), RadiusM: radiusM}
}

func TestLoopsNeverTouchAnAvoidedArea(t *testing.T) {
	// Arrange
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	area := circleAt(g, 10*stepM, 14*stepM, 150)
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	req.Avoided = []Circle{area}
	// Act
	loops, err := e.Loops(context.Background(), req)
	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if len(loops) == 0 {
		t.Fatal("no loop")
	}
	for _, l := range loops {
		for i := 1; i < len(l.Points); i++ {
			if d := segmentDistanceM(l.Points[i-1].Point, l.Points[i].Point, area.Center); d <= area.RadiusM {
				t.Fatalf("a loop passes %.0f m from the centre of a %.0f m area", d, area.RadiusM)
			}
		}
	}
}

func TestAnEdgeCrossingAnAreaIsForbiddenEvenWithBothEndsOutside(t *testing.T) {
	// Arrange: a long way straight from a to b, and a detour around the area that sits on its middle.
	g := &testGraph{}
	a := g.addNode(0, 0, 100)
	b := g.addNode(0, 1000, 100)
	g.connect(a, b, KindPath)
	c := g.addNode(400, 0, 100)
	d := g.addNode(400, 1000, 100)
	g.connect(a, c, KindPath)
	g.connect(c, d, KindPath)
	g.connect(d, b, KindPath)
	area := circleAt(g, 0, 500, 100)
	e := openTest(t, g, false)
	forbidden := newForbidden(e.g, []Circle{area})
	// Act
	r := newSearcher().route(context.Background(), e, 0, nil, searchLimits{forbidden: forbidden}, uint32(a), uint32(b))
	// Assert
	if r == nil {
		t.Fatal("no route around the area")
	}
	if len(r.nodes) != 4 {
		t.Errorf("route has %d nodes, want the 4 of the detour", len(r.nodes))
	}
}

func TestAnAreaOnTheOnlyWayLeavesNoRoute(t *testing.T) {
	// Arrange
	g := &testGraph{}
	at := g.grid(5, 1, flat)
	area := circleAt(g, 0, 2*stepM, 30)
	e := openTest(t, g, false)
	forbidden := newForbidden(e.g, []Circle{area})
	// Act
	r := newSearcher().route(context.Background(), e, 0, nil, searchLimits{forbidden: forbidden}, uint32(at(0, 0)), uint32(at(4, 0)))
	// Assert
	if r != nil {
		t.Error("a route went through the area")
	}
}

func TestAStartInsideAnAreaMovesToTheNearestNodeOutside(t *testing.T) {
	// Arrange
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	area := circleAt(g, 10*stepM, 10*stepM, 150)
	e := openTest(t, g, false)
	forbidden := newForbidden(e.g, []Circle{area})
	// Act
	node, err := e.snapStart(pointOf(g, at(10, 10)), forbidden)
	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if forbidden.has(node) {
		t.Error("the start is on a node inside the area")
	}
}

func TestWithoutAreasNothingIsForbidden(t *testing.T) {
	// Arrange
	g := &testGraph{}
	g.grid(3, 3, flat)
	e := openTest(t, g, false)
	// Act
	forbidden := newForbidden(e.g, nil)
	// Assert
	if forbidden != nil {
		t.Error("an empty set of areas must cost the searches nothing")
	}
}

func TestAVeryLongEdgeCrossingAnAreaFarFromBothEndsIsForbidden(t *testing.T) {
	// Arrange: a 6 km way whose ends are each 3 km from the area on its middle.
	g := &testGraph{}
	a := g.addNode(0, 0, 100)
	b := g.addNode(0, 6000, 100)
	g.connect(a, b, KindPath)
	c := g.addNode(500, 0, 100)
	d := g.addNode(500, 6000, 100)
	g.connect(a, c, KindPath)
	g.connect(c, d, KindPath)
	g.connect(d, b, KindPath)
	area := circleAt(g, 0, 3000, 100)
	e := openTest(t, g, false)
	// Act
	forbidden := newForbidden(e.g, []Circle{area})
	// Assert
	if !forbidden.holds(uint32(a), uint32(b)) {
		t.Error("the long way through the area is allowed")
	}
	if forbidden.holds(uint32(c), uint32(d)) {
		t.Error("the way that keeps clear of the area is forbidden")
	}
}

func TestTheSameAreasShareOneForbiddenSetAcrossCalls(t *testing.T) {
	// Arrange
	g := &testGraph{}
	g.grid(5, 5, flat)
	one := circleAt(g, 100, 100, 50)
	other := circleAt(g, 300, 300, 50)
	e := openTest(t, g, false)
	// Act
	first := e.g.forbiddenFor([]Circle{one})
	again := e.g.forbiddenFor([]Circle{one})
	changed := e.g.forbiddenFor([]Circle{other})
	// Assert
	if first != again {
		t.Error("the set was built again for the same areas")
	}
	if changed == first {
		t.Error("another area reused the set of the first")
	}
}
