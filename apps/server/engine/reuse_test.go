package engine

import (
	"context"
	"errors"
	"slices"
	"testing"
)

// TestAnchorLoopReusesTheDirectLoopChain checks that a loop request does not route the waypoints again when the
// caller already found the direct loop through the same nodes.
func TestAnchorLoopReusesTheDirectLoopChain(t *testing.T) {
	// Arrange: a lattice, a waypoint, and the anchors the direct loop went through.
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	start, waypoint := uint32(at(10, 10)), uint32(at(14, 10))
	anchors := []uint32{start, waypoint, start}
	direct := &Route{Distance: 1234, anchors: anchors, fingerprint: e.g.fingerprint}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // A search that ran would stop on the cancelled context.

	// Act
	got, length, err := e.anchorLoop(ctx, start, []Point{pointOf(g, at(14, 10))}, nil, direct)

	// Assert
	if err != nil || length != direct.Distance || !slices.Equal(got, anchors) {
		t.Errorf("anchors = %v, length = %v, err = %v: want %v and %v without searching", got, length, err, anchors, direct.Distance)
	}
}

// TestAnchorLoopRoutesAgainWhenTheDirectChainIsNotReusable checks that a direct loop of another chain, or of another
// graph, does not lend its length to the loops.
func TestAnchorLoopRoutesAgainWhenTheDirectChainIsNotReusable(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	start := uint32(at(10, 10))
	waypoint := pointOf(g, at(14, 10))
	anchors := []uint32{start, uint32(at(14, 10)), start}
	cases := map[string]*Route{
		"other anchors":     {Distance: 1234, anchors: []uint32{0, 1, 0}, fingerprint: e.g.fingerprint},
		"other graph":       {Distance: 1234, anchors: anchors, fingerprint: e.g.fingerprint + 1},
		"no anchors at all": {Distance: 1234, fingerprint: e.g.fingerprint},
		"no length at all":  {anchors: anchors, fingerprint: e.g.fingerprint},
	}
	for name, direct := range cases {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			_, _, err := e.anchorLoop(ctx, start, []Point{waypoint}, nil, direct)
			if !errors.Is(err, context.Canceled) {
				t.Errorf("err = %v, want the routing to start and stop on the cancelled context", err)
			}
		})
	}
}

// TestLoopPointsDropRepeatedPoints checks the control points a loop is built from: a point that falls on the node
// before it, such as the start, must not make the candidate fail as two legs on one node.
func TestLoopPointsDropRepeatedPoints(t *testing.T) {
	// Without waypoints, the start is repeated at both ends.
	if got := loopPoints(7, []uint32{8, 8, 7}, nil, nil); !slices.Equal(got, []uint32{7, 8, 7}) {
		t.Errorf("loop points = %v, want 7, 8, 7", got)
	}
	if got := loopPoints(7, []uint32{7, 7}, nil, nil); !slices.Equal(got, []uint32{7}) {
		t.Errorf("loop points = %v, want the start alone", got)
	}
	// With waypoints, a control point that falls on an anchor is dropped as well.
	xy := func(n uint32) (float64, float64) { return float64(n) * 100, 0 }
	if got := loopPoints(1, []uint32{2}, []uint32{1, 2, 1}, xy); !slices.Equal(got, []uint32{1, 2, 1}) {
		t.Errorf("loop points = %v, want 1, 2, 1", got)
	}
}
