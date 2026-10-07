package engine

import (
	"context"
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

func TestSearchSkipsTechnicalWaysOnlyWhenAsked(t *testing.T) {
	// A direct technical way from a to b, and a longer detour through c that is allowed.
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

	allowed := s.route(ctx, e, 0, nil, 0, 0, uint32(a), uint32(b))
	if allowed == nil || len(allowed.edges) != 1 || e.g.edges[allowed.edges[0]].Flags&EdgeTechnical == 0 {
		t.Fatalf("with technical ways allowed, the route should take the direct one: %+v", allowed)
	}
	excluded := s.route(ctx, e, 0, nil, EdgeTechnical, 0, uint32(a), uint32(b))
	if excluded == nil || len(excluded.edges) != 2 {
		t.Fatalf("with technical ways excluded, the route should take the detour: %+v", excluded)
	}
	if excluded.cost <= allowed.cost {
		t.Errorf("the detour should cost more: %v <= %v", excluded.cost, allowed.cost)
	}
}

func TestSearchFindsNoRouteWhenTheOnlyWayIsTechnical(t *testing.T) {
	g := &testGraph{}
	a, b := g.addNode(0, 0, 100), g.addNode(0, 200, 100)
	g.connect(a, b, KindPath)
	g.edges[a][0].Flags, g.edges[b][0].Flags = EdgeTechnical, EdgeTechnical
	e := openTest(t, g, false)
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	if r := s.route(context.Background(), e, 0, nil, EdgeTechnical, 0, uint32(a), uint32(b)); r != nil {
		t.Errorf("route = %+v, want none", r)
	}
}

func TestLoopsAvoidTechnicalWaysAndMoveTheirStart(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	flagAround(g, at, 10, 10, 1) // every way out of the start is technical
	e := openTest(t, g, false)
	req := loopRequest(g, at)

	loops, err := e.Loops(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range loops {
		if !l.Technical {
			t.Fatalf("a loop from inside the technical block is not marked technical")
		}
	}

	req.ExcludeTechnical = true
	loops, err = e.Loops(context.Background(), req)
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
	e := openTest(t, g, false)
	_, err := e.Loops(context.Background(), LoopRequest{Start: pointOf(g, a), Distance: 1000, Candidates: 2, ExcludeTechnical: true})
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

func TestAGraphBeforeTheTechnicalFlagIsRefused(t *testing.T) {
	g := &testGraph{}
	g.grid(3, 3, flat)
	path := g.write(t)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	copy(data, "PFGRAPH5") // its ways all read as untagged: serving it would silently allow every one
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path, "", "any"); err == nil {
		t.Error("a graph of the previous version opened")
	}
}
