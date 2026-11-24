package engine

import (
	"context"
	"testing"
)

// hillOrFlat is two ways from a start to an end: a short one over a steep hill, and a longer flat one.
func hillOrFlat() (g *testGraph, start, end int) {
	g = &testGraph{}
	start = g.addNode(0, 0, 100)
	end = g.addNode(0, 1000, 100)
	hill := g.addNode(0, 500, 300)
	flat := g.addNode(-300, 500, 100)
	for _, n := range []int{hill, flat} {
		g.connect(start, n, KindPath)
		g.connect(n, end, KindPath)
	}
	return g, start, end
}

func referenceRoute(t *testing.T, ref Reference) *Route {
	t.Helper()
	g, start, end := hillOrFlat()
	e := openTest(t, g, false)
	to := pointOf(g, end)

	r, err := e.DirectLoop(context.Background(), DirectLoopRequest{Start: pointOf(g, start), End: &to, Reference: ref})

	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestTheShortestReferenceGoesOverTheHill(t *testing.T) {
	shortest := referenceRoute(t, ReferenceShortest)
	preferred := referenceRoute(t, ReferencePreferred)

	if shortest.Distance >= preferred.Distance || shortest.Ascent == 0 {
		t.Errorf("shortest %.0f m with %.0f m up, preferred %.0f m: want the shorter way over the hill", shortest.Distance, shortest.Ascent, preferred.Distance)
	}
}

func TestTheFastestReferenceKeepsToTheFlatWay(t *testing.T) {
	fastest := referenceRoute(t, ReferenceFastest)
	shortest := referenceRoute(t, ReferenceShortest)

	if fastest.Ascent >= shortest.Ascent || fastest.Distance <= shortest.Distance {
		t.Errorf("fastest %.0f m with %.0f m up, shortest %.0f m with %.0f m up: want the longer flat way",
			fastest.Distance, fastest.Ascent, shortest.Distance, shortest.Ascent)
	}
}

func TestTheReferencesAreNotAffectedByTheSurfaceMultipliers(t *testing.T) {
	// Arrange: a way the "paved" preference makes dearer, and a longer one it likes
	g := &testGraph{}
	start := g.addNode(0, 0, 100)
	end := g.addNode(0, 1000, 100)
	rough := g.addNode(0, 500, 100)
	long := g.addNode(-300, 500, 100)
	g.connect(start, rough, KindTrunk)
	g.connect(rough, end, KindTrunk)
	g.connect(start, long, KindPath)
	g.connect(long, end, KindPath)
	e := openTest(t, g, false)
	to := pointOf(g, end)

	r, err := e.DirectLoop(context.Background(), DirectLoopRequest{Start: pointOf(g, start), End: &to, Reference: ReferenceShortest})

	if err != nil || r.Distance > 1100 {
		t.Errorf("distance = %.0f m, err = %v, want the direct 1000 m way whatever its kind", r.Distance, err)
	}
}
