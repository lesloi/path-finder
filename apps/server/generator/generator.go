// Package generator turns criteria into a route set: it asks the engine for loops, then keeps
// the best and most different ones. It is plain Go, tested without a server or a graph.
package generator

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/rand/v2"

	"github.com/lesloi/path-finder/apps/server/contract"
	"github.com/lesloi/path-finder/apps/server/engine"
)

// Looper generates loops, as an engine does for one profile.
type Looper interface {
	Loops(ctx context.Context, req engine.LoopRequest) ([]*engine.Route, error)
	// DirectLoop is the cheapest loop through the waypoints, in order.
	DirectLoop(ctx context.Context, req engine.DirectLoopRequest) (*engine.Route, error)
}

// Generator builds route sets. It is safe for concurrent use.
type Generator struct {
	// Engines by surface preference ("any", "paved", "unpaved").
	Engines map[string]Looper
	// Candidates is how many loops to ask the engine for (default defaultCandidates).
	Candidates int
	// MaxRoutes is how many matches a route set holds at most, and where the search stops (default maxRoutes).
	MaxRoutes int
	// StopAfter ends the search once that many loops in a row have added no match to the set, whatever the
	// budget left (default defaultStopAfter). It lets a hard request search long and an easy one stop early.
	StopAfter int
	// Seed gives each request its own seed, so asking again can bring other loops (default random).
	Seed func() uint64
}

// defaultCandidates is large because most requests stop long before it: defaultStopAfter ends the search once
// more loops no longer add a match. The measures behind both are in docs/DECISIONS.md.
const (
	defaultCandidates = 100
	defaultStopAfter  = 60
)

