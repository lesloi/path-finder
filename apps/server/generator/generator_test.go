package generator

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/lesloi/path-finder/apps/server/contract"
	"github.com/lesloi/path-finder/apps/server/engine"
)

type fakeLooper struct {
	loops []*engine.Route
	err   error
	got   engine.LoopRequest
	// direct is the loop through the waypoints, and directErr why there is none.
	direct      *engine.Route
	directErr   error
	directCalls int
	loopCalls   int
	// enoughAt is the number of loops after which Enough said to stop, when the loops are given to it one by one; 0 if never.
	enoughAt  int
	askEnough bool
}

func (f *fakeLooper) DirectLoop(_ context.Context, _ engine.DirectLoopRequest) (*engine.Route, error) {
	f.directCalls++
	return f.direct, f.directErr
}

func (f *fakeLooper) Loops(_ context.Context, req engine.LoopRequest) ([]*engine.Route, error) {
	f.got = req
	f.loopCalls++
	if f.askEnough {
		for i := range f.loops {
			if req.Enough(f.loops[:i+1]) {
				f.enoughAt = i + 1
				return f.loops[:i+1], f.err
			}
		}
	}
	return f.loops, f.err
}

// engineLoop is a loop as the engine returns it: positions around the start point.
func engineLoop(heading float64) *engine.Route {
	points := make([]engine.Position, 0, 4)
	for _, p := range loop(heading) {
		points = append(points, engine.Position{Point: engine.Point{Lat: p[1], Lon: p[0]}, Elevation: 450.123})
	}
	return &engine.Route{
		Points: points, Distance: 10_000.4, Ascent: 300.04, Descent: 299.96,
		Stretches: []engine.Stretch{{Unpaved: false, Meters: 7500}, {Unpaved: true, Meters: 2500}},
	}
}

const body = `{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":300,"surface":"any","pace":6}`

func generate(t *testing.T, looper *fakeLooper, ctx context.Context, request string) ([]contract.Route, error) {
	t.Helper()
	g := &Generator{Engines: map[string]Looper{"any": looper}, Seed: func() uint64 { return 42 }}
	out, err := g.Generate(ctx, json.RawMessage(request))
	if err != nil {
		return nil, err
	}
	return out.([]contract.Route), nil
}

func TestGenerateAsksTheEngineForLoopsFromTheCriteria(t *testing.T) {
	looper := &fakeLooper{loops: []*engine.Route{engineLoop(0)}}
	if _, err := generate(t, looper, context.Background(), body); err != nil {
		t.Fatal(err)
	}
	want := engine.LoopRequest{Start: engine.Point{Lat: 45.8992, Lon: 6.1294}, Distance: 10_000, Ascent: 300, AscentBand: engine.AscentBand{Share: 0.2, FloorM: 50}, Candidates: 100, Seed: 42}
	got := looper.got
	if got.Enough == nil {
		t.Error("the engine is not told when to stop")
	}
	got.Enough = nil
	if !reflect.DeepEqual(got, want) {
		t.Errorf("request = %+v, want %+v", got, want)
	}
}

func TestGenerateSpellsOutTheContract(t *testing.T) {
	looper := &fakeLooper{loops: []*engine.Route{engineLoop(0)}}
	routes, err := generate(t, looper, context.Background(), body)
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) != 1 {
		t.Fatalf("%d routes", len(routes))
	}
	r := routes[0]
	if r.Distance != 10 || *r.ElevationGain != 300 || *r.ElevationLoss != 300 || r.UnpavedShare != 0.25 || r.Kind != "match" || r.Technical {
		t.Errorf("route = %+v", r)
	}
	if got := r.Geometry[0]; len(got) != 3 || got[0] != 6.1294 || got[1] != 45.8992 || got[2] != 450.1 {
		t.Errorf("first point = %v, want longitude, latitude and a height to the decimetre", got)
	}
	if len(r.Surfaces) != 2 || r.Surfaces[0] != (contract.SurfaceStretch{Surface: "paved", From: 0, To: 7.5}) {
		t.Errorf("surfaces = %+v", r.Surfaces)
	}
	if _, err := json.Marshal(map[string]any{"routes": routes}); err != nil {
		t.Errorf("not JSON: %v", err)
	}
}

