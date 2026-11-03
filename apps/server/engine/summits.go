package engine

import (
	"context"
	"math"
	"sort"
)

// The summit source answers a gain target that the circle loops leave short: a loop through the high ground
// around the start can chain more climbs than the 2 to 4 control points of a circle. The anchors are the highest
// usable nodes of a sector-and-ring grid, the legs are the cheapest paths between them, and a beam picks the tour
// whose length and gain are closest to the target. It adds candidates; the caller still ranks and classifies them.
const (
	summitAnchors   = 9    // anchors a tour may visit, the start excluded
	summitSectors   = 12   // directions the anchors are spread over
	summitRings     = 2    // rings around the start: the inner half of the reach, and the outer one
	summitMinClimb  = 10.0 // metres above the start below which a node is not a summit
	summitBeamWidth = 40   // states kept at each depth
	summitTours     = 3    // tours returned
	// summitLegMaxSettled caps the nodes one leg may settle: a longer leg is a detour, not a leg between two
	// summits, and a closure of many such legs would eat the request's time budget.
	summitLegMaxSettled = 60_000
	summitLengthSlack   = 1.4 // a tour longer than this share of the target is not built
	summitCloseMin      = 0.7 // a tour shorter than this share of the target is not closed
)

// summitLeg is the cheapest path between two anchors, in the measures the beam compares.
type summitLeg struct {
	length, gain float64
	ok           bool
}

// circlesMetGain tells whether one of the loops the circles found is within the ascent band of the target. A
// zero band accepts only the exact target: the caller that wants a tolerance sets one, as the generator does.
func circlesMetGain(found []*loopResult, ascent float64, band AscentBand) bool {
	if ascent <= 0 {
		return true
	}
	bound := math.Max(band.Share*ascent, band.FloorM)
	for _, l := range found {
		if math.Abs(l.ascent-ascent) <= bound {
			return true
		}
	}
	return false
}

// summitWanted tells whether the summit source may add loops: a numeric gain the circles did not meet, on a plain
// length-and-gain request. Waypoints and effort targets keep their own shape and ranking; the source would ignore
// them, so it stays out of those requests.
func summitWanted(req LoopRequest, found []*loopResult) bool {
	return req.Ascent > 0 && len(req.Waypoints) == 0 && req.Effort == nil &&
		!circlesMetGain(found, req.Ascent, req.AscentBand)
}

// summitLoops returns up to summitTours loops through the high ground around start, for a gain target the circle
// loops did not meet. It returns none when no usable summit rises summitMinClimb above the start within reach.
func (e *Engine) summitLoops(ctx context.Context, start uint32, lp *loopParams) []*Route {
	reach := math.Min(lp.distM/4, 8_000)
	anchors := e.summitAnchors(start, reach, lp.forbidden)
	if len(anchors) == 0 {
		return nil
	}
	legs, ok := e.summitClosure(ctx, start, anchors, lp.forbidden)
	if !ok || ctx.Err() != nil {
		return nil
	}
	tours := summitBeam(legs, len(anchors), lp.distM, lp.ascentM)
	if len(tours) == 0 {
		return nil
	}
	out := make([]*Route, 0, len(tours))
	for _, tour := range tours {
		if r := e.summitRoute(ctx, start, anchors, tour, lp.forbidden); r != nil {
			out = append(out, r)
		}
	}
	return out
}

// summitAnchors keeps the highest usable node of each sector and ring around the start, then the highest
// summitAnchors of them. A flat grid of cells would put every anchor on one ridge; the sectors keep the hills apart.
func (e *Engine) summitAnchors(start uint32, reachM float64, f *forbidden) []uint32 {
	if reachM <= 0 {
		return nil
	}
	sn := e.g.nodes[start]
	lat, lon := float64(sn.Lat)*1e-7, float64(sn.Lon)*1e-7
	cosl := math.Cos(lat * rad)
	best := make(map[int]uint32, summitRings*summitSectors)
	e.sp.eachNodeWithin(e.g, Point{Lat: lat, Lon: lon}, cosl, reachM, func(n uint32) {
		if n == start || !e.nodeUsable(n) || e.g.small[e.mode].has(n) || f.has(n) {
			return
		}
		nd := e.g.nodes[n]
		if nd.Elev-sn.Elev < int32(summitMinClimb*10) {
			return
		}
		dy := (float64(nd.Lat)*1e-7 - lat) * metersPerDegree
		dx := (float64(nd.Lon)*1e-7 - lon) * metersPerDegree * cosl
		d := math.Hypot(dx, dy)
		if d == 0 {
			return
		}
		sector := int((math.Atan2(dx, dy) + math.Pi) / (2 * math.Pi / summitSectors))
		if sector >= summitSectors {
			sector = summitSectors - 1
		}
		ring := 0
		if d > reachM/2 {
			ring = 1
		}
		key := ring*summitSectors + sector
		if cur, ok := best[key]; !ok || nd.Elev > e.g.nodes[cur].Elev ||
			nd.Elev == e.g.nodes[cur].Elev && n < cur {
			best[key] = n
		}
	})
	if len(best) == 0 {
		return nil
	}
	anchors := make([]uint32, 0, len(best))
	for _, n := range best {
		anchors = append(anchors, n)
	}
	sort.Slice(anchors, func(i, j int) bool {
		zi, zj := e.g.nodes[anchors[i]].Elev, e.g.nodes[anchors[j]].Elev
		if zi != zj {
			return zi > zj
		}
		return anchors[i] < anchors[j]
	})
	if len(anchors) > summitAnchors {
		anchors = anchors[:summitAnchors]
	}
	return anchors
}

