package engine

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// sectionFile writes the bytes of one section of a graph, as a build that works on disk leaves them.
func sectionFile(t *testing.T, dir, name string, b []byte) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestGraphFromPartsIsTheGraphFromMemory(t *testing.T) {
	// Arrange: five nodes whose cells differ, and a few edges, so that no section is empty or aligned by luck
	nodes := []node{{450_000_000, 60_000_000, 1000}, {450_030_000, 60_050_000, 1100}, {450_100_000, 60_020_000, -50}, {450_120_000, 60_200_000, 3000}, {450_130_000, 60_210_000, 0}}
	off := []uint32{0, 1, 3, 4, 5, 6}
	edges := []edge{{To: 1, Len: 10, Kind: 2, Surf: 1}, {To: 0, Len: 10, Kind: 2, Surf: 1}, {To: 3, Len: 7.5, Kind: 4, Flags: EdgeTechnical}, {To: 2, Len: 7.5, Kind: 4, Flags: EdgeTechnical}, {To: 3, Len: 1}, {To: 4, Len: 1}}
	dir := t.TempDir()
	want := filepath.Join(dir, "want.bin")
	if err := WriteGraph(want, nodes, off, edges); err != nil {
		t.Fatal(err)
	}
	sp := computeSpatial(nodes)
	parts := GraphParts{
		Nodes:     sectionFile(t, dir, "nodes", bytesOf(nodes)),
		Off:       sectionFile(t, dir, "off", bytesOf(off)),
		Edges:     sectionFile(t, dir, "edges", bytesOf(edges)),
		GridCells: sectionFile(t, dir, "cells", bytesOf(sp.start)),
		GridNodes: sectionFile(t, dir, "grid", bytesOf(sp.nodes)),
		NodeCount: uint32(len(nodes)), EdgeCount: uint32(len(edges)),
		Bounds: [4]int32{sp.minLat, sp.minLon, sp.maxLat, sp.maxLon},
	}
	got := filepath.Join(dir, "got.bin")

	// Act
	err := WriteGraphFromParts(got, parts)

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(want)
	b, _ := os.ReadFile(got)
	if !bytes.Equal(a, b) {
		t.Errorf("the graph from its parts differs from the graph from memory (%d and %d bytes)", len(b), len(a))
	}
	if _, err := os.Stat(got + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("a temporary file is left: %v", err)
	}
}

func TestGridSizeExportsTheGridOfTheIndex(t *testing.T) {
	nx, ny := GridSize([4]int32{0, 0, 2*cellLat + 5, 3*cellLon + 5})

	if nx != 4 || ny != 3 {
		t.Errorf("grid %d by %d, want 4 by 3", nx, ny)
	}
}