func TestGenerateGivesTheEngineTheEffortOfADurationTarget(t *testing.T) {
	cases := []struct {
		name, body string
		ascent     float64
	}{
		{"without a gain", `{"start":[6.1294,45.8992],"target":{"duration":90},"surface":"any","pace":6}`, 0},
		{"with a gain", `{"start":[6.1294,45.8992],"target":{"duration":90},"elevationGain":300,"surface":"any","pace":6}`, 300},
		{"with a shortcut", `{"start":[6.1294,45.8992],"target":{"duration":90},"elevationGain":"hilly","surface":"any","pace":6}`, 0},
		{"with waypoints", `{"start":[6.1294,45.8992],"target":{"duration":90},"surface":"any","pace":6,"waypoints":` + twoWaypoints + `}`, 0},
	}
	s := contract.SlopeEffortOf()
	wantSlope := engine.SlopeEffort{Decay: s.Decay, EasiestGrade: s.EasiestGrade, MaxGrade: s.MaxGrade, StretchMetres: s.StretchMetres}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			looper := &fakeLooper{direct: engineLoop(0), loops: []*engine.Route{engineLoop(0)}}
			if _, err := generate(t, looper, context.Background(), tc.body); err != nil {
				t.Fatal(err)
			}

			if looper.got.Effort == nil || looper.got.Effort.Metres != 15_000 {
				t.Fatalf("effort = %+v, want 15000 m", looper.got.Effort)
			}
			if looper.got.Effort.Slope != wantSlope {
				t.Errorf("slope = %+v, want %+v", looper.got.Effort.Slope, wantSlope)
			}
			if looper.got.Ascent != tc.ascent {
				t.Errorf("ascent = %v, want %v", looper.got.Ascent, tc.ascent)
			}
			if tc.name == "with waypoints" && looper.got.Direct == nil {
				t.Error("the direct loop was not handed to the engine")
			}
		})
	}
}

func TestGenerateSetsNoAscentForAShortcut(t *testing.T) {
	looper := &fakeLooper{}
	hilly := `{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":"hilly","surface":"any","pace":6}`
	if _, err := generate(t, looper, context.Background(), hilly); err != nil {
		t.Fatal(err)
	}
	if looper.got.Ascent != 0 {
		t.Errorf("ascent = %v", looper.got.Ascent)
	}
}

func TestGenerateReportsInvalidCriteria(t *testing.T) {
	_, err := generate(t, &fakeLooper{}, context.Background(), `{"start":[6,45]}`)
	var ce *contract.CriteriaError
	if !errors.As(err, &ce) || ce.Field != "target" {
		t.Errorf("err = %v", err)
	}
}

func TestGenerateAnswersEmptyWhenThereIsNothingToOffer(t *testing.T) {
	for _, err := range []error{engine.ErrOffGraph, engine.ErrNoLoop} {
		routes, got := generate(t, &fakeLooper{err: err}, context.Background(), body)
		if got != nil || routes == nil || len(routes) != 0 {
			t.Errorf("%v: routes = %v (nil %v), err = %v", err, routes, routes == nil, got)
		}
	}
}

func TestGenerateFailsOnAnUnexpectedEngineError(t *testing.T) {
	if _, err := generate(t, &fakeLooper{err: errors.New("graph corrupt")}, context.Background(), body); err == nil {
		t.Error("err = nil")
	}
}

func TestGenerateKeepsWhatIsFoundWhenTheDeadlineComes(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	loops := []*engine.Route{engineLoop(0), engineLoop(120), engineLoop(240)}

	routes, err := generate(t, &fakeLooper{loops: loops, err: context.Canceled}, ctx, body)
	if err != nil || len(routes) != 3 {
		t.Errorf("3 loops found before the deadline: %d routes, err = %v", len(routes), err)
	}

	_, err = generate(t, &fakeLooper{err: context.Canceled}, ctx, body)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("nothing found before the deadline: err = %v, want the context's", err)
	}
}

func TestGenerateSkipsALoopWithNoLength(t *testing.T) {
	empty := &engine.Route{Points: engineLoop(0).Points}
	routes, err := generate(t, &fakeLooper{loops: []*engine.Route{empty, engineLoop(0)}}, context.Background(), body)
	if err != nil || len(routes) != 1 {
		t.Errorf("%d routes, err = %v", len(routes), err)
	}
}

