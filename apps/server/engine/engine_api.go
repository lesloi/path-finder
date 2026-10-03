package engine

import (
	"context"
	"errors"
	"fmt"
)

// maxSnapMeters is how far a requested point may be from the nearest graph node.
const maxSnapMeters = 400

var (
	// ErrOffGraph means a point is too far from any way of the graph.
	ErrOffGraph = errors.New("engine: point is off the graph")
	// ErrNoRoute means no route was found between two points.
	ErrNoRoute = errors.New("engine: no route found")
	// ErrNoLoop means no loop was found from the start point.
	ErrNoLoop = errors.New("engine: no loop found")
)

// Point is a position in degrees.
type Point struct{ Lat, Lon float64 }

// Position is a point of a route with its elevation in metres.
type Position struct {
	Point
	Elevation float64
}

// Route is a generated route: its geometry and its measures, in metres.
type Route struct {
	Points     []Position
	Distance   float64
	Ascent     float64
	TrailShare float64 // share of the distance on trails, 0 to 1
}

// LoopRequest asks for a loop from Start. Distance is the target length in metres and Ascent the
// target elevation gain in metres (0 for none). The same Seed always yields the same loop.
type LoopRequest struct {
	Start      Point
	Distance   float64
	Ascent     float64
	Candidates int
	Seed       uint64
}

// Open maps a graph file, and its landmark file when landmarksPath is not empty, for the named
// activity profile. The landmarks must have been built for the same profile.
func Open(graphPath, landmarksPath, profile string) (*Engine, error) {
	p := profiles[profile]
	if p == nil {
		return nil, fmt.Errorf("engine: unknown profile %q", profile)
	}
	g, err := openGraph(graphPath)
	if err != nil {
		return nil, err
	}
	e := &Engine{g: g, prof: p, minMult: p.minMult()}
	for k := range e.mult {
		for s := range e.mult[k] {
			e.mult[k][s] = p.Kind[k] * p.Surf[s]
		}
	}
	if landmarksPath != "" {
		if e.alt, err = openLandmarks(landmarksPath, g); err != nil {
			return nil, err
		}
	}
	e.sp = newSpatial(g)
	return e, nil
}

// Route finds the cheapest route from one point to another. It returns ctx's error when ctx ends first.
func (e *Engine) Route(ctx context.Context, from, to Point) (*Route, error) {
	src, d, ok := e.sp.nearest(e.g, from.Lat, from.Lon)
	if !ok || d > maxSnapMeters {
		return nil, ErrOffGraph
	}
	dst, d, ok := e.sp.nearest(e.g, to.Lat, to.Lon)
	if !ok || d > maxSnapMeters {
		return nil, ErrOffGraph
	}
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	r := s.route(ctx, e, e.prof.UpPerMeter, nil, 0, src, dst)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if r == nil {
		return nil, ErrNoRoute
	}
	dist, trail, _ := measure(e.g, r.nodes, r.edges)
	out := &Route{Points: e.positions(r.nodes), Distance: dist, Ascent: ascent(e.g, r.nodes)}
	if dist > 0 {
		out.TrailShare = trail / dist
	}
	return out, nil
}

// Loop generates the best of req.Candidates loops. It returns ctx's error when ctx ends first.
func (e *Engine) Loop(ctx context.Context, req LoopRequest) (*Route, error) {
	if req.Distance <= 0 || req.Candidates <= 0 {
		return nil, errors.New("engine: loop needs a positive distance and candidate count")
	}
	l := generate(ctx, e, e.sp, &loopParams{
		lat: req.Start.Lat, lon: req.Start.Lon, distM: req.Distance, ascentM: req.Ascent,
		candidates: req.Candidates, seed: req.Seed,
	})
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if l == nil {
		return nil, ErrNoLoop
	}
	return &Route{Points: e.positions(l.nodes), Distance: l.dist, Ascent: l.ascent, TrailShare: l.trail / l.dist}, nil
}

func (e *Engine) positions(nodes []uint32) []Position {
	out := make([]Position, len(nodes))
	for i, n := range nodes {
		nd := e.g.nodes[n]
		out[i] = Position{Point{float64(nd.Lat) * 1e-7, float64(nd.Lon) * 1e-7}, float64(nd.Elev) * 0.1}
	}
	return out
}
