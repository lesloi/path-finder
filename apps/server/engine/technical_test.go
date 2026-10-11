package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// flagAround marks as technical every way between nodes of the lattice cells within r cells of (cx, cy).
func flagAround(t *testGraph, at func(x, y int) int, cx, cy, r int) {
	inside := make(map[int]bool)
	for y := cy - r; y <= cy+r; y++ {
		for x := cx - r; x <= cx+r; x++ {
			inside[at(x, y)] = true
		}
	}
	for a, es := range t.edges {
		for i := range es {
			if inside[a] && inside[int(es[i].To)] {
				es[i].Flags |= EdgeTechnical
			}
		}
	}
}

// setMagic gives a graph file the magic of another format, its content left as it is.
func setMagic(tb testing.TB, path, magic string) {
	tb.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		tb.Fatal(err)
	}
	copy(data, magic)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		tb.Fatal(err)
	}
}

// openLegacy opens g as a graph of the previous format, `PFGRAPH6`: its edges are the same, but the flag holds T3 and
// up without telling them apart.
func openLegacy(tb testing.TB, g *testGraph) *Engine {
	tb.Helper()
	path := g.write(tb)
	setMagic(tb, path, "PFGRAPH6")
	e, err := Open(path, "", "any")
	if err != nil {
		tb.Fatal(err)
	}
	return e
}