func TestGenerateUsesTheEngineOfTheSurfacePreference(t *testing.T) {
	anyLooper, paved, unpaved := &fakeLooper{}, &fakeLooper{}, &fakeLooper{}
	g := &Generator{Engines: map[string]Looper{"any": anyLooper, "paved": paved, "unpaved": unpaved}}
	if _, err := g.Generate(context.Background(), json.RawMessage(`{"start":[6.1294,45.8992],"target":{"distance":5},"surface":"unpaved","pace":5}`)); err != nil {
		t.Fatal(err)
	}
	if unpaved.got.Candidates == 0 || anyLooper.got.Candidates != 0 || paved.got.Candidates != 0 {
		t.Errorf("unpaved asked %+v, any asked %+v, paved asked %+v", unpaved.got, anyLooper.got, paved.got)
	}
	if _, err := (&Generator{}).Generate(context.Background(), json.RawMessage(body)); err == nil {
		t.Error("a surface preference without an engine: err = nil")
	}
}

func TestGenerateStopsTheSearchOnceTheSetIsFull(t *testing.T) {
	looper := &fakeLooper{}
	if _, err := generate(t, looper, context.Background(), body); err != nil {
		t.Fatal(err)
	}
	enough := looper.got.Enough

	// Loops that do not overlap, each a match, as the engine would deliver them one by one.
	var found []*engine.Route
	for i, heading := range []float64{0, 40, 80, 120, 160, 200, 240, 280} {
		found = append(found, engineLoop(heading))
		if got, want := enough(found), i == 7; got != want {
			t.Errorf("after %d matches: enough = %v, want %v", i+1, got, want)
		}
	}
}

func TestGenerateKeepsSearchingWhileTheSetIsNotFull(t *testing.T) {
	looper := &fakeLooper{}
	if _, err := generate(t, looper, context.Background(), body); err != nil {
		t.Fatal(err)
	}
	// Six loops, but all the same: one route, and suggestions or duplicates do not fill the set.
	var found []*engine.Route
	for range 6 {
		found = append(found, engineLoop(0))
	}
	if looper.got.Enough(found) {
		t.Error("enough on six copies of one loop")
	}
}

func TestCmpOrFallsBackOnlyForANonPositiveValue(t *testing.T) {
	for _, tc := range []struct{ v, fallback, want int }{{0, 40, 40}, {-3, 40, 40}, {7, 40, 7}} {
		if got := cmpOr(tc.v, tc.fallback); got != tc.want {
			t.Errorf("cmpOr(%d, %d) = %d, want %d", tc.v, tc.fallback, got, tc.want)
		}
	}
}

func TestGenerateTellsWhichRoutesHoldATechnicalStretch(t *testing.T) {
	technical, plain := engineLoop(0), engineLoop(1.5)
	technical.Stretches = []engine.Stretch{{Meters: 5000}, {Meters: 5000, Technical: true}}
	looper := &fakeLooper{loops: []*engine.Route{technical, plain}}
	routes, err := generate(t, looper, context.Background(), body)
	if err != nil {
		t.Fatal(err)
	}
	var flagged, unflagged int
	for _, r := range routes {
		if r.Technical {
			flagged++
		} else {
			unflagged++
		}
	}
	if flagged != 1 || unflagged != 1 {
		t.Errorf("%d technical routes and %d plain ones out of %d, want one each", flagged, unflagged, len(routes))
	}
}

func TestStretchesFollowEachOtherAndCoverTheRoute(t *testing.T) {
	r := engineLoop(0)
	r.Distance = 9_999.7
	r.Stretches = []engine.Stretch{{Meters: 3333}, {Unpaved: true, Meters: 3333}, {Meters: 3333.7}}
	got := toCandidate(r).surfaces
	if len(got) != 3 {
		t.Fatalf("surfaces = %+v", got)
	}
	var end float64
	for _, s := range got {
		if s.From != end || s.To < s.From {
			t.Errorf("stretch %+v does not follow the previous one, which ends at %v", s, end)
		}
		end = s.To
	}
	if end != 10 {
		t.Errorf("stretches end at %v km, want the route's 10", end)
	}
}