// Generate reads the criteria from body and returns the routes of a route set. It reports
// criteria that are not valid as a *contract.CriteriaError. When ctx ends first, it returns the
// routes the loops finished by then make, if any, and ctx's error otherwise: asking for more
// would only take longer.
func (g *Generator) Generate(ctx context.Context, body json.RawMessage) (any, error) {
	criteria, err := contract.ParseCriteria(body, true)
	if err != nil {
		return nil, err
	}
	looper := g.Engines[criteria.Surface]
	if looper == nil {
		return nil, errors.New("generator: no engine for surface preference " + criteria.Surface)
	}
	km, err := criteria.TargetDistanceKm()
	if err != nil {
		return nil, err
	}
	limit := cmpOr(g.MaxRoutes, maxRoutes)
	stopAfter := cmpOr(g.StopAfter, defaultStopAfter)
	req := engine.LoopRequest{
		Start:      engine.Point{Lat: criteria.Start[1], Lon: criteria.Start[0]},
		Distance:   km * 1000,
		Candidates: cmpOr(g.Candidates, defaultCandidates),
		Seed:       g.seed(),
		Avoided:    avoidedCircles(criteria.AvoidedAreas),
	}
	if criteria.ElevationGain != nil && criteria.ElevationGain.Shortcut == "" {
		req.Ascent = criteria.ElevationGain.Metres
		req.AscentBand = engine.AscentBand{Share: matchTolerance.elevationGain, FloorM: matchTolerance.elevationGainFloor}
	}
	// A target duration is an effort distance: the search aims at it with the same curve the ranking estimates the
	// duration with, so that a hilly loop is shorter than the flat prior rather than too slow.
	if criteria.Target.Duration > 0 {
		s := contract.SlopeEffortOf()
		req.Effort = &engine.EffortTarget{
			Metres: criteria.Target.Duration / criteria.Pace * 1000,
			Slope: engine.SlopeEffort{
				Decay: s.Decay, EasiestGrade: s.EasiestGrade, MaxGrade: s.MaxGrade, StretchMetres: s.StretchMetres,
			},
		}
	}
	// The loop straight through the waypoints is a candidate of its own.
	set := newRanking(criteria, km)
	enough := limit
	// directOver tells whether the waypoints already make a route beyond the match bound: every loop through them is
	// at least as long, so none can match, and the direct loop is the answer.
	directOver := false
	if len(criteria.Waypoints) > 0 {
		for _, w := range criteria.Waypoints {
			req.Waypoints = append(req.Waypoints, engine.Point{Lat: w[1], Lon: w[0]})
		}
		direct, directRoute, err := throughWaypoints(ctx, looper, criteria, req.Waypoints, req.Avoided)
		if err != nil {
			return nil, err
		}
		req.Direct = directRoute
		if direct != nil {
			set.add(direct)
			if set.holdsADirectSuggestion() {
				// It keeps a place in the set (see ranking.routes), so one match fewer fills it.
				enough = limit - 1
			}
			if criteria.Target.Distance > 0 && (criteria.ElevationGain == nil || criteria.ElevationGain.Shortcut == "") &&
				directRoute != nil && directRoute.Shortest > 0 {
				targetM := criteria.Target.Distance * 1000
				if directRoute.Shortest-targetM > matchTolerance.distance*targetM {
					directOver = true
				}
			}
			if directOver || overshoots(criteria, direct) {
				// Searching loops would only cost CPU: the shortest loop through the waypoints is already beyond the
				// match bound, and every loop is at least that long; the direct loop is offered.
				return set.routes(limit), nil
			}
		}
	}
	// Stops searching once the route set cannot get any bigger, or no longer does: more loops would only cost CPU.
	var converted, best, lastGain int
	addLoops := func(found []*engine.Route) {
		for ; converted < len(found); converted++ {
			if c := toCandidate(found[converted]); c != nil {
				set.add(c)
			}
		}
	}
	req.Enough = func(found []*engine.Route) bool {
		addLoops(found)
		matches := 0
		for _, r := range set.routes(limit) {
			if r.Kind == "match" {
				matches++
			}
		}
		if matches > best {
			best, lastGain = matches, len(found)
		}
		return matches >= enough || len(found)-lastGain >= stopAfter
	}

	loops, err := looper.Loops(ctx, req)
	switch {
	case errors.Is(err, engine.ErrOffGraph), errors.Is(err, engine.ErrNoLoop), errors.Is(err, engine.ErrNoRoute):
		// Nothing more to offer from here: the direct loop through the waypoints, if any, or an empty
		// route set, not a failure. ErrNoRoute means the loops through the waypoints found no route, which
		// leaves the direct loop as the answer.
	case err != nil && ctx.Err() == nil:
		return nil, err
	}
	addLoops(loops)
	routes := set.routes(limit)
	if ctx.Err() != nil && len(routes) == 0 {
		return nil, ctx.Err()
	}
	return routes, nil
}

// avoidedCircles is the areas of the criteria as the engine takes them.
func avoidedCircles(areas []contract.AvoidedArea) []engine.Circle {
	var circles []engine.Circle
	for _, a := range areas {
		circles = append(circles, engine.Circle{Center: engine.Point{Lat: a.Center[1], Lon: a.Center[0]}, RadiusM: a.Radius})
	}
	return circles
}

// throughWaypoints routes the direct loop through the waypoints and refuses criteria whose waypoints
// make a loop longer than any route may be, or that the engine cannot match to a way. It returns the direct loop as
// a candidate and as the route the loop search reuses, or nil when it goes nowhere. A loop beyond the target is no
// refusal: a summit with a single access is farther than the target allows, and the loop is offered with the
// distance it has.
func throughWaypoints(ctx context.Context, looper Looper, c contract.Criteria, points []engine.Point, avoided []engine.Circle) (*candidate, *engine.Route, error) {
	tooLong := &contract.CriteriaError{Field: "waypoints", Message: "waypoints make too long a route"}
	// A loop is never shorter than the straight lines through its points: no need to search.
	if crowFlies(c.Start, c.Waypoints)/1000 > contract.MaxDistanceKm() {
		return nil, nil, tooLong
	}
	direct, err := looper.DirectLoop(ctx, engine.DirectLoopRequest{Start: engine.Point{Lat: c.Start[1], Lon: c.Start[0]}, Waypoints: points, Avoided: avoided})
	var waypoint *engine.WaypointError
	switch {
	case errors.As(err, &waypoint):
		return nil, nil, &contract.CriteriaError{Field: "waypoints", Message: "waypoint is too far from a way", Waypoint: waypoint.Index}
	case errors.Is(err, engine.ErrOffGraph):
		return nil, nil, &contract.CriteriaError{Field: "start", Message: "start point is too far from a way"}
	case errors.Is(err, engine.ErrNoRoute):
		return nil, nil, &contract.CriteriaError{Field: "waypoints", Message: "waypoints are not joined by a way"}
	case err != nil:
		return nil, nil, err
	}
	cand := toCandidate(direct)
	if cand == nil {
		return nil, nil, nil
	}
	if cand.distance > contract.MaxDistanceKm() {
		return nil, nil, tooLong
	}
	cand.direct = true
	return cand, direct, nil
}

