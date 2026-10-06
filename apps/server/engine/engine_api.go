package engine

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
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

// Stretch is a part of a route on one kind of surface.
type Stretch struct {
	Unpaved bool
	Meters  float64
}

// Route is a generated route: its geometry and its measures, in metres.
type Route struct {
	Points     []Position
	Distance   float64
	Ascent     float64
	Descent    float64
	TrailShare float64   // share of the distance on trails, 0 to 1
	Stretches  []Stretch // the surface along the route, consecutive stretches of one kind merged
}

// LoopRequest asks for loops from Start. Distance is the target length in metres and Ascent the
// target elevation gain in metres (0 for none). The same Seed always yields the same loops.
type LoopRequest struct {
	Start      Point
	Distance   float64
	Ascent     float64
	Candidates int
	Seed       uint64
	// Enough, when set, is called with the loops found so far after each new one, one call at a time
	// and without retaining the slice. Returning true ends the search: the loops still being
	// searched are dropped, so a caller that has what it needs spares the CPU.
	Enough func(found []*Route) bool
}

// Open maps a graph file, and its landmark file when landmarksPath is not empty, for the named
// activity profile. The landmarks must have been built for the same profile.
func Open(graphPath, landmarksPath, profile string) (*Engine, error) {
	engines, err := OpenAll(graphPath, map[string]string{profile: landmarksPath})
	if err != nil {
		return nil, err
	}
	return engines[profile], nil
}

// OpenAll maps a graph file once and returns an engine per activity profile, keyed by name. The
// value is the profile's landmark file, or empty for none. Engines share the graph and its index.
func OpenAll(graphPath string, landmarks map[string]string) (map[string]*Engine, error) {
	g, err := openGraph(graphPath, true)
	if err != nil {
		return nil, err
	}
	sp := newSpatial(g)
	engines := make(map[string]*Engine, len(landmarks))
	for name, path := range landmarks {
		p := profiles[name]
		if p == nil {
			return nil, fmt.Errorf("engine: unknown profile %q", name)
		}
		e := &Engine{g: g, sp: sp, prof: p, minMult: p.minMult()}
		for k := range e.mult {
			for s := range e.mult[k] {
				e.mult[k][s] = p.Kind[k] * p.Surf[s]
			}
		}
		if path != "" {
			if e.alt, err = openLandmarks(path, g, true); err != nil {
				return nil, err
			}
		}
		engines[name] = e
	}
	return engines, nil
}

// Names of the files a data directory holds: the graph, and for each activity its landmarks.
const GraphFileName = "graph.bin"

// LandmarksFileName is the name of an activity's landmark file in a data directory.
func LandmarksFileName(activity string) string { return activity + ".alt" }

// OpenDir opens the engines of the activities from a data directory: its graph, and the landmarks
// of each activity when the directory holds them (a search is slower without).
func OpenDir(dir string, activities ...string) (map[string]*Engine, error) {
	landmarks := make(map[string]string, len(activities))
	for _, activity := range activities {
		path := filepath.Join(dir, LandmarksFileName(activity))
		if _, err := os.Stat(path); err == nil {
			landmarks[activity] = path
		} else if errors.Is(err, fs.ErrNotExist) {
			landmarks[activity] = ""
		} else {
			return nil, err
		}
	}
	engines, err := OpenAll(filepath.Join(dir, GraphFileName), landmarks)
	if err != nil {
		return nil, fmt.Errorf("engine: opening the data in %s: %w", dir, err)
	}
	return engines, nil
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
	return e.describe(r.nodes, r.edges), nil
}

// Loops generates req.Candidates loops that differ by their waypoints, each close to the target
// distance, in no particular order. When ctx ends first it returns the loops finished so far,
// possibly none, with ctx's error: the caller decides whether they are enough.
func (e *Engine) Loops(ctx context.Context, req LoopRequest) ([]*Route, error) {
	if req.Distance <= 0 || req.Candidates <= 0 {
		return nil, errors.New("engine: loops need a positive distance and candidate count")
	}
	start, d, ok := e.sp.nearest(e.g, req.Start.Lat, req.Start.Lon)
	if !ok || d > maxSnapMeters {
		return nil, ErrOffGraph
	}
	// Loops are described as they are found, for Enough, which sees the finished form.
	var loops []*Route
	var enough func([]*loopResult) bool
	if req.Enough != nil {
		enough = func(found []*loopResult) bool {
			for len(loops) < len(found) {
				l := found[len(loops)]
				loops = append(loops, e.describe(l.nodes, l.edges))
			}
			return req.Enough(loops)
		}
	}
	found, failure := generate(ctx, e, e.sp, &loopParams{
		distM: req.Distance, ascentM: req.Ascent, candidates: req.Candidates, seed: req.Seed,
	}, start, enough)
	if failure != nil {
		return nil, failure
	}
	for len(loops) < len(found) {
		l := found[len(loops)]
		loops = append(loops, e.describe(l.nodes, l.edges))
	}
	if err := ctx.Err(); err != nil {
		return loops, err
	}
	if len(loops) == 0 {
		return nil, ErrNoLoop
	}
	return loops, nil
}

// describe measures a path of nodes joined by edges.
func (e *Engine) describe(nodes, edges []uint32) *Route {
	dist, trail, _ := measure(e.g, nodes, edges)
	r := &Route{
		Points:    make([]Position, len(nodes)),
		Distance:  dist,
		Ascent:    ascent(e.g, nodes),
		Descent:   descent(e.g, nodes),
		Stretches: e.stretches(edges),
	}
	if dist > 0 {
		r.TrailShare = trail / dist
	}
	for i, n := range nodes {
		nd := e.g.nodes[n]
		r.Points[i] = Position{Point{float64(nd.Lat) * 1e-7, float64(nd.Lon) * 1e-7}, float64(nd.Elev) * 0.1}
	}
	return r
}

// isUnpaved tells whether a way is unpaved, from its surface group, or from its kind when the
// surface is unknown.
func isUnpaved(kind, surf uint8) bool {
	if surf == SurfaceUnknown {
		return kind == KindPath || kind == KindTrack || kind == KindBridleway
	}
	return surf == SurfaceCompact || surf == SurfaceRough
}

func (e *Engine) stretches(edges []uint32) []Stretch {
	var out []Stretch
	for _, id := range edges {
		ed := e.g.edges[id]
		unpaved := isUnpaved(ed.Kind, ed.Surf)
		if n := len(out); n > 0 && out[n-1].Unpaved == unpaved {
			out[n-1].Meters += float64(ed.Len)
		} else {
			out = append(out, Stretch{unpaved, float64(ed.Len)})
		}
	}
	return out
}