func TestStretchesDropTheOnesWithoutLengthAndMergeTheirNeighbours(t *testing.T) {
	r := engineLoop(0)
	r.Distance = 10_000
	r.Stretches = []engine.Stretch{{Meters: 3000}, {Unpaved: true, Meters: 0.2}, {Meters: 7000}}
	want := []contract.SurfaceStretch{{Surface: "paved", From: 0, To: 10}}
	if got := toCandidate(r).surfaces; !reflect.DeepEqual(got, want) {
		t.Errorf("surfaces = %+v, want %+v", got, want)
	}
}

func TestTechnicalStretchesAreLocatedAlongTheRoute(t *testing.T) {
	// Arrange: plain 3 km, technical 2 km, plain 5 km.
	r := engineLoop(0)
	r.Distance = 10_000
	r.Technical = true
	r.Stretches = []engine.Stretch{{Meters: 3000}, {Meters: 2000, Technical: true}, {Meters: 5000}}
	want := []contract.TechnicalStretch{{From: 3, To: 5}}

	// Act
	got := toCandidate(r).technicalStretches

	// Assert
	if !reflect.DeepEqual(got, want) {
		t.Errorf("technical stretches = %+v, want %+v", got, want)
	}
}

func TestTechnicalStretchesOnDifferentSurfacesMakeOne(t *testing.T) {
	r := engineLoop(0)
	r.Distance = 10_000
	r.Technical = true
	r.Stretches = []engine.Stretch{
		{Meters: 4000}, {Meters: 1000, Technical: true}, {Unpaved: true, Meters: 1000, Technical: true}, {Unpaved: true, Meters: 4000},
	}
	want := []contract.TechnicalStretch{{From: 4, To: 6}}

	c := toCandidate(r)

	if !reflect.DeepEqual(c.technicalStretches, want) {
		t.Errorf("technical stretches = %+v, want %+v", c.technicalStretches, want)
	}
	if len(c.surfaces) != 2 {
		t.Errorf("surfaces = %+v, want the technical split to leave two", c.surfaces)
	}
}

func TestATechnicalStretchTooShortToBeLocatedDoesNotMakeTheRouteTechnical(t *testing.T) {
	r := engineLoop(0)
	r.Distance = 10_000
	r.Technical = true
	r.Stretches = []engine.Stretch{{Meters: 9999.9998}, {Meters: 0.0002, Technical: true}}

	c := toCandidate(r)

	if c.technical || len(c.technicalStretches) != 0 {
		t.Errorf("technical %v, stretches %+v, want none", c.technical, c.technicalStretches)
	}
}

func TestARouteWithoutTechnicalStretchSendsNoneButAnEmptyList(t *testing.T) {
	r := engineLoop(0)

	got := toCandidate(r).technicalStretches

	if got == nil || len(got) != 0 {
		t.Errorf("technical stretches = %#v, want an empty non-nil list", got)
	}
}

// withWaypoints is body with waypoints: two near the start point, 1 km and 2 km to the north-east.
func withWaypoints(waypoints string) string {
	return `{"start":[6.1294,45.8992],"target":{"distance":10},"surface":"any","pace":6,"waypoints":` + waypoints + `}`
}

const twoWaypoints = `[[6.14,45.906],[6.15,45.91]]`

func TestGeneratePassesTheWaypointsToTheEngineInOrder(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0), loops: []*engine.Route{engineLoop(120)}}

	if _, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints)); err != nil {
		t.Fatal(err)
	}

	want := []engine.Point{{Lat: 45.906, Lon: 6.14}, {Lat: 45.91, Lon: 6.15}}
	if !reflect.DeepEqual(looper.got.Waypoints, want) {
		t.Errorf("waypoints = %v, want %v", looper.got.Waypoints, want)
	}
}

func TestGenerateOffersTheDirectLoopAsACandidate(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0), loops: nil, err: engine.ErrNoLoop}

	routes, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints))

	if err != nil || len(routes) != 1 || routes[0].Kind != "match" {
		t.Errorf("routes = %+v, err = %v, want the direct loop alone", routes, err)
	}
}

