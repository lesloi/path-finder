package generator

import (
	"context"
	"encoding/json"
	"errors"
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
}

func (f *fakeLooper) DirectLoop(_ context.Context, _ engine.Point, _ []engine.Point) (*engine.Route, error) {
	f.directCalls++
	return f.direct, f.directErr
}

func (f *fakeLooper) Loops(_ context.Context, req engine.LoopRequest) ([]*engine.Route, error) {
	f.got = req
	f.loopCalls++
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
	want := engine.LoopRequest{Start: engine.Point{Lat: 45.8992, Lon: 6.1294}, Distance: 10_000, Ascent: 300, AscentBand: engine.AscentBand{Share: 0.2, FloorM: 50}, Candidates: 80, Seed: 42}
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
	for i, heading := range []float64{0, 70, 140, 210, 280} {
		found = append(found, engineLoop(heading))
		if got, want := enough(found), i == 4; got != want {
			t.Errorf("after %d matches: enough = %v, want %v", i+1, got, want)
		}
	}
}

func TestGenerateKeepsSearchingWhileTheSetIsNotFull(t *testing.T) {
	looper := &fakeLooper{}
	if _, err := generate(t, looper, context.Background(), body); err != nil {
		t.Fatal(err)
	}
	// Five loops, but all the same: one route, and suggestions or duplicates do not fill the set.
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
	technical.Technical = true
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

func TestGenerateAsksNothingOfTheEngineWithoutWaypoints(t *testing.T) {
	looper := &fakeLooper{loops: []*engine.Route{engineLoop(0)}}

	if _, err := generate(t, looper, context.Background(), body); err != nil {
		t.Fatal(err)
	}

	if looper.directCalls != 0 || looper.got.Waypoints != nil {
		t.Errorf("direct loops asked %d times, waypoints = %v", looper.directCalls, looper.got.Waypoints)
	}
}

func TestGenerateRefusesWaypointsBeyondTheTargetBeforeSearching(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0)}
	// 30 km away and back, for a target of 10 km.
	far := `[[6.5,46.1]]`

	_, err := generate(t, looper, context.Background(), withWaypoints(far))

	var ce *contract.CriteriaError
	if !errors.As(err, &ce) || ce.Field != "waypoints" || ce.Waypoint != 0 {
		t.Fatalf("err = %v, want a CriteriaError on waypoints, with no index", err)
	}
	if looper.directCalls+looper.loopCalls != 0 {
		t.Errorf("the engine was asked %d times", looper.directCalls+looper.loopCalls)
	}
}

func TestGenerateRefusesADirectLoopBeyondTheTarget(t *testing.T) {
	long := engineLoop(0)
	long.Distance = 14_000 // 40 % over a target of 10 km: beyond what a suggestion allows
	looper := &fakeLooper{direct: long}

	_, err := generate(t, looper, context.Background(), withWaypoints(twoWaypoints))

	var ce *contract.CriteriaError
	if !errors.As(err, &ce) || ce.Field != "waypoints" || ce.Waypoint != 0 {
		t.Fatalf("err = %v, want a CriteriaError on waypoints, with no index", err)
	}
	if looper.loopCalls != 0 {
		t.Error("loops were searched for waypoints that cannot meet the target")
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
	_, err := generate(t, &fakeLooper{direct: long}, context.Background(), duration)
	var ce *contract.CriteriaError
	if !errors.As(err, &ce) {
		t.Fatalf("err = %v, want a CriteriaError", err)
	}

	fine := engineLoop(0)
	fine.Distance, fine.Ascent = 9_000, 0
	if _, err := generate(t, &fakeLooper{direct: fine, err: engine.ErrNoLoop}, context.Background(), duration); err != nil {
		t.Errorf("a direct loop of 54 min for 60: err = %v", err)
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
