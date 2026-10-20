package elevation

import (
	"bytes"
	"compress/gzip"
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
	data := []byte(b.String())
	if strings.HasSuffix(strings.ToLower(name), ".gz") {
		var z bytes.Buffer
		w := gzip.NewWriter(&z)
		if _, err := w.Write(data); err != nil {
			t.Fatal(err)
		}
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		data = z.Bytes()
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
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

	dem, err := Load(dir, Lambert93Grid)
	if err != nil {
		t.Fatal(err)
	}
	if dem.Tiles() != 2 {
		t.Fatalf("%d tiles, want 2", dem.Tiles())
	}
	// Cell centres are 12.5 m into each cell, and heights are interpolated between them.
	for x, want := range map[float64]float64{800_012.5: 100, 800_025: 105, 800_037.5: 110} {
		if z := dem.elevationAt(x, 6_500_050); math.Abs(float64(z)-want) > 0.01 {
			t.Errorf("height at x=%v is %v, want %v", x, z, want)
		}
	}
	if z := dem.elevationAt(800_000, 6_700_000); !math.IsNaN(float64(z)) {
		t.Errorf("height outside the tiles = %v, want NaN", z)
	}
	// The hole of b.asc (north-west cell) takes the value of the overlapping tile.
	if z := dem.cell(4, 3); z != 55 && z != 140 {
		t.Errorf("merged cell = %v", z)
	}
}

func TestDEMErrors(t *testing.T) {
	if _, err := Load(t.TempDir(), Lambert93Grid); err == nil {
		t.Error("an empty directory: err = nil")
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bad.asc"), []byte("ncols x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir, Lambert93Grid); err == nil {
		t.Error("a bad header: err = nil")
	}
	short := t.TempDir()
	if err := os.WriteFile(filepath.Join(short, "short.asc"), []byte("ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 25\nNODATA_value -1\n1 2 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(short, Lambert93Grid); err == nil {
		t.Error("too few values: err = nil")
	}
}

func TestLambertOfKnownPoints(t *testing.T) {
	// The Lambert-93 origin: 3°E, 46.5°N is x = 700 000 m, y = 6 600 000 m.
	x, y := Lambert93Grid.Forward(46.5, 3)
	if math.Abs(x-700_000) > 1 || math.Abs(y-6_600_000) > 1 {
		t.Errorf("origin = %.1f, %.1f", x, y)
	}
	// Paris, about (652 000, 6 862 000).
	if x, y = Lambert93Grid.Forward(48.8566, 2.3522); math.Abs(x-652_400) > 1000 || math.Abs(y-6_862_000) > 1000 {
		t.Errorf("Paris = %.0f, %.0f", x, y)
	}
}

func TestSampleKeepsHighElevations(t *testing.T) {
	dir := t.TempDir()
	writeTile(t, dir, "a.asc", 800_000, 6_500_000, func(c, r int) float64 { return 4000 })
	dem, err := Load(dir, Lambert93Grid)
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
	dem, err := Load(dir, Lambert93Grid)
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
		px, py := Lambert93Grid.Forward(lat, lon)
		lat += (y - py) / 111_194.9
		lon += (x - px) / (111_194.9 * math.Cos(lat*math.Pi/180))
	}
	if px, py := Lambert93Grid.Forward(lat, lon); math.Abs(px-x) > 0.5 || math.Abs(py-y) > 0.5 {
		t.Fatalf("did not converge: %.2f, %.2f", px, py)
	}
	return
}

func TestATileHeaderMustSayWhereItIs(t *testing.T) {
	dir := t.TempDir()
	// A header with a centre instead of a corner would put the tile in the wrong place.
	bad := "ncols 4\nnrows 4\nxllcenter 800000\nyllcenter 6500000\ncellsize 25\nNODATA_value -99999\n"
	if err := os.WriteFile(filepath.Join(dir, "centre.asc"), []byte(bad), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir, Lambert93Grid); err == nil || !strings.Contains(err.Error(), "xllcorner") {
		t.Errorf("Load: err = %v, want it to name the missing xllcorner", err)
	}
}

func TestGzippedTilesReadLikePlainOnes(t *testing.T) {
	height := func(c, r int) float64 { return float64(100 + 10*c + r) }
	plain, gz := t.TempDir(), t.TempDir()
	writeTile(t, plain, "a.asc", 800_000, 6_500_000, height)
	writeTile(t, gz, "a.asc.gz", 800_000, 6_500_000, height)
	// An upper-case name, a tile of the next département, and files that are not tiles.
	writeTile(t, gz, "B.ASC.GZ", 800_100, 6_500_000, height)
	writeTile(t, plain, "b.asc", 800_100, 6_500_000, height)
	for _, name := range []string{"a.asc.gz.tmp", "a.gz", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(gz, name), []byte("not a tile"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := Load(plain, Lambert93Grid)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Load(gz, Lambert93Grid)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tiles() != want.Tiles() {
		t.Fatalf("%d tiles, want %d", got.Tiles(), want.Tiles())
	}
	for _, x := range []float64{800_012.5, 800_050, 800_137.5} {
		if a, b := got.elevationAt(x, 6_500_050), want.elevationAt(x, 6_500_050); a != b {
			t.Errorf("height at x=%v is %v from gzip, %v from plain", x, a, b)
		}
	}
}

func TestADamagedGzippedTileNamesItsFile(t *testing.T) {
	good := t.TempDir()
	writeTile(t, good, "a.asc.gz", 800_000, 6_500_000, func(c, r int) float64 { return 100 })
	data, err := os.ReadFile(filepath.Join(good, "a.asc.gz"))
	if err != nil {
		t.Fatal(err)
	}
	flipped := bytes.Clone(data)
	flipped[len(flipped)-6] ^= 0xff // inside the checksum: every value still parses
	for name, bad := range map[string][]byte{
		"cut.asc.gz":     data[:len(data)/2],
		"flipped.asc.gz": flipped,
		"header.asc.gz":  []byte("this is not gzip"),
	} {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, name), bad, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(dir, Lambert93Grid); err == nil || !strings.Contains(err.Error(), name) {
			t.Errorf("%s: Load err = %v, want it to name the file", name, err)
		}
	}
}

func TestOpenLazyNamesATileWhoseHeaderIsNotGzip(t *testing.T) {
	// Arrange
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "header.asc.gz"), []byte("this is not gzip"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Act
	_, err := OpenLazy(dir, Lambert93Grid, 1)

	// Assert
	if err == nil || !strings.Contains(err.Error(), "header.asc.gz") {
		t.Errorf("OpenLazy err = %v, want it to name the file", err)
	}
}

func TestDEMReadsTilesInTheProjectionItIsGiven(t *testing.T) {
	// Saint-Denis (Réunion) and Pointe-à-Pitre (Guadeloupe) in their own UTM zone: each tile only holds its point
	// when the DEM projects with the right zone.
	cases := []struct {
		name     string
		lat, lon float64
	}{
		{"utm40s", -20.8789, 55.4481},
		{"utm20n", 16.2411, -61.5331},
	}
	for _, c := range cases {
		proj, err := ParseProjection(c.name)
		if err != nil {
			t.Fatal(err)
		}
		dir := t.TempDir()
		x, y := proj.Forward(c.lat, c.lon)
		writeTile(t, dir, "a.asc", math.Floor(x/100)*100-50, math.Floor(y/100)*100-50, func(c, r int) float64 { return 250 })

		dem, err := Load(dir, proj)
		if err != nil || dem.Tiles() != 1 {
			t.Fatalf("%s: load: %v tiles, %v", c.name, dem, err)
		}
		if z := dem.At(c.lat, c.lon); math.Abs(float64(z)-250) > 0.01 {
			t.Errorf("%s: At = %v, want 250", c.name, z)
		}
		if z := dem.At(c.lat+1, c.lon); !math.IsNaN(float64(z)) {
			t.Errorf("%s: a point 110 km north = %v, want NaN", c.name, z)
		}
	}
}

func TestCountTilesReadsNoTile(t *testing.T) {
	// Arrange
	dir := t.TempDir()
	x, y := Lambert93Grid.Forward(48.85, 2.35)
	writeTile(t, dir, "a.asc", math.Floor(x/100)*100-50, math.Floor(y/100)*100-50, func(c, r int) float64 { return 100 })
	writeTile(t, dir, "b.asc.gz", math.Floor(x/100)*100+1000, math.Floor(y/100)*100-50, func(c, r int) float64 { return 100 })
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Act
	n, err := CountTiles(dir)
	empty, emptyErr := CountTiles(t.TempDir())

	// Assert
	if err != nil || n != 2 {
		t.Errorf("CountTiles = %d, %v; want 2", n, err)
	}
	if emptyErr != nil || empty != 0 {
		t.Errorf("CountTiles of an empty directory = %d, %v; want 0", empty, emptyErr)
	}
}
