package elevation

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
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

// writeBrokenTile writes a tile whose header is right and whose values are one short: opening the directory reads the
// header alone, and only a tile that is parsed fails.
func writeBrokenTile(t *testing.T, dir, name string, xll, yll float64) {
	t.Helper()
	b := "ncols 4\nnrows 4\n"
	b += fmt.Sprintf("xllcorner %v\nyllcorner %v\ncellsize 25\nNODATA_value -99999.00\n", xll, yll)
	b += "1 2 3 4\n1 2 3 4\n1 2 3 4\n1 2 3\n"
	if err := os.WriteFile(filepath.Join(dir, name), []byte(b), 0o644); err != nil {
		t.Fatal(err)
	}
}

// degreesAt is the WGS84 position of a point of the projection, good to a few metres within a few hundred metres of
// Paris, which is all the tiles of the fixture need.
func degreesAt(x, y float64) (lat, lon int32) {
	x0, y0 := Lambert93Grid.Forward(48.85, 2.35)
	return int32(math.Round((48.85 + (y-y0)/111_195.0) * 1e7)),
		int32(math.Round((2.35 + (x-x0)/(111_195.0*math.Cos(48.85*rad))) * 1e7))
}

// pointsAround covers the tiles, their borders and what lies beyond them, in 1e-7 degrees.
func pointsAround(xll, yll float64) (lat, lon []int32) {
	for k := 0; k < 400; k++ {
		a, b := degreesAt(xll-30+float64(k%20)*11, yll-30+float64(k/20)*11)
		lat, lon = append(lat, a), append(lon, b)
	}
	return lat, lon
}

// pointsInTheWestOfTheFirstTile stay in the columns of the first tile, whose cells a point reaches without reading the
// tile east of it.
func pointsInTheWestOfTheFirstTile(xll, yll float64) (lat, lon []int32) {
	for k := 0; k < 40; k++ {
		a, b := degreesAt(xll+15+float64(k%8)*9, yll+15+float64(k/8)*9)
		lat, lon = append(lat, a), append(lon, b)
	}
	return lat, lon
}

// loadsAsLoaded is the elevation of the points the loaded DEM gives, the oracle of the lazy ones.
func loadsAsLoaded(t *testing.T, dir string, lat, lon []int32) []int32 {
	t.Helper()
	dem, err := Load(dir, Lambert93Grid)
	if err != nil {
		t.Fatal(err)
	}
	return dem.Sample(lat, lon)
}

