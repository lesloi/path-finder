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

func TestGenerateSearchesNoLoopsForAPointToPointRoute(t *testing.T) {
	looper := &fakeLooper{direct: engineLoop(0), loops: []*engine.Route{engineLoop(120)}}

	if _, err := generate(t, looper, context.Background(), withEnd); err != nil {
		t.Fatal(err)
	}

	if looper.loopCalls != 0 {
		t.Errorf("loop searches = %d, want none: a route that finishes elsewhere is no loop", looper.loopCalls)
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
