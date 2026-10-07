package graphbuild

import (
	"fmt"
	"math"
	"testing"

	"github.com/paulmach/osm"

	"github.com/lesloi/path-finder/apps/server/elevation"
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
			kind, surface, _, ok := classifyWay(tc.tags)
			if ok != tc.ok || (ok && (kind != tc.kind || surface != tc.surface)) {
				t.Errorf("got kind %d surface %d ok %v, want kind %d surface %d ok %v", kind, surface, ok, tc.kind, tc.surface, tc.ok)
			}
		})
	}
}

func TestClassifyWayFlagsTechnicalWaysFromT3(t *testing.T) {
	cases := []struct {
		scale     string
		technical bool
	}{
		{"", false}, // untagged: not excluded
		{"hiking", false},
		{"mountain_hiking", false},
		{"demanding_mountain_hiking", true},
		{"alpine_hiking", true},
		{"demanding_alpine_hiking", true},
		{"difficult_alpine_hiking", true},
		{"unknown", false},
	}
	for _, tc := range cases {
		t.Run("sac_scale="+tc.scale, func(t *testing.T) {
			_, _, flags, ok := classifyWay(tags("highway", "path", "sac_scale", tc.scale))
			if !ok || (flags&engine.EdgeTechnical != 0) != tc.technical {
				t.Errorf("flags %d ok %v, want technical %v", flags, ok, tc.technical)
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
	elev := []int32{1000, 1100, 1200, elevation.Unknown, 1000}
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

func TestAssembleCarriesTheTechnicalFlagToBothDirections(t *testing.T) {
	lat := []int32{450_000_000, 450_010_000, 450_020_000}
	lon := []int32{60_000_000, 60_000_000, 60_000_000}
	elev := []int32{1000, 1100, 1200}
	ways := []rawWay{
		{kind: engine.KindPath, flags: engine.EdgeTechnical, idx: []uint32{0, 1}},
		{kind: engine.KindPath, idx: []uint32{1, 2}},
	}

	_, off, edges := assemble(ways, lat, lon, elev)

	// Node 0 has one edge, node 1 two (back to 0, on to 2), node 2 one.
	technical := func(from int) []bool {
		var out []bool
		for e := off[from]; e < off[from+1]; e++ {
			out = append(out, edges[e].Flags&engine.EdgeTechnical != 0)
		}
		return out
	}
	if got := fmt.Sprint(technical(0), technical(1), technical(2)); got != "[true] [true false] [false]" {
		t.Errorf("technical flags per node = %s", got)
	}
}
