package engine

import (
	"encoding/binary"
	"os"
	"slices"
	"strings"
	"testing"
)

// chainWithALongWayAndAnIsland is a chain of 1,100 nodes (a component that can hold a loop), one way of 600 m from
// its start, and an island of three nodes beside it.
func chainWithALongWayAndAnIsland() (g *testGraph, long [2]int, island [3]int) {
	g = &testGraph{}
	chain := make([]int, 1_100)
	for i := range chain {
		chain[i] = g.addNode(float64(i)*stepM, 0, 500)
		if i > 0 {
			g.connect(chain[i-1], chain[i], KindPath)
		}
	}
	far := g.addNode(-600, 0, 500)
	g.connect(chain[0], far, KindPath)
	for i := range island {
		island[i] = g.addNode(0, 5_000+float64(i)*stepM, 500)
		if i > 0 {
			g.connect(island[i-1], island[i], KindPath)
		}
	}
	return g, [2]int{chain[0], far}, island
}

func TestAGraphStoresItsSmallComponentsAndItsLongWays(t *testing.T) {
	// Arrange
	g, long, island := chainWithALongWayAndAnIsland()
	path := g.write(t)

	// Act
	e, err := Open(path, "", footKey("any"))

	// Assert: the sets are those the in-memory passes find, so a search never has to read the graph to get them
	if err != nil {
		t.Fatal(err)
	}
	wantSmall := smallBitmaps(e.g.n, e.g.off, e.g.edges, smallComponentNodes)
	for m := range e.g.small {
		for _, n := range island {
			if !e.g.small[m].has(uint32(n)) {
				t.Errorf("node %d of the island is not small for the %s mode", n, Mode(m))
			}
		}
		if e.g.small[m].has(uint32(long[0])) || e.g.small[m].has(uint32(long[1])) {
			t.Errorf("the chain is small for the %s mode", Mode(m))
		}
		if !slices.Equal(e.g.small[m], nodeSet(wantSmall[m])) {
			t.Errorf("the stored small components differ from the in-memory pass for the %s mode", Mode(m))
		}
	}
	if got := e.g.long; !slices.Equal(got, []longWay{{A: uint32(long[0]), B: uint32(long[1]), Modes: EdgeAllModes}}) {
		t.Errorf("long ways = %v, want the one of 600 m, once", got)
	}
	if want := longEdgeList(e.g.off, e.g.edges, e.g.n); !slices.Equal(e.g.long, want) {
		t.Error("the stored long ways differ from the in-memory pass")
	}
	// The node modes are those the edges give, for the snapping to keep off the nodes a mode cannot reach.
	wantModes := nodeModeBitmaps(e.g.n, e.g.off, e.g.edges)
	for m := range e.g.nodeModes {
		if !slices.Equal(e.g.nodeModes[m], nodeSet(wantModes[m])) {
			t.Errorf("the stored node modes differ from the in-memory pass for the %s mode", Mode(m))
		}
	}
}

func TestAGraphWithNoComponentThatCanHoldALoopHasNoSmallOne(t *testing.T) {
	// Arrange: a small zone, where every component is all there is
	g := &testGraph{}
	g.grid(5, 5, flat)
	g.connect(g.addNode(9_000, 0, 100), g.addNode(9_100, 0, 100), KindPath)
	// Act
	e := openTest(t, g, false)
	// Assert
	for n := 0; n < e.g.n; n++ {
		for m := range e.g.small {
			if e.g.small[m].has(uint32(n)) {
				t.Fatalf("node %d is small for the %s mode in a graph with no large component", n, Mode(m))
			}
		}
	}
}

func TestAGraphBuiltWithOtherParametersIsRefused(t *testing.T) {
	for _, c := range []struct {
		name string
		at   int
		put  func(b []byte)
	}{
		{"small component size", 40, func(b []byte) { binary.LittleEndian.PutUint32(b, 999) }},
		{"long way length", 44, func(b []byte) { binary.LittleEndian.PutUint32(b, 0x44fa0001) }},
	} {
		t.Run(c.name, func(t *testing.T) {
			// Arrange
			g, _, _ := chainWithALongWayAndAnIsland()
			path := g.write(t)
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			c.put(data[c.at:])
			if err := os.WriteFile(path, data, 0o644); err != nil {
				t.Fatal(err)
			}
			// Act
			_, err = Open(path, "", footKey("any"))
			// Assert
			if err == nil || !strings.Contains(err.Error(), "other parameters") || !strings.Contains(err.Error(), "build-graph") {
				t.Errorf("err = %v, want it to refuse other parameters and say to build again", err)
			}
		})
	}
}

func TestAGraphCutBeforeItsStoredSectionsIsRefused(t *testing.T) {
	// Arrange
	g, _, _ := chainWithALongWayAndAnIsland()
	path := g.write(t)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data[:len(data)-16], 0o644); err != nil { // the long way (12 bytes) and its padding are the last bytes
		t.Fatal(err)
	}
	// Act
	_, err = Open(path, "", footKey("any"))
	// Assert
	if err == nil {
		t.Error("a graph without its last section was opened")
	}
}
