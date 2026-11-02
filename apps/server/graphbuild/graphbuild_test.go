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
		name          string
		tags          osm.Tags
		kind, surface uint8
		foot, bike    bool
	}{
		{"a path", tags("highway", "path"), engine.KindPath, engine.SurfaceUnknown, true, true},
		{"a track with a rough surface", tags("highway", "track", "surface", "grass"), engine.KindTrack, engine.SurfaceRough, true, true},
		{"a road with a paved surface", tags("highway", "residential", "surface", "asphalt"), engine.KindResidential, engine.SurfacePaved, true, true},
		{"a brick road", tags("highway", "residential", "surface", "brick"), engine.KindResidential, engine.SurfacePaved, true, true},
		{"a bricks road", tags("highway", "residential", "surface", "bricks"), engine.KindResidential, engine.SurfacePaved, true, true},
		{"a cement road", tags("highway", "service", "surface", "cement"), engine.KindService, engine.SurfacePaved, true, true},
		{"a chipseal road", tags("highway", "tertiary", "surface", "chipseal"), engine.KindTertiary, engine.SurfacePaved, true, true},
		{"a track of unhewn cobblestone", tags("highway", "track", "surface", "unhewn_cobblestone"), engine.KindTrack, engine.SurfaceRough, true, true},
		{"a path of stepping stones", tags("highway", "path", "surface", "stepping_stones"), engine.KindPath, engine.SurfaceRough, true, true},
		{"several surfaces stay unknown", tags("highway", "track", "surface", "asphalt;gravel"), engine.KindTrack, engine.SurfaceUnknown, true, true},
		{"a link counts as its road", tags("highway", "secondary_link"), engine.KindSecondary, engine.SurfaceUnknown, true, true},
		{"not a highway", tags("waterway", "river"), 0, 0, false, false},
		{"a motorway", tags("highway", "motorway"), 0, 0, false, false},
		{"foot forbidden, bike allowed", tags("highway", "path", "foot", "no"), engine.KindPath, engine.SurfaceUnknown, false, true},
		{"foot private", tags("highway", "track", "foot", "private"), engine.KindTrack, engine.SurfaceUnknown, false, true},
		{"foot private on a way open to all", tags("highway", "track", "access", "yes", "foot", "private"), engine.KindTrack, engine.SurfaceUnknown, false, true},
		{"a pedestrian area is no linear way", tags("highway", "pedestrian", "area", "yes"), 0, 0, false, false},
		{"private access closes both modes", tags("highway", "track", "access", "private"), 0, 0, false, false},
		{"private access with explicit foot", tags("highway", "track", "access", "private", "foot", "yes"), engine.KindTrack, engine.SurfaceUnknown, true, false},
		{"private access with an explicit bicycle", tags("highway", "track", "access", "private", "bicycle", "designated"), engine.KindTrack, engine.SurfaceUnknown, false, true},
		{"a dismount does not open a private way", tags("highway", "track", "access", "private", "bicycle", "dismount"), 0, 0, false, false},
		{"a trunk road is no place for a walker or a rider", tags("highway", "trunk"), engine.KindTrunk, engine.SurfaceUnknown, false, false},
		{"a trunk road for foot alone", tags("highway", "trunk", "foot", "designated"), engine.KindTrunk, engine.SurfaceUnknown, true, false},
		{"a trunk road for bike", tags("highway", "trunk", "bicycle", "yes"), engine.KindTrunk, engine.SurfaceUnknown, false, true},
		{"a trunk road permissive for bike", tags("highway", "trunk", "bicycle", "permissive"), engine.KindTrunk, engine.SurfaceUnknown, false, true},
		{"a motorroad is no place for a bike", tags("highway", "primary", "motorroad", "yes"), engine.KindPrimary, engine.SurfaceUnknown, true, false},
		{"a motorroad with an explicit bicycle", tags("highway", "primary", "motorroad", "yes", "bicycle", "yes"), engine.KindPrimary, engine.SurfaceUnknown, true, false},
		{"a cycleway with a foot rule", tags("highway", "cycleway", "foot", "use_sidepath"), engine.KindCycleway, engine.SurfaceUnknown, false, true},
		{"a plain cycleway is open to both", tags("highway", "cycleway"), engine.KindCycleway, engine.SurfaceUnknown, true, true},
		{"a footway is no place for a bike", tags("highway", "footway"), engine.KindFootway, engine.SurfaceUnknown, true, false},
		{"a footway where a bike may be pushed", tags("highway", "footway", "bicycle", "dismount"), engine.KindFootway, engine.SurfaceUnknown, true, true},
		{"a stair where a bike is designated", tags("highway", "steps", "bicycle", "designated"), engine.KindSteps, engine.SurfaceUnknown, true, true},
		{"a pedestrian way permissive for bikes", tags("highway", "pedestrian", "bicycle", "permissive"), engine.KindPedestrian, engine.SurfaceUnknown, true, true},
		{"bikes forbidden on a footway", tags("highway", "footway", "bicycle", "no"), engine.KindFootway, engine.SurfaceUnknown, true, false},
		{"a bridleway is open to both", tags("highway", "bridleway"), engine.KindBridleway, engine.SurfaceUnknown, true, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w, ok := classifyWay(tc.tags)
			foot, bike := w.modes&engine.EdgeFoot != 0, w.modes&engine.EdgeBike != 0
			if ok != (tc.foot || tc.bike) || foot != tc.foot || bike != tc.bike {
				t.Errorf("ok %v foot %v bike %v, want ok %v foot %v bike %v", ok, foot, bike, tc.foot || tc.bike, tc.foot, tc.bike)
			}
			if ok && (w.kind != tc.kind || w.surf != tc.surface) {
				t.Errorf("kind %d surface %d, want %d and %d", w.kind, w.surf, tc.kind, tc.surface)
			}
		})
	}
}

