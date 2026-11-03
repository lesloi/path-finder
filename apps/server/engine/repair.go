package engine

import (
	"context"
	"math"
	"sort"
)

// The repair takes the candidates the sources left short of a gain and detours them through a summit near their
// path, keeping the length inside the match band. It only adds climbs: a route over the band, or already within the
// gain band, is left to the ranking.
const (
	repairCandidates = 5     // paths repaired at most, the largest gain shortfall first
	repairDetours    = 3     // summits one path may be detoured through
	repairReach      = 1_500 // metres around a path sample where a summit is looked for
	repairSeparation = 600   // metres between two summits of the set
	repairSample     = 2_000 // metres along the path between two samples
	repairSummits    = 9     // summits tried at most
)

// repairPaths repairs up to repairCandidates paths whose length is inside the band and whose gain is short, and
// returns the repaired paths beside the originals. It returns none when no length band was given or no path fits.
func (e *Engine) repairPaths(ctx context.Context, paths []summitPath, lp *loopParams) []summitPath {
	if lp.distanceBand <= 0 || lp.ascentM <= 0 || len(paths) == 0 {
		return nil
	}
	type candidate struct {
		path      summitPath
		dist      float64
		gain      float64
		shortfall float64
	}
	var candidates []candidate
	for _, p := range paths {
		if len(p.nodes) < 2 {
			continue
		}
		dist, _, _ := measure(e.g, p.nodes, p.edges)
		if math.Abs(dist-lp.distM) > lp.distanceBand*lp.distM {
			continue
		}
		gain := ascent(e.g, p.nodes)
		if withinGain(gain, lp.ascentM, lp.ascentBand) || gain > lp.ascentM {
			continue
		}
		candidates = append(candidates, candidate{path: p, dist: dist, gain: gain, shortfall: lp.ascentM - gain})
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].shortfall != candidates[j].shortfall {
			return candidates[i].shortfall > candidates[j].shortfall
		}
		return candidates[i].dist < candidates[j].dist
	})
	if len(candidates) > repairCandidates {
		candidates = candidates[:repairCandidates]
	}
	out := make([]summitPath, 0, len(candidates))
	for _, c := range candidates {
		if ctx.Err() != nil {
			return out
		}
		if p := e.repairOne(ctx, c.path, lp); p.nodes != nil {
			out = append(out, p)
		}
	}
	return out
}

// repairOne detours a path through up to repairDetours summits, each time taking the summit that adds the most gain
// while the length stays inside the band. It returns the same path when no detour fits.
func (e *Engine) repairOne(ctx context.Context, path summitPath, lp *loopParams) summitPath {
	s := searcherPool.Get().(*searcher)
	defer searcherPool.Put(s)
	lim := searchLimits{summitLegMaxSettled, lp.forbidden}
	for detour := 0; detour < repairDetours; detour++ {

		gain := ascent(e.g, path.nodes)
		if withinGain(gain, lp.ascentM, lp.ascentBand) {
			break
		}
		bestGain, bestPath := gain, summitPath{}
		for _, summit := range e.repairSummits(path, lp) {
			segment := nearestSegment(e.g, path.nodes, summit)
			if segment < 0 {
				continue
			}
			// The replaced segment is avoided, then the outbound leg too: a detour that re-walks the corridor it
			// replaces adds retrace without a climb, and the ranking would rightly drop it.
			avoid := newAvoidSet()
			avoid.insert(pairKey(path.nodes[segment], path.nodes[segment+1]))
			out := s.route(ctx, e, e.prof.UpPerMeter, avoid, lim, path.nodes[segment], summit)
			if out == nil {
				continue
			}
			for q := 1; q < len(out.nodes); q++ {
				avoid.insert(pairKey(out.nodes[q-1], out.nodes[q]))
			}
			back := s.route(ctx, e, e.prof.UpPerMeter, avoid, lim, summit, path.nodes[segment+1])
			if back == nil {
				continue
			}
			repaired := detourPath(path, segment, out, back)
			if repaired.nodes == nil {
				continue
			}
			length, _, _ := measure(e.g, repaired.nodes, repaired.edges)
			if length > lp.distM*(1+lp.distanceBand) || length < lp.distM*(1-lp.distanceBand) {
				continue
			}
			ascent := ascent(e.g, repaired.nodes)
			if ascent > bestGain {
				bestGain, bestPath = ascent, repaired
			}
		}
		if bestPath.nodes == nil {
			break
		}
		path = bestPath
	}
	return path
}

