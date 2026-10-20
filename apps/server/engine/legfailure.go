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

// smallComponentNodes is the size under which a set of joined ways is too small to hold a loop. In the Mont-Blanc
// valleys a control point fell on one for 246 of 2,000 candidates, all of which were then lost; no component
// between 1,000 and 50,000 nodes was hit.
const smallComponentNodes = 1_000

// nodeSet is a set of nodes as a bitmap.
type nodeSet []uint64

func (s nodeSet) has(n uint32) bool { return s[n>>6]&(1<<(n&63)) != 0 }

// Components are the connected components of a graph as its edges are met, one by one: a build that cannot hold the
// graph in memory joins the nodes of each edge as it writes it.
type Components struct{ parent []uint32 }

// NewComponents starts with every one of n nodes alone.
func NewComponents(n int) *Components {
	c := &Components{parent: make([]uint32, n)}
	for i := range c.parent {
		c.parent[i] = uint32(i)
	}
	return c
}

func (c *Components) find(x uint32) uint32 {
	for c.parent[x] != x {
		c.parent[x] = c.parent[c.parent[x]]
		x = c.parent[x]
	}
	return x
}

// Join joins the components of two nodes.
func (c *Components) Join(a, b uint32) {
	if a, b = c.find(a), c.find(b); a != b {
		c.parent[a] = b
	}
}

// SmallBitmap is the nodes of the components of fewer than limit nodes, as the bitmap of a graph file, in a graph that
// holds a component of limit nodes or more.
func (c *Components) SmallBitmap(limit int) []uint64 {
	n := len(c.parent)
	size := make([]uint32, n)
	large := false
	for i := range size {
		r := c.find(uint32(i))
		size[r]++
		large = large || int(size[r]) >= limit
	}
	small := make([]uint64, (n+63)/64)
	// A graph with no component of limit nodes is a small zone, where every component is all there is.
	if !large {
		return small
	}
	for i := range size {
		if int(size[c.find(uint32(i))]) < limit {
			small[i>>6] |= 1 << (uint(i) & 63)
		}
	}
	return small
}

// smallBitmap is the small components of a graph held in memory: what a graph file stores, and, in the tests, the
// oracle of the one a build streams.
func smallBitmap(n int, off []uint32, edges []edge, limit int) []uint64 {
	c := NewComponents(n)
	for u := uint32(0); int(u) < n; u++ {
		for _, e := range edges[off[u]:off[u+1]] {
			if e.To > u { // every edge is stored both ways
				c.Join(u, e.To)
			}
		}
	}
	return c.SmallBitmap(limit)
}