func TestGenerateHandsTheDirectLoopToTheEngine(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0), loops: []*engine.Route{engineLoop(120)}}

	if _, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints)); err != nil {
		t.Fatal(err)
	}

	if looper.got.Direct != looper.direct {
		t.Errorf("the engine got %p as the direct loop, want %p", looper.got.Direct, looper.direct)
	}
}

func TestGenerateKeepsTheDirectLoopWhenTheLoopSearchFindsNoRoute(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0), err: engine.ErrNoRoute}

	routes, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints))

	if err != nil || len(routes) != 1 || routes[0].Kind != "match" {
		t.Errorf("routes = %+v, err = %v, want the direct loop alone", routes, err)
	}
}

func TestGenerateAsksNothingOfTheEngineWithoutWaypoints(t *testing.T) {
	looper := &fakeLooper{loops: []*engine.Route{engineLoop(0)}}

	if _, err := generate(t, looper, context.Background(), body); err != nil {
		t.Fatal(err)
	}

	if looper.directCalls != 0 || looper.got.Waypoints != nil {
		t.Errorf("direct loops asked %d times, waypoints = %v", looper.directCalls, looper.got.Waypoints)
	}
}

func TestGenerateRefusesWaypointsBeyondTheLongestRouteBeforeSearching(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0)}
	// 120 km away and back, for a target of 10 km.
	far := `[[7.7,46.9]]`

	_, err := generate(t, looper, context.Background(), withWaypoints(far))

	var ce *contract.CriteriaError
	if !errors.As(err, &ce) || ce.Field != "waypoints" || ce.Waypoint != 0 {
		t.Fatalf("err = %v, want a CriteriaError on waypoints, with no index", err)
	}
	if looper.directCalls+looper.loopCalls != 0 {
		t.Errorf("the engine was asked %d times", looper.directCalls+looper.loopCalls)
	}
}

func TestGenerateRefusesADirectLoopBeyondTheLongestRoute(t *testing.T) {
	long := engineLoop(0)
	long.Distance = contract.MaxDistanceKm()*1000 + 1
	looper := &fakeLooper{direct: long}

	_, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints))

	var ce *contract.CriteriaError
	if !errors.As(err, &ce) || ce.Field != "waypoints" || ce.Waypoint != 0 {
		t.Fatalf("err = %v, want a CriteriaError on waypoints, with no index", err)
	}
}

func TestGenerateServesTheDirectLoopAloneWhenWaypointsAreBeyondTheTarget(t *testing.T) {
	long := engineLoop(0)
	long.Distance = 30_000 // out and back to a summit 15 km away, for a target of 10 km
	looper := &fakeLooper{direct: long, loops: []*engine.Route{engineLoop(120)}}
	// 15 km north and back.
	far := `[[6.1294,46.0342]]`

	routes, err := generate(t, looper, context.Background(), withWaypoints(far))

	if err != nil || len(routes) != 1 || routes[0].Kind != "suggestion" || routes[0].Distance != 30 {
		t.Errorf("routes = %+v, err = %v, want the direct loop as the only suggestion", routes, err)
	}
	if looper.loopCalls != 0 {
		t.Error("loops were searched for waypoints that no loop can meet the target through")
	}
}

func TestGenerateKeepsAWaypointLoopThatOnlyAWideSuggestionAllows(t *testing.T) {
	long := engineLoop(0)
	long.Distance = 12_800 // 28 % over a target of 10 km: refused by suggestions, kept by wide ones
	looper := &fakeLooper{direct: long, err: engine.ErrNoLoop}
	// 6.4 km east and back: the straight lines alone are 28 % over the target.
	east := `[[6.2120,45.8992]]`

	routes, err := generate(t, looper, context.Background(), withWaypoints(east))

	if err != nil || len(routes) != 1 || routes[0].Kind != "suggestion" {
		t.Errorf("routes = %+v, err = %v, want the direct loop as a suggestion", routes, err)
	}
}

