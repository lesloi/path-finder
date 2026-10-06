package graphbuild

import (
	"bytes"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"testing"
)

// scatter is n nodes evenly spread over a box, with ids from first.
func scatter(first int64, n int, minLat, minLon, maxLat, maxLon float64) []pbfNode {
	side := int(math.Ceil(math.Sqrt(float64(n))))
	var nodes []pbfNode
	for i := 0; i < n; i++ {
		fy, fx := (float64(i/side)+0.5)/float64(side), (float64(i%side)+0.5)/float64(side)
		nodes = append(nodes, pbfNode{first + int64(i), minLat + fy*(maxLat-minLat), minLon + fx*(maxLon-minLon)})
	}
	return nodes
}

func inside(z Zone, n pbfNode) bool {
	return n.lat >= z.Box.MinLat && n.lat <= z.Box.MaxLat && n.lon >= z.Box.MinLon && n.lon <= z.Box.MaxLon
}

func planOf(t *testing.T, nodes []pbfNode, opt PlanOptions) []Zone {
	t.Helper()
	path := filepath.Join(t.TempDir(), "x.pbf")
	writePBF(t, path, nodes, nil)
	zones, err := PlanZones(path, opt, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	return zones
}

func TestPlanZonesCoversEveryNodeWithinTheBudget(t *testing.T) {
	// A dense area, a lighter one far from it, and nothing between: the sea.
	nodes := scatter(1, 1200, 45.0, 0.0, 45.5, 1.0)
	nodes = append(nodes, scatter(5000, 300, 45.2, 2.5, 45.4, 2.9)...)
	opt := PlanOptions{Extent: Box{MinLon: 0, MinLat: 44.5, MaxLon: 3, MaxLat: 46}, MaxNodes: 400, MarginKm: 5, CellDeg: 0.05}
	zones := planOf(t, nodes, opt)

	if len(zones) < 4 {
		t.Fatalf("%d zones for 1500 nodes with a budget of 400 each", len(zones))
	}
	for _, n := range nodes {
		covered := false
		for _, z := range zones {
			covered = covered || inside(z, n)
		}
		if !covered {
			t.Fatalf("node %d at %.3f,%.3f is in no zone", n.id, n.lat, n.lon)
		}
	}
	for _, z := range zones {
		count := 0
		for _, n := range nodes {
			if inside(z, n) {
				count++
			}
		}
		// A box can hold a little more than the budget: the grid cuts at whole cells, and a margin comes on top.
		if count > 400*3/2 {
			t.Errorf("%s holds %d nodes, budget 400", z.Name, count)
		}
		if count == 0 {
			t.Errorf("%s holds no node: the sea is not a zone", z.Name)
		}
	}
	// The gap between the two areas is nobody's.
	for _, z := range zones {
		if z.Box.MinLon < 1.2 && z.Box.MaxLon > 2.3 {
			t.Errorf("%s spans the empty gap: %+v", z.Name, z.Box)
		}
	}
}

func TestPlanZonesOverlapByTheMargin(t *testing.T) {
	nodes := scatter(1, 2000, 45.0, 0.0, 45.1, 1.0)
	opt := PlanOptions{Extent: Box{MinLon: -0.5, MinLat: 44.5, MaxLon: 1.5, MaxLat: 45.5}, MaxNodes: 700, MarginKm: 10, CellDeg: 0.02}
	zones := planOf(t, nodes, opt)
	if len(zones) < 3 {
		t.Fatalf("%d zones", len(zones))
	}
	// Every zone but the easternmost has a neighbour to its east that begins well before it ends: by about
	// twice the margin, so a loop near the edge of one is whole in the other.
	east := 0.0
	for _, z := range zones {
		east = max(east, z.Box.MaxLon)
	}
	kmPerDegree := 111.32 * math.Cos(45.05*math.Pi/180)
	for _, z := range zones {
		if z.Box.MaxLon == east {
			continue
		}
		overlapped := false
		for _, w := range zones {
			if w.Box.MaxLon > z.Box.MaxLon && w.Box.MinLat < z.Box.MaxLat && w.Box.MaxLat > z.Box.MinLat && (z.Box.MaxLon-w.Box.MinLon)*kmPerDegree >= 15 {
				overlapped = true
			}
		}
		if !overlapped {
			t.Errorf("%s (%+v) has no neighbour to the east overlapping it by 15 km", z.Name, z.Box)
		}
	}
}

func TestPlanZonesNamesAreStableAndTheLineIsWhatBuildTakes(t *testing.T) {
	nodes := scatter(1, 800, 45.0, 0.0, 45.3, 0.6)
	opt := PlanOptions{Extent: Box{MinLon: -0.5, MinLat: 44.5, MaxLon: 1, MaxLat: 46}, MaxNodes: 300, MarginKm: 3, CellDeg: 0.02}
	first, second := planOf(t, nodes, opt), planOf(t, nodes, opt)
	if fmt.Sprint(first) != fmt.Sprint(second) {
		t.Error("the same extract gives different zones")
	}
	for _, z := range first {
		line := z.Line()
		name, box, _ := strings.Cut(line, " ")
		if name != z.Name {
			t.Errorf("line %q does not start with the name %s", line, z.Name)
		}
		if got, err := ParseBox(box); err != nil || got != z.Box {
			t.Errorf("line %q: box %+v, %v; want %+v", line, got, err, z.Box)
		}
	}
	if !strings.HasPrefix(first[0].Name, "z") {
		t.Errorf("name %q", first[0].Name)
	}
}

func TestPlanZonesRefusesWhatItCannotPlan(t *testing.T) {
	path := filepath.Join(t.TempDir(), "x.pbf")
	writePBF(t, path, scatter(1, 10, 45, 0, 45.1, 0.1), nil)
	good := PlanOptions{Extent: Box{MinLon: -1, MinLat: 44, MaxLon: 1, MaxLat: 46}, MaxNodes: 100, MarginKm: 5, CellDeg: 0.05}
	for name, opt := range map[string]PlanOptions{
		"no budget":    {Extent: good.Extent, MarginKm: 5, CellDeg: 0.05},
		"no cell":      {Extent: good.Extent, MaxNodes: 100, MarginKm: 5},
		"empty extent": {Extent: Box{MinLon: 1, MaxLon: 0}, MaxNodes: 100, MarginKm: 5, CellDeg: 0.05},
		"huge grid":    {Extent: Box{MinLon: -180, MinLat: -90, MaxLon: 180, MaxLat: 90}, MaxNodes: 100, MarginKm: 5, CellDeg: 0.001},
	} {
		if _, err := PlanZones(path, opt, &bytes.Buffer{}); err == nil {
			t.Errorf("%s: err = nil", name)
		}
	}
	if _, err := PlanZones(filepath.Join(t.TempDir(), "missing.pbf"), good, &bytes.Buffer{}); err == nil {
		t.Error("a PBF that does not exist: err = nil")
	}
	// No node at all inside the extent: nothing to serve.
	far := good
	far.Extent = Box{MinLon: 5, MinLat: 40, MaxLon: 6, MaxLat: 41}
	if _, err := PlanZones(path, far, &bytes.Buffer{}); err == nil {
		t.Error("an extract with no node in the extent: err = nil")
	}
}

func TestPlanZonesWarnsOfAZoneOverTheBudget(t *testing.T) {
	// A thousand nodes in one cell cannot be split: the zone is over its budget, and the plan says so.
	path := filepath.Join(t.TempDir(), "x.pbf")
	writePBF(t, path, scatter(1, 1000, 45.001, 0.001, 45.009, 0.009), nil)
	var log bytes.Buffer
	zones, err := PlanZones(path, PlanOptions{Extent: Box{MinLon: 0, MinLat: 45, MaxLon: 0.5, MaxLat: 45.5}, MaxNodes: 100, MarginKm: 1, CellDeg: 0.05}, &log)
	if err != nil || len(zones) != 1 {
		t.Fatalf("%d zones, %v", len(zones), err)
	}
	if !strings.Contains(log.String(), "warning") || !strings.Contains(log.String(), zones[0].Name) {
		t.Errorf("no warning in the log:\n%s", log.String())
	}
}
