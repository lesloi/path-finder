package engine

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"slices"
)

// maxSnapMeters is how far a requested point may be from the nearest graph node.
const maxSnapMeters = 400

// maxWaypointSnapMeters is how far a waypoint may be from the nearest graph node: it is moved there.
const maxWaypointSnapMeters = 250

var (
	// ErrOffGraph means a point is too far from any way of the graph.
	ErrOffGraph = errors.New("engine: point is off the graph")
	// ErrNoRoute means no route was found between two points.
	ErrNoRoute = errors.New("engine: no route found")
	// ErrNoLoop means no loop was found from the start point.
	ErrNoLoop = errors.New("engine: no loop found")
)

// WaypointError means a waypoint is too far from any way of the graph. It is an ErrOffGraph.
type WaypointError struct {
	Index int // counted from 1, in the order the waypoints were given
}

func (e *WaypointError) Error() string {
	return fmt.Sprintf("engine: waypoint %d is off the graph", e.Index)
}

func (e *WaypointError) Unwrap() error { return ErrOffGraph }

// Point is a position in degrees.
type Point struct{ Lat, Lon float64 }

// Position is a point of a route with its elevation in metres.
type Position struct {
	Point
	Elevation float64
}

// Stretch is a part of a route on one kind of surface, technical or not.
type Stretch struct {
	Unpaved   bool
	Technical bool
	Meters    float64
}

// Route is a generated route: its geometry and its measures, in metres.
type Route struct {
	Points     []Position
	Distance   float64
	Ascent     float64
	Descent    float64
	TrailShare float64   // share of the distance on trails, 0 to 1
	Stretches  []Stretch // the surface and technical ways along the route, consecutive stretches of one kind merged
	Technical  bool      // the route holds a technical stretch
	// Shortest is the shortest length of a loop through the waypoints the loop search would take, with unit costs and
	// no climb penalty, which DirectLoop also routes: no loop through them can be shorter. It is 0 when that chain
	// could not be measured.
	Shortest float64
	// anchors are the nodes a direct loop went through, waypoints included, the start first and last, and
	// fingerprint is the graph they belong to. Loops reuses the chain of a direct loop this engine built, instead
	// of routing the same waypoints a second time; both stay unset for a loop.
	anchors     []uint32
	fingerprint uint64
}

// AscentBand is a share of the target elevation gain, and a floor in metres for a small target, within which
// a loop is on target. The caller owns what counts as a match, so the engine is told it.
type AscentBand struct{ Share, FloorM float64 }

// SlopeEffort is the curve that weights a stretch of a route by its grade, as contract.json holds it: the effort
// distance is the length times the mean weight. The zero value weighs every stretch the same.
type SlopeEffort struct {
	Decay         float64
	EasiestGrade  float64
	MaxGrade      float64
	StretchMetres float64
}

// EffortTarget makes a loop request aim at a target duration: Metres is the effort distance the duration allows
// (duration / pace), and Slope is the curve that turns a loop's geometry into its effort distance. The search sizes
// and ranks loops on their effort distance instead of their length, so the loop it aims at is the one the ranking
// estimates at that duration.
type EffortTarget struct {
	Metres float64
	Slope  SlopeEffort
}

// LoopRequest asks for loops from Start. Distance is the target length in metres, or the length the first circle of a
// loop without waypoints is sized from when Effort is set, and Ascent the target elevation gain in metres (0 for
// none). The same Seed always yields the same loops.
type LoopRequest struct {
	Start    Point
	Distance float64
	Ascent   float64
	// AscentBand is how far a loop's elevation gain may be from Ascent to count as on target. A loop
	// outside it is steered towards the target; the zero value steers nothing.
	AscentBand AscentBand
	// Effort, when set, makes the search size and score loops on their effort distance rather than their length, so
	// that a target duration lands on the loop the ranking estimates at that duration.
	Effort     *EffortTarget
	Candidates int
	Seed       uint64
	// Waypoints every loop goes through, in this order, between leaving Start and coming back to it. A
	// route may retrace its steps to reach one. At most as many as the caller allows.
	Waypoints []Point
	// Direct, when set, is the loop through Waypoints the caller already found with DirectLoop. The engine reuses
	// its chain when the waypoints snap to the same nodes on the same graph, so that a loop request does not route
	// them twice; otherwise it routes them again.
	Direct *Route
	// Avoided are areas no loop may touch: a way that comes within the radius of a centre is left out of the
	// searches, so that a loop never goes through one.
	Avoided []Circle
	// Enough, when set, is called with the loops found so far after each new one, one call at a time
	// and without retaining the slice. Returning true ends the search: the loops still being
	// searched are dropped, so a caller that has what it needs spares the CPU.
	Enough func(found []*Route) bool
	// Stats, when set, counts why candidates give no loop, for a diagnosis. Finding why costs extra
	// searches, so the product leaves it nil.
	Stats *LoopStats
}

