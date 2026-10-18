package generator

import (
	"math"
	"testing"

	"github.com/lesloi/path-finder/apps/server/contract"
)

var start = [2]float64{6.1294, 45.8992}

// at is a point metres east and north of the start point.
func at(x, y float64) []float64 {
	return []float64{start[0] + x/(111_320*math.Cos(start[1]*math.Pi/180)), start[1] + y/110_540}
}

func startPoint() []float64 { return []float64{start[0], start[1]} }

// loop is a wedge-shaped loop of about 5 km heading away from the start point, so loops with
// headings 60° apart share nothing but the start point.
func loop(heading float64) [][]float64 {
	corner := func(bearing float64) []float64 {
		r := bearing * math.Pi / 180
		return at(2000*math.Sin(r), 2000*math.Cos(r))
	}
	return [][]float64{startPoint(), corner(heading - 20), corner(heading + 20), startPoint()}
}

func ptr(v float64) *float64 { return &v }

func cand(mutate func(*candidate)) *candidate {
	c := &candidate{
		geometry: loop(0), distance: 10, elevationGain: ptr(300), unpavedShare: 0.5,
		surfaces: []contract.SurfaceStretch{{Surface: "paved", From: 0, To: 5}, {Surface: "unpaved", From: 5, To: 10}},
	}
	if mutate != nil {
		mutate(c)
	}
	return c
}

func withHeading(h float64) func(*candidate)  { return func(c *candidate) { c.geometry = loop(h) } }
func withDistance(d float64) func(*candidate) { return func(c *candidate) { c.distance = d } }
func withGain(g *float64) func(*candidate)    { return func(c *candidate) { c.elevationGain = g } }

func compose(fs ...func(*candidate)) *candidate {
	return cand(func(c *candidate) {
		for _, f := range fs {
			f(c)
		}
	})
}

func criteria(mutate func(*contract.Criteria)) contract.Criteria {
	c := contract.Criteria{
		Start: start, Target: contract.Target{Distance: 10}, ElevationGain: &contract.ElevationGain{Metres: 300},
		Surface: "any", Pace: 6,
	}
	if mutate != nil {
		mutate(&c)
	}
	return c
}

func build(c contract.Criteria, candidates ...*candidate) []contract.Route {
	km, err := c.TargetDistanceKm()
	if err != nil {
		panic(err)
	}
	return buildRouteSet(c, km, candidates, maxRoutes)
}

func kinds(routes []contract.Route) (out []string) {
	for _, r := range routes {
		out = append(out, r.Kind)
	}
	return
}

func equal[T comparable](t *testing.T, got, want []T, what string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("%s = %v, want %v", what, got, want)
		}
	}
}

func distances(routes []contract.Route) (out []float64) {
	for _, r := range routes {
		out = append(out, r.Distance)
	}
	return
}

func TestDistanceTolerances(t *testing.T) {
	c := criteria(nil)
	if r := build(c, compose(withDistance(10.9))); len(r) != 1 || r[0].Kind != "match" {
		t.Errorf("10.9 km: %+v", r)
	}
	r := build(c, compose(withDistance(7.6)))
	if len(r) != 1 || r[0].Kind != "suggestion" {
		t.Errorf("7.6 km: %+v", r)
	}
	if r := build(c, compose(withDistance(13.6))); len(r) != 0 {
		t.Errorf("13.6 km kept: %+v", r)
	}
}

func TestElevationGainTolerances(t *testing.T) {
	c := criteria(nil)
	r := build(c, compose(withGain(ptr(420))))
	if len(r) != 1 || r[0].Kind != "suggestion" {
		t.Errorf("420 m: %+v", r)
	}
	if r := build(c, compose(withGain(ptr(530)))); len(r) != 0 {
		t.Errorf("530 m kept: %+v", r)
	}
}

func TestElevationGainFloors(t *testing.T) {
	flatTarget := criteria(func(c *contract.Criteria) { c.ElevationGain = &contract.ElevationGain{Metres: 0} })
	r := build(flatTarget,
		compose(withGain(ptr(50)), withHeading(0)),
		compose(withGain(ptr(100)), withHeading(120)),
		compose(withGain(ptr(151)), withHeading(240)),
	)
	equal(t, kinds(r), []string{"match", "suggestion"}, "kinds")
	if *r[1].ElevationGain != 100 {
		t.Errorf("suggestion = %+v", r[1])
	}
}