// repairSummits is the summit set near a path: the high nodes around a sample every repairSample metres, deduplicated
// by repairSeparation, the highest repairSummits of them, leaving out the nodes the path already visits.
func (e *Engine) repairSummits(path summitPath, lp *loopParams) []uint32 {
	onPath := make(map[uint32]struct{}, len(path.nodes))
	for _, n := range path.nodes {
		onPath[n] = struct{}{}
	}
	seen := make(map[uint32]struct{})
	var raw []uint32
	var run, next float64
	for i, n := range path.nodes {
		if i > 0 {
			run += float64(e.g.edges[path.edges[i-1]].Len)
		}
		if i == 0 || run >= next {
			for _, s := range e.summitAnchors(n, repairReach, lp.forbidden) {
				if _, ok := onPath[s]; ok {
					continue
				}
				if _, ok := seen[s]; ok {
					continue
				}
				seen[s] = struct{}{}
				raw = append(raw, s)
			}
			next = run + repairSample
		}
	}
	sort.SliceStable(raw, func(i, j int) bool {
		zi, zj := e.g.nodes[raw[i]].Elev, e.g.nodes[raw[j]].Elev
		if zi != zj {
			return zi > zj
		}
		return raw[i] < raw[j]
	})
	kept := make([]uint32, 0, repairSummits)
	for _, s := range raw {
		far := true
		for _, k := range kept {
			if nodeDistance(e.g, s, k) < repairSeparation {
				far = false
				break
			}
		}
		if far {
			kept = append(kept, s)
			if len(kept) == repairSummits {
				break
			}
		}
	}
	return kept
}

// nearestSegment is the path segment whose first node is nearest to the summit, or -1 for a path too short.
func nearestSegment(g *graph, nodes []uint32, target uint32) int {
	if len(nodes) < 2 {
		return -1
	}
	t := g.nodes[target]
	tLat, tLon := float64(t.Lat)*1e-7, float64(t.Lon)*1e-7
	best, bestDist := -1, math.Inf(1)
	for i := 0; i+1 < len(nodes); i++ {
		a, b := g.nodes[nodes[i]], g.nodes[nodes[i+1]]
		lat := (float64(a.Lat) + float64(b.Lat)) / 2 * 1e-7
		lon := (float64(a.Lon) + float64(b.Lon)) / 2 * 1e-7
		d := straightMetres(lat, lon, tLat, tLon)
		if d < bestDist {
			best, bestDist = i, d
		}
	}
	return best
}

// nodeDistance is the straight distance between two nodes, in metres.
func nodeDistance(g *graph, a, b uint32) float64 {
	na, nb := g.nodes[a], g.nodes[b]
	return straightMetres(
		float64(na.Lat)*1e-7, float64(na.Lon)*1e-7,
		float64(nb.Lat)*1e-7, float64(nb.Lon)*1e-7,
	)
}

// detourPath replaces the segment segment of a path with the two legs through a summit: path[segment] to the summit,
// and the summit to path[segment+1].
func detourPath(path summitPath, segment int, out, back *route) summitPath {
	if segment < 0 || segment+1 >= len(path.nodes) || out == nil || back == nil {
		return summitPath{}
	}
	nodes := make([]uint32, 0, len(path.nodes)+len(out.nodes)+len(back.nodes)-2)
	nodes = append(nodes, path.nodes[:segment+1]...)
	nodes = append(nodes, out.nodes[1:]...)
	nodes = append(nodes, back.nodes[1:]...)
	nodes = append(nodes, path.nodes[segment+2:]...)
	edges := make([]uint32, 0, len(path.edges)+len(out.edges)+len(back.edges)-1)
	edges = append(edges, path.edges[:segment]...)
	edges = append(edges, out.edges...)
	edges = append(edges, back.edges...)
	edges = append(edges, path.edges[segment+1:]...)
	if len(edges) != len(nodes)-1 {
		return summitPath{}
	}
	return summitPath{nodes: nodes, edges: edges}
}
