package generator

import (
	"context"
	"errors"
	"testing"

	"github.com/lesloi/path-finder/apps/server/contract"
	"github.com/lesloi/path-finder/apps/server/engine"
)

const withEnd = `{"start":[6.1294,45.8992],"end":[6.2,45.95],"target":{"distance":10},"surface":"any","pace":6}`

func TestGenerateAsksTheEngineForTheWayToTheEndPoint(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0)}

	routes, err := generate(t, looper, context.Background(), withEnd)

	want := engine.Point{Lat: 45.95, Lon: 6.2}
	if err != nil || len(routes) != 1 {
		t.Fatalf("routes = %+v, err = %v, want one route", routes, err)
	}
	if got := looper.gotDirect.End; got == nil || *got != want {
		t.Errorf("the engine got end %v, want %v", got, want)
	}
}

// shortRoute is the direct route to the end point: far shorter than the 10 km the criteria ask for.
func shortRoute() *engine.Route {
	r := engineLoop(0)
	r.Distance = 4000
	return r
}

func TestGenerateSearchesDetoursToTheEndPoint(t *testing.T) {
	looper := &fakeLooper{direct: shortRoute(), loops: []*engine.Route{engineLoop(120)}}

	routes, err := generate(t, looper, context.Background(), withEnd)

	if err != nil || looper.loopCalls != 1 {
		t.Fatalf("loop searches = %d, err = %v, want one search", looper.loopCalls, err)
	}
	want := engine.Point{Lat: 45.95, Lon: 6.2}
	if got := looper.got.End; got == nil || *got != want {
		t.Errorf("the search got end %v, want %v", got, want)
	}
	if looper.got.Direct != looper.direct {
		t.Error("the search was not handed the direct route to reuse")
	}
	if len(routes) != 2 || routes[0].Kind != "match" || routes[1].Kind != "suggestion" {
		t.Errorf("routes = %+v, want the detour as a match and the direct route as a suggestion", routes)
	}
}

func TestGenerateAimsDetoursAtTheCriteriaOfTheRequest(t *testing.T) {
	looper := &fakeLooper{direct: shortRoute(), loops: []*engine.Route{engineLoop(120)}}
	request := `{"start":[6.1294,45.8992],"end":[6.2,45.95],"target":{"duration":60},"elevationGain":300,"surface":"any","pace":6}`

	if _, err := generate(t, looper, context.Background(), request); err != nil {
		t.Fatal(err)
	}

	if looper.got.Ascent != 300 || looper.got.Effort == nil {
		t.Errorf("the search got ascent %v and effort %v, want 300 and an effort target", looper.got.Ascent, looper.got.Effort)
	}
}

func TestGenerateSearchesLoopsWhenTheEndPointIsWhereTheStartIs(t *testing.T) {
	// Arrange: both points snap to the same node, so the way between them has no length
	looper := &fakeLooper{direct: &engine.Route{}, loops: []*engine.Route{engineLoop(120)}}

	routes, err := generate(t, looper, context.Background(), withEnd)

	if err != nil || looper.loopCalls != 1 || looper.got.End != nil {
		t.Fatalf("searches = %d, end = %v, err = %v, want one loop search without an end", looper.loopCalls, looper.got.End, err)
	}
	if len(routes) != 1 || routes[0].Kind != "match" {
		t.Errorf("routes = %+v, want the loop as a match", routes)
	}
}

func TestGenerateSearchesNoDetourWhenTheDirectRouteIsAlreadyBeyondTheTarget(t *testing.T) {
	long := engineLoop(0)
	long.Distance = 25_000
	looper := &fakeLooper{direct: long, loops: []*engine.Route{engineLoop(120)}}

	routes, err := generate(t, looper, context.Background(), withEnd)

	if err != nil || len(routes) != 1 || looper.loopCalls != 0 {
		t.Errorf("routes = %d, searches = %d, err = %v, want the direct route alone", len(routes), looper.loopCalls, err)
	}
}

func TestGenerateKeepsTheDirectRouteWhenNoDetourIsFound(t *testing.T) {
	looper := &fakeLooper{direct: shortRoute(), err: engine.ErrNoLoop}

	routes, err := generate(t, looper, context.Background(), withEnd)

	if err != nil || len(routes) != 1 || routes[0].Kind != "suggestion" {
		t.Errorf("routes = %+v, err = %v, want the direct route as a suggestion", routes, err)
	}
}

func TestGenerateRefusesAnEndPointNoWayJoins(t *testing.T) {
	looper := &fakeLooper{directErr: engine.ErrNoRoute}

	_, err := generate(t, looper, context.Background(), withEnd)

	var ce *contract.CriteriaError
	if !errors.As(err, &ce) || ce.Field != "end" {
		t.Errorf("err = %v, want a CriteriaError on end", err)
	}
}

func TestGenerateOffersAPointToPointRouteFarFromTheTargetAsASuggestion(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0)}
	request := `{"start":[6.1294,45.8992],"end":[6.2,45.95],"target":{"distance":30},"surface":"any","pace":6}`

	routes, err := generate(t, looper, context.Background(), request)

	if err != nil || len(routes) != 1 || routes[0].Kind != "suggestion" {
		t.Errorf("routes = %+v, err = %v, want the route to the end point as a suggestion", routes, err)
	}
}

func TestGenerateRefusesAnEndPointOffTheWays(t *testing.T) {
	looper := &fakeLooper{directErr: engine.ErrEndOffGraph}

	_, err := generate(t, looper, context.Background(), withEnd)

	var ce *contract.CriteriaError
	if !errors.As(err, &ce) || ce.Field != "end" {
		t.Errorf("err = %v, want a CriteriaError on end", err)
	}
}