func TestOnlyTheDistanceCountsWithoutAGainToCheck(t *testing.T) {
	noTarget := criteria(func(c *contract.Criteria) { c.ElevationGain = nil })
	if r := build(noTarget, compose(withGain(ptr(2000)))); len(r) != 1 || r[0].Kind != "match" {
		t.Errorf("no target gain: %+v", r)
	}
	hilly := criteria(func(c *contract.Criteria) { c.ElevationGain = &contract.ElevationGain{Shortcut: "hilly"} })
	if r := build(hilly, compose(withGain(nil))); len(r) != 1 || r[0].Kind != "match" {
		t.Errorf("route without gain: %+v", r)
	}
}

func TestHillyShortcut(t *testing.T) {
	hilly := criteria(func(c *contract.Criteria) { c.ElevationGain = &contract.ElevationGain{Shortcut: "hilly"} })
	if r := build(hilly, compose(withGain(ptr(900)))); len(r) != 1 || r[0].Kind != "match" {
		t.Errorf("900 m: %+v", r)
	}
	r := build(hilly, compose(withGain(ptr(60))))
	if len(r) != 1 || r[0].Kind != "suggestion" {
		t.Errorf("60 m: %+v", r)
	}
	if r := build(hilly, compose(withGain(ptr(40)))); len(r) != 0 {
		t.Errorf("40 m kept: %+v", r)
	}
	// Within the bound, routes rank on distance alone.
	r = build(hilly,
		compose(withHeading(0), withDistance(10.2), withGain(ptr(110))),
		compose(withHeading(120), withDistance(10.1), withGain(ptr(800))),
	)
	equal(t, distances(r), []float64{10.1, 10.2}, "distances")
}

func TestFlatShortcut(t *testing.T) {
	flatLevelCriteria := criteria(func(c *contract.Criteria) { c.ElevationGain = &contract.ElevationGain{Shortcut: "flat"} })
	if r := build(flatLevelCriteria, compose(withGain(ptr(100)))); len(r) != 1 || r[0].Kind != "match" {
		t.Errorf("100 m: %+v", r)
	}
	r := build(flatLevelCriteria, compose(withGain(ptr(160))))
	if len(r) != 1 || r[0].Kind != "suggestion" {
		t.Errorf("160 m: %+v", r)
	}
	if r := build(flatLevelCriteria, compose(withGain(ptr(210)))); len(r) != 0 {
		t.Errorf("210 m kept: %+v", r)
	}
}

func TestEstimatedDuration(t *testing.T) {
	// 10 km + 300 m of gain = 13 km of effort distance, at 6 min/km.
	if r := build(criteria(nil), compose()); r[0].EstimatedDuration != 78 {
		t.Errorf("duration = %v", r[0].EstimatedDuration)
	}
	if r := build(criteria(nil), compose(withGain(nil))); r[0].EstimatedDuration != 60 {
		t.Errorf("duration without gain = %v", r[0].EstimatedDuration)
	}
}

func TestTargetDuration(t *testing.T) {
	byDuration := criteria(func(c *contract.Criteria) { c.Target = contract.Target{Duration: 67} })
	if r := build(byDuration, compose(withDistance(8.5))); len(r) != 1 || r[0].Kind != "match" {
		t.Errorf("69 min: %+v", r)
	}
	r := build(byDuration, compose(withDistance(10)))
	if len(r) != 1 || r[0].Kind != "suggestion" {
		t.Errorf("78 min: %+v", r)
	}
	if r := build(byDuration, compose(withDistance(12.2))); len(r) != 0 {
		t.Errorf("91 min kept: %+v", r)
	}
}

