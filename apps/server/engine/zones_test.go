package engine

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// zoneGraph is a square lattice of paths, 2 km on a side, whose south-west corner is (eastM, northM) metres
// from the test origin, and the middle of the lattice.
func zoneGraph(eastM, northM float64) (g *testGraph, centre Point) {
	g = &testGraph{}
	const w = 21
	first := len(g.nodes)
	for y := 0; y < w; y++ {
		for x := 0; x < w; x++ {
			g.addNode(northM+float64(y)*stepM, eastM+float64(x)*stepM, 100)
		}
	}
	for y := 0; y < w; y++ {
		for x := 0; x < w; x++ {
			if x+1 < w {
				g.connect(first+y*w+x, first+y*w+x+1, KindPath)
			}
			if y+1 < w {
				g.connect(first+y*w+x, first+(y+1)*w+x, KindPath)
			}
		}
	}
	return g, pointOf(g, first+(w/2)*w+w/2)
}

// writeZone puts the graph, and the landmarks of the hike profile, in dir.
func writeZone(t *testing.T, dir string, g *testGraph) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(g.write(t))
	if err != nil {
		t.Fatal(err)
	}
	graph := filepath.Join(dir, GraphFileName)
	if err := os.WriteFile(graph, data, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, activity := range []string{"hike", "run"} {
		if err := WriteLandmarks(graph, filepath.Join(dir, LandmarksFileName(activity)), activity, 2); err != nil {
			t.Fatal(err)
		}
	}
}

func loopsFrom(t *testing.T, z *Zones, from Point) ([]*Route, error) {
	t.Helper()
	hike := z.Activity("hike")
	if hike == nil {
		t.Fatal("no hike activity")
	}
	return hike.Loops(context.Background(), LoopRequest{Start: from, Distance: 3000, Candidates: 8, Seed: 3})
}

func TestZonesOfAFlatDirectoryAreOneZone(t *testing.T) {
	dir := t.TempDir()
	g, centre := zoneGraph(0, 0)
	writeZone(t, dir, g)
	z, err := OpenZones(dir, "hike", "run")
	if err != nil {
		t.Fatal(err)
	}
	if z.Len() != 1 {
		t.Errorf("%d zones, want the one of a flat directory", z.Len())
	}
	if loops, err := loopsFrom(t, z, centre); err != nil || len(loops) == 0 {
		t.Errorf("loops from the zone: %d, %v", len(loops), err)
	}
	if z.Activity("ride") != nil {
		t.Error("an activity that was not opened has loops")
	}
}

func TestEachZoneAnswersForItsOwnArea(t *testing.T) {
	dir := t.TempDir()
	west, westCentre := zoneGraph(0, 0)
	east, eastCentre := zoneGraph(10_000, 0) // 8 km of nothing between them
	writeZone(t, filepath.Join(dir, "west"), west)
	writeZone(t, filepath.Join(dir, "east"), east)
	if err := os.MkdirAll(filepath.Join(dir, "empty-folder"), 0o755); err != nil { // not a zone: no graph in it
		t.Fatal(err)
	}
	z, err := OpenZones(dir, "hike", "run")
	if err != nil {
		t.Fatal(err)
	}
	if z.Len() != 2 {
		t.Fatalf("%d zones, want the two with a graph", z.Len())
	}
	for name, at := range map[string]Point{"west": westCentre, "east": eastCentre} {
		loops, err := loopsFrom(t, z, at)
		if err != nil || len(loops) == 0 {
			t.Errorf("%s zone: %d loops, %v", name, len(loops), err)
			continue
		}
	}
	between := Point{Lat: westCentre.Lat, Lon: westCentre.Lon + 5000/(metersPerDegree*math.Cos(westCentre.Lat*rad))} // 6 km east
	if _, err := loopsFrom(t, z, between); !errors.Is(err, ErrOffGraph) {
		t.Errorf("a start between the zones: err = %v, want ErrOffGraph", err)
	}
}

// The box of a zone is a rectangle round an area of any shape: a start can be in the box of a zone that has no
// way near it, and the zone that has one must answer.
func TestAZoneWithNoWayNearTheStartLetsTheNextOneAnswer(t *testing.T) {
	dir := t.TempDir()
	real, centre := zoneGraph(0, 0)
	writeZone(t, filepath.Join(dir, "real"), real)

	// Two nodes far apart, joined by one way: its box covers the real zone with more margin, and no node of
	// it is within snapping distance of the centre.
	sparse := &testGraph{}
	a := sparse.addNode(-5_000, -5_000, 100)
	b := sparse.addNode(8_000, 8_000, 100)
	sparse.connect(a, b, KindPath)
	writeZone(t, filepath.Join(dir, "a-sparse"), sparse)

	z, err := OpenZones(dir, "hike")
	if err != nil {
		t.Fatal(err)
	}
	loops, err := loopsFrom(t, z, centre)
	if err != nil || len(loops) == 0 {
		t.Errorf("%d loops, %v: the real zone should have answered after the sparse one", len(loops), err)
	}
}

