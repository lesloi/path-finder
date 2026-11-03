package engine

import (
	"context"
	"math"
)

// The lollipop source reaches high ground farther than a circle around the start can: a stem from the start to the
// foot of a cluster, a local loop there, and the stem back. It is the shape of a run from a town to the hills, and
// it runs only when the circles and the summit source still miss a numeric gain.
const (
	lollipopHubs       = 4     // clusters tried at most
	lollipopHubSep     = 1_500 // metres between two hubs: one ridge is one cluster
	lollipopBaseReach  = 800   // metres around a summit where its foot is looked for
	lollipopLocalMin   = 2_000 // metres under which a local loop is not worth a stem
	lollipopLengthBand = 0.1   // share of the target a lollipop may miss and still stop the search
	lollipopTours      = 3     // lollipops returned at most
)

// lollipopLoops returns up to lollipopTours loops that reach the high ground around a hub by a stem, loop there and
// come back. It returns none when no cluster rises within reach or no stem leaves room for a local loop.
func (e *Engine) lollipopLoops(ctx context.Context, start uint32, lp *loopParams) []*Route {
	reach := math.Min(lp.distM/2-lollipopLocalMin/2, 10_000)
	if reach <= 0 {
		return nil
	}
	hubs := pickHubs(e.g, e.summitAnchors(start, reach, lp.forbidden), lollipopHubSep, lollipopHubs)
	if len(hubs) == 0 {
		return nil
	}
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	lim := searchLimits{summitLegMaxSettled, lp.forbidden}
	var out []*Route
	for _, hub := range hubs {
		if ctx.Err() != nil {
			return out
		}
		base, ok := e.lowestWithin(hub, lollipopBaseReach, lp.forbidden)
		if !ok {
			continue
		}
		stemOut := s.route(ctx, e, e.prof.UpPerMeter, nil, lim, start, base)
		if stemOut == nil {
			continue
		}
		stemBack := s.route(ctx, e, e.prof.UpPerMeter, nil, lim, base, start)
		if stemBack == nil {
			continue
		}
		stemLen := legLength(e, stemOut) + legLength(e, stemBack)
		localL := lp.distM - stemLen
		if localL < lollipopLocalMin {
			continue
		}
		stemGain := ascent(e.g, stemOut.nodes) + ascent(e.g, stemBack.nodes)
		localA := math.Max(lp.ascentM-stemGain, 0)
		// The local loop aims at its share of the length; a shorter local tour is kept too, and the composed
		// lollipop's own length band decides whether it stops the source.
		localLp := &loopParams{
			distM: localL, ascentM: localA, ascentBand: lp.ascentBand, distanceBand: lp.distanceBand,
			seed: lp.seed, forbidden: lp.forbidden,
		}
		local := e.lollipopLocal(ctx, base, localLp, s)
		if len(local) == 0 {
			continue
		}
		for _, path := range local {
			composed := composeLollipop(
				summitPath{nodes: stemOut.nodes, edges: stemOut.edges},
				path,
				summitPath{nodes: stemBack.nodes, edges: stemBack.edges},
			)
			if composed.nodes == nil {
				continue
			}
			r := e.describe(composed.nodes, composed.edges)
			r.Lollipop = true
			out = append(out, r)
			if lollipopInBand(r, lp) || len(out) >= lollipopTours {
				return out
			}
		}
	}
	if len(out) > lollipopTours {
		out = out[:lollipopTours]
	}
	return out
}

// lollipopLocal is the loop at the foot of the cluster: the cheap circle first, then the summit source when the
// circle cannot reach the local gain. The circle is kept with the summit tours: a shorter, hillier local tour and a
// longer, lower one are both worth ranking against the whole lollipop.
func (e *Engine) lollipopLocal(ctx context.Context, base uint32, lp *loopParams, s *searcher) []summitPath {
	if heading, ok := e.terrainHeading(base, math.Min(2*loopRadius(lp.extra()), headingReachMax), lp.forbidden); ok {
		lp.heading, lp.hasHeading = heading, true
	}
	var out []summitPath
	inBand := false
	if r, _ := candidateLoop(ctx, e, e.sp, s, lp, base, 0); r != nil {
		out = append(out, summitPath{nodes: r.nodes, edges: r.edges})
		inBand = withinGain(r.ascent, lp.ascentM, lp.ascentBand)
	}
	if !inBand {
		out = append(out, e.summitPaths(ctx, base, lp)...)
	}
	return append(out, e.repairPaths(ctx, out, lp)...)
}

// pickHubs keeps the highest anchors that are far enough apart to be different clusters.
func pickHubs(g *graph, anchors []uint32, minSep float64, max int) []uint32 {
	out := make([]uint32, 0, max)
	for _, a := range anchors {
		keep := true
		na := g.nodes[a]
		for _, b := range out {
			nb := g.nodes[b]
			if straightMetres(
				float64(na.Lat)*1e-7, float64(na.Lon)*1e-7,
				float64(nb.Lat)*1e-7, float64(nb.Lon)*1e-7,
			) < minSep {
				keep = false
				break
			}
		}
		if keep {
			out = append(out, a)
			if len(out) == max {
				break
			}
		}
	}
	return out
}

// lowestWithin is the foot of a summit: the lowest usable node within reach of it, or false when none is lower.
func (e *Engine) lowestWithin(center uint32, reachM float64, f *forbidden) (uint32, bool) {
	c := e.g.nodes[center]
	lat, lon := float64(c.Lat)*1e-7, float64(c.Lon)*1e-7
	cosl := math.Cos(lat * rad)
	best, bestElev, found := center, c.Elev, false
	e.sp.eachNodeWithin(e.g, Point{Lat: lat, Lon: lon}, cosl, reachM, func(n uint32) {
		if !e.nodeUsable(n) || e.g.small[e.mode].has(n) || f.has(n) {
			return
		}
		if z := e.g.nodes[n].Elev; z < bestElev {
			best, bestElev, found = n, z, true
		}
	})
	if !found {
		return 0, false
	}
	return best, true
}

// legLength is the length of a searched leg, in metres.
func legLength(e *Engine, r *route) float64 {
	dist, _, _ := measure(e.g, r.nodes, r.edges)
	return dist
}

// composeLollipop joins the stem out, the local loop and the stem back, dropping the node each shares with the next.
func composeLollipop(stemOut, local, stemBack summitPath) summitPath {
	if len(stemOut.nodes) == 0 || len(local.nodes) < 2 || len(stemBack.nodes) == 0 {
		return summitPath{}
	}
	nodes := make([]uint32, 0, len(stemOut.nodes)+len(local.nodes)+len(stemBack.nodes)-2)
	nodes = append(nodes, stemOut.nodes...)
	nodes = append(nodes, local.nodes[1:]...)
	nodes = append(nodes, stemBack.nodes[1:]...)
	edges := make([]uint32, 0, len(stemOut.edges)+len(local.edges)+len(stemBack.edges))
	edges = append(edges, stemOut.edges...)
	edges = append(edges, local.edges...)
	edges = append(edges, stemBack.edges...)
	if len(edges) != len(nodes)-1 {
		return summitPath{}
	}
	return summitPath{nodes: nodes, edges: edges}
}

// lollipopInBand tells whether a composed lollipop is close enough to stop the source: the distance band is the
// generator's match share, and the gain band is the request's.
func lollipopInBand(r *Route, lp *loopParams) bool {
	if math.Abs(r.Distance-lp.distM) > lollipopLengthBand*lp.distM {
		return false
	}
	return withinGain(r.Ascent, lp.ascentM, lp.ascentBand)
}
