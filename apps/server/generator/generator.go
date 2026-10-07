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
	criteria, _, err := contract.ParseCriteria(body, true)
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
	// Stops searching once the route set cannot get any bigger: more loops would only cost CPU.
	var seen []*candidate
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
		// Nothing to offer from here: an empty route set, not a failure.
		return []contract.Route{}, nil
	case err != nil && ctx.Err() == nil:
		return nil, err
	}
	candidates := make([]*candidate, 0, len(loops))
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
		unpavedShare: unpaved / total,
	}
	// Consecutive stretches of one surface are already merged; shares add up to 1.
	c.surfaces = make([]contract.SurfaceStretch, len(l.Stretches))
	for i, s := range l.Stretches {
		surface := "paved"
		if s.Unpaved {
			surface = "unpaved"
		}
		c.surfaces[i] = contract.SurfaceStretch{Surface: surface, Share: s.Meters / total}
	}
	return c
}
