package engine

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
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

func TestAColumnIsWrittenInBlocks(t *testing.T) {
	// Arrange: distances that quantize to known bytes, among them the unreachable one
	dist := []float32{0, altUnitMeters, 2 * altUnitMeters, 3.9 * altUnitMeters, unreachable, 5, 0x1234 * altUnitMeters}
	var want []byte
	for _, d := range dist {
		q := quantize(d)
		want = append(want, byte(q), byte(q>>8))
	}

	// Act: three nodes a block, so the last block is a short one
	path := filepath.Join(t.TempDir(), "column.u16")
	err := writeColumn(path, dist, make([]byte, 2*3))

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("the column holds %v, want %v", got, want)
	}
}

func TestADijkstraKeepsItsHeapBetweenCalls(t *testing.T) {
	// Arrange: four calls, in both directions, on a graph whose frontier grows and empties more than once
	p, g, _, err := openForLandmarks(islandGraph(t, t.TempDir()), "any", 4)
	if err != nil {
		t.Fatal(err)
	}
	defer g.file.unmap()
	want, got := make([]float32, g.n), make([]float32, g.n)
	var d dijkstra

	for _, run := range []struct {
		src      uint32
		backward bool
	}{{0, false}, {uint32(g.n - 1), true}, {5, false}, {2, true}} {
		// Act
		dijkstraAll(g, p, run.src, want, p.UpPerMeter, run.backward)
		d.all(g, p, run.src, got, p.UpPerMeter, run.backward)

		// Assert: the heap it kept changes nothing to the distances
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("node %d from %d (backward %v): %v, want %v", i, run.src, run.backward, got[i], want[i])
			}
		}
	}
	if cap(d.heap) == 0 {
		t.Error("the heap was not kept for the next call")
	}
}

func TestLandmarkWorkersFollowTheCPUs(t *testing.T) {
	for procs, want := range map[int]int{1: 1, 2: 2, 8: 8, 16: 8, 64: 8} {
		if got := landmarkWorkers(procs); got != want {
			t.Errorf("%d CPUs: %d workers, want %d", procs, got, want)
		}
	}
	if DefaultLandmarkWorkers() < 1 {
		t.Error("the default must allow at least one worker")
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

func TestLandmarksOnDiskSweepTheScratchOfAKilledBuild(t *testing.T) {
	// Arrange: the scratch of a build killed long ago, and of one that still writes to a file it made long ago
	dir := t.TempDir()
	graph := islandGraph(t, dir)
	stale, writing := filepath.Join(dir, "pf-landmarks-old"), filepath.Join(dir, "pf-landmarks-writing")
	for _, d := range []string{stale, writing} {
		if err := os.Mkdir(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(writing, "column-0.u16"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * StaleScratch)
	for _, d := range []string{stale, writing} { // after the file: creating it moved the directory's time
		if err := os.Chtimes(d, old, old); err != nil {
			t.Fatal(err)
		}
	}

	// Act
	err := WriteLandmarksOnDisk(graph, filepath.Join(dir, "any.alt"), "any", 4, dir, 2)

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("the stale scratch directory is still there: %v", err)
	}
	if _, err := os.Stat(filepath.Join(writing, "column-0.u16")); err != nil {
		t.Errorf("the scratch of a build that still writes was removed: %v", err)
	}
}
