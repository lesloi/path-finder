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

func TestARouteTakesTheDirectTechnicalWayAndSaysSo(t *testing.T) {
	// Arrange: a direct flagged way from a to b.
	g := &testGraph{}
	a, b := g.addNode(0, 0, 100), g.addNode(0, 400, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	e := openTest(t, g, true)

	// Act
	direct := s.route(context.Background(), e, 0, nil, searchLimits{}, uint32(a), uint32(b))

	// Assert
	if direct == nil || len(direct.edges) != 1 || e.g.edges[direct.edges[0]].Flags&EdgeTechnical == 0 {
		t.Fatalf("the flagged way should be taken: %+v", direct)
	}
}

func TestSearchSkipsTechnicalWaysOnlyWhenAsked(t *testing.T) {
	// Arrange: a direct technical way from a to b, and a longer detour through c that is allowed.
	g := &testGraph{}
	a, b, c := g.addNode(0, 0, 100), g.addNode(0, 400, 100), g.addNode(300, 200, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	g.connect(a, c, KindPath)
	g.connect(c, b, KindPath)
	e := openTest(t, g, true)
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	ctx := context.Background()

	// Act
	allowed := s.route(ctx, e, 0, nil, searchLimits{}, uint32(a), uint32(b))
	excluded := s.route(ctx, e, 0, nil, searchLimits{0, e.g.forbiddenFor(nil, Foot, EdgeTechnical)}, uint32(a), uint32(b))

	// Assert
	if allowed == nil || len(allowed.edges) != 1 || e.g.edges[allowed.edges[0]].Flags&EdgeTechnical == 0 {
		t.Fatalf("with technical ways allowed, the route should take the direct one: %+v", allowed)
	}
	if excluded == nil || len(excluded.edges) != 2 {
		t.Fatalf("with technical ways excluded, the route should take the detour: %+v", excluded)
	}
	if excluded.cost <= allowed.cost {
		t.Errorf("the detour should cost more: %v <= %v", excluded.cost, allowed.cost)
	}
}

func TestSearchFindsNoRouteWhenTheOnlyWayIsTechnical(t *testing.T) {
	// Arrange
	g := &testGraph{}
	a, b := g.addNode(0, 0, 100), g.addNode(0, 200, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	e := openTest(t, g, false)
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)

	// Act
	r := s.route(context.Background(), e, 0, nil, searchLimits{0, e.g.forbiddenFor(nil, Foot, EdgeTechnical)}, uint32(a), uint32(b))

	// Assert
	if r != nil {
		t.Errorf("route = %+v, want none", r)
	}
}

func TestLoopsFromInsideATechnicalBlockAreMarkedTechnicalWhenAllowed(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	flagAround(g, at, 10, 10, 1) // every way out of the start is technical
	req := loopRequest(g, at)
	req.IncludeTechnical = true

	// Act
	loops, err := openTest(t, g, false).Loops(context.Background(), req)

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if len(loops) == 0 {
		t.Fatal("no loop")
	}
	for _, l := range loops {
		if !l.Technical {
			t.Fatalf("a loop from inside the technical block is not marked technical")
		}
	}
}

func TestLoopsAvoidTechnicalWaysAndMoveTheirStart(t *testing.T) {
	// Arrange: every way out of the start is technical.
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	flagAround(g, at, 10, 10, 1)
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	req.IncludeTechnical = true
	if loops, err := e.Loops(context.Background(), req); err != nil || len(loops) == 0 || !loops[0].Technical {
		t.Fatalf("the block should hold technical loops: %d loops, %v", len(loops), err)
	}

	// Act
	req.IncludeTechnical = false
	loops, err := e.Loops(context.Background(), req)

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if len(loops) == 0 {
		t.Fatal("no loop once the start moved to an allowed way")
	}
	for _, l := range loops {
		if l.Technical {
			t.Error("a loop holds a technical stretch though they were excluded")
		}
		if l.Points[0].Point == pointOf(g, at(10, 10)) {
			t.Error("the start stayed on the technical way")
		}
	}
}

func TestDirectLoopAvoidsTechnicalWays(t *testing.T) {
	// Arrange: a direct technical way from a to b, and a longer detour through c that is allowed.
	g := &testGraph{}
	a, b, c := g.addNode(0, 0, 100), g.addNode(0, 400, 100), g.addNode(300, 200, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	g.connect(a, c, KindPath)
	g.connect(c, b, KindPath)
	e := openTest(t, g, false)
	req := DirectLoopRequest{Start: pointOf(g, a), Waypoints: []Point{pointOf(g, b)}, IncludeTechnical: true}

	// Act
	allowed, err := e.DirectLoop(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	req.IncludeTechnical = false
	excluded, err := e.DirectLoop(context.Background(), req)

	// Assert
	if !allowed.Technical {
		t.Fatal("the direct way should be taken when technical ways are allowed")
	}
	if err != nil {
		t.Fatal(err)
	}
	if excluded.Technical {
		t.Error("the detour should be taken when technical ways are excluded")
	}
	if excluded.Distance <= allowed.Distance {
		t.Errorf("the detour should be longer: %v <= %v", excluded.Distance, allowed.Distance)
	}
}

func TestAStartTooFarFromAnAllowedWayIsOffTheGraph(t *testing.T) {
	// Arrange
	g := &testGraph{}
	a, b := g.addNode(0, 0, 100), g.addNode(0, 200, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	e := openTest(t, g, false)

	// Act
	_, err := e.Loops(context.Background(), LoopRequest{Start: pointOf(g, a), Distance: 1000, Candidates: 2})

	// Assert
	if err != ErrOffGraph {
		t.Errorf("err = %v, want ErrOffGraph", err)
	}
}

func TestHasRoomLeavesASmallIslandTheFlagsDidNotClose(t *testing.T) {
	// Arrange: a small island of allowed ways, and the same island joined to a large one by a technical way.
	island := &testGraph{}
	islandA, islandB := island.addNode(0, 0, 100), island.addNode(0, 200, 100)
	island.connect(islandA, islandB, KindPath)
	open := openTest(t, island, false)

	pocket := &testGraph{}
	at := pocket.grid(21, 21, flat)
	stubA, stubB := pocket.addNode(10*stepM+30, 10*stepM+40, 100), pocket.addNode(10*stepM+30, 10*stepM+70, 100)
	pocket.connect(stubA, stubB, KindPath)
	pocket.connect(stubA, at(10, 10), KindPath)
	pocket.edges[stubA][len(pocket.edges[stubA])-1].Flags = EdgeTechnical
	pocket.edges[at(10, 10)][len(pocket.edges[at(10, 10)])-1].Flags = EdgeTechnical
	closed := openTest(t, pocket, false)

	// Act and Assert: the flags closed the pocket, but not the island.
	if !open.g.hasRoom(uint32(islandA), EdgeTechnical, Foot) {
		t.Error("a small island the flags did not close should count as room")
	}
	if closed.g.hasRoom(uint32(stubA), EdgeTechnical, Foot) {
		t.Error("a pocket the flags close should not count as room")
	}
}

func TestAStartDoesNotSnapToAPocketTechnicalWaysCloseOff(t *testing.T) {
	// Arrange: a stub of two nodes beside the start, joined to the lattice by one technical way.
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	stubA, stubB := g.addNode(10*stepM+30, 10*stepM+40, 100), g.addNode(10*stepM+30, 10*stepM+70, 100)
	g.connect(stubA, stubB, KindPath)
	g.connect(stubA, at(10, 10), KindPath)
	g.edges[stubA][len(g.edges[stubA])-1].Flags = EdgeTechnical
	g.edges[at(10, 10)][len(g.edges[at(10, 10)])-1].Flags = EdgeTechnical
	flagAround(g, at, 10, 10, 1)
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	req.Start = pointOf(g, stubA)

	// Act
	loops, err := e.Loops(context.Background(), req)

	// Assert
	if err != nil || len(loops) == 0 {
		t.Fatalf("loops = %d, err = %v: the start should move out of the pocket", len(loops), err)
	}
	if loops[0].Points[0].Point == pointOf(g, stubA) || loops[0].Points[0].Point == pointOf(g, stubB) {
		t.Error("the start stayed in the pocket")
	}
}

func TestCancellingStopsALoopSearchThatExcludesTechnicalWays(t *testing.T) {
	// Arrange
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	flagAround(g, at, 4, 4, 2)
	e := openTest(t, g, false)
	done, cancel := context.WithCancel(context.Background())
	cancel()

	// Act
	_, err := e.Loops(done, loopRequest(g, at))

	// Assert
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}

func TestARouteAlongATechnicalRowIsMarkedTechnical(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	// Arrange: the straight row from (2, 10) to (18, 10) is technical: the shortest way there, and the only one of its length.
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

	// Act
	direct, err := openTest(t, g, false).Route(context.Background(), pointOf(g, at(2, 10)), pointOf(g, at(18, 10)))

	// Assert
	if err != nil || !direct.Technical {
		t.Errorf("the technical row should be taken and flagged: %+v, %v", direct, err)
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

func TestABuilderFlagsTechnicalWays(t *testing.T) {
	var b Builder
	x, y, z := b.AddNode(45, 6, 100), b.AddNode(45.001, 6, 100), b.AddNode(45.002, 6, 100)
	b.Connect(x, y, KindPath, SurfaceRough)
	b.ConnectTechnical(y, z, KindPath, SurfaceRough)
	path := filepath.Join(t.TempDir(), "graph.bin")
	if err := b.WriteGraph(path); err != nil {
		t.Fatal(err)
	}
	e, err := Open(path, "", footKey("any"))
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

func TestAGraphOfAnOlderFormatIsRefused(t *testing.T) {
	for _, magic := range []string{"PFGRAPH5", "PFGRAPH6"} {
		t.Run(magic, func(t *testing.T) {
			g := &testGraph{}
			g.grid(3, 3, flat)
			path := g.write(t)
			setMagic(t, path, magic) // its flags do not tell T3 from T4 and up: serving it would be wrong

			_, err := Open(path, "", footKey("any"))

			if err == nil {
				t.Error("a graph of an older format opened")
			}
		})
	}
}

func TestStretchesSplitWhereAWayIsTechnical(t *testing.T) {
	// Arrange: a path of three ways, the middle one technical, all on one surface.
	g := &testGraph{}
	n := []int{g.addNode(0, 0, 100), g.addNode(0, 100, 100), g.addNode(0, 200, 100), g.addNode(0, 300, 100)}
	for i := 0; i < 3; i++ {
		g.connect(n[i], n[i+1], KindPath)
	}
	g.edges[n[1]][1].Flags = EdgeTechnical // the way from n[1] to n[2]
	e := openTest(t, g, true)
	edges := []uint32{e.g.off[n[0]], e.g.off[n[1]] + 1, e.g.off[n[2]] + 1}

	// Act
	got, technical := e.stretches(edges)

	// Assert
	if !technical || len(got) != 3 || got[0].Technical || !got[1].Technical || got[2].Technical {
		t.Errorf("stretches = %+v, technical %v, want plain, technical, plain", got, technical)
	}
}