// EngineKey selects an engine of a graph: a travel mode and a surface preference. Several engines of one mode
// share a landmark file; the surface preferences of a mode share one graph.
type EngineKey struct {
	Mode    Mode
	Profile string
}

// Open maps a graph file, and its landmark file when landmarksPath is not empty, for the mode and the
// surface-preference profile. The landmarks must have been built for the same mode, and for that profile when they
// hold its costs.
func Open(graphPath, landmarksPath string, key EngineKey) (*Engine, error) {
	engines, err := OpenAll(graphPath, map[EngineKey]string{key: landmarksPath})
	if err != nil {
		return nil, err
	}
	return engines[key], nil
}

// OpenAll maps a graph file once and returns an engine per key. The value is the key's landmark file, or empty for
// none; engines of one mode that share a file share its mapping. Engines share the graph and its index.
func OpenAll(graphPath string, landmarks map[EngineKey]string) (map[EngineKey]*Engine, error) {
	g, err := openGraph(graphPath)
	if err != nil {
		return nil, err
	}
	return openEngines(g, landmarks)
}

// openEngines builds the engines of a graph that is already mapped, so that a caller that opens several modes of a
// data directory maps its graph once.
func openEngines(g *graph, paths map[EngineKey]string) (map[EngineKey]*Engine, error) {
	engines := make(map[EngineKey]*Engine, len(paths))
	alts := make(map[string]*landmarks, len(paths))
	var err error
	for key, path := range paths {
		p := profiles[key.Profile]
		if p == nil {
			closeEngines(engines, g)
			return nil, fmt.Errorf("engine: unknown profile %q", key.Profile)
		}
		if int(key.Mode) >= int(NumModes) {
			closeEngines(engines, g)
			return nil, fmt.Errorf("engine: unknown travel mode %d", key.Mode)
		}
		e := &Engine{g: g, sp: g.sp, mode: key.Mode, prof: p, minMult: p.minMult()}
		for k := range e.mult {
			for s := range e.mult[k] {
				e.mult[k][s] = p.Kind[k] * p.Surf[s]
			}
		}
		if path != "" {
			if e.alt = alts[path]; e.alt == nil {
				if e.alt, err = openLandmarks(path, g, key); err != nil {
					closeEngines(engines, g)
					return nil, err
				}
				alts[path] = e.alt
			} else if e.alt.metric != altMetricUnit || Mode(e.alt.mode) != key.Mode {
				closeEngines(engines, g)
				return nil, fmt.Errorf("engine: %s is shared by engines of another mode or metric", path)
			}
		}
		engines[key] = e
	}
	return engines, nil
}

// closeEngines unmaps the graph the engines share, once, and the landmark files of each, once. Nothing may search
// after.
func closeEngines(engines map[EngineKey]*Engine, g *graph) {
	seen := make(map[*landmarks]bool, len(engines))
	for _, e := range engines {
		if e.alt != nil && !seen[e.alt] {
			seen[e.alt] = true
			e.alt.file.unmap()
		}
	}
	g.file.unmap()
}

// Names of the files a data directory holds: the graph, and for each mode its landmarks.
const GraphFileName = "graph.bin"

// LandmarksFileName is the name of a mode's landmark file in a data directory: the unit metric, shared by the
// surface preferences of the mode.
func LandmarksFileName(mode Mode) string { return mode.String() + ".alt" }

// LandmarksCostsFileName is the name of the landmark file of one surface preference's costs, when a data directory
// holds one: a fallback for a mode whose unit metric is too slow. It takes precedence over the mode's unit file for
// that profile.
func LandmarksCostsFileName(mode Mode, profile string) string {
	return mode.String() + "-" + profile + ".alt"
}

// landmarkPath finds the landmark file of a key in dir: its profile's costs when the directory holds one, else the
// mode's unit file, else empty (a search runs without landmarks, only slower).
func landmarkPath(dir string, key EngineKey) (string, error) {
	for _, name := range []string{LandmarksCostsFileName(key.Mode, key.Profile), LandmarksFileName(key.Mode)} {
		path := filepath.Join(dir, name)
		_, err := os.Stat(path)
		if err == nil {
			return path, nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", transientError{err}
		}
	}
	return "", nil
}

