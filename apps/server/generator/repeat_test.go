package generator

import (
	"context"
	"reflect"
	"testing"

	"github.com/lesloi/path-finder/apps/server/contract"
	"github.com/lesloi/path-finder/apps/server/engine"
)

// loopOf is an engine loop with the measures the test wants, on the geometry of engineLoop.
func loopOf(meters, ascent float64) *engine.Route {
	l := engineLoop(0)
	l.Distance = meters
	l.Ascent = ascent
	l.Descent = ascent
	return l
}

func TestRepeatSearchesALapWhenTheGainIsOutOfReach(t *testing.T) {
	looper := &fakeLooper{
		loops:   []*engine.Route{loopOf(10_000, 300)},
		batches: [][]*engine.Route{{loopOf(10_000, 300)}, {loopOf(5_000, 300)}},
	}

	set, err := generateSet(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":600,"surface":"any","pace":6,"repeats":true}`)
	if err != nil {
		t.Fatal(err)
	}

	if len(looper.requests) != 2 {
		t.Fatalf("the engine was asked %d times, want a lap search too", len(looper.requests))
	}
	want := engine.LoopRequest{
		Start:      engine.Point{Lat: 45.8992, Lon: 6.1294},
		Distance:   5_000,
		Ascent:     300,
		AscentBand: engine.AscentBand{Share: 0.2, FloorM: 25},
		Candidates: repeatCandidates,
		Seed:       42,
	}
	got := looper.requests[1]
	if got.Enough == nil {
		t.Error("the lap search is not told when to stop")
	}
	got.Enough = nil
	if got.DistanceBand != 0.1 {
		t.Errorf("distance band = %v, want the match share", got.DistanceBand)
	}
	got.DistanceBand = 0
	if !reflect.DeepEqual(got, want) {
		t.Errorf("lap request = %+v, want %+v", got, want)
	}

	var repeated *contract.Route
	for i := range set.Routes {
		if set.Routes[i].Laps > 1 {
			repeated = &set.Routes[i]
		}
	}
	if repeated == nil {
		t.Fatalf("routes = %+v, want a repeated one", set.Routes)
	}
	if repeated.Laps != 2 || repeated.Distance != 10 || repeated.ElevationGain == nil || *repeated.ElevationGain != 600 {
		t.Errorf("repeated route = %+v, want 2 laps of 5 km and 300 m", repeated)
	}
	if repeated.Kind != "match" {
		t.Errorf("kind = %s, want a match", repeated.Kind)
	}
}

func TestRepeatDoesNotFireWhenALoopMeetsTheGain(t *testing.T) {
	looper := &fakeLooper{loops: []*engine.Route{loopOf(10_000, 600)}}

	if _, err := generate(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":600,"surface":"any","pace":6,"repeats":true}`); err != nil {
		t.Fatal(err)
	}

	if looper.loopCalls != 1 {
		t.Errorf("the engine was asked %d times, want the natural search alone", looper.loopCalls)
	}
}

func TestRepeatDoesNotFireWhenTheGainIsMetOutOfDistance(t *testing.T) {
	// A natural loop already meets the gain; repeating is the answer to a gain that is short, not to a distance that
	// is off, so the repeat search stays away.
	looper := &fakeLooper{loops: []*engine.Route{loopOf(17_900, 490)}}

	if _, err := generate(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":16},"elevationGain":500,"surface":"any","pace":6,"repeats":true}`); err != nil {
		t.Fatal(err)
	}

	if looper.loopCalls != 1 {
		t.Errorf("the engine was asked %d times, want the natural search alone", looper.loopCalls)
	}
}

func TestRepeatTriesTheShortestLapWhenTheNaturalSearchFindsNone(t *testing.T) {
	looper := &fakeLooper{
		err:     engine.ErrNoLoop,
		batches: [][]*engine.Route{nil, []*engine.Route{loopOf(1_667, 100)}},
	}

	set, err := generateSet(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":600,"surface":"any","pace":6,"repeats":true}`)
	if err != nil {
		t.Fatal(err)
	}

	// The floor caps a 10 km route at six laps: the shortest lap the loop search may aim at is 10/6 km.
	want := 10_000.0 / 6
	if len(looper.requests) != 2 || looper.requests[1].Distance != want {
		t.Fatalf("requests = %+v, want one lap search at %v m", looper.requests, want)
	}
	if got := looper.requests[1].Ascent; got != 100 {
		t.Errorf("lap ascent = %v m, want 100", got)
	}
	var repeated *contract.Route
	for i := range set.Routes {
		if set.Routes[i].Laps == 6 {
			repeated = &set.Routes[i]
		}
	}
	if repeated == nil || repeated.Kind != "match" {
		t.Errorf("routes = %+v, want a match at 6 laps", set.Routes)
	}
}

func TestRepeatReEstimatesTheCountFromTheLapGain(t *testing.T) {
	looper := &fakeLooper{
		loops: []*engine.Route{loopOf(10_000, 300)},
		batches: [][]*engine.Route{
			{loopOf(10_000, 300)},
			{loopOf(5_000, 100)},
			{loopOf(1_667, 100)},
		},
	}

	set, err := generateSet(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":600,"surface":"any","pace":6,"repeats":true}`)
	if err != nil {
		t.Fatal(err)
	}

	if len(looper.requests) != 3 {
		t.Fatalf("the engine was asked %d times, want two lap searches", len(looper.requests))
	}
	if got := looper.requests[1].Distance; got != 5_000 {
		t.Errorf("first lap = %v m, want 5000", got)
	}
	// The 5 km lap made 100 m, so 600 m needs six laps rather than the natural loop's estimate of two.
	if got := looper.requests[2].Distance; got != 10_000.0/6 {
		t.Errorf("second lap = %v m, want a sixth of the route", got)
	}
	if got := looper.requests[2].Ascent; got != 100 {
		t.Errorf("second lap ascent = %v m, want 100", got)
	}
	var repeated *contract.Route
	for i := range set.Routes {
		if set.Routes[i].Laps == 6 {
			repeated = &set.Routes[i]
		}
	}
	if repeated == nil || repeated.Kind != "match" {
		t.Errorf("routes = %+v, want a match at 6 laps", set.Routes)
	}
}

func TestRepeatFollowsTheLapGainDownToTheFloor(t *testing.T) {
	// A low-relief start: a 15 km loop makes 270 m, but a 7.5 km lap makes 130, a 3.75 km lap 87 and a 2.5 km lap
	// 60: the count has to walk down to nine short laps before the gain is there.
	looper := &fakeLooper{
		loops: []*engine.Route{loopOf(15_000, 270)},
		batches: [][]*engine.Route{
			{loopOf(15_000, 270)},
			{loopOf(7_500, 130)},
			{loopOf(3_750, 87)},
			{loopOf(2_500, 60)},
			{loopOf(1_667, 60)},
		},
	}

	set, err := generateSet(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":15},"elevationGain":500,"surface":"any","pace":6,"repeats":true}`)
	if err != nil {
		t.Fatal(err)
	}

	if len(looper.requests) != 5 {
		t.Fatalf("the engine was asked %d times, want four lap searches", len(looper.requests))
	}
	want := []float64{7_500, 3_750, 2_500, 15_000.0 / 9}
	for i, distance := range want {
		if got := looper.requests[i+1].Distance; got != distance {
			t.Errorf("lap %d = %v m, want %v", i, got, distance)
		}
	}
	var repeated *contract.Route
	for i := range set.Routes {
		if set.Routes[i].Laps == 9 {
			repeated = &set.Routes[i]
		}
	}
	if repeated == nil || repeated.Kind != "match" || repeated.ElevationGain == nil || *repeated.ElevationGain != 540 {
		t.Errorf("routes = %+v, want a match at 9 laps and 540 m", set.Routes)
	}
}

func TestRepeatTriesTheMaximumWhenTheEstimateOvershoots(t *testing.T) {
	// The 2.5 km lap makes 50 m, which would need twelve laps: over the contract's ten, but the ten 1.5 km laps make
	// 60 m each, enough for the 600 m target.
	looper := &fakeLooper{
		loops: []*engine.Route{loopOf(15_000, 270)},
		batches: [][]*engine.Route{
			{loopOf(15_000, 270)},
			{loopOf(7_500, 100)},
			{loopOf(2_500, 50)},
			{loopOf(1_500, 60)},
		},
	}

	set, err := generateSet(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":15},"elevationGain":600,"surface":"any","pace":6,"repeats":true}`)
	if err != nil {
		t.Fatal(err)
	}

	if len(looper.requests) != 4 {
		t.Fatalf("the engine was asked %d times, want three lap searches", len(looper.requests))
	}
	if got := looper.requests[3].Distance; got != 15_000.0/10 {
		t.Errorf("last lap = %v m, want a tenth of the route", got)
	}
	var repeated *contract.Route
	for i := range set.Routes {
		if set.Routes[i].Laps == 10 {
			repeated = &set.Routes[i]
		}
	}
	if repeated == nil || repeated.Kind != "match" {
		t.Errorf("routes = %+v, want a match at 10 laps", set.Routes)
	}
}

func TestRepeatStopsAfterFourSearchesWithoutAMatch(t *testing.T) {
	looper := &fakeLooper{
		loops: []*engine.Route{loopOf(15_000, 270)},
		batches: [][]*engine.Route{
			{loopOf(15_000, 270)},
			{loopOf(7_500, 130)},
			{loopOf(3_750, 87)},
			{loopOf(2_500, 60)},
			{loopOf(1_667, 40)},
		},
	}

	set, err := generateSet(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":15},"elevationGain":500,"surface":"any","pace":6,"repeats":true}`)
	if err != nil {
		t.Fatal(err)
	}

	// 2, 4, 6 and 9 laps: the fourth still gains too little, and the next count (13) is over the maximum.
	if len(looper.requests) != 5 {
		t.Fatalf("the engine was asked %d times, want four lap searches", len(looper.requests))
	}
	if got := looper.requests[4].Distance; got != 15_000.0/9 {
		t.Errorf("last lap = %v m, want a ninth of the route", got)
	}
	for _, route := range set.Routes {
		if route.Kind == "match" {
			t.Errorf("route %+v matches, want none", route)
		}
	}
	if set.ClosestElevationGain == nil || *set.ClosestElevationGain != 360 {
		t.Errorf("closest gain = %v, want 360", set.ClosestElevationGain)
	}
}

func TestRepeatStaysWithinTheLapFloor(t *testing.T) {
	looper := &fakeLooper{
		loops:   []*engine.Route{loopOf(4_000, 300)},
		batches: [][]*engine.Route{{loopOf(4_000, 300)}, {loopOf(2_000, 300)}},
	}

	if _, err := generate(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":4},"elevationGain":600,"surface":"any","pace":6,"repeats":true}`); err != nil {
		t.Fatal(err)
	}

	if len(looper.requests) != 2 || looper.requests[1].Distance != 2_000 {
		t.Fatalf("requests = %+v, want one lap search at 2 km", looper.requests)
	}
}

func TestRepeatRefusesALapUnderTheFloor(t *testing.T) {
	looper := &fakeLooper{loops: []*engine.Route{loopOf(2_000, 300)}}

	if _, err := generate(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":2},"elevationGain":600,"surface":"any","pace":6,"repeats":true}`); err != nil {
		t.Fatal(err)
	}

	if looper.loopCalls != 1 {
		t.Errorf("the engine was asked %d times, want the natural search alone", looper.loopCalls)
	}
}

func TestRepeatLeavesADurationAndWaypointsToTheirOwnShape(t *testing.T) {
	for name, body := range map[string]string{
		"a duration": `{"start":[6.1294,45.8992],"target":{"duration":60},"elevationGain":600,"surface":"any","pace":6,"repeats":true}`,
		"waypoints":  `{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":600,"surface":"any","pace":6,"repeats":true,"waypoints":` + twoWaypoints + `}`,
	} {
		t.Run(name, func(t *testing.T) {
			looper := &fakeLooper{direct: loopOf(10_000, 300), loops: []*engine.Route{loopOf(10_000, 300)}}
			if _, err := generate(t, looper, context.Background(), body); err != nil {
				t.Fatal(err)
			}
			if looper.loopCalls != 1 {
				t.Errorf("the engine was asked %d times, want the natural search alone", looper.loopCalls)
			}
		})
	}
}

func TestRepeatedCandidateKeepsOneLapForTheRanking(t *testing.T) {
	base := cand(nil)
	repeated := base.repeated(3)

	if repeated.laps != 3 || repeated.distance != 30 || repeated.elevationGain == nil || *repeated.elevationGain != 900 {
		t.Errorf("repeated = %+v, want 3 laps, 30 km and 900 m", repeated)
	}
	if len(repeated.circuit) != len(base.geometry) {
		t.Errorf("circuit has %d points, want the loop's %d", len(repeated.circuit), len(base.geometry))
	}
	if got, want := len(repeated.geometry), len(base.geometry)+2*(len(base.geometry)-1); got != want {
		t.Errorf("geometry has %d points, want %d", got, want)
	}
	if !samePoint(repeated.geometry[0], repeated.geometry[len(repeated.geometry)-1]) {
		t.Error("the repeated route does not close")
	}
	want := []contract.SurfaceStretch{
		{Surface: "paved", From: 0, To: 5}, {Surface: "unpaved", From: 5, To: 10},
		{Surface: "paved", From: 10, To: 15}, {Surface: "unpaved", From: 15, To: 20},
		{Surface: "paved", From: 20, To: 25}, {Surface: "unpaved", From: 25, To: 30},
	}
	if !reflect.DeepEqual(repeated.surfaces, want) {
		t.Errorf("surfaces = %+v, want %+v", repeated.surfaces, want)
	}

	if !reflect.DeepEqual(repeated.circuit, base.geometry) {
		t.Error("the repeated route does not keep its loop for the ranking")
	}
	criteria := contract.Criteria{Start: [2]float64{6.1294, 45.8992}, Target: contract.Target{Distance: 30}, Surface: "any", Pace: 6}
	entry, ok := classify(criteria, repeated, newRanking(criteria, 30).radius)
	if !ok {
		t.Fatal("the repeated route does not fit its own target")
	}
	wantCells := make(map[cell]struct{})
	for _, v := range cellsAlong(base.geometry, criteria.Start, 500) {
		wantCells[v.cell] = struct{}{}
	}
	if !reflect.DeepEqual(entry.cells, wantCells) {
		t.Error("the repeated route does not compare on its loop's cells")
	}
}

func TestRepeatTechnicalOffsetsEachLap(t *testing.T) {
	got := repeatTechnical([]contract.TechnicalStretch{{From: 2, To: 4}}, 10, 2)

	want := []contract.TechnicalStretch{{From: 2, To: 4}, {From: 12, To: 14}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("technical = %+v, want %+v", got, want)
	}
}

func TestBestDirectRepeatsAWaypointLoopThatFits(t *testing.T) {
	looper := &fakeLooper{direct: loopOf(3_000, 100), loops: nil}

	routes, err := generate(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":300,"surface":"any","pace":6,"repeats":true,"waypoints":`+twoWaypoints+`}`)
	if err != nil {
		t.Fatal(err)
	}

	var repeated *contract.Route
	for i := range routes {
		if routes[i].Laps > 1 {
			repeated = &routes[i]
		}
	}
	if repeated == nil {
		t.Fatalf("routes = %+v, want the direct loop repeated", routes)
	}
	if repeated.Laps != 3 || repeated.Distance != 9 || repeated.ElevationGain == nil || *repeated.ElevationGain != 300 {
		t.Errorf("repeated direct = %+v, want 3 laps of 3 km and 100 m", repeated)
	}
	if repeated.Kind != "match" {
		t.Errorf("kind = %s, want a match", repeated.Kind)
	}
	if looper.got.Direct != looper.direct {
		t.Error("the engine was not handed the direct loop to reuse")
	}
}

func TestBestDirectKeepsTheLoopWhenRepeatingIsWorse(t *testing.T) {
	looper := &fakeLooper{direct: loopOf(10_000, 300), loops: nil}

	routes, err := generate(t, looper, context.Background(),
		`{"start":[6.1294,45.8992],"target":{"distance":10},"elevationGain":300,"surface":"any","pace":6,"repeats":true,"waypoints":`+twoWaypoints+`}`)
	if err != nil {
		t.Fatal(err)
	}

	if len(routes) != 1 || routes[0].Laps != 0 || routes[0].Kind != "match" {
		t.Errorf("routes = %+v, want the direct loop run once", routes)
	}
}