func TestSearchOfALegacyGraphSkipsFlaggedWays(t *testing.T) {
	// A direct flagged way from a to b, and a longer detour through c.
	g := &testGraph{}
	a, b, c := g.addNode(0, 0, 100), g.addNode(0, 400, 100), g.addNode(300, 200, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	g.connect(a, c, KindPath)
	g.connect(c, b, KindPath)
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	ctx := context.Background()

	current, legacy := openTest(t, g, true), openLegacy(t, g)
	direct := s.route(ctx, current, 0, nil, searchLimits{}, uint32(a), uint32(b))
	if direct == nil || len(direct.edges) != 1 || current.g.edges[direct.edges[0]].Flags&EdgeTechnical == 0 {
		t.Fatalf("a current graph should give the direct way: %+v", direct)
	}
	detour := s.route(ctx, legacy, 0, nil, searchLimits{}, uint32(a), uint32(b))
	if detour == nil || len(detour.edges) != 2 {
		t.Fatalf("a legacy graph should give the detour: %+v", detour)
	}
	if detour.cost <= direct.cost {
		t.Errorf("the detour should cost more: %v <= %v", detour.cost, direct.cost)
	}
}

func TestSearchFindsNoRouteWhenTheOnlyWayIsFlaggedOnALegacyGraph(t *testing.T) {
	g := &testGraph{}
	a, b := g.addNode(0, 0, 100), g.addNode(0, 200, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	if r := s.route(context.Background(), openLegacy(t, g), 0, nil, searchLimits{}, uint32(a), uint32(b)); r != nil {
		t.Errorf("route = %+v, want none", r)
	}
}

func TestLoopsOfALegacyGraphAvoidTechnicalWaysAndMoveTheirStart(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	flagAround(g, at, 10, 10, 1) // every way out of the start is technical
	req := loopRequest(g, at)

	// A current graph keeps them, and tells a loop that holds one.
	loops, err := openTest(t, g, false).Loops(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range loops {
		if !l.Technical {
			t.Fatalf("a loop from inside the technical block is not marked technical")
		}
	}

	// A legacy graph cannot tell T3 from T4 and up: every flagged way is out.
	loops, err = openLegacy(t, g).Loops(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if len(loops) == 0 {
		t.Fatal("no loop once the start moved to an allowed way")
	}
	for _, l := range loops {
		if l.Technical {
			t.Error("a loop holds a technical stretch though a legacy graph leaves them out")
		}
		if l.Points[0].Point == pointOf(g, at(10, 10)) {
			t.Error("the start stayed on the technical way")
		}
	}
}

func TestARouteOfALegacyGraphAvoidsTechnicalWays(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	// The straight row from (2, 10) to (18, 10) is technical: the shortest way there, and the only one of its length.
	onRow := func(n int) bool {
		for x := 2; x <= 18; x++ {
			if n == at(x, 10) {
				return true
			}
		}
		return false
	}
	for a, es := range g.edges {
		for i := range es {
			if onRow(a) && onRow(int(es[i].To)) {
				es[i].Flags = EdgeTechnical
			}
		}
	}
	from, to := pointOf(g, at(2, 10)), pointOf(g, at(18, 10))

	direct, err := openTest(t, g, false).Route(context.Background(), from, to)
	if err != nil || !direct.Technical {
		t.Fatalf("a current graph should take the technical row: %+v, %v", direct, err)
	}
	detour, err := openLegacy(t, g).Route(context.Background(), from, to)
	if err != nil || detour.Technical {
		t.Errorf("a legacy graph should go around it: %+v, %v", detour, err)
	}
}

func TestUntaggedWaysAreNotTechnical(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	loops, err := e.Loops(context.Background(), loopRequest(g, at))
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range loops {
		if l.Technical {
			t.Error("a loop on untagged ways is marked technical")
		}
	}
}

func TestAStartTooFarFromAnAllowedWayIsOffTheGraph(t *testing.T) {
	g := &testGraph{}
	a, b := g.addNode(0, 0, 100), g.addNode(0, 200, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	e := openLegacy(t, g)
	_, err := e.Loops(context.Background(), LoopRequest{Start: pointOf(g, a), Distance: 1000, Candidates: 2})
	if err != ErrOffGraph {
		t.Errorf("err = %v, want ErrOffGraph", err)
	}
}

func TestABuilderFlagsTechnicalWays(t *testing.T) {
	var b Builder
	x, y, z := b.AddNode(45, 6, 100), b.AddNode(45.001, 6, 100), b.AddNode(45.002, 6, 100)
	b.Connect(x, y, KindPath, SurfaceRough)
	b.ConnectTechnical(y, z, KindPath, SurfaceRough)
	path := filepath.Join(t.TempDir(), "graph.bin")
	if err := b.WriteGraph(path); err != nil {
		t.Fatal(err)
	}
	e, err := Open(path, "", "any")
	if err != nil {
		t.Fatal(err)
	}
	flagged := 0
	for _, ed := range e.g.edges {
		if ed.Flags&EdgeTechnical != 0 {
			flagged++
		}
	}
	if flagged != 2 {
		t.Errorf("%d directed edges flagged, want 2", flagged)
	}
}

func TestAGraphBeforeTheLegacyFormatIsRefused(t *testing.T) {
	g := &testGraph{}
	g.grid(3, 3, flat)
	path := g.write(t)
	setMagic(t, path, "PFGRAPH5") // its ways all read as untagged: serving it would silently allow every one
	if _, err := Open(path, "", "any"); err == nil {
		t.Error("a graph of the previous version opened")
	}
}

func TestAStartDoesNotSnapToAPocketTechnicalWaysCloseOff(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	// A stub of two nodes beside the start, joined to the lattice by one technical way.
	stubA, stubB := g.addNode(10*stepM+30, 10*stepM+40, 100), g.addNode(10*stepM+30, 10*stepM+70, 100)
	g.connect(stubA, stubB, KindPath)
	g.connect(stubA, at(10, 10), KindPath)
	g.edges[stubA][len(g.edges[stubA])-1].Flags = EdgeTechnical
	g.edges[at(10, 10)][len(g.edges[at(10, 10)])-1].Flags = EdgeTechnical
	flagAround(g, at, 10, 10, 1)
	e := openLegacy(t, g)
	req := loopRequest(g, at)
	req.Start = pointOf(g, stubA)

	loops, err := e.Loops(context.Background(), req)
	if err != nil || len(loops) == 0 {
		t.Fatalf("loops = %d, err = %v: the start should move out of the pocket", len(loops), err)
	}
	if loops[0].Points[0].Point == pointOf(g, stubA) || loops[0].Points[0].Point == pointOf(g, stubB) {
		t.Error("the start stayed in the pocket")
	}
}

func TestNearestOnALegacyGraphGivesUpPastTheSnapLimit(t *testing.T) {
	g := &testGraph{}
	a, b := g.addNode(0, 0, 100), g.addNode(0, 200, 100)
	g.connect(a, b, KindPath)
	far, farB := g.addNode(0, 20_000, 100), g.addNode(0, 20_200, 100)
	g.connect(far, farB, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	legacy, current := openLegacy(t, g), openTest(t, g, false)
	if _, _, ok := legacy.sp.nearest(legacy.g, baseLat, baseLon); ok {
		t.Error("a node 20 km away was found: the search should stop near the snap limit")
	}
	if _, _, ok := legacy.sp.nearestSkipping(legacy.g, 0, baseLat, baseLon); !ok {
		t.Error("the landmarks are built over the whole graph: a node should be found whatever the graph skips")
	}
	if _, _, ok := current.sp.nearest(current.g, baseLat, baseLon); !ok {
		t.Error("without edges to skip, the nearest node is found")
	}
}

func TestCancellingStopsALoopSearchThatExcludesTechnicalWays(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	flagAround(g, at, 4, 4, 2)
	e := openLegacy(t, g)
	req := loopRequest(g, at)
	done, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := e.Loops(done, req); !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}

func TestALegacyGraphKeepsItsLandmarks(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	path := g.write(t)
	alt := writeTestLandmarks(t, path)
	setMagic(t, path, "PFGRAPH6")
	legacy, err := Open(path, alt, "any")
	if err != nil {
		t.Fatalf("the landmarks of a current graph should fit its legacy form: %v", err)
	}
	if _, err := legacy.Route(context.Background(), pointOf(g, at(0, 0)), pointOf(g, at(20, 20))); err != nil {
		t.Errorf("err = %v", err)
	}
}