// OpenDir opens the engines of the keys from a data directory: its graph, and the landmarks of each when the
// directory holds them (a search is slower without).
func OpenDir(dir string, keys ...EngineKey) (map[EngineKey]*Engine, error) {
	landmarks := make(map[EngineKey]string, len(keys))
	for _, key := range keys {
		path, err := landmarkPath(dir, key)
		if err != nil {
			return nil, err
		}
		landmarks[key] = path
	}
	engines, err := OpenAll(filepath.Join(dir, GraphFileName), landmarks)
	if err != nil {
		return nil, fmt.Errorf("engine: opening the data in %s: %w", dir, err)
	}
	return engines, nil
}

// Route finds the cheapest route from one point to another. It returns ctx's error when ctx ends first.
func (e *Engine) Route(ctx context.Context, from, to Point) (*Route, error) {
	src, d, ok := e.sp.nearestWhere(e.g, from.Lat, from.Lon, e.modeSkip(nil), maxSnapMeters)
	if !ok || d > maxSnapMeters {
		return nil, ErrOffGraph
	}
	dst, d, ok := e.sp.nearestWhere(e.g, to.Lat, to.Lon, e.modeSkip(nil), maxSnapMeters)
	if !ok || d > maxSnapMeters {
		return nil, ErrOffGraph
	}
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	r := s.route(ctx, e, e.prof.UpPerMeter, nil, searchLimits{}, src, dst)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if r == nil {
		return nil, ErrNoRoute
	}
	return e.describe(r.nodes, r.edges), nil
}

