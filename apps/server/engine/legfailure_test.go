package engine

import (
	"context"
	"testing"
)

// uShape adds a path going north, one step east and back south, so that its two ends are one step apart
// while the only way between them is long. It returns the nodes of both ends.
func uShape(g *testGraph, steps int) (a, b int) {
	prev := g.addNode(0, 0, 100)
	a = prev
	for i := 1; i <= steps; i++ {
		n := g.addNode(float64(i)*stepM, 0, 100)
		g.connect(prev, n, KindPath)
		prev = n
	}
	top := g.addNode(float64(steps)*stepM, stepM, 100)
	g.connect(prev, top, KindPath)
	prev = top
	for i := steps - 1; i >= 0; i-- {
		n := g.addNode(float64(i)*stepM, stepM, 100)
		g.connect(prev, n, KindPath)
		prev = n
	}
	return a, prev
}

func TestAFailedLegIsNamedByItsCause(t *testing.T) {
	cases := []struct {
		name   string
		build  func(g *testGraph) []uint32
		lim    searchLimits
		cancel bool
		want   LegCause
	}{
		{"a target on an island", func(g *testGraph) []uint32 {
			at := g.grid(5, 5, flat)
			far := g.addNode(5_000, 0, 100)
			g.connect(far, g.addNode(5_100, 0, 100), KindPath)
			return []uint32{uint32(at(0, 0)), uint32(far)}
		}, searchLimits{}, false, CauseDisconnected},
		{"ends only a long way apart", func(g *testGraph) []uint32 {
			a, b := uShape(g, 150)
			return []uint32{uint32(a), uint32(b)}
		}, searchLimits{}, false, CauseCutoff},
		{"a search that settles too many nodes", func(g *testGraph) []uint32 {
			at := g.grid(30, 30, flat)
			return []uint32{uint32(at(0, 0)), uint32(at(29, 29))}
		}, searchLimits{maxSettled: 10}, false, CauseSettleCap},
		{"the way back over the way out", func(g *testGraph) []uint32 {
			a, b := uShape(g, 25)
			return []uint32{uint32(a), uint32(b), uint32(a)}
		}, searchLimits{}, false, CauseAvoid},
		{"two points on one node", func(g *testGraph) []uint32 {
			at := g.grid(3, 3, flat)
			return []uint32{uint32(at(0, 0)), uint32(at(1, 1)), uint32(at(1, 1))}
		}, searchLimits{}, false, CauseSameNode},
		{"a search that was cancelled", func(g *testGraph) []uint32 {
			at := g.grid(30, 30, flat)
			return []uint32{uint32(at(0, 0)), uint32(at(29, 29))}
		}, searchLimits{}, true, CauseCanceled},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Arrange
			g := &testGraph{}
			points := tc.build(g)
			e := openTest(t, g, false)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.cancel {
				cancel()
			}
			// Act
			nodes, _, got := chainLegs(ctx, e, newSearcher(), 0, tc.lim, true, points)
			// Assert
			if got != tc.want {
				t.Errorf("cause = %v, want %v", got, tc.want)
			}
			if nodes != nil {
				t.Errorf("a failed chain returned %d nodes", len(nodes))
			}
		})
	}
}

func TestAChainThatSucceedsHasNoCause(t *testing.T) {
	// Arrange
	g := &testGraph{}
	at := g.grid(5, 5, flat)
	e := openTest(t, g, false)
	// Act
	nodes, edges, got := chainLegs(context.Background(), e, newSearcher(), 0, searchLimits{}, true, []uint32{uint32(at(0, 0)), uint32(at(4, 4)), uint32(at(0, 4))})
	// Assert
	if got != CauseNone || len(nodes) == 0 || len(edges) != len(nodes)-1 {
		t.Errorf("cause = %v with %d nodes and %d edges", got, len(nodes), len(edges))
	}
}

func TestWithoutDiagnosisAFailedLegKeepsTheCheapestName(t *testing.T) {
	// Arrange
	g := &testGraph{}
	a, b := uShape(g, 25)
	e := openTest(t, g, false)
	// Act
	_, _, got := chainLegs(context.Background(), e, newSearcher(), 0, searchLimits{}, false, []uint32{uint32(a), uint32(b), uint32(a)})
	// Assert
	if got != CauseCutoff {
		t.Errorf("cause = %v, want the search's own stop, %v: the rerun that names the avoid set is for the harness", got, CauseCutoff)
	}
}

func TestStatsCountLostCandidatesAndCutRefinementsApart(t *testing.T) {
	// Arrange
	var s LoopStats
	// Act
	s.record(CauseDisconnected, true)
	s.record(CauseDisconnected, true)
	s.record(CauseCutoff, false)
	s.record(CauseCanceled, true)
	s.record(CauseNone, true)
	// Assert
	if got := s.Lost[CauseDisconnected].Load(); got != 2 {
		t.Errorf("lost to a disconnected leg = %d, want 2", got)
	}
	if got := s.Cut[CauseCutoff].Load(); got != 1 {
		t.Errorf("refinements cut by the cutoff = %d, want 1", got)
	}
	if s.Lost[CauseCanceled].Load()+s.Lost[CauseNone].Load() != 0 {
		t.Error("a cancellation or a success was counted as a failure")
	}
}

func TestLoopsStartedOnAnIslandAreAllLostAndCounted(t *testing.T) {
	// Arrange
	g := &testGraph{}
	g.grid(21, 21, flat)
	island := g.addNode(1_000, -300, 100) // the control points fall on the grid, which the island does not reach
	g.connect(island, g.addNode(1_100, -300, 100), KindPath)
	e := openTest(t, g, false)
	var stats LoopStats
	req := LoopRequest{Start: pointOf(g, island), Distance: 3000, Candidates: 12, Seed: 7, Stats: &stats}
	// Act
	loops, err := e.Loops(context.Background(), req)
	// Assert
	if err != ErrNoLoop || loops != nil {
		t.Fatalf("loops = %v, err = %v, want ErrNoLoop", loops, err)
	}
	var lost int64
	for c := range stats.Lost {
		lost += stats.Lost[c].Load()
	}
	if lost != 12 {
		t.Errorf("%d candidates counted as lost, want all 12", lost)
	}
	if stats.Lost[CauseDisconnected].Load() == 0 {
		t.Error("no candidate was lost to a disconnected leg")
	}
}
