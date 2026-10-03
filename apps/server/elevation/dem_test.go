package elevation

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

	dem, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if dem.Tiles() != 2 {
		t.Fatalf("%d tiles, want 2", dem.Tiles())
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
	if _, err := Load(t.TempDir()); err == nil {
		t.Error("an empty directory: err = nil")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bad.asc"), []byte("ncols x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir); err == nil {
		t.Error("a bad header: err = nil")
	}
	short := t.TempDir()
	if err := os.WriteFile(filepath.Join(short, "short.asc"), []byte("ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 25\nNODATA_value -1\n1 2 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(short); err == nil {
		t.Error("too few values: err = nil")
	}
}

func TestLambertOfKnownPoints(t *testing.T) {
	// The Lambert-93 origin: 3°E, 46.5°N is x = 700 000 m, y = 6 600 000 m.
	x, y := Lambert93(46.5, 3)
	if math.Abs(x-700_000) > 1 || math.Abs(y-6_600_000) > 1 {
		t.Errorf("origin = %.1f, %.1f", x, y)
	}
	// Paris, about (652 000, 6 862 000).
	if x, y = Lambert93(48.8566, 2.3522); math.Abs(x-652_400) > 1000 || math.Abs(y-6_862_000) > 1000 {
		t.Errorf("Paris = %.0f, %.0f", x, y)
	}
}

func TestSampleKeepsHighElevations(t *testing.T) {
	dir := t.TempDir()
	writeTile(t, dir, "a.asc", 800_000, 6_500_000, func(c, r int) float64 { return 4000 })
	dem, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	lat, lon := lambertToWGS(t, 800_050, 6_500_050)
	got := dem.Sample([]int32{int32(lat * 1e7)}, []int32{int32(lon * 1e7)})[0]
	if math.Abs(float64(got)-40000) > 3 {
		t.Errorf("4000 m = %d decimetres, want about 40000: a height above 3276.7 m must not wrap", got)
	}
}

func TestSampleReadsEveryPointOnEveryCPU(t *testing.T) {
	dir := t.TempDir()
	writeTile(t, dir, "a.asc", 800_000, 6_500_000, func(c, r int) float64 { return float64(100 + 10*c) })
	dem, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Three points: one inside the tile, one outside, and one whose position was never read.
	x, y := 800_037.5, 6_500_050.0
	lat, lon := lambertToWGS(t, x, y)
	elev := dem.Sample(
		[]int32{int32(lat * 1e7), 450_000_000, math.MinInt32},
		[]int32{int32(lon * 1e7), 60_000_000, 0},
	)
	if math.Abs(float64(elev[0])-1100) > 3 {
		t.Errorf("inside = %d decimetres, want about 1100", elev[0])
	}
	if elev[1] != Unknown || elev[2] != Unknown {
		t.Errorf("outside and unread = %d, %d, want Unknown", elev[1], elev[2])
	}
	if got := dem.Sample(nil, nil); len(got) != 0 {
		t.Errorf("no point = %v", got)
	}
}

// lambertToWGS finds the WGS84 point whose Lambert-93 position is (x, y), by iterating the forward projection.
func lambertToWGS(t *testing.T, x, y float64) (lat, lon float64) {
	t.Helper()
	lat, lon = 45.0, 3.0
	for range 50 {
		px, py := Lambert93(lat, lon)
		lat += (y - py) / 111_194.9
		lon += (x - px) / (111_194.9 * math.Cos(lat*math.Pi/180))
	}
	if px, py := Lambert93(lat, lon); math.Abs(px-x) > 0.5 || math.Abs(py-y) > 0.5 {
		t.Fatalf("did not converge: %.2f, %.2f", px, py)
	}
	return
}
