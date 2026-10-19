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

func TestLoopsFromInsideATechnicalBlockAreMarkedTechnical(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	flagAround(g, at, 10, 10, 1) // every way out of the start is technical

	// Act
	loops, err := openTest(t, g, false).Loops(context.Background(), loopRequest(g, at))

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

func TestAGraphOfAnOlderFormatIsRefused(t *testing.T) {
	for _, magic := range []string{"PFGRAPH5", "PFGRAPH6"} {
		t.Run(magic, func(t *testing.T) {
			g := &testGraph{}
			g.grid(3, 3, flat)
			path := g.write(t)
			setMagic(t, path, magic) // its flags do not tell T3 from T4 and up: serving it would be wrong

			_, err := Open(path, "", "any")

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