func TestGenerateKeepsWaypointsWhoseDirectLoopIsMuchShorterThanTheTarget(t *testing.T) {
	short := engineLoop(0)
	short.Distance = 3_000 // the engine adds detours to reach the 10 km
	looper := &fakeLooper{direct: short, loops: []*engine.Route{engineLoop(120)}}

	routes, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints))

	if err != nil || len(routes) == 0 || looper.loopCalls != 1 {
		t.Errorf("%d routes, err = %v, %d searches", len(routes), err, looper.loopCalls)
	}
}

func TestGenerateKeepsWaypointsThatClimbMakesLongerThanTheDistanceLeft(t *testing.T) {
	// 60 min at 6 min/km with 500 m to climb leaves 5 km of distance, but a flat loop of 7 km is only 42 min.
	climbing := `{"start":[6.1294,45.8992],"target":{"duration":60},"elevationGain":500,"surface":"any","pace":6,"waypoints":[[6.1800,45.8992]]}`
	direct := engineLoop(0)
	direct.Distance, direct.Ascent = 7_000, 100
	looper := &fakeLooper{direct: direct, err: engine.ErrNoLoop}

	_, err := generate(t, looper, context.Background(), climbing)

	if err != nil {
		t.Errorf("err = %v", err)
	}
}

func TestGenerateJudgesTheDirectLoopOnTheDurationForADurationTarget(t *testing.T) {
	duration := `{"start":[6.1294,45.8992],"target":{"duration":60},"surface":"any","pace":6,"waypoints":` + twoWaypoints + `}`
	long := engineLoop(0)
	long.Distance, long.Ascent = 14_000, 0 // 84 min at 6 min/km, over 60 min plus a quarter
	over := &fakeLooper{direct: long}
	fine := engineLoop(0)
	fine.Distance, fine.Ascent = 9_000, 0
	under := &fakeLooper{direct: fine, err: engine.ErrNoLoop}

	overRoutes, overErr := generate(t, over, context.Background(), duration)
	_, underErr := generate(t, under, context.Background(), duration)

	if overErr != nil || len(overRoutes) != 1 || over.loopCalls != 0 {
		t.Errorf("84 min for 60: %d routes, err = %v, %d searches, want the direct loop alone", len(overRoutes), overErr, over.loopCalls)
	}
	if underErr != nil || under.loopCalls != 1 {
		t.Errorf("54 min for 60: err = %v, %d searches, want loops searched", underErr, under.loopCalls)
	}
}

func TestGenerateTellsWhichWaypointOrTheStartPointIsOffTheWays(t *testing.T) {
	cases := []struct {
		name  string
		err   error
		field string
		index int
	}{
		{"waypoint 2", &engine.WaypointError{Index: 2}, "waypoints", 2},
		{"start point", engine.ErrOffGraph, "start", 0},
		{"unreachable", engine.ErrNoRoute, "waypoints", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := generate(t, &fakeLooper{directErr: tc.err}, context.Background(), withWaypoints(twoWaypoints))

			var ce *contract.CriteriaError
			if !errors.As(err, &ce) || ce.Field != tc.field || ce.Waypoint != tc.index {
				t.Errorf("err = %v, want a CriteriaError on %s, index %d", err, tc.field, tc.index)
			}
			if err != nil && (strings.Contains(err.Error(), "6.1") || strings.Contains(err.Error(), "45.9")) {
				t.Errorf("message %q holds a position", err)
			}
		})
	}
}

func TestGenerateKeepsAnEmptyAnswerForAStartPointOffTheWaysWithoutWaypoints(t *testing.T) {
	routes, err := generate(t, &fakeLooper{err: engine.ErrOffGraph}, context.Background(), body)

	if err != nil || routes == nil || len(routes) != 0 {
		t.Errorf("routes = %v, err = %v", routes, err)
	}
}

func TestGenerateKeepsAtMostTheMaxRoutesItIsGiven(t *testing.T) {
	// Arrange: three loops that do not overlap, all matches, and a cap of two
	looper := &fakeLooper{loops: []*engine.Route{engineLoop(0), engineLoop(120), engineLoop(240)}}
	g := &Generator{Engines: map[string]Looper{"any": looper}, MaxRoutes: 2, Seed: func() uint64 { return 42 }}
	// Act
	out, err := g.Generate(context.Background(), json.RawMessage(body))
	if err != nil {
		t.Fatal(err)
	}
	// Assert
	if routes := out.([]contract.Route); len(routes) != 2 {
		t.Errorf("%d routes, want the cap of 2", len(routes))
	}
}