func TestEdgeDistanceIsTheDistanceToTheNearestEdgeOfTheBox(t *testing.T) {
	_, centre := zoneGraph(0, 0)
	b := bounds{minLat: int32(centre.Lat*1e7) - 10_000_000, maxLat: int32(centre.Lat*1e7) + 10_000_000,
		minLon: int32(centre.Lon*1e7) - 10_000_000, maxLon: int32(centre.Lon*1e7) + 10_000_000}
	// The nearest edges are the east and west ones: a degree of longitude is 111 km times cos(45°), about 79 km.
	if m := edgeDistance(b, centre.Lat, centre.Lon); m < 77_000 || m > 80_000 {
		t.Errorf("margin at the centre of a box of a degree on a side: %.0f m", m)
	}
	if m := edgeDistance(b, centre.Lat+2, centre.Lon); m >= 0 {
		t.Errorf("margin of a point outside the box: %.0f m, want it negative", m)
	}
}

func TestZonesFailAtStartupOnWhatCannotBeServed(t *testing.T) {
	if _, err := OpenZones(t.TempDir(), "hike"); err == nil || !strings.Contains(err.Error(), "no graph") {
		t.Errorf("a directory without a zone: err = %v", err)
	}
	if _, err := OpenZones(t.TempDir()); err == nil {
		t.Error("no activity: err = nil")
	}

	dir := t.TempDir()
	good, _ := zoneGraph(0, 0)
	writeZone(t, filepath.Join(dir, "good"), good)
	bad, _ := zoneGraph(10_000, 0)
	writeZone(t, filepath.Join(dir, "bad"), bad)
	graph := filepath.Join(dir, "bad", GraphFileName)
	data, err := os.ReadFile(graph)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(graph, data[:len(data)/2], 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenZones(dir, "hike"); err == nil || !strings.Contains(err.Error(), "bad") {
		t.Errorf("a truncated zone: err = %v, want it to name the zone", err)
	}
}

// A zone that did not finish building must stop the server, not leave a hole in the map.
func TestAZoneThatDidNotFinishBuildingStopsTheStartup(t *testing.T) {
	good, _ := zoneGraph(0, 0)
	for name, leftovers := range map[string][]string{
		"landmarks without a graph": {"hike.alt", "run.alt"},
		"a temporary graph":         {"graph.bin.tmp"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			writeZone(t, filepath.Join(dir, "good"), good)
			broken := filepath.Join(dir, "broken")
			if err := os.MkdirAll(broken, 0o755); err != nil {
				t.Fatal(err)
			}
			for _, f := range leftovers {
				if err := os.WriteFile(filepath.Join(broken, f), []byte("x"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := OpenZones(dir, "hike", "run"); err == nil || !strings.Contains(err.Error(), "broken") {
				t.Errorf("err = %v, want it to name the unfinished zone", err)
			}
		})
	}
}

// With several zones, a zone without the landmarks of an activity would serve slowly and unnoticed.
func TestEachZoneOfADirectoryNeedsItsLandmarks(t *testing.T) {
	dir := t.TempDir()
	g, _ := zoneGraph(0, 0)
	writeZone(t, filepath.Join(dir, "zone"), g)
	if err := os.Remove(filepath.Join(dir, "zone", LandmarksFileName("run"))); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenZones(dir, "hike", "run"); err == nil || !strings.Contains(err.Error(), "run.alt") {
		t.Errorf("a zone without run.alt: err = %v", err)
	}
	// A directory that is one zone keeps the landmarks optional.
	flat := t.TempDir()
	writeZone(t, flat, g)
	if err := os.Remove(filepath.Join(flat, LandmarksFileName("run"))); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenZones(flat, "hike", "run"); err != nil {
		t.Errorf("a flat directory without run.alt: %v", err)
	}
}

// Volumes expose their directories as links.
func TestAZoneDirectoryCanBeALink(t *testing.T) {
	dir, store := t.TempDir(), t.TempDir()
	g, _ := zoneGraph(0, 0)
	writeZone(t, filepath.Join(store, "real"), g)
	if err := os.Symlink(filepath.Join(store, "real"), filepath.Join(dir, "linked")); err != nil {
		t.Fatal(err)
	}
	z, err := OpenZones(dir, "hike", "run")
	if err != nil || z.Len() != 1 {
		t.Errorf("a linked zone: %v zones, %v", z, err)
	}
}