// overshoots tells whether the direct loop is longer than the target allows even a wide suggestion: no loop
// through the waypoints is any nearer, as detours only add to it.
func overshoots(c contract.Criteria, direct *candidate) bool {
	tooFar := checks(c, direct, direct.effortDistance()*c.Pace)[0]
	return tooFar.gap > 0 && tooFar.tier == tierOut
}

func (g *Generator) seed() uint64 {
	if g.Seed != nil {
		return g.Seed()
	}
	return rand.Uint64()
}

func cmpOr(v, fallback int) int {
	if v > 0 {
		return v
	}
	return fallback
}

func round(x float64, decimals int) float64 {
	p := math.Pow10(decimals)
	return math.Round(x*p) / p
}

// toCandidate converts a loop, or returns nil for one with no length.
func toCandidate(l *engine.Route) *candidate {
	var unpaved, total float64
	for _, s := range l.Stretches {
		total += s.Meters
		if s.Unpaved {
			unpaved += s.Meters
		}
	}
	if total == 0 {
		return nil
	}
	geometry := make([][]float64, len(l.Points))
	for i, p := range l.Points {
		geometry[i] = []float64{round(p.Lon, 7), round(p.Lat, 7), round(p.Elevation, 1)}
	}
	gain, loss := round(l.Ascent, 1), round(l.Descent, 1)
	c := &candidate{
		geometry: geometry, distance: round(l.Distance/1000, 3), elevationGain: &gain, elevationLoss: &loss,
		unpavedShare: unpaved / total, technicalStretches: []contract.TechnicalStretch{},
	}
	// Each stretch starts where the previous ends, and the last ends at the route's distance, so
	// they cover it without gaps. One that rounds to no length is dropped, and the stretches of one
	// surface it then leaves side by side are merged.
	var from, coveredMeters float64
	for i, s := range l.Stretches {
		surface := "paved"
		if s.Unpaved {
			surface = "unpaved"
		}
		to := c.distance
		if i < len(l.Stretches)-1 {
			coveredMeters += s.Meters
			to = round(coveredMeters/total*c.distance, 3)
		}
		if to == from {
			continue
		}
		if s.Technical {
			c.technicalStretches = appendTechnical(c.technicalStretches, from, to)
		}
		c.surfaces = appendSurface(c.surfaces, surface, from, to)
		from = to
	}
	// Told from the stretches kept, so that the badge never shows for a route with nothing to hatch.
	c.technical = len(c.technicalStretches) > 0
	return c
}

// appendSurface adds a stretch, merged into the last one when it is on the same surface.
func appendSurface(list []contract.SurfaceStretch, surface string, from, to float64) []contract.SurfaceStretch {
	if n := len(list); n > 0 && list[n-1].Surface == surface {
		list[n-1].To = to
		return list
	}
	return append(list, contract.SurfaceStretch{Surface: surface, From: from, To: to})
}

// appendTechnical adds a stretch, merged into the last one when it follows it.
func appendTechnical(list []contract.TechnicalStretch, from, to float64) []contract.TechnicalStretch {
	if n := len(list); n > 0 && list[n-1].To == from {
		list[n-1].To = to
		return list
	}
	return append(list, contract.TechnicalStretch{From: from, To: to})
}
