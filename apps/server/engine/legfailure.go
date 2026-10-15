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

// reaches tells whether, within diagnoseFloodNodes nodes, a walk from one node meets the other, and whether
// it ran out of nodes first: a walk that runs out without meeting it has left the whole component behind.
func reaches(g *graph, from, to uint32) (met, exhausted bool) {
	seen := map[uint32]struct{}{from: {}}
	queue := []uint32{from}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		if u == to {
			return true, false
		}
		for e := g.off[u]; e < g.off[u+1]; e++ {
			v := g.edges[e].To
			if _, ok := seen[v]; ok {
				continue
			}
			if len(seen) >= diagnoseFloodNodes {
				return false, false
			}
			seen[v] = struct{}{}
			queue = append(queue, v)
		}
	}
	return false, true
}

// diagnose names a failed leg more exactly than the search can: a search that settles the large side of a
// leg stops on its cutoff just as when the target is on an island, and one that was slowed by the avoid set
// looks like any other.
func diagnose(ctx context.Context, cx *Engine, s *searcher, climb float32, avoid *avoidSet, lim searchLimits, from, to uint32, stop stopReason) LegCause {
	if ctx.Err() != nil || stop == stopCanceled {
		return CauseCanceled
	}
	if _, exhausted := reaches(cx.g, from, to); exhausted {
		return CauseDisconnected
	}
	if _, exhausted := reaches(cx.g, to, from); exhausted {
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
