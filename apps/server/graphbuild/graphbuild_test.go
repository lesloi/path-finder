package graphbuild

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/paulmach/osm"

	"github.com/lesloi/path-finder/apps/server/engine"
)

func tags(kv ...string) osm.Tags {
	var t osm.Tags
	for i := 0; i < len(kv); i += 2 {
		t = append(t, osm.Tag{Key: kv[i], Value: kv[i+1]})
	}
	return t
}

func TestClassifyWay(t *testing.T) {
	cases := []struct {
		name    string
		tags    osm.Tags
		ok      bool
		kind    uint8
		surface uint8
	}{
		{"a path", tags("highway", "path"), true, engine.KindPath, engine.SurfaceUnknown},
		{"a track with a rough surface", tags("highway", "track", "surface", "grass"), true, engine.KindTrack, engine.SurfaceRough},
		{"a road with a paved surface", tags("highway", "residential", "surface", "asphalt"), true, engine.KindResidential, engine.SurfacePaved},
		{"a link counts as its road", tags("highway", "secondary_link"), true, engine.KindSecondary, engine.SurfaceUnknown},
		{"not a highway", tags("waterway", "river"), false, 0, 0},
		{"a motorway", tags("highway", "motorway"), false, 0, 0},
		{"foot forbidden", tags("highway", "path", "foot", "no"), false, 0, 0},
		{"an area", tags("highway", "pedestrian", "area", "yes"), false, 0, 0},
		{"private access", tags("highway", "track", "access", "private"), false, 0, 0},
		{"private access with explicit foot", tags("highway", "track", "access", "private", "foot", "yes"), true, engine.KindTrack, engine.SurfaceUnknown},
		{"a trunk road", tags("highway", "trunk"), false, 0, 0},
		{"a trunk road for foot", tags("highway", "trunk", "foot", "designated"), true, engine.KindTrunk, engine.SurfaceUnknown},
		{"a cycleway with a foot rule", tags("highway", "cycleway", "foot", "use_sidepath"), false, 0, 0},
		{"a plain cycleway", tags("highway", "cycleway"), true, engine.KindCycleway, engine.SurfaceUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			kind, surface, ok := classifyWay(tc.tags)
			if ok != tc.ok || (ok && (kind != tc.kind || surface != tc.surface)) {
				t.Errorf("got kind %d surface %d ok %v, want kind %d surface %d ok %v", kind, surface, ok, tc.kind, tc.surface, tc.ok)
			}
		})
	}
}

func TestHaversine(t *testing.T) {
	// One degree of latitude is about 111.2 km, and one of longitude shrinks with the latitude.
	if d := haversineM(450_000_000, 60_000_000, 460_000_000, 60_000_000); math.Abs(d-111_195) > 100 {
		t.Errorf("1° of latitude = %.0f m", d)
	}
	if d := haversineM(600_000_000, 0, 600_000_000, 10_000_000); math.Abs(d-55_597) > 200 {
		t.Errorf("1° of longitude at 60°N = %.0f m", d)
	}
	if d := haversineM(450_000_000, 60_000_000, 450_000_000, 60_000_000); d != 0 {
		t.Errorf("same point = %v", d)
	}
}

func TestAssembleCutsWaysIntoEdgesAndDropsWhatHasNoElevation(t *testing.T) {
	// Nodes 0-1-2 form a path; node 3 has no elevation and node 4 belongs to no way.
	lat := []int32{450_000_000, 450_010_000, 450_020_000, 450_030_000, 460_000_000}
	lon := []int32{60_000_000, 60_000_000, 60_000_000, 60_000_000, 60_000_000}
	elev := []int16{1000, 1100, 1200, elevUnknown, 1000}
	ways := []rawWay{
		{kind: engine.KindPath, surf: engine.SurfaceRough, idx: []uint32{0, 1, 2, 3}},
		{kind: engine.KindTrack, surf: engine.SurfacePaved, idx: []uint32{1, 1}}, // a way that stays on a node
	}

	nodes, off, edges := assemble(ways, lat, lon, elev)

	if len(nodes) != 3 || len(off) != 4 || len(edges) != 4 {
		t.Fatalf("%d nodes, %d offsets, %d edges; want 3, 4, 4", len(nodes), len(off), len(edges))
	}
	if nodes[2].Elev != 1200 || nodes[0].Lat != 450_000_000 {
		t.Errorf("nodes = %+v", nodes)
	}
	if want := []uint32{0, 1, 3, 4}; fmt.Sprint(off) != fmt.Sprint(want) {
		t.Errorf("offsets = %v, want %v", off, want)
	}
	for _, e := range edges {
		if e.Kind != engine.KindPath || e.Surf != engine.SurfaceRough || math.Abs(float64(e.Len)-111.2) > 1 {
			t.Errorf("edge = %+v", e)
		}
	}
}