// summitClosure routes the leg between every pair of the start and the anchors, and keeps only its measures: the
// chosen tour is routed again, so a beam of many tours does not hold a path per pair.
func (e *Engine) summitClosure(ctx context.Context, start uint32, anchors []uint32, f *forbidden) ([][]summitLeg, bool) {
	n := len(anchors) + 1
	points := make([]uint32, n)
	points[0] = start
	copy(points[1:], anchors)
	legs := make([][]summitLeg, n)
	for i := range legs {
		legs[i] = make([]summitLeg, n)
	}
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	lim := searchLimits{summitLegMaxSettled, f}
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			if i == j {
				continue
			}
			if ctx.Err() != nil {
				return nil, false
			}
			r := s.route(ctx, e, e.prof.UpPerMeter, nil, lim, points[i], points[j])
			if r == nil {
				continue
			}
			dist, _, _ := measure(e.g, r.nodes, r.edges)
			legs[i][j] = summitLeg{length: dist, gain: ascent(e.g, r.nodes), ok: true}
		}
	}
	return legs, true
}

// summitState is one partial tour: the anchor it ends at, the anchors it visited, and the lengths and gains so far.
type summitState struct {
	at      int
	visited uint16
	length  float64
	gain    float64
	path    []int
	score   float64
}

// summitTour is a closed tour: the anchors in order, the sums of its legs, and how close it is to the target.
type summitTour struct {
	path         []int
	length, gain float64
	score        float64
}

// summitBeam walks the anchors in a beam, closing each state to the start, and keeps the best tours by how close
// their length and gain are. It is deterministic: the same legs give the same tours.
func summitBeam(legs [][]summitLeg, k int, distM, ascentM float64) []summitTour {
	if k == 0 || distM <= 0 {
		return nil
	}
	tours := make(map[uint16]summitTour)
	states := []summitState{{at: 0}}
	for depth := 0; depth < k; depth++ {
		var next []summitState
		for _, st := range states {
			for j := 1; j <= k; j++ {
				bit := uint16(1) << (j - 1)
				if st.visited&bit != 0 {
					continue
				}
				leg := legs[st.at][j]
				if !leg.ok {
					continue
				}
				nl, ng := st.length+leg.length, st.gain+leg.gain
				if nl > distM*summitLengthSlack {
					continue
				}
				path := append(append([]int{}, st.path...), j)
				closeLeg := legs[j][0]
				if closeLeg.ok {
					totalL, totalG := nl+closeLeg.length, ng+closeLeg.gain
					if totalL >= distM*summitCloseMin && totalL <= distM*summitLengthSlack {
						visited := st.visited | bit
						score := math.Abs(totalL-distM)/distM + math.Abs(totalG-ascentM)/math.Max(ascentM, 50)
						if old, ok := tours[visited]; !ok || score < old.score {
							tours[visited] = summitTour{path: path, length: totalL, gain: totalG, score: score}
						}
					}
				}
				heuristic := math.Abs(nl-distM)/distM + math.Abs(ng-ascentM)/math.Max(ascentM, 50)
				if closeLeg.ok {
					heuristic = math.Abs(nl+closeLeg.length-distM)/distM +
						math.Abs(ng+closeLeg.gain-ascentM)/math.Max(ascentM, 50)
				}
				next = append(next, summitState{
					at: j, visited: st.visited | bit, length: nl, gain: ng, path: path, score: heuristic,
				})
			}
		}
		if len(next) == 0 {
			break
		}
		sort.SliceStable(next, func(i, j int) bool {
			if next[i].score != next[j].score {
				return next[i].score < next[j].score
			}
			return summitPathLess(next[i].path, next[j].path)
		})
		if len(next) > summitBeamWidth {
			next = next[:summitBeamWidth]
		}
		states = next
	}
	out := make([]summitTour, 0, len(tours))
	for _, tour := range tours {
		out = append(out, tour)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].score != out[j].score {
			return out[i].score < out[j].score
		}
		return summitPathLess(out[i].path, out[j].path)
	})
	if len(out) > summitTours {
		out = out[:summitTours]
	}
	return out
}

// summitPathLess orders tours of the same score by their anchors, so a seed's tours stay the same.
func summitPathLess(a, b []int) bool {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return len(a) < len(b)
}

// summitRoute routes the legs of a tour, start to start, and describes the loop. A leg is routed alone, as in the
// closure: avoiding the earlier legs would make the route longer than the length the beam chose.
func (e *Engine) summitRoute(ctx context.Context, start uint32, anchors []uint32, tour summitTour, f *forbidden) *Route {
	points := make([]uint32, 0, len(tour.path)+2)
	points = append(points, start)
	for _, j := range tour.path {
		points = append(points, anchors[j-1])
	}
	points = append(points, start)
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	lim := searchLimits{summitLegMaxSettled, f}
	var nodes, edges []uint32
	for i := 1; i < len(points); i++ {
		if points[i-1] == points[i] || ctx.Err() != nil {
			return nil
		}
		r := s.route(ctx, e, e.prof.UpPerMeter, nil, lim, points[i-1], points[i])
		if r == nil {
			return nil
		}
		if len(nodes) == 0 {
			nodes = append(nodes, r.nodes...)
		} else {
			nodes = append(nodes, r.nodes[1:]...)
		}
		edges = append(edges, r.edges...)
	}
	if len(nodes) < 2 || len(edges) != len(nodes)-1 {
		return nil
	}
	return e.describe(nodes, edges)
}
