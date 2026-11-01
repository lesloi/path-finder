package engine

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// graphFixture is five nodes whose cells differ and a few edges, one of them a long way, so that no section is empty
// or aligned by luck.
func graphFixture(t *testing.T) ([]node, []uint32, []edge) {
	t.Helper()
	nodes := []node{{450_000_000, 60_000_000, 1000}, {450_030_000, 60_050_000, 1100}, {450_100_000, 60_020_000, -50}, {450_120_000, 60_200_000, 3000}, {450_130_000, 60_210_000, 0}}
	off := []uint32{0, 1, 3, 4, 5, 6}
	edges := []edge{
		{To: 1, Len: 600, Kind: 2, Surf: 1, Modes: EdgeAllModes}, {To: 0, Len: 600, Kind: 2, Surf: 1, Modes: EdgeAllModes},
		{To: 3, Len: 7.5, Kind: 4, Flags: EdgeTechnical, Modes: EdgeFoot}, {To: 2, Len: 7.5, Kind: 4, Flags: EdgeTechnical, Modes: EdgeFoot},
		{To: 3, Len: 1, Modes: EdgeBike}, {To: 4, Len: 1, Modes: EdgeBike},
	}
	if long := longEdgeList(off, edges, len(nodes)); len(long) != 1 {
		t.Fatalf("the fixture must hold one long way, holds %d", len(long))
	}
	return nodes, off, edges
}

// writeSections gives a graph writer every section of a graph, the grid and the small components first, as a build
// that knows them before the edges may.
func writeSections(w *GraphWriter, nodes []node, off []uint32, edges []edge) error {
	sp := computeSpatial(nodes)
	for _, c := range sp.start {
		if err := w.GridCell(c); err != nil {
			return err
		}
	}
	for _, n := range nodes {
		if err := w.Node(n); err != nil {
			return err
		}
	}
	for _, o := range off {
		if err := w.Offset(o); err != nil {
			return err
		}
	}
	for _, e := range edges {
		if err := w.Edge(e); err != nil {
			return err
		}
	}
	for _, l := range longEdgeList(off, edges, len(nodes)) {
		if err := w.Long(l.A, l.B, l.Modes); err != nil {
			return err
		}
	}
	small := smallBitmaps(len(nodes), off, edges, smallComponentNodes)
	for m := range small {
		for _, word := range small[m] {
			if err := w.Small(Mode(m), word); err != nil {
				return err
			}
		}
	}
	modes := nodeModeBitmaps(len(nodes), off, edges)
	for m := range modes {
		for _, word := range modes[m] {
			if err := w.NodeModes(Mode(m), word); err != nil {
				return err
			}
		}
	}
	for _, n := range sp.nodes {
		if err := w.GridNode(n); err != nil {
			return err
		}
	}
	return nil
}

func TestGraphWriterWritesTheGraphFromMemory(t *testing.T) {
	// Arrange
	nodes, off, edges := graphFixture(t)
	dir := t.TempDir()
	want := filepath.Join(dir, "want.bin")
	if err := WriteGraph(want, nodes, off, edges); err != nil {
		t.Fatal(err)
	}
	sp := computeSpatial(nodes)
	got := filepath.Join(dir, "got.bin")
	w, err := CreateGraph(got, uint32(len(nodes)), uint32(len(edges)), [4]int32{sp.minLat, sp.minLon, sp.maxLat, sp.maxLon})
	if err != nil {
		t.Fatal(err)
	}

	// Act
	err = writeSections(w, nodes, off, edges)
	if err == nil {
		err = w.Close()
	}

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(want)
	b, _ := os.ReadFile(got)
	if !bytes.Equal(a, b) {
		t.Errorf("the graph written by sections differs from the graph from memory (%d and %d bytes)", len(b), len(a))
	}
	if _, err := os.Stat(got + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("a temporary file is left: %v", err)
	}
}