// writeTile writes an ASC tile of ncols by nrows, whose value at column c and row r (from the north) is f(c, r).
func writeTile(t *testing.T, dir, name string, xll, yll float64, f func(c, r int) float64) {
	t.Helper()
	const n = 4
	var b strings.Builder
	fmt.Fprintf(&b, "ncols %d\nnrows %d\nxllcorner %v\nyllcorner %v\ncellsize 25\nNODATA_value -99999.00\n", n, n, xll, yll)
	for r := 0; r < n; r++ {
		for c := 0; c < n; c++ {
			fmt.Fprintf(&b, "%v ", f(c, r))
		}
		b.WriteString("\n")
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDEMReadsTilesAndInterpolates(t *testing.T) {
	dir := t.TempDir()
	// A 100 m tile at the origin, rising 10 m per column towards the east, and a second one east of it
	// with a hole, whose neighbour fills the border cells: a département border comes as two tiles.
	writeTile(t, dir, "a.asc", 800_000, 6_500_000, func(c, r int) float64 { return float64(100 + 10*c) })
	writeTile(t, filepath.Join(dir), "b.ASC", 800_100, 6_500_000, func(c, r int) float64 {
		if c == 0 && r == 0 {
			return -99999
		}
		return 140
	})
	writeTile(t, dir, "overlap.asc", 800_100, 6_500_000, func(c, r int) float64 { return 55 })
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}

	dem, err := loadDEM(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(dem.tiles) != 2 {
		t.Fatalf("%d tiles, want 2", len(dem.tiles))
	}
	// Cell centres are 12.5 m into each cell, and heights are interpolated between them.
	for x, want := range map[float64]float64{800_012.5: 100, 800_025: 105, 800_037.5: 110} {
		if z := dem.elevationL93(x, 6_500_050); math.Abs(float64(z)-want) > 0.01 {
			t.Errorf("height at x=%v is %v, want %v", x, z, want)
		}
	}
	if z := dem.elevationL93(800_000, 6_700_000); !math.IsNaN(float64(z)) {
		t.Errorf("height outside the tiles = %v, want NaN", z)
	}
	// The hole of b.asc (north-west cell) takes the value of the overlapping tile.
	if z := dem.cell(4, 3); z != 55 && z != 140 {
		t.Errorf("merged cell = %v", z)
	}
}

func TestDEMErrors(t *testing.T) {
	if _, err := loadDEM(t.TempDir()); err == nil {
		t.Error("an empty directory: err = nil")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bad.asc"), []byte("ncols x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := loadDEM(dir); err == nil {
		t.Error("a bad header: err = nil")
	}
	short := t.TempDir()
	if err := os.WriteFile(filepath.Join(short, "short.asc"), []byte("ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 25\nNODATA_value -1\n1 2 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := loadDEM(short); err == nil {
		t.Error("too few values: err = nil")
	}
}

func TestLambertOfKnownPoints(t *testing.T) {
	// The Lambert-93 origin: 3°E, 46.5°N is x = 700 000 m, y = 6 600 000 m.
	x, y := l93.forward(46.5, 3)
	if math.Abs(x-700_000) > 1 || math.Abs(y-6_600_000) > 1 {
		t.Errorf("origin = %.1f, %.1f", x, y)
	}
	// Paris, about (652 000, 6 862 000).
	if x, y = l93.forward(48.8566, 2.3522); math.Abs(x-652_400) > 1000 || math.Abs(y-6_862_000) > 1000 {
		t.Errorf("Paris = %.0f, %.0f", x, y)
	}
}