func TestComposition(t *testing.T) {
	match := func(h float64) *candidate { return compose(withHeading(h)) }
	suggestion := func(h float64) *candidate { return compose(withHeading(h), withDistance(8)) }
	c := criteria(nil)
	cases := map[string]struct {
		candidates []*candidate
		want       []string
	}{
		"matches before suggestions": {[]*candidate{suggestion(0), match(120)}, []string{"match", "suggestion"}},
		"at most eight matches": {
			[]*candidate{match(0), match(40), match(80), match(120), match(160), match(200), match(240), match(280), match(320)},
			[]string{"match", "match", "match", "match", "match", "match", "match", "match"},
		},
		"suggestions fill up to three": {
			[]*candidate{match(0), suggestion(60), suggestion(120), suggestion(180), suggestion(240), suggestion(300)},
			[]string{"match", "suggestion", "suggestion"},
		},
		"no suggestion once there are three matches": {
			[]*candidate{match(0), match(60), match(120), match(180), suggestion(240), suggestion(300)},
			[]string{"match", "match", "match", "match"},
		},
		"three suggestions when nothing matches": {
			[]*candidate{suggestion(0), suggestion(60), suggestion(120), suggestion(180), suggestion(240)},
			[]string{"suggestion", "suggestion", "suggestion"},
		},
		"one route when one fits": {[]*candidate{match(0), compose(withDistance(20))}, []string{"match"}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) { equal(t, kinds(build(c, tc.candidates...)), tc.want, "kinds") })
	}
}

func TestRanking(t *testing.T) {
	c := criteria(nil)
	r := build(c,
		compose(withHeading(0), withDistance(10.6)),
		compose(withHeading(120), withDistance(9.8), withGain(ptr(305))),
		compose(withHeading(240), withDistance(10.2)),
	)
	equal(t, distances(r), []float64{10.2, 9.8, 10.6}, "distances")

	r = build(c, compose(withHeading(0), withDistance(7.6)), compose(withHeading(120), withDistance(11.2)))
	equal(t, distances(r), []float64{11.2, 7.6}, "suggestion distances")
}

func TestSurfacePreferenceRanksWithoutDropping(t *testing.T) {
	share := func(v float64) func(*candidate) { return func(c *candidate) { c.unpavedShare = v } }
	for surface, want := range map[string][]float64{"unpaved": {0.9, 0.2}, "paved": {0.2, 0.9}} {
		c := criteria(func(c *contract.Criteria) { c.Surface = surface })
		r := build(c, compose(withHeading(0), share(0.2)), compose(withHeading(120), share(0.9)))
		var got []float64
		for _, route := range r {
			got = append(got, route.UnpavedShare)
		}
		equal(t, got, want, surface+" unpaved shares")
	}
}

func TestOutAndBackRanksAfterLoops(t *testing.T) {
	outAndBack := [][]float64{startPoint(), at(0, -2500), startPoint()}
	r := build(criteria(nil),
		compose(func(c *candidate) { c.geometry = outAndBack }),
		compose(withHeading(0)),
	)
	if len(r) != 2 || len(r[0].Geometry) != 4 || len(r[1].Geometry) != 3 {
		t.Errorf("loop must come first: %d then %d points", len(r[0].Geometry), len(r[1].Geometry))
	}
}

func TestWeavingAlongACellEdgeIsNotWalkingTwice(t *testing.T) {
	zigzag := [][]float64{startPoint()}
	for i := 0; i < 100; i++ {
		x := -3.0
		if i%2 == 1 {
			x = 3
		}
		zigzag = append(zigzag, at(x, float64(20*(i+1))))
	}
	zigzag = append(zigzag, at(700, 1900), startPoint())
	r := build(criteria(nil), compose(func(c *candidate) { c.geometry = zigzag }), compose(withHeading(120)))
	if len(r) != 2 || len(r[0].Geometry) != len(zigzag) {
		t.Errorf("zigzag must keep its rank: %d routes, first has %d points", len(r), len(r[0].Geometry))
	}
}

