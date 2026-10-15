package engine

import (
	"context"
	"sync/atomic"
)

// LegCause tells why a leg of a loop, or the candidate holding it, could not be routed.
type LegCause uint8

const (
	CauseNone         LegCause = iota
	CauseCanceled              // the search was stopped: not a failure
	CauseSameNode              // two consecutive points fell on one node
	CauseDisconnected          // an end of the leg is on a component that does not reach the other
	CauseCutoff                // the ends are joined, but by a way costing more than a leg is worth
	CauseSettleCap             // the leg needed more nodes than a leg may settle
	CauseAvoid                 // the leg is found once the ways of the earlier legs are allowed
	CauseNoSnap                // no node within reach of a control point (not a leg)
	NumCauses
)

var causeNames = [NumCauses]string{"none", "canceled", "same-node", "disconnected", "cutoff", "settle-cap", "avoid", "no-snap"}

func (c LegCause) String() string { return causeNames[c] }

// LoopStats counts, for a diagnosis, why candidates did not give a loop. A candidate is lost when it
// gave none; a failure after a first loop only cuts its resizing short. It is safe for concurrent use.
type LoopStats struct {
	Lost, Cut [NumCauses]atomic.Int64
}

func (s *LoopStats) record(c LegCause, lost bool) {
	if c == CauseNone || c == CauseCanceled {
		return
	}
	if lost {
		s.Lost[c].Add(1)
	} else {
		s.Cut[c].Add(1)
	}
}

// diagnoseFloodNodes bounds the search for the extent of a component.
const diagnoseFloodNodes = 50_000

// isolated tells whether a walk from one node, bounded to diagnoseFloodNodes nodes, runs out of nodes
// without meeting the other: it has then left a whole component behind.
func isolated(g *graph, from, to uint32) bool {
	seen := map[uint32]struct{}{from: {}}
	queue := []uint32{from}
	for head := 0; head < len(queue); head++ {
		u := queue[head]
		if u == to {
			return false
		}
		for e := g.off[u]; e < g.off[u+1]; e++ {
			v := g.edges[e].To
			if _, ok := seen[v]; ok {
				continue
			}
			if len(seen) >= diagnoseFloodNodes {
				return false
			}
			seen[v] = struct{}{}
			queue = append(queue, v)
		}
	}
	return true
}

// diagnose names a failed leg more exactly than the search can: a search that settles the large side of a
// leg stops on its cutoff just as when the target is on an island, and one that was slowed by the avoid set
// looks like any other.
func diagnose(ctx context.Context, cx *Engine, s *searcher, climb float32, avoid *avoidSet, lim searchLimits, from, to uint32, stop stopReason) LegCause {
	if ctx.Err() != nil {
		return CauseCanceled
	}
	if isolated(cx.g, from, to) || isolated(cx.g, to, from) {
		return CauseDisconnected
	}
	if avoid != nil && s.route(ctx, cx, climb, nil, lim, from, to) != nil {
		return CauseAvoid
	}
	if ctx.Err() != nil {
		return CauseCanceled
	}
	return searchCause(stop)
}

// searchCause is the name a failed search gives itself, with no diagnosis.
func searchCause(stop stopReason) LegCause {
	switch stop {
	case stopCutoff:
		return CauseCutoff
	case stopCap:
		return CauseSettleCap
	case stopCanceled:
		return CauseCanceled
	}
	return CauseDisconnected
}

// smallComponentNodes is the size under which a set of joined ways is too small to hold a loop. At Chamonix
// a control point fell on one for 246 of 2,000 candidates, all of which were then lost; no component
// between 1,000 and 50,000 nodes was hit.
const smallComponentNodes = 1_000

// nodeSet is a set of nodes as a bitmap.
type nodeSet []uint64

func (s nodeSet) has(n uint32) bool { return s[n>>6]&(1<<(n&63)) != 0 }

// smallComponents is the nodes of the connected components of fewer than limit nodes, in a graph that holds a
// component of limit nodes or more.
func smallComponents(g *graph, limit int) nodeSet {
	parent := make([]uint32, g.n)
	for i := range parent {
		parent[i] = uint32(i)
	}
	find := func(x uint32) uint32 {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for u := uint32(0); int(u) < g.n; u++ {
		for e := g.off[u]; e < g.off[u+1]; e++ {
			if v := g.edges[e].To; v > u { // every edge is stored both ways
				if a, b := find(u), find(v); a != b {
					parent[a] = b
				}
			}
		}
	}
	size := make([]uint32, g.n)
	large := false
	for i := range size {
		r := find(uint32(i))
		size[r]++
		large = large || int(size[r]) >= limit
	}
	small := make(nodeSet, (g.n+63)/64)
	// A graph with no component of limit nodes is a small zone, where every component is all there is.
	if !large {
		return small
	}
	for i := range size {
		if int(size[find(uint32(i))]) < limit {
			small[i>>6] |= 1 << (uint(i) & 63)
		}
	}
	return small
}