func TestLazyDEMSamplesWhatTheLoadedDEMSamples(t *testing.T) {
	// Arrange: a cache of one tile, so that every change of tile reads a tile again
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	lat, lon = append(lat, math.MinInt32), append(lon, 0)
	want := loadsAsLoaded(t, dir, lat, lon)
	lazy, err := OpenLazy(dir, Lambert93Grid, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()

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

func TestLazyDEMReadsTheTilesAheadAsWellAsTheLoadedDEMDoes(t *testing.T) {
	// Arrange: the window holds the row of tiles above the points, so that the readers can stay ahead of them
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	lat, lon = append(lat, math.MinInt32), append(lon, 0)
	want := loadsAsLoaded(t, dir, lat, lon)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()

	for i := range lat {
		// Act
		got, err := lazy.Sample(lat[i], lon[i])

		// Assert
		if err != nil || got != want[i] {
			t.Fatalf("point %d: got %d (%v), want %d", i, got, err, want[i])
		}
	}
}

func TestLazyDEMCountsTilesNotFiles(t *testing.T) {
	dir, _, _ := lazyFixture(t)

	lazy, err := OpenLazy(dir, Lambert93Grid, 4, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()

	if lazy.Tiles() != 3 {
		t.Errorf("%d tiles, want 3 (a border is two files and one tile)", lazy.Tiles())
	}
}

func TestLazyDEMReadsATileOnceWhenPointsComeTileByTile(t *testing.T) {
	// Arrange
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	// A point reads the four cells round it, which can be in four tiles: the cache holds as many.
	lazy, err := OpenLazy(dir, Lambert93Grid, 4, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()
	order := orderByKey(lazy, lat, lon)

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

func TestLazyDEMReadsATileOnceWhenTheReadersGoFirst(t *testing.T) {
	// Arrange: a window large enough for the readers to read every tile before the points ask for it
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 2)
	if err != nil {
		t.Fatal(err)
	}

	// Act
	for _, i := range orderByKey(lazy, lat, lon) {
		if _, err := lazy.Sample(lat[i], lon[i]); err != nil {
			t.Fatal(err)
		}
	}
	lazy.Close()

	// Assert
	if lazy.Loads() != uint64(lazy.Tiles()) {
		t.Errorf("%d reads for %d tiles: a tile the readers had read was read again", lazy.Loads(), lazy.Tiles())
	}
}

func TestLazyDEMReadsTheTilesNoPointNeeds(t *testing.T) {
	// Arrange: the points stay on one tile, and the window covers the two others, which the readers parse anyway
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsInTheWestOfTheFirstTile(xll, yll)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 2)
	if err != nil {
		t.Fatal(err)
	}

	// Act
	for i := range lat {
		if _, err := lazy.Sample(lat[i], lon[i]); err != nil {
			t.Fatal(err)
		}
	}
	lazy.Close()

	// Assert: the report counts the tiles read ahead, which the graph never uses
	if lazy.Loads() != 3 {
		t.Errorf("%d reads, want the 3 tiles of the window", lazy.Loads())
	}
}

func TestLazyDEMReadsOnlyTheTilesItsPointsReach(t *testing.T) {
	// Arrange: a fourth tile far east of the points, which none of their cells reaches
	dir, xll, yll := lazyFixture(t)
	writeTile(t, dir, "d.asc", xll+500, yll, func(c, r int) float64 { return 300 + float64(c) })
	lat, lon := pointsInTheWestOfTheFirstTile(xll, yll)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	for i := range lat {
		x, y := lazy.Project(lat[i], lon[i])
		lazy.KeepAt(x, y)
	}
	lazy.Plan()

	// Act
	for i := range lat {
		if _, err := lazy.Sample(lat[i], lon[i]); err != nil {
			t.Fatal(err)
		}
	}
	lazy.Close()

	// Assert: the tile of the points, the ones east and north of it, and not the one far east
	if lazy.Loads() != 3 {
		t.Errorf("%d reads, want the 3 tiles of the plan", lazy.Loads())
	}
}

func TestLazyDEMReadsATileAtATimeWhenTheCacheHoldsNoWindow(t *testing.T) {
	// Arrange: a cache of four tiles holds the frame of a point and nothing ahead, so no reader can help
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	lazy, err := OpenLazy(dir, Lambert93Grid, 4, 8)
	if err != nil {
		t.Fatal(err)
	}

	// Act
	for _, i := range orderByKey(lazy, lat, lon) {
		if _, err := lazy.Sample(lat[i], lon[i]); err != nil {
			t.Fatal(err)
		}
	}
	lazy.Close()

	// Assert
	if lazy.Loads() != uint64(lazy.Tiles()) {
		t.Errorf("%d reads for %d tiles", lazy.Loads(), lazy.Tiles())
	}
}

func TestLazyDEMSamplesPointsThatComeInAnyOrder(t *testing.T) {
	// Arrange: the frame goes back and forth, which no read-ahead can follow
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	want := loadsAsLoaded(t, dir, lat, lon)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()
	order := orderByKey(lazy, lat, lon)

	for k := len(order) - 1; k >= 0; k-- {
		// Act
		got, err := lazy.Sample(lat[order[k]], lon[order[k]])

		// Assert
		if err != nil || got != want[order[k]] {
			t.Fatalf("point %d: got %d (%v), want %d", order[k], got, err, want[order[k]])
		}
	}
}

func TestLazyDEMSamplesAfterClose(t *testing.T) {
	// Arrange: a build that fails elsewhere closes the directory before its points come
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	want := loadsAsLoaded(t, dir, lat, lon)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 4)
	if err != nil {
		t.Fatal(err)
	}
	lazy.Close()
	lazy.Close() // a build closes on its error path and again on its way out

	for i := range lat {
		// Act
		got, err := lazy.Sample(lat[i], lon[i])

		// Assert
		if err != nil || got != want[i] {
			t.Fatalf("point %d: got %d (%v), want %d", i, got, err, want[i])
		}
	}
}

func TestLazyDEMClosesReadersThatWaitForAPoint(t *testing.T) {
	// Arrange: no point has come, so every reader waits on the first tile
	dir, _, _ := lazyFixture(t)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 4)
	if err != nil {
		t.Fatal(err)
	}

	// Act
	done := make(chan struct{})
	go func() {
		lazy.Close()
		close(done)
	}()

	// Assert
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("Close waited for readers that had no tile to parse")
	}
}

