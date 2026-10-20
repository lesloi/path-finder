package graphbuild

import (
	"bytes"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lesloi/path-finder/apps/server/elevation"
)

// writeSquare writes a tile of 8 by 8 cells of 25 m whose lower-left corner is (xll, yll), rising to the north and the
// east. With a hole, the western half is empty, as the border tiles of a département are outside it.
func writeSquare(t *testing.T, dir, name string, xll, yll float64, hole bool) {
	t.Helper()
	var b strings.Builder
	fmt.Fprintf(&b, "ncols 8\nnrows 8\nxllcorner %v\nyllcorner %v\ncellsize 25\nNODATA_value -99999.00\n", xll, yll)
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			v := float64(200 + 7*c + 11*(7-r))
			if hole && c < 4 {
				v = -99999
			}
			fmt.Fprintf(&b, "%v ", v)
		}
		b.WriteString("\n")
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

// fixture holds the paths of an extract and of its tiles.
type fixture struct{ dir, pbf, dem string }

// parisPoint is the WGS84 point whose Lambert-93 position is close to (x, y), good to a few metres within a few
// hundred metres of Paris, which is all the tiles need.
func parisPoint(x, y float64) (lat, lon float64) {
	x0, y0 := elevation.Lambert93Grid.Forward(48.85, 2.35)
	return 48.85 + (y-y0)/111_195.0, 2.35 + (x-x0)/(111_195.0*math.Cos(48.85*math.Pi/180))
}

// newFixture writes an extract and four tiles of 200 m round Paris, one of them twice as a border is. The extract has what
// makes the two builds differ if one is wrong: ways that cross, a repeated node, a reference with no node, nodes off the
// tiles, a way nobody walks, and two nodes at one position, the one of the higher id met first.
func newFixture(t *testing.T) fixture {
	t.Helper()
	dir := t.TempDir()
	dem := filepath.Join(dir, "dem")
	if err := os.Mkdir(dem, 0o755); err != nil {
		t.Fatal(err)
	}
	x, y := elevation.Lambert93Grid.Forward(48.85, 2.35)
	xll, yll := math.Floor(x/200)*200, math.Floor(y/200)*200
	writeSquare(t, dem, "a.asc", xll, yll, false)
	writeSquare(t, dem, "b.asc", xll+200, yll, true)
	writeSquare(t, dem, "b2.asc", xll+200, yll, false)
	writeSquare(t, dem, "c.asc", xll, yll+200, false)

	at := func(col, row int64) int64 { return 100 + row*20 + col }
	var nodes []pbfNode
	for row := int64(0); row < 14; row++ {
		for col := int64(0); col < 14; col++ {
			lat, lon := parisPoint(xll-60+float64(col)*36, yll-60+float64(row)*36)
			nodes = append(nodes, pbfNode{at(col, row), lat, lon})
		}
	}
	lat, lon := parisPoint(xll+90, yll+90)
	nodes = append(nodes, pbfNode{500, lat, lon}, pbfNode{600, lat, lon}) // the same position
	rows, cols := make([][]int64, 14), make([][]int64, 14)
	for i := int64(0); i < 14; i++ {
		for j := int64(0); j < 14; j++ {
			rows[i], cols[i] = append(rows[i], at(j, i)), append(cols[i], at(i, j))
		}
	}
	road := [][2]string{{"highway", "residential"}, {"surface", "asphalt"}}
	var ways []pbfWay
	// The twins first: 600 is met before 500, so it must come first along the curve whatever the order of their ids.
	ways = append(ways,
		pbfWay{id: 900, refs: []int64{600, at(5, 7)}, tags: road},
		pbfWay{id: 901, refs: []int64{500, at(7, 5)}, tags: road})
	for i, r := range rows {
		ways = append(ways, pbfWay{id: int64(1000 + i), refs: r, tags: road})
	}
	for i := 0; i < 14; i += 3 {
		ways = append(ways, pbfWay{id: int64(2000 + i), refs: cols[i], tags: [][2]string{{"highway", "path"}, {"sac_scale", "demanding_mountain_hiking"}}})
	}
	ways = append(ways,
		pbfWay{id: 3000, refs: []int64{at(5, 5), at(5, 5), at(6, 5), 999_999, at(7, 5)}, tags: [][2]string{{"highway", "track"}}},
		pbfWay{id: 3001, refs: []int64{at(5, 5), at(6, 6)}, tags: [][2]string{{"waterway", "river"}}},
		pbfWay{id: 3002, refs: []int64{at(7, 7), at(8, 8), at(7, 7)}, tags: [][2]string{{"highway", "footway"}}})
	pbf := filepath.Join(dir, "a.osm.pbf")
	writePBF(t, pbf, nodes, ways)
	return fixture{dir, pbf, dem}
}

