package engine

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/lesloi/path-finder/apps/server/contract"
)

// The web app draws the veil on the grid of contract.json: the engine's must be the same.
func TestCoverageGridIsTheOneOfTheContract(t *testing.T) {
	if CoverageCellsPerDegree != contract.CoverageCellsPerDegree() {
		t.Errorf("the engine has %d cells to the degree, contract.json %d", CoverageCellsPerDegree, contract.CoverageCellsPerDegree())
	}
}

// A reload brings the coverage of the files it maps, not the one of the zones it replaces.
func TestReloadReplacesTheCoverage(t *testing.T) {
	dir := t.TempDir()
	writeZone(t, dir, squareAt(45.905, 6.11, 0.002))
	r := newReloader(t, dir)
	if got := r.Coverage(); !reflect.DeepEqual(got, [][4]float64{{6.1, 45.9, 6.2, 46}}) {
		t.Fatalf("coverage = %v", got)
	}

	replaceZone(t, dir, squareAt(48.05, -2.55, 0.002))
	if swapped, err := r.Reload(); err != nil || !swapped {
		t.Fatalf("reload = %v, %v", swapped, err)
	}

	if got := r.Coverage(); !reflect.DeepEqual(got, [][4]float64{{-2.6, 48, -2.5, 48.1}}) {
		t.Errorf("coverage after the reload = %v", got)
	}
}

// squareAt is four nodes joined in a square whose south-west corner is at the given degrees.
func squareAt(lat, lon, side float64) *testGraph {
	g := &testGraph{}
	for _, d := range [][2]float64{{0, 0}, {0, side}, {side, side}, {side, 0}} {
		g.nodes = append(g.nodes, node{Lat: int32((lat + d[0]) * 1e7), Lon: int32((lon + d[1]) * 1e7), Elev: 1000})
		g.edges = append(g.edges, nil)
	}
	for i := 0; i < 4; i++ {
		g.connect(i, (i+1)%4, KindPath)
	}
	return g
}

func TestCoverageIsTheCellsHoldingANode(t *testing.T) {
	dir := t.TempDir()
	// West of Greenwich, over two cells; and a second zone on the same cells, as zones overlap by design.
	writeZone(t, filepath.Join(dir, "brittany"), squareAt(48.01, -2.51, 0.02))
	writeZone(t, filepath.Join(dir, "brittany-east"), squareAt(48.02, -2.49, 0.002))
	writeZone(t, filepath.Join(dir, "annecy"), squareAt(45.905, 6.11, 0.002))
	z, err := OpenZones(dir, "any", "paved")
	if err != nil {
		t.Fatal(err)
	}
	want := [][4]float64{
		{6.1, 45.9, 6.2, 46},
		{-2.6, 48, -2.5, 48.1},
		{-2.5, 48, -2.4, 48.1},
	}
	if got := z.Coverage(); !reflect.DeepEqual(got, want) {
		t.Errorf("coverage = %v, want %v", got, want)
	}
}

func TestReloaderCoverage(t *testing.T) {
	dir := t.TempDir()
	writeZone(t, dir, squareAt(45.905, 6.11, 0.002))
	r, err := NewReloader(dir, "any", "paved")
	if err != nil {
		t.Fatal(err)
	}
	if got := r.Coverage(); !reflect.DeepEqual(got, [][4]float64{{6.1, 45.9, 6.2, 46}}) {
		t.Errorf("coverage = %v", got)
	}
}

func TestCoarseRoundsDown(t *testing.T) {
	for _, tc := range []struct {
		units int64
		want  int64
	}{{0, 0}, {999_999, 0}, {1_000_000, 1}, {-1, -1}, {-1_000_000, -1}, {-1_000_001, -2}, {-25_100_000, -26}} {
		if got := coarse(tc.units, 10); got != tc.want {
			t.Errorf("coarse(%d) = %d, want %d", tc.units, got, tc.want)
		}
	}
}

// A start within the snap distance of a node is served, so the cell it is in counts though it holds no node.
func TestCoverageReachesAsFarAsAStartSnaps(t *testing.T) {
	dir := t.TempDir()
	// 0.0005° (about 40 m) from the west edge of its cell, and 300 m from the south edge of the cell below.
	writeZone(t, dir, squareAt(45.9027, 6.1005, 0.002))
	z, err := OpenZones(dir, "any", "paved")
	if err != nil {
		t.Fatal(err)
	}
	want := [][4]float64{
		{6, 45.8, 6.1, 45.9},
		{6.1, 45.8, 6.2, 45.9},
		{6, 45.9, 6.1, 46},
		{6.1, 45.9, 6.2, 46},
	}
	if got := z.Coverage(); !reflect.DeepEqual(got, want) {
		t.Errorf("coverage = %v, want %v", got, want)
	}
}

func TestCoverageLeavesOutWhatIsPastTheSnapDistance(t *testing.T) {
	dir := t.TempDir()
	// More than 400 m from every edge of the cell: it alone is covered.
	writeZone(t, dir, squareAt(45.95, 6.15, 0.002))
	z, err := OpenZones(dir, "any", "paved")
	if err != nil {
		t.Fatal(err)
	}
	if got := z.Coverage(); !reflect.DeepEqual(got, [][4]float64{{6.1, 45.9, 6.2, 46}}) {
		t.Errorf("coverage = %v", got)
	}
}