// Loops generates req.Candidates loops that differ by their control points, each close to the target
// distance, in no particular order. When ctx ends first it returns the loops finished so far,
// possibly none, with ctx's error: the caller decides whether they are enough.
func (e *Engine) Loops(ctx context.Context, req LoopRequest) ([]*Route, error) {
	if req.Distance <= 0 || req.Candidates <= 0 {
		return nil, errors.New("engine: loops need a positive distance and candidate count")
	}
	if req.Effort != nil && req.Effort.Metres <= 0 {
		return nil, errors.New("engine: an effort target needs a positive effort distance")
	}
	forbidden := e.g.forbiddenFor(req.Avoided, e.mode)
	start, err := e.snapLoopStart(req.Start, forbidden)
	if err != nil {
		return nil, err
	}
	anchors, baseM, baseEffort, err := e.anchorLoop(ctx, start, req.Waypoints, forbidden, req.Direct, req.Effort)
	if err != nil {
		return nil, err
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
	lp := &loopParams{
		distM: req.Distance, ascentM: req.Ascent, ascentBand: req.AscentBand, effort: req.Effort,
		candidates: req.Candidates, seed: req.Seed,
		anchors: anchors, baseM: baseM, baseEffort: baseEffort, stats: req.Stats, forbidden: forbidden,
	}
	// A loop with an elevation gain to make heads for the highest ground around the start, rather than a random way.
	if req.Ascent > 0 {
		if heading, ok := e.terrainHeading(start, math.Min(2*loopRadius(lp.extra()), headingReachMax), forbidden); ok {
			lp.heading, lp.hasHeading = heading, true
		}
	}
	found, failure := generate(ctx, e, e.sp, lp, start, enough)
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

// snapWaypoints finds the node of each waypoint, or the *WaypointError of the first one too far from a way.
// With leaveSmall, a waypoint moves off the small components to the nearest node outside them, as no leg
// leads from the rest of the graph to one; with only small components in reach it fails with ErrNoRoute.
func (e *Engine) snapWaypoints(waypoints []Point, leaveSmall bool, f *forbidden) ([]uint32, error) {
	nodes := make([]uint32, len(waypoints))
	for i, w := range waypoints {
		n, d, ok := e.sp.nearestWhere(e.g, w.Lat, w.Lon, e.modeSkip(f), maxWaypointSnapMeters)
		if !ok || d > maxWaypointSnapMeters {
			return nil, &WaypointError{Index: i + 1}
		}
		if leaveSmall && e.g.small[e.mode].has(n) {
			if n, ok = e.nearestLarge(w, maxWaypointSnapMeters, f); !ok {
				return nil, ErrNoRoute
			}
		}
		nodes[i] = n
	}
	return nodes, nil
}

// snapStart finds the node of a start point, or fails with ErrOffGraph.
func (e *Engine) snapStart(p Point, f *forbidden) (uint32, error) {
	n, d, ok := e.sp.nearestWhere(e.g, p.Lat, p.Lon, e.modeSkip(f), maxSnapMeters)
	if !ok || d > maxSnapMeters {
		return 0, ErrOffGraph
	}
	return n, nil
}

// snapLoopStart is snapStart for loops: a start on a small component moves to the nearest node outside the
// small components within the same reach, and fails with ErrNoLoop when there is none, before any search
// spends its budget on legs that cannot reach the rest of the graph.
func (e *Engine) snapLoopStart(p Point, f *forbidden) (uint32, error) {
	n, err := e.snapStart(p, f)
	if err != nil || !e.g.small[e.mode].has(n) {
		return n, err
	}
	if n, ok := e.nearestLarge(p, maxSnapMeters, f); ok {
		return n, nil
	}
	return 0, ErrNoLoop
}

// nearestLarge is the node nearest to p within reachM that is outside the small components.
func (e *Engine) nearestLarge(p Point, reachM float64, f *forbidden) (uint32, bool) {
	small := e.g.small[e.mode]
	skip := e.modeSkip(f)
	n, d, ok := e.sp.nearestWhere(e.g, p.Lat, p.Lon, func(n uint32) bool { return small != nil && small.has(n) || skip(n) }, reachM)
	return n, ok && d <= reachM
}

// snapAnchors finds the node of the start and of each waypoint, the start first and last, without a node twice in a
// row: fewer than two means every waypoint is the start node, and the loop goes nowhere. With leaveSmall the
// waypoints move off the small components (see snapWaypoints).
func (e *Engine) snapAnchors(start uint32, waypoints []Point, leaveSmall bool, f *forbidden) ([]uint32, error) {
	snapped, err := e.snapWaypoints(waypoints, leaveSmall, f)
	if err != nil {
		return nil, err
	}
	return collapse(append(append([]uint32{start}, snapped...), start)), nil
}

// routeChain routes each leg between consecutive anchors, a leg avoiding the ways the earlier ones used.
func (e *Engine) routeChain(ctx context.Context, anchors []uint32, f *forbidden) (nodes, edges []uint32, err error) {
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	nodes, edges, cause := chainLegs(ctx, e, s, e.prof.UpPerMeter, searchLimits{loopLegMaxSettled, f}, false, anchors)
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if cause != CauseNone {
		return nil, nil, ErrNoRoute
	}
	return nodes, edges, nil
}

// routeAnchors routes the cheapest loop from the start node through the waypoints in order and back.
// With leaveSmall the waypoints move off the small components (see snapWaypoints): loops want it, a direct loop
// goes where it is told.
func (e *Engine) routeAnchors(ctx context.Context, start uint32, waypoints []Point, leaveSmall bool, f *forbidden) (anchors, nodes, edges []uint32, err error) {
	anchors, err = e.snapAnchors(start, waypoints, leaveSmall, f)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(anchors) < 2 {
		return anchors, []uint32{start}, nil, nil
	}
	nodes, edges, err = e.routeChain(ctx, anchors, f)
	return anchors, nodes, edges, err
}

// anchorLoop gives the anchors of the loops through the waypoints, the length of the cheapest one and its effort
// distance, or nil anchors when there are no waypoints, or all of them are the start node. When direct is the direct
// loop of the same anchors, its length is the cheapest one, and the waypoints are not routed again.
func (e *Engine) anchorLoop(ctx context.Context, start uint32, waypoints []Point, f *forbidden, direct *Route, effort *EffortTarget) (anchors []uint32, length, baseEffort float64, err error) {
	if len(waypoints) == 0 {
		return nil, 0, 0, nil
	}
	anchors, err = e.snapAnchors(start, waypoints, true, f)
	if err != nil || len(anchors) < 2 {
		return nil, 0, 0, err
	}
	if direct != nil && direct.Distance > 0 && direct.fingerprint == e.g.fingerprint && slices.Equal(direct.anchors, anchors) {
		length = direct.Distance
		baseEffort = length
		if effort != nil {
			baseEffort = length * effortFactorOfPoints(direct.Points, effort.Slope)
		}
		return anchors, length, baseEffort, nil
	}
	nodes, edges, err := e.routeChain(ctx, anchors, f)
	if err != nil {
		return nil, 0, 0, err
	}
	length, _, _ = measure(e.g, nodes, edges)
	baseEffort = length
	if effort != nil {
		baseEffort = length * effortFactor(e.g, nodes, effort.Slope)
	}
	return anchors, length, baseEffort, nil
}

// shortestLoop is the shortest length of a loop through the anchors: unit costs and no climb penalty, so no loop
// through them can be shorter, and it is the lower bound a loop search may rely on. It is zero when the chain cannot
// be routed.
func shortestLoop(ctx context.Context, e *Engine, anchors []uint32, f *forbidden) float64 {
	if len(anchors) < 2 {
		return 0
	}
	// The profile's multipliers are not all 1: the cheapest chain for a preference can be longer than the shortest
	// one, so the bound is searched with every way costing its length.
	unit := *e
	for k := range unit.mult {
		for s := range unit.mult[k] {
			unit.mult[k][s] = 1
		}
	}
	unit.minMult = 1
	unit.alt = nil
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	nodes, edges, cause := chainLegs(ctx, &unit, s, 0, searchLimits{loopLegMaxSettled, f}, false, anchors)
	if cause != CauseNone {
		return 0
	}
	dist, _, _ := measure(e.g, nodes, edges)
	return dist
}

// shortestLoopForLoops is the shortest length of a loop through the waypoints the loop search would take, moving them
// off the small components as it does. It is zero when they cannot be routed, or when the loop's anchors cannot be
// snapped; the search then simply runs.
func (e *Engine) shortestLoopForLoops(ctx context.Context, start Point, waypoints []Point, f *forbidden) float64 {
	loopStart, err := e.snapLoopStart(start, f)
	if err != nil {
		return 0
	}
	anchors, err := e.snapAnchors(loopStart, waypoints, true, f)
	if err != nil || len(anchors) < 2 {
		return 0
	}
	return shortestLoop(ctx, e, anchors, f)
}

// DirectLoopRequest asks for the cheapest loop from Start through the Waypoints in order, keeping out of the
// Avoided areas.
type DirectLoopRequest struct {
	Start     Point
	Waypoints []Point
	Avoided   []Circle
}

// DirectLoop finds the cheapest loop from start through the waypoints in order and back, going back
// over its steps where it must. It fails with ErrOffGraph for a start point off the ways, a
// *WaypointError for a waypoint off them, and ErrNoRoute when they are not joined.
func (e *Engine) DirectLoop(ctx context.Context, req DirectLoopRequest) (*Route, error) {
	forbidden := e.g.forbiddenFor(req.Avoided, e.mode)
	src, err := e.snapStart(req.Start, forbidden)
	if err != nil {
		return nil, err
	}
	anchors, nodes, edges, err := e.routeAnchors(ctx, src, req.Waypoints, false, forbidden)
	if err != nil {
		return nil, err
	}
	r := e.describe(nodes, edges)
	r.anchors, r.fingerprint = anchors, e.g.fingerprint
	r.Shortest = e.shortestLoopForLoops(ctx, req.Start, req.Waypoints, forbidden)
	return r, nil
}

// describe measures a path of nodes joined by edges.
func (e *Engine) describe(nodes, edges []uint32) *Route {
	dist, trail, _ := measure(e.g, nodes, edges)
	r := &Route{
		Points:   make([]Position, len(nodes)),
		Distance: dist,
		Ascent:   ascent(e.g, nodes),
		Descent:  descent(e.g, nodes),
	}
	r.Stretches, r.Technical = e.stretches(edges)
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

// stretches tells the surface along a path of edges, and whether any of them is technical.
func (e *Engine) stretches(edges []uint32) (out []Stretch, technical bool) {
	technicalBit := EdgeTechnical
	if e.mode == Bike {
		technicalBit = EdgeTechnicalBike
	}
	for _, id := range edges {
		ed := e.g.edges[id]
		isTechnical := ed.Flags&technicalBit != 0
		technical = technical || isTechnical
		unpaved := isUnpaved(ed.Kind, ed.Surf)
		if n := len(out); n > 0 && out[n-1].Unpaved == unpaved && out[n-1].Technical == isTechnical {
			out[n-1].Meters += float64(ed.Len)
		} else {
			out = append(out, Stretch{Unpaved: unpaved, Technical: isTechnical, Meters: float64(ed.Len)})
		}
	}
	return out, technical
}
