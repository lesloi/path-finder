package engine

import (
	"context"
	"math"
)

// A route with an end point detours like a loop does, but its control points sit on an arc that bulges to one side of
// one leg of the chain from the start through the waypoints to the end, not on a circle through the start: the way
// between the fixed points is the direct path, and the arc only makes up what it lacks of the target.

// pathTortuosity is how much longer than its straight line a way is, as loopRadius's 1.3 says it of a loop: the
// arc's first height is sized with it, and the resizings correct what it gets wrong.
const pathTortuosity = 1.3

// snapPathEnd finds the node of an end point, moved off the small components as the loop search's start is: no leg
// leads from the rest of the graph to one. It fails with ErrEndOffGraph for a point off the ways, and with ErrNoRoute
// when only small components are in reach.
func (e *Engine) snapPathEnd(p Point, f *forbidden) (uint32, error) {
	n, d, ok := e.sp.nearestWhere(e.g, p.Lat, p.Lon, e.modeSkip(f), maxSnapMeters)
	if !ok || d > maxSnapMeters {
		return 0, ErrEndOffGraph
	}
	if e.g.small[e.mode].has(n) {
		if n, ok = e.nearestLarge(p, maxSnapMeters, f); !ok {
			return 0, ErrNoRoute
		}
	}
	return n, nil
}

// anchorPath gives the anchors of the routes to an end point (the start node, the waypoints, the end node), the length
// of the cheapest one and its effort distance. It fails with ErrNoLoop when the start and the end are the same node:
// there is nothing to detour from.
func (e *Engine) anchorPath(ctx context.Context, start uint32, waypoints []Point, end Point, f *forbidden, direct *Route, effort *EffortTarget) (anchors []uint32, length, baseEffort float64, err error) {
	snapped, err := e.snapWaypoints(waypoints, true, f)
	if err != nil {
		return nil, 0, 0, err
	}
	endNode, err := e.snapPathEnd(end, f)
	if err != nil {
		return nil, 0, 0, err
	}
	anchors = collapse(append(append([]uint32{start}, snapped...), endNode))
	if len(anchors) < 2 {
		return nil, 0, 0, ErrNoLoop
	}
	length, baseEffort, err = e.measureAnchors(ctx, anchors, f, direct, effort)
	return anchors, length, baseEffort, err
}

// pathLeg picks the leg of the chain a candidate detours from, by chance and by length: the longer a leg, the more
// room it has for an arc. u is in [0, 1).
func pathLeg(anchors []uint32, xy func(uint32) (x, y float64), u float64) int {
	lengths := make([]float64, len(anchors)-1)
	var total float64
	for i := range lengths {
		ax, ay := xy(anchors[i])
		bx, by := xy(anchors[i+1])
		lengths[i] = math.Hypot(bx-ax, by-ay)
		total += lengths[i]
	}
	target := u * total
	for i, l := range lengths {
		if target < l {
			return i
		}
		target -= l
	}
	return len(lengths) - 1
}

// pathHeight is the height of an arc over a leg of the given straight length that adds about extraM to the route.
func pathHeight(chord, extraM float64) float64 {
	longer := chord + extraM/pathTortuosity
	return 0.5 * math.Sqrt(math.Max(longer*longer-chord*chord, 0))
}

// bulgePoints puts one control point per jitter value on an arc over the leg from a to b (metres east and north of the
// start), bulging to the side given by sign, h high in the middle. It fails when a point falls where no way is within
// reach. Like circlePoints, it moves a point up or down by lift.
func bulgePoints(g *graph, sp *spatial, slat, slon float64, a, b [2]float64, h, sign float64, jitter []float64, lift float64, f *forbidden, mode Mode) ([]uint32, bool) {
	cosl := math.Cos(slat * rad)
	dx, dy := b[0]-a[0], b[1]-a[1]
	chord := math.Hypot(dx, dy)
	if chord == 0 {
		return nil, false
	}
	px, py := -dy/chord, dx/chord
	nodes := make([]uint32, 0, len(jitter))
	small, modes := g.small[mode], g.nodeModes[mode]
	reach := snapReach(h)
	skip := func(n uint32) bool { return !modes.has(n) || small.has(n) || !f.hasRoom(n) }
	for j := range jitter {
		t := float64(j+1) / float64(len(jitter)+1)
		off := sign * h * math.Sin(math.Pi*t) * jitter[j]
		x, y := a[0]+t*dx+off*px, a[1]+t*dy+off*py
		n, d, ok := sp.nearestWhere(g, slat+y/metersPerDegree, slon+x/(metersPerDegree*cosl), skip, reach)
		if !ok || d > reach {
			return nil, false
		}
		nodes = append(nodes, liftedNode(g, sp, n, math.Abs(lift)*liftReach*h, lift, f, mode))
	}
	return nodes, true
}

// pathPoints is the chain a route to an end point is routed through: the anchors, with the control points in the leg
// they bulge from, and a point that repeats the one before it dropped. A chain with no control point left is no
// detour.
func pathPoints(anchors []uint32, leg int, control []uint32) []uint32 {
	out := append([]uint32{}, anchors[:leg+1]...)
	out = append(out, collapse(control)...)
	out = append(out, anchors[leg+1:]...)
	return collapse(out)
}
