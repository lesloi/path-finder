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
	DirectLoop(ctx context.Context, start engine.Point, waypoints []engine.Point) (*engine.Route, error)
}

// Generator builds route sets. It is safe for concurrent use.
type Generator struct {
	// Engines by surface preference ("any", "paved", "unpaved").
	Engines map[string]Looper
	// Candidates is how many loops to ask the engine for (default 80).
	Candidates int
	// Seed gives each request its own seed, so asking again can bring other loops (default random).
	Seed func() uint64
}

const defaultCandidates = 80

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
	req := engine.LoopRequest{
		Start:      engine.Point{Lat: criteria.Start[1], Lon: criteria.Start[0]},
		Distance:   km * 1000,
		Candidates: cmpOr(g.Candidates, defaultCandidates),
		Seed:       g.seed(),
	}
	if criteria.ElevationGain != nil && criteria.ElevationGain.Shortcut == "" {
		req.Ascent = criteria.ElevationGain.Metres
	}
	// The loop straight through the waypoints is a candidate of its own.
	var direct *candidate
	var seen []*candidate
	if len(criteria.Waypoints) > 0 {
		for _, w := range criteria.Waypoints {
			req.Waypoints = append(req.Waypoints, engine.Point{Lat: w[1], Lon: w[0]})
		}
		var err error
		if direct, err = throughWaypoints(ctx, looper, criteria, req.Waypoints); err != nil {
			return nil, err
		}
		if direct != nil {
			seen = append(seen, direct)
		}
	}
	// Stops searching once the route set cannot get any bigger: more loops would only cost CPU.
	var converted int
	req.Enough = func(found []*engine.Route) bool {
		for ; converted < len(found); converted++ {
			if c := toCandidate(found[converted]); c != nil {
				seen = append(seen, c)
			}
		}
		matches := 0
		for _, r := range buildRouteSet(criteria, km, seen) {
			if r.Kind == "match" {
				matches++
			}
		}
		return matches >= maxRoutes
	}

	loops, err := looper.Loops(ctx, req)
	switch {
	case errors.Is(err, engine.ErrOffGraph), errors.Is(err, engine.ErrNoLoop):
		// Nothing more to offer from here: the direct loop through the waypoints, if any, or an empty
		// route set, not a failure.
	case err != nil && ctx.Err() == nil:
		return nil, err
	}
	candidates := make([]*candidate, 0, len(loops)+1)
	if direct != nil {
		candidates = append(candidates, direct)
	}
	for _, l := range loops {
		if c := toCandidate(l); c != nil {
			candidates = append(candidates, c)
		}
	}
	routes := buildRouteSet(criteria, km, candidates)
	if ctx.Err() != nil && len(routes) == 0 {
		return nil, ctx.Err()
	}
	return routes, nil
}

// throughWaypoints routes the direct loop through the waypoints and refuses criteria whose waypoints
// make a loop too long for the target to be met even by a suggestion, or that the engine cannot match
// to a way. It returns the direct loop as a candidate, or nil when it goes nowhere.
func throughWaypoints(ctx context.Context, looper Looper, c contract.Criteria, points []engine.Point) (*candidate, error) {
	tooLong := &contract.CriteriaError{Field: "waypoints", Message: "waypoints make too long a route for the target"}
	// A loop is never shorter than the straight lines through its points: no need to search. Climb only
	// adds to a duration, so a duration target is judged on the flat loop.
	km := crowFlies(c.Start, c.Waypoints) / 1000
	limit := c.Target.Distance
	if c.Target.Distance == 0 {
		km, limit = km*c.Pace, c.Target.Duration
	}
	if km > limit*(1+suggestionTolerance.distance) {
		return nil, tooLong
	}
	route, err := looper.DirectLoop(ctx, engine.Point{Lat: c.Start[1], Lon: c.Start[0]}, points)
	var waypoint *engine.WaypointError
	switch {
	case errors.As(err, &waypoint):
		return nil, &contract.CriteriaError{Field: "waypoints", Message: "waypoint is too far from a way", Waypoint: waypoint.Index}
	case errors.Is(err, engine.ErrOffGraph):
		return nil, &contract.CriteriaError{Field: "start", Message: "start point is too far from a way"}
	case errors.Is(err, engine.ErrNoRoute):
		return nil, &contract.CriteriaError{Field: "waypoints", Message: "waypoints are not joined by a way"}
	case err != nil:
		return nil, err
	}
	cand := toCandidate(route)
	if cand == nil {
		return nil, nil
	}
	estimated := effortDistance(cand.distance, cand.elevationGain) * c.Pace
	// Only a loop that is too long is refused: detours make up for one that is too short.
	if tooFar := checks(c, cand, estimated)[0]; tooFar.gap > 0 && !tooFar.suggestion {
		return nil, tooLong
	}
	return cand, nil
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
		unpavedShare: unpaved / total, technical: l.Technical,
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
		if n := len(c.surfaces); n > 0 && c.surfaces[n-1].Surface == surface {
			c.surfaces[n-1].To = to
		} else {
			c.surfaces = append(c.surfaces, contract.SurfaceStretch{Surface: surface, From: from, To: to})
		}
		from = to
	}
	return c
}
