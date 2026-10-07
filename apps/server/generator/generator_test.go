package generator

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/lesloi/path-finder/apps/server/contract"
	"github.com/lesloi/path-finder/apps/server/engine"
)

type fakeLooper struct {
	loops []*engine.Route
	err   error
	got   engine.LoopRequest
}

func (f *fakeLooper) Loops(_ context.Context, req engine.LoopRequest) ([]*engine.Route, error) {
	f.got = req
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

const body = `{"start":[6.1294,45.8992],"activity":"hike","target":{"distance":10},"elevationGain":300,"surface":"any","pace":6}`

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
	want := engine.LoopRequest{Start: engine.Point{Lat: 45.8992, Lon: 6.1294}, Distance: 10_000, Ascent: 300, Candidates: 80, Seed: 42}
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
	if r.Distance != 10 || *r.ElevationGain != 300 || *r.ElevationLoss != 300 || r.UnpavedShare != 0.25 || r.Kind != "match" {
		t.Errorf("route = %+v", r)
	}
	if got := r.Geometry[0]; len(got) != 3 || got[0] != 6.1294 || got[1] != 45.8992 || got[2] != 450.1 {
		t.Errorf("first point = %v, want longitude, latitude and a height to the decimetre", got)
	}
	if len(r.Surfaces) != 2 || r.Surfaces[0] != (contract.SurfaceStretch{Surface: "paved", Share: 0.75}) {
		t.Errorf("surfaces = %+v", r.Surfaces)
	}
	if _, err := json.Marshal(map[string]any{"routes": routes}); err != nil {
		t.Errorf("not JSON: %v", err)
	}
}

func TestGenerateSetsNoAscentForAShortcut(t *testing.T) {
	looper := &fakeLooper{}
	hilly := `{"start":[6.1294,45.8992],"activity":"hike","target":{"distance":10},"elevationGain":"hilly","surface":"any","pace":6}`
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
	if !errors.As(err, &ce) || ce.Field != "activity" {
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
	if _, err := g.Generate(context.Background(), json.RawMessage(`{"start":[6.1294,45.8992],"activity":"run","target":{"distance":5},"surface":"unpaved","pace":5}`)); err != nil {
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
