package elevation

import (
	"math"
	"os"
	"path/filepath"
	"testing"
)

// lazyFixture puts four tiles of 100 m round Paris in a directory, one of them twice (a border, with a hole in the
// first file), and returns the directory and the lower-left corner of the first tile.
func lazyFixture(t *testing.T) (dir string, xll, yll float64) {
	t.Helper()
	dir = t.TempDir()
	x, y := Lambert93Grid.Forward(48.85, 2.35)
	xll, yll = math.Floor(x/100)*100, math.Floor(y/100)*100
	slope := func(c, r int) float64 { return float64(200 + 7*c + 11*(3-r)) }
	writeTile(t, dir, "a.asc", xll, yll, slope)
	writeTile(t, dir, "b.asc", xll+100, yll, func(c, r int) float64 {
		if c < 2 {
			return -99999
		}
		return slope(c, r)
	})
	writeTile(t, dir, "b2.asc", xll+100, yll, func(c, r int) float64 { return 900 + float64(c) })
	writeTile(t, dir, "c.asc", xll, yll+100, slope)
	return dir, xll, yll
}

// pointsAround covers the tiles, their borders and what lies beyond them, in 1e-7 degrees.
func pointsAround(xll, yll float64) (lat, lon []int32) {
	x0, y0 := Lambert93Grid.Forward(48.85, 2.35)
	for k := 0; k < 400; k++ {
		px, py := xll-30+float64(k%20)*11, yll-30+float64(k/20)*11
		lat = append(lat, int32(math.Round((48.85+(py-y0)/111_195.0)*1e7)))
		lon = append(lon, int32(math.Round((2.35+(px-x0)/(111_195.0*math.Cos(48.85*rad)))*1e7)))
	}
	return lat, lon
}

func TestLazyDEMSamplesWhatTheLoadedDEMSamples(t *testing.T) {
	// Arrange: a cache of one tile, so that every change of tile reads a tile again
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	lat, lon = append(lat, math.MinInt32), append(lon, 0)
	dem, err := Load(dir, Lambert93Grid)
	if err != nil {
		t.Fatal(err)
	}
	want := dem.Sample(lat, lon)
	lazy, err := OpenLazy(dir, Lambert93Grid, 1)
	if err != nil {
		t.Fatal(err)
	}

	for i := range lat {
		// Act
		got, err := lazy.Sample(lat[i], lon[i])

		// Assert
		if err != nil || got != want[i] {
			t.Fatalf("point %d: got %d (%v), want %d", i, got, err, want[i])
		}
	}
	known := 0
	for _, e := range want {
		if e != Unknown {
			known++
		}
	}
	if known == 0 || known == len(want) {
		t.Fatalf("the points must cover and miss the tiles: %d of %d known", known, len(want))
	}
}

func TestLazyDEMCountsTilesNotFiles(t *testing.T) {
	dir, _, _ := lazyFixture(t)

	lazy, err := OpenLazy(dir, Lambert93Grid, 4)
	if err != nil {
		t.Fatal(err)
	}

	if lazy.Tiles() != 3 {
		t.Errorf("%d tiles, want 3 (a border is two files and one tile)", lazy.Tiles())
	}
}

func TestLazyDEMReadsATileOnceWhenPointsComeTileByTile(t *testing.T) {
	// Arrange
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	// A point reads the four cells round it, which can be in four tiles: the cache holds as many.
	lazy, err := OpenLazy(dir, Lambert93Grid, 4)
	if err != nil {
		t.Fatal(err)
	}
	order := make([]int, len(lat))
	for i := range order {
		order[i] = i
	}
	sortBy(order, func(i int) uint32 { return lazy.TileKey(lat[i], lon[i]) })

	// Act
	for _, i := range order {
		if _, err := lazy.Sample(lat[i], lon[i]); err != nil {
			t.Fatal(err)
		}
	}

	// Assert: a tile read twice would mean the keys do not group the points
	if lazy.Loads() != uint64(lazy.Tiles()) {
		t.Errorf("%d reads for %d tiles", lazy.Loads(), lazy.Tiles())
	}
}

func TestLazyDEMRefusesADirectoryWithNoTile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := OpenLazy(dir, Lambert93Grid, 1); err == nil {
		t.Error("a directory with no tile was opened")
	}
}

// sortBy orders idx by key, stably: the order of the points with the same key does not matter to the test.
func sortBy(idx []int, key func(int) uint32) {
	for i := 1; i < len(idx); i++ {
		for j := i; j > 0 && key(idx[j]) < key(idx[j-1]); j-- {
			idx[j], idx[j-1] = idx[j-1], idx[j]
		}
	}
}