func TestDiversity(t *testing.T) {
	t.Run("a route sharing most of a better one is left out", func(t *testing.T) {
		r := build(criteria(nil),
			compose(withHeading(0), withDistance(10.1)),
			compose(withHeading(120), withDistance(10.2)),
			compose(withHeading(0), withDistance(10)),
		)
		equal(t, distances(r), []float64{10, 10.2}, "distances")
	})
	t.Run("the shorter route sets the share", func(t *testing.T) {
		l := loop(0)
		spur := [][]float64{startPoint(), l[1], startPoint()}
		r := build(criteria(nil), compose(withHeading(0)), compose(func(c *candidate) { c.geometry = spur }))
		if len(r) != 1 {
			t.Errorf("%d routes, want the loop alone", len(r))
		}
	})
	t.Run("the stretch around the start point is ignored", func(t *testing.T) {
		west := [][]float64{startPoint(), at(0, 490), at(-150, 650), at(-150, 490), at(0, 490), startPoint()}
		east := [][]float64{startPoint(), at(0, 490), at(150, 650), at(150, 490), at(0, 490), startPoint()}
		r := build(criteria(nil), compose(func(c *candidate) { c.geometry = west }), compose(func(c *candidate) { c.geometry = east }))
		if len(r) != 2 {
			t.Errorf("%d routes, want 2", len(r))
		}
	})
	t.Run("the stretch shrinks for short routes", func(t *testing.T) {
		small := [][]float64{startPoint(), at(-150, 400), at(150, 400), startPoint()}
		short := criteria(func(c *contract.Criteria) { c.Target = contract.Target{Distance: 2} })
		same := func(c *candidate) { c.geometry, c.distance = small, 2 }
		if r := build(short, compose(same), compose(same)); len(r) != 1 {
			t.Errorf("%d routes, want 1", len(r))
		}
	})
}

func TestWideSuggestionsFillASetShortOfThreeRoutes(t *testing.T) {
	wide := func(h float64) *candidate { return compose(withHeading(h), withDistance(13)) }
	suggestion := func(h float64) *candidate { return compose(withHeading(h), withDistance(8)) }
	match := func(h float64) *candidate { return compose(withHeading(h)) }
	c := criteria(nil)
	cases := map[string]struct {
		candidates []*candidate
		want       []string
	}{
		"fills when nothing else fits": {
			[]*candidate{wide(0), wide(60), wide(120), wide(180)},
			[]string{"suggestion", "suggestion", "suggestion"},
		},
		"completes the suggestions up to three": {
			[]*candidate{match(0), wide(60), wide(120), wide(180)},
			[]string{"match", "suggestion", "suggestion"},
		},
		"unused once three routes fit": {
			[]*candidate{match(0), suggestion(60), suggestion(120), wide(180)},
			[]string{"match", "suggestion", "suggestion"},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) { equal(t, kinds(build(c, tc.candidates...)), tc.want, "kinds") })
	}
}

func TestWideSuggestionComesAfterANormalOne(t *testing.T) {
	c := criteria(nil)

	r := build(c,
		compose(withHeading(0), withDistance(13)), // a better score than the suggestion, but wide
		compose(withHeading(120), withDistance(12.4), withGain(ptr(450))),
	)

	equal(t, distances(r), []float64{12.4, 13}, "distances")
}

func TestWideSuggestionOffOnTwoCriteriaIsKept(t *testing.T) {
	c := criteria(nil)

	r := build(c, compose(withDistance(13), withGain(ptr(500))))

	if len(r) != 1 || r[0].Kind != "suggestion" {
		t.Errorf("routes = %+v", r)
	}
}

func TestBeyondTheWideTolerancesARouteIsDropped(t *testing.T) {
	c := criteria(nil)
	for name, cand := range map[string]*candidate{
		"distance":       compose(withDistance(13.6)),
		"elevationGain":  compose(withGain(ptr(530))),
		"elevationBelow": compose(withGain(ptr(30))),
	} {
		t.Run(name, func(t *testing.T) {
			if r := build(c, cand); len(r) != 0 {
				t.Errorf("routes = %+v", r)
			}
		})
	}
}

func TestWideElevationGainFloor(t *testing.T) {
	c := criteria(func(c *contract.Criteria) { c.ElevationGain = &contract.ElevationGain{Metres: 100} })

	inside := build(c, compose(withGain(ptr(245))))
	outside := build(c, compose(withGain(ptr(255))))

	if len(inside) != 1 || len(outside) != 0 {
		t.Errorf("inside = %+v, outside = %+v", inside, outside)
	}
}

func TestWideDurationTarget(t *testing.T) {
	c := criteria(func(c *contract.Criteria) { c.Target = contract.Target{Duration: 74} })

	r := build(c, compose(withDistance(13)))

	if len(r) != 1 || r[0].Kind != "suggestion" {
		t.Errorf("routes = %+v", r)
	}
}
