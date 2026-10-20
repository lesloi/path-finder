package engine

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// islandGraph writes a graph of a wide grid and of an island that nothing joins to it, so that the landmarks must be
// kept off the island by the reach from the middle. Heights rise to the east, for the profiles that count the climb.
func islandGraph(t *testing.T, dir string) string {
	t.Helper()
	var b Builder
	const w, h = 9, 7
	id := func(x, y int) int { return y*w + x }
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			b.AddNode(45+float64(y)*0.001, 6+float64(x)*0.0015, float64(100+15*x+4*y))
		}
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			surface := []uint8{SurfacePaved, SurfaceRough, SurfaceCompact}[(x+y)%3]
			if x+1 < w {
				b.Connect(id(x, y), id(x+1, y), KindPath, surface)
			}
			if y+1 < h {
				b.Connect(id(x, y), id(x, y+1), KindResidential, surface)
			}
		}
	}
	// The island lies to the north-east of the grid, past its bounding box edge, where a landmark would be snapped.
	a := b.AddNode(45.0065, 6.0125, 500)
	c := b.AddNode(45.0066, 6.0126, 510)
	b.Connect(a, c, KindTrack, SurfaceRough)
	path := filepath.Join(dir, "graph.bin")
	if err := b.WriteGraph(path); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLandmarksOnDiskAreTheLandmarksInMemory(t *testing.T) {
	graph := islandGraph(t, t.TempDir())
	for _, profile := range ProfileNames {
		dir := t.TempDir()
		want := filepath.Join(dir, "want.alt")
		if err := WriteLandmarks(graph, want, profile, 4); err != nil {
			t.Fatal(err)
		}
		// 7 does not divide the number of nodes: the last pass over the rows is a short one
		for _, workers := range []int{1, 3} {
			got := filepath.Join(dir, "got.alt")

			// Act
			err := writeLandmarksOnDisk(graph, got, profile, 4, dir, workers, 7)

			// Assert
			if err != nil {
				t.Fatalf("%s, %d workers: %v", profile, workers, err)
			}
			a, _ := os.ReadFile(want)
			b, _ := os.ReadFile(got)
			if !bytes.Equal(a, b) {
				t.Errorf("%s, %d workers: the landmarks differ", profile, workers)
			}
		}
		// only the two landmark files are left
		if list, _ := os.ReadDir(dir); len(list) != 2 {
			t.Errorf("%s: %d entries left, want 2", profile, len(list))
		}
	}
}

func TestLandmarksOnDiskRefuseWhatInMemoryRefuses(t *testing.T) {
	dir := t.TempDir()
	graph := islandGraph(t, dir)

	unknown := WriteLandmarksOnDisk(graph, filepath.Join(dir, "a.alt"), "nope", 4, dir, 2)
	tooMany := WriteLandmarksOnDisk(graph, filepath.Join(dir, "b.alt"), "any", 1000, dir, 2)

	if unknown == nil || tooMany == nil {
		t.Errorf("unknown profile: %v, too many landmarks: %v", unknown, tooMany)
	}
	if list, _ := os.ReadDir(dir); len(list) != 1 {
		t.Errorf("%d entries left, want only the graph", len(list))
	}
}