func readAll(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func entries(t *testing.T, dir string) int {
	t.Helper()
	list, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return len(list)
}

func TestBuildOnDiskWritesTheGraphBuildWrites(t *testing.T) {
	// Arrange
	f := newFixture(t)
	proj := elevation.Lambert93Grid
	want := filepath.Join(f.dir, "want.bin")
	if err := Build([]string{f.pbf}, f.dem, proj, want, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	for _, o := range []Options{{Tmp: f.dir, Chunk: 1 << 20, Cache: 16}, {Tmp: f.dir, Chunk: 9, Cache: 1}, {Tmp: f.dir, Chunk: 50, Cache: 2}} {
		got := filepath.Join(f.dir, "got.bin")

		// Act
		report, err := BuildOnDisk(f.pbf, f.dem, proj, got, o, &bytes.Buffer{})

		// Assert
		if err != nil {
			t.Fatalf("%+v: %v", o, err)
		}
		if !bytes.Equal(readAll(t, got), readAll(t, want)) {
			t.Errorf("%+v: the graphs differ", o)
		}
		if report.Nodes < 50 || report.Edges < 50 {
			t.Errorf("%+v: a graph too small to prove anything: %+v", o, report)
		}
		if o.Chunk == 9 && report.Runs < 10 {
			t.Errorf("a chunk of 9 spilled %d runs", report.Runs)
		}
	}
	// only the extract, the tiles and the two graphs are left
	if n := entries(t, f.dir); n != 4 {
		t.Errorf("%d entries left in the directory, want 4", n)
	}
}

func TestBuildOnDiskFailsWithoutElevationAsBuildDoes(t *testing.T) {
	f := newFixture(t)
	far := filepath.Join(f.dir, "far")
	if err := os.Mkdir(far, 0o755); err != nil {
		t.Fatal(err)
	}
	writeSquare(t, far, "t.asc", 0, 0, false)

	_, err := BuildOnDisk(f.pbf, far, elevation.Lambert93Grid, filepath.Join(f.dir, "o.bin"), Options{Chunk: 100, Cache: 2}, &bytes.Buffer{})

	if err == nil || !strings.Contains(err.Error(), "no walkable way has elevation") {
		t.Errorf("error %v", err)
	}
	if n := entries(t, f.dir); n != 3 { // the extract and the two tile directories: no scratch directory, no graph
		t.Errorf("%d entries left in the directory, want 3", n)
	}
}

func TestBuildOnDiskRefusesAnExtractThatIsNotSortedById(t *testing.T) {
	f := newFixture(t)
	nodes := []pbfNode{{5, 48.85, 2.35}, {3, 48.85, 2.3501}}
	writePBF(t, f.pbf, nodes, []pbfWay{{id: 1, refs: []int64{5, 3}, tags: [][2]string{{"highway", "path"}}}})

	_, err := BuildOnDisk(f.pbf, f.dem, elevation.Lambert93Grid, filepath.Join(f.dir, "o.bin"), Options{Chunk: 100, Cache: 2}, &bytes.Buffer{})

	if err == nil || !strings.Contains(err.Error(), "not sorted") {
		t.Errorf("error %v", err)
	}
}

func TestBuildGraphBuildsOneExtractOnDiskBesideTheGraph(t *testing.T) {
	// Arrange
	f := newFixture(t)
	want := filepath.Join(f.dir, "want.bin")
	if err := Build([]string{f.pbf}, f.dem, elevation.Lambert93Grid, want, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(f.dir, "out")
	if err := os.Mkdir(out, 0o755); err != nil {
		t.Fatal(err)
	}
	var log bytes.Buffer

	// Act: no directory is given for the temporary files, so they go beside the graph
	err := BuildGraph([]string{f.pbf}, f.dem, elevation.Lambert93Grid, filepath.Join(out, "graph.bin"), Options{}, &log)

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(readAll(t, filepath.Join(out, "graph.bin")), readAll(t, want)) {
		t.Error("the graphs differ")
	}
	if n := entries(t, out); n != 1 {
		t.Errorf("%d entries beside the graph, want 1", n)
	}
	if !strings.Contains(log.String(), "on disk") {
		t.Errorf("the log does not say the build was on disk:\n%s", &log)
	}
}

func TestBuildGraphBuildsSeveralExtractsInMemory(t *testing.T) {
	f := newFixture(t)
	second := filepath.Join(f.dir, "b.osm.pbf")
	writePBF(t, second, []pbfNode{{9000, 48.85, 2.35}}, nil)
	var log bytes.Buffer

	err := BuildGraph([]string{f.pbf, second}, f.dem, elevation.Lambert93Grid, filepath.Join(f.dir, "g.bin"), Options{}, &log)

	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(log.String(), "in memory") {
		t.Errorf("the log does not say the build was in memory:\n%s", &log)
	}
}
