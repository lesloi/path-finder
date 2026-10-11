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

func TestLoopsThroughTechnicalWaysAreMarkedTechnical(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	flagAround(g, at, 10, 10, 1) // every way out of the start is technical
	e := openTest(t, g, false)

	loops, err := e.Loops(context.Background(), loopRequest(g, at))
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

func TestAGraphBeforeTheAlpineExclusionIsRefused(t *testing.T) {
	g := &testGraph{}
	g.grid(3, 3, flat)
	path := g.write(t)
	setMagic(t, path, "PFGRAPH6") // its alpine ways (T4 and up) are still in: serving it would route onto them
	if _, err := Open(path, "", "any"); err == nil {
		t.Error("a graph of the previous version opened")
	}
}