func TestGraphWriterRefusesTheModesOutOfOrder(t *testing.T) {
	// Arrange: the fingerprint reads the foot bitmaps before the bike ones
	path := filepath.Join(t.TempDir(), "g.bin")
	w, err := CreateGraph(path, 1, 0, [4]int32{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Abort()
	if err := w.Node(node{}); err != nil {
		t.Fatal(err)
	}
	if err := w.Offset(0); err != nil {
		t.Fatal(err)
	}
	if err := w.Offset(0); err != nil {
		t.Fatal(err)
	}
	if err := w.Small(Bike, 0); err != nil {
		t.Fatal(err)
	}

	// Act and Assert
	if err := w.Small(Foot, 0); err == nil {
		t.Error("a foot word after a bike one was taken")
	}
	if err := w.NodeModes(Bike, 0); err != nil {
		t.Fatal(err)
	}
	if err := w.NodeModes(Foot, 0); err == nil {
		t.Error("a foot word after a bike one was taken")
	}
}

func TestGraphWriterRefusesASectionThatIsShort(t *testing.T) {
	// Arrange: one edge fewer than announced
	nodes, off, edges := graphFixture(t)
	sp := computeSpatial(nodes)
	path := filepath.Join(t.TempDir(), "g.bin")
	w, err := CreateGraph(path, uint32(len(nodes)), uint32(len(edges))+1, [4]int32{sp.minLat, sp.minLon, sp.maxLat, sp.maxLon})
	if err != nil {
		t.Fatal(err)
	}
	if err := writeSections(w, nodes, off, edges); err != nil {
		t.Fatal(err)
	}

	// Act
	err = w.Close()

	// Assert: neither the graph nor its temporary file is there
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, p := range []string{path, path + ".tmp"} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s is left: %v", p, err)
		}
	}
}

func TestGraphWriterRefusesARecordBeyondItsSection(t *testing.T) {
	// Arrange
	path := filepath.Join(t.TempDir(), "g.bin")
	w, err := CreateGraph(path, 1, 0, [4]int32{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Abort()
	if err := w.Node(node{}); err != nil {
		t.Fatal(err)
	}

	// Act
	err = w.Node(node{})

	// Assert
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestGraphWriterTakesTheFingerprintedSectionsInOrder(t *testing.T) {
	// Arrange: the fingerprint is that of the nodes, then the offsets, then the edges
	path := filepath.Join(t.TempDir(), "g.bin")
	w, err := CreateGraph(path, 2, 2, [4]int32{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Abort()
	if err := w.Node(node{}); err != nil {
		t.Fatal(err)
	}

	// Act: an offset while a node is still to come
	err = w.Offset(0)

	// Assert
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestGraphWriterAbortAfterCloseLeavesTheFilesAlone(t *testing.T) {
	// Arrange: a graph written, then another build that starts its own temporary file at the same place
	nodes, off, edges := graphFixture(t)
	sp := computeSpatial(nodes)
	path := filepath.Join(t.TempDir(), "g.bin")
	w, err := CreateGraph(path, uint32(len(nodes)), uint32(len(edges)), [4]int32{sp.minLat, sp.minLon, sp.maxLat, sp.maxLon})
	if err != nil {
		t.Fatal(err)
	}
	if err := writeSections(w, nodes, off, edges); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".tmp", []byte("another build"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Act
	w.Abort()

	// Assert
	for _, p := range []string{path, path + ".tmp"} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s: %v", p, err)
		}
	}
}

func TestGridSizeExportsTheGridOfTheIndex(t *testing.T) {
	nx, ny := GridSize([4]int32{0, 0, 2*cellLat + 5, 3*cellLon + 5})

	if nx != 4 || ny != 3 {
		t.Errorf("grid %d by %d, want 4 by 3", nx, ny)
	}
}

func TestCellsAreThoseOfTheSpatialIndex(t *testing.T) {
	nodes := []node{{450_000_000, 60_000_000, 0}, {450_030_000, 60_050_000, 0}, {450_100_000, 60_020_000, 0}, {450_130_000, 60_210_000, 0}}
	sp := computeSpatial(nodes)
	cells := Cells([4]int32{sp.minLat, sp.minLon, sp.maxLat, sp.maxLon})

	for i, n := range nodes {
		c := cells(n.Lat, n.Lon)
		if !slices.Contains(sp.nodes[sp.start[c]:sp.start[c+1]], uint32(i)) {
			t.Errorf("node %d is not in cell %d of the index", i, c)
		}
	}
}