func TestLazyDEMFailsOnATileItNeeds(t *testing.T) {
	// Arrange: the values of the tile of the points are one short
	dir, xll, yll := lazyFixture(t)
	writeBrokenTile(t, dir, "a.asc", xll, yll)
	lat, lon := pointsInTheWestOfTheFirstTile(xll, yll)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()

	// Act
	_, err = lazy.Sample(lat[0], lon[0])

	// Assert
	if err == nil {
		t.Fatal("a tile that was read ahead failed for nobody")
	}
}

func TestLazyDEMIgnoresATileItsPointsNeverReach(t *testing.T) {
	// Arrange: the tile east of the points is broken, and their cells never reach it
	dir, xll, yll := lazyFixture(t)
	writeBrokenTile(t, dir, "b.asc", xll+100, yll)
	lat, lon := pointsInTheWestOfTheFirstTile(xll, yll)
	lazy, err := OpenLazy(dir, Lambert93Grid, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()

	for i := range lat {
		// Act
		got, err := lazy.Sample(lat[i], lon[i])

		// Assert
		if err != nil {
			t.Fatalf("point %d: %v: a tile nobody reads failed the build", i, err)
		}
		if got == Unknown {
			t.Fatalf("point %d: no elevation", i)
		}
	}
}

func TestLazyDEMRefusesADirectoryWithNoTile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := OpenLazy(dir, Lambert93Grid, 1, 0); err == nil {
		t.Error("a directory with no tile was opened")
	}
}

// orderByKey is the points in the order of their tile keys, which is the order the build samples them in.
func orderByKey(lazy *LazyDEM, lat, lon []int32) []int {
	order := make([]int, len(lat))
	for i := range order {
		order[i] = i
	}
	sortBy(order, func(i int) uint32 { return lazy.TileKey(lat[i], lon[i]) })
	return order
}

// sortBy orders idx by key, stably: the order of the points with the same key does not matter to the test.
func sortBy(idx []int, key func(int) uint32) {
	for i := 1; i < len(idx); i++ {
		for j := i; j > 0 && key(idx[j]) < key(idx[j-1]); j-- {
			idx[j], idx[j-1] = idx[j-1], idx[j]
		}
	}
}

func TestLazyDEMSamplesAProjectedPointAsAPositionOfDegrees(t *testing.T) {
	// Arrange
	dir, xll, yll := lazyFixture(t)
	lat, lon := pointsAround(xll, yll)
	lazy, err := OpenLazy(dir, Lambert93Grid, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lazy.Close()

	for i := range lat {
		want, werr := lazy.Sample(lat[i], lon[i])
		wantKey := lazy.TileKey(lat[i], lon[i])

		// Act
		x, y := lazy.Project(lat[i], lon[i])
		key := lazy.TileKeyAt(x, y)
		got, err := lazy.SampleAt(x, y)

		// Assert
		if err != nil || werr != nil || got != want || key != wantKey {
			t.Fatalf("point %d: got %d (%v), want %d (%v)", i, got, err, want, werr)
		}
	}
}