func TestGenerateStopsAtTheMaxRoutesItIsGiven(t *testing.T) {
	// Arrange
	next := enoughFor(t, &Generator{MaxRoutes: 2})
	// Act and assert: loop after loop, all matches that do not overlap
	if next(0) || !next(120) {
		t.Error("the search should stop at two matches, not before")
	}
}

// enoughFor runs Generate with g and returns a function that hands the engine's callback one more loop at a
// time, as the engine does, and tells whether the search would stop there.
func enoughFor(t *testing.T, g *Generator) func(heading float64) bool {
	t.Helper()
	looper := &fakeLooper{}
	g.Engines, g.Seed = map[string]Looper{"any": looper}, func() uint64 { return 42 }
	if _, err := g.Generate(context.Background(), json.RawMessage(body)); err != nil {
		t.Fatal(err)
	}
	var found []*engine.Route
	return func(heading float64) bool {
		found = append(found, engineLoop(heading))
		return looper.got.Enough(found)
	}
}

func TestGenerateStopsWhenLoopsStopAddingMatches(t *testing.T) {
	same := func(n int) []float64 { return make([]float64, n) } // the same loop again and again: a match, then nothing new
	cases := []struct {
		name      string
		stopAfter int
		headings  []float64
		stopsAt   int // the loop after which the search stops, counted from 1, or 0 for never
	}{
		{"after loops that add nothing", 3, same(10), 4},
		{"a new match starts the count again", 3, []float64{0, 0, 0, 120, 0, 0, 0}, 7},
		{"after defaultStopAfter loops by default", 0, same(2 * defaultStopAfter), 1 + defaultStopAfter},
		{"never when the limit is out of reach", math.MaxInt, same(200), 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Arrange
			next := enoughFor(t, &Generator{StopAfter: tc.stopAfter})
			// Act
			stoppedAt := 0
			for i, heading := range tc.headings {
				if next(heading) {
					stoppedAt = i + 1
					break
				}
			}
			// Assert
			if stoppedAt != tc.stopsAt {
				t.Errorf("stopped after loop %d, want %d", stoppedAt, tc.stopsAt)
			}
		})
	}
}

func TestGenerateKeepsTheDirectLoopAloneWhenTheWaypointsOvershootTheTarget(t *testing.T) {
	direct := engineLoop(0)
	direct.Distance, direct.Shortest = 12_000, 12_000 // 20 % over the 10 km target: a suggestion, even at its shortest
	looper := &fakeLooper{direct: direct}

	routes, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints))

	if err != nil || len(routes) != 1 || routes[0].Kind != "suggestion" {
		t.Fatalf("routes = %+v, err = %v, want the direct loop alone", routes, err)
	}
	if looper.loopCalls != 0 {
		t.Error("loops were searched although every one is at least as long as the direct loop")
	}
}

func TestGenerateStopsOnlyWhenTheShortestLoopIsOverTheMatchBound(t *testing.T) {
	cases := []struct {
		name     string
		shortest float64
		searched bool
	}{
		{"within the match bound", 10_900, true},
		{"beyond the match bound", 11_100, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			direct := engineLoop(0)
			direct.Distance, direct.Shortest = 12_000, tc.shortest
			looper := &fakeLooper{direct: direct, loops: []*engine.Route{engineLoop(120)}}

			if _, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints)); err != nil {
				t.Fatal(err)
			}
			if searched := looper.loopCalls > 0; searched != tc.searched {
				t.Errorf("loops searched = %v, want %v", searched, tc.searched)
			}
		})
	}
}

func TestGenerateStillSearchesWithAShortcutPastTheMatchBound(t *testing.T) {
	direct := engineLoop(0)
	direct.Distance, direct.Shortest = 12_000, 12_000
	looper := &fakeLooper{direct: direct, loops: []*engine.Route{engineLoop(120)}}
	hilly := `{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":"hilly","surface":"any","pace":6,"waypoints":` + twoWaypoints + `}`

	if _, err := generate(t, looper, context.Background(), hilly); err != nil {
		t.Fatal(err)
	}
	if looper.loopCalls == 0 {
		t.Error("a shortcut can improve with a longer loop: the search must run")
	}
}