func TestClassifyWayFlagsT3AndLeavesOutT4AndUp(t *testing.T) {
	cases := []struct {
		scale     string
		technical bool // flagged for the badge
		walkable  bool
	}{
		{"", false, true}, // untagged: neither flagged nor excluded
		{"hiking", false, true},
		{"mountain_hiking", false, true},
		{"demanding_mountain_hiking", true, true},
		{"hiking;demanding_mountain_hiking", true, true},
		{"hiking; mountain_hiking", false, true},
		{"unknown", false, true},
		{"alpine_hiking", false, false},
		{"demanding_alpine_hiking", false, false},
		{"difficult_alpine_hiking", false, false},
		{"demanding_mountain_hiking;alpine_hiking", false, false}, // one T4+ value is enough
	}
	for _, tc := range cases {
		t.Run("sac_scale="+tc.scale, func(t *testing.T) {
			w, ok := classifyWay(tags("highway", "path", "sac_scale", tc.scale))
			if ok != (tc.walkable || w.modes&engine.EdgeBike != 0) || (w.modes&engine.EdgeFoot != 0) != tc.walkable || (w.flags&engine.EdgeTechnical != 0) != tc.technical {
				t.Errorf("flags %d modes %d, want technical %v walkable %v", w.flags, w.modes, tc.technical, tc.walkable)
			}
		})
	}
}

func TestClassifyWayFlagsTheBikeScaleAndLeavesOutTheHardest(t *testing.T) {
	cases := []struct {
		scale     string
		technical bool
		rideable  bool
	}{
		{"", false, true},
		{"0", true, true},
		{"2", true, true},
		{"3", true, true},
		{"2;3", true, true},
		{"4", false, false},
		{"5", false, false},
		{"6", false, false},
		{"3;4", false, false}, // one value from 4 up is enough
		{"imba", false, true}, // another scale says nothing of this one
	}
	for _, tc := range cases {
		t.Run("mtb:scale="+tc.scale, func(t *testing.T) {
			w, _ := classifyWay(tags("highway", "path", "mtb:scale", tc.scale))
			if rideable := w.modes&engine.EdgeBike != 0; rideable != tc.rideable || (w.flags&engine.EdgeTechnicalBike != 0) != tc.technical {
				t.Errorf("modes %d flags %d, want rideable %v technical %v", w.modes, w.flags, tc.rideable, tc.technical)
			}
		})
	}
}

func TestClassifyWayKeepsTheBikeDirectionOfAOneway(t *testing.T) {
	cases := []struct {
		name              string
		tags              osm.Tags
		forward, backward bool
	}{
		{"no oneway", tags("highway", "residential"), true, true},
		{"oneway", tags("highway", "residential", "oneway", "yes"), true, false},
		{"oneway reversed", tags("highway", "residential", "oneway", "-1"), false, true},
		{"oneway for bikes only", tags("highway", "residential", "oneway:bicycle", "yes"), true, false},
		{"oneway where bikes go both ways", tags("highway", "residential", "oneway", "yes", "oneway:bicycle", "no"), true, true},
		{"oneway with a contraflow lane", tags("highway", "residential", "oneway", "yes", "cycleway:backward", "opposite_lane"), true, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w, ok := classifyWay(tc.tags)
			if !ok {
				t.Fatal("the way is open to no mode")
			}
			if f := w.modes&bikeForward != 0; f != tc.forward {
				t.Errorf("forward = %v, want %v", f, tc.forward)
			}
			if b := w.modes&bikeBackward != 0; b != tc.backward {
				t.Errorf("backward = %v, want %v", b, tc.backward)
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

func TestAssembleCarriesTheModesOfAWayToBothDirections(t *testing.T) {
	lat := []int32{450_000_000, 450_010_000, 450_020_000}
	lon := []int32{60_000_000, 60_000_000, 60_000_000}
	elev := []int32{1000, 1100, 1200}
	ways := []rawWay{
		{kind: engine.KindPath, modes: engine.EdgeFoot | engine.EdgeBike | bikeForward, idx: []uint32{0, 1}},
		{kind: engine.KindFootway, modes: engine.EdgeFoot | bikeForward | bikeBackward, idx: []uint32{1, 2}},
	}

	_, off, edges := assemble(ways, lat, lon, elev)

	// Node 1 to node 2 is open to foot alone, and the direction bit follows each edge.
	for e := off[1]; e < off[2]; e++ {
		if edges[e].To == 2 && edges[e].Modes != engine.EdgeFoot {
			t.Errorf("the footway edge carries modes %d, want foot only", edges[e].Modes)
		}
	}
	both := 0
	for e := off[0]; e < off[1]; e++ {
		if edges[e].Modes&engine.EdgeFoot != 0 && edges[e].Modes&engine.EdgeBike != 0 {
			both++
		}
	}
	if both != 1 {
		t.Errorf("%d both-mode edges out of node 0, want 1", both)
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