func TestGeneratePassesTheAvoidedAreasToTheEngine(t *testing.T) {
	// Arrange
	looper := &fakeLooper{loops: []*engine.Route{engineLoop(0)}}
	request := `{"start":[6.1294,45.8992],"target":{"distance":10},"surface":"any","pace":6,"avoidedAreas":[{"center":[6.15,45.9],"radius":400}]}`
	want := []engine.Circle{{Center: engine.Point{Lat: 45.9, Lon: 6.15}, RadiusM: 400}}
	// Act
	_, err := generate(t, looper, context.Background(), request)
	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(looper.got.Avoided, want) {
		t.Errorf("avoided = %+v, want %+v", looper.got.Avoided, want)
	}
}

func TestGenerateStopsSearchingOnceTheSetIsFullWithTheDirectLoopAsASuggestion(t *testing.T) {
	long := engineLoop(0)
	long.Distance, long.Ascent = 10_000, 150 // the distance matches, half the 300 m target: a suggestion
	// Out to the waypoint and back by the same way, so that no loop of the set duplicates it.
	long.Points = nil
	for _, p := range [][]float64{startPoint(), at(6400, 0), startPoint()} {
		long.Points = append(long.Points, engine.Position{Point: engine.Point{Lat: p[1], Lon: p[0]}, Elevation: 450})
	}
	var loops []*engine.Route
	for h := 0.0; h < 360; h += 45 {
		loops = append(loops, engineLoop(h))
	}
	looper := &fakeLooper{direct: long, loops: loops, askEnough: true}
	east := `[[6.2120,45.8992]]`
	withGain := `{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":300,"surface":"any","pace":6,"waypoints":` + east + `}`

	if _, err := generate(t, looper, context.Background(), withGain); err != nil {
		t.Fatal(err)
	}

	if looper.enoughAt == 0 || looper.enoughAt > maxRoutes {
		t.Errorf("Enough said to stop after %d loops, want at most %d", looper.enoughAt, maxRoutes)
	}
}

func TestGenerateServesTheDirectLoopBeyondTheTargetWhateverItsGain(t *testing.T) {
	long := engineLoop(0)
	long.Distance, long.Ascent = 30_000, 20 // 3 times the target, flat for a gain target of 300 m
	looper := &fakeLooper{direct: long, loops: []*engine.Route{engineLoop(120)}}
	withGain := `{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":300,"surface":"any","pace":6,"waypoints":[[6.1294,46.0342]]}`

	routes, err := generate(t, looper, context.Background(), withGain)

	if err != nil || len(routes) != 1 || looper.loopCalls != 0 {
		t.Errorf("%d routes, err = %v, %d searches, want the direct loop alone", len(routes), err, looper.loopCalls)
	}
}

func TestGenerateKeepsEightMatchesWhenTheDirectLoopIsLeftOut(t *testing.T) {
	short := engineLoop(0)
	short.Distance = 3_000 // much shorter than the target: left out of the set
	var loops []*engine.Route
	for h := 0.0; h < 360; h += 40 {
		loops = append(loops, engineLoop(h))
	}
	looper := &fakeLooper{direct: short, loops: loops, askEnough: true}

	routes, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints))

	if err != nil || looper.enoughAt != maxRoutes || len(routes) != maxRoutes {
		t.Errorf("Enough at %d loops, %d routes, err = %v, want %d of each", looper.enoughAt, len(routes), err, maxRoutes)
	}
}

func TestGenerateStopsWithANumericGainWhenTheShortestIsOverTheMatchBound(t *testing.T) {
	direct := engineLoop(0)
	direct.Distance, direct.Shortest = 12_000, 12_000
	looper := &fakeLooper{direct: direct, loops: []*engine.Route{engineLoop(120)}}
	withGain := `{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":300,"surface":"any","pace":6,"waypoints":` + twoWaypoints + `}`

	if _, err := generate(t, looper, context.Background(), withGain); err != nil {
		t.Fatal(err)
	}
	if looper.loopCalls != 0 {
		t.Error("the distance cannot match; the gain does not make a loop through the waypoints shorter")
	}
}
