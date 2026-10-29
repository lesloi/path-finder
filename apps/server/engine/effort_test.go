package engine

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/lesloi/path-finder/apps/server/contract"
)

// testSlope is the slope curve of contract.json, as the generator hands it to the engine.
func testSlope() SlopeEffort {
	s := contract.SlopeEffortOf()
	return SlopeEffort{Decay: s.Decay, EasiestGrade: s.EasiestGrade, MaxGrade: s.MaxGrade, StretchMetres: s.StretchMetres}
}

// geometryOf is a path of nodes as the contract reads it: longitude, latitude and height in metres.
func geometryOf(g *graph, nodes []uint32) [][]float64 {
	out := make([][]float64, len(nodes))
	for i, n := range nodes {
		nd := g.nodes[n]
		out[i] = []float64{float64(nd.Lon) * 1e-7, float64(nd.Lat) * 1e-7, float64(nd.Elev) * 0.1}
	}
	return out
}

// geometryOfPoints is the geometry of a route's positions, as the engine hands it to the contract.
func geometryOfPoints(points []Position) [][]float64 {
	out := make([][]float64, len(points))
	for i, p := range points {
		out[i] = []float64{p.Lon, p.Lat, p.Elevation}
	}
	return out
}

// positionOf is a node as a route reports it.
func positionOf(g *graph, n uint32) Position {
	nd := g.nodes[n]
	return Position{Point{float64(nd.Lat) * 1e-7, float64(nd.Lon) * 1e-7}, float64(nd.Elev) * 0.1}
}

// TestEffortFactorMatchesTheContract checks that the engine weights a path's stretches as the ranking does, so that a
// loop found for a target effort is the one the ranking estimates at that duration.
func TestEffortFactorMatchesTheContract(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(x)*20 })
	e := openTest(t, g, false)
	nodes := make([]uint32, 0, 41)
	for x := 0; x < 41; x++ {
		nodes = append(nodes, uint32(at(x, 0)))
	}

	want := contract.EffortFactor(geometryOf(e.g, nodes))
	got := effortFactor(e.g, nodes, testSlope())

	if math.Abs(got-want) > 1e-9 {
		t.Errorf("effort factor = %.12f, want %.12f", got, want)
	}
}

// TestEffortFactorOfPointsMatchesTheContract checks the same from the positions of a direct loop.
func TestEffortFactorOfPointsMatchesTheContract(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(x)*20 })
	e := openTest(t, g, false)
	nodes := []uint32{uint32(at(0, 0)), uint32(at(10, 0)), uint32(at(20, 0)), uint32(at(30, 0)), uint32(at(40, 0))}
	points := make([]Position, len(nodes))
	for i, n := range nodes {
		points[i] = positionOf(e.g, n)
	}

	want := contract.EffortFactor(geometryOf(e.g, nodes))
	got := effortFactorOfPoints(points, testSlope())

	if math.Abs(got-want) > 1e-9 {
		t.Errorf("effort factor = %.12f, want %.12f", got, want)
	}
}

// TestEffortFactorFollowsTheSharedCases runs the cases the server and the web app share through the engine's mirror,
// so a clamp or a descent that the contract handles cannot drift here unseen.
func TestEffortFactorFollowsTheSharedCases(t *testing.T) {
	data, err := os.ReadFile("../contract/testdata/slope-effort-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string      `json:"name"`
		Geometry [][]float64 `json:"geometry"`
		Factor   float64     `json:"factor"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		if len(tc.Geometry) == 0 || len(tc.Geometry[0]) < 3 {
			continue // the engine always reads heights from its nodes
		}
		t.Run(tc.Name, func(t *testing.T) {
			points := make([]Position, len(tc.Geometry))
			for i, p := range tc.Geometry {
				points[i] = Position{Point: Point{Lat: p[1], Lon: p[0]}, Elevation: p[2]}
			}

			if got := effortFactorOfPoints(points, testSlope()); math.Abs(got-tc.Factor) > 1e-9 {
				t.Errorf("effort factor = %.12f, want %.12f", got, tc.Factor)
			}
		})
	}
}

// TestLoopsAimAtTheEffortDistance checks that a duration target makes the search size its loops on effort, not on
// length: on a slope, a loop of the target duration is shorter than the flat prior.
func TestLoopsAimAtTheEffortDistance(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(x)*20 })
	e := openTest(t, g, false)
	const effort = 10_000.0

	loops, err := e.Loops(context.Background(), LoopRequest{
		Start: pointOf(g, at(20, 20)), Distance: effort, Candidates: 40, Seed: 7,
		Effort: &EffortTarget{Metres: effort, Slope: testSlope()},
	})
	if err != nil {
		t.Fatal(err)
	}
	closest := math.Inf(1)
	for _, l := range loops {
		got := l.Distance * contract.EffortFactor(geometryOfPoints(l.Points))
		closest = math.Min(closest, math.Abs(got-effort))
		if math.Abs(got-effort) <= 0.1*effort {
			return
		}
	}
	t.Errorf("no loop within 10%% of %v m of effort among %d, closest off by %.0f m", effort, len(loops), closest)
}

// TestWaypointLoopsAimAtTheEffortDistance checks the detour of a waypoint loop: it makes up the effort the direct
// chain lacks, not the distance.
func TestWaypointLoopsAimAtTheEffortDistance(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(x)*20 })
	e := openTest(t, g, false)
	const effort = 10_000.0

	loops, err := e.Loops(context.Background(), LoopRequest{
		Start: pointOf(g, at(20, 20)), Distance: effort, Candidates: 40, Seed: 7,
		Waypoints: []Point{pointOf(g, at(28, 20))},
		Effort:    &EffortTarget{Metres: effort, Slope: testSlope()},
	})
	if err != nil {
		t.Fatal(err)
	}
	closest := math.Inf(1)
	for _, l := range loops {
		got := l.Distance * contract.EffortFactor(geometryOfPoints(l.Points))
		closest = math.Min(closest, math.Abs(got-effort))
		if math.Abs(got-effort) <= 0.1*effort {
			return
		}
	}
	t.Errorf("no waypoint loop within 10%% of %v m of effort among %d, closest off by %.0f m", effort, len(loops), closest)
}

// TestLoopsRefuseAnEmptyEffortTarget checks that a duration target without an effort distance is refused before any
// search.
func TestLoopsRefuseAnEmptyEffortTarget(t *testing.T) {
	g := &testGraph{}
	at := g.grid(11, 11, flat)
	e := openTest(t, g, false)
	_, err := e.Loops(context.Background(), LoopRequest{
		Start: pointOf(g, at(5, 5)), Distance: 1000, Candidates: 1, Effort: &EffortTarget{},
	})
	if err == nil {
		t.Error("an effort target of no distance was accepted")
	}
}

// TestAnchorLoopGivesTheDirectLoopsEffort checks that a waypoint loop is sized from the direct loop's effort, not its
// length, when the request has a duration target.
func TestAnchorLoopGivesTheDirectLoopsEffort(t *testing.T) {
	g := &testGraph{}
	at := g.grid(41, 41, func(x, y int) float64 { return 100 + float64(x)*20 })
	e := openTest(t, g, false)
	start, waypoint := uint32(at(20, 20)), uint32(at(30, 20))
	points := []Position{positionOf(e.g, start), positionOf(e.g, waypoint), positionOf(e.g, start)}
	direct := &Route{
		Points: points, Distance: 2000,
		anchors: []uint32{start, waypoint, start}, fingerprint: e.g.fingerprint,
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // A search that ran would stop on the cancelled context.

	_, length, baseEffort, err := e.anchorLoop(ctx, start, []Point{pointOf(g, at(30, 20))}, nil, direct, &EffortTarget{Metres: 10_000, Slope: testSlope()})
	if err != nil || length != direct.Distance {
		t.Fatalf("length = %v, err = %v, want the direct loop's", length, err)
	}
	want := direct.Distance * contract.EffortFactor(geometryOfPoints(points))
	if math.Abs(baseEffort-want) > 1e-9 {
		t.Errorf("base effort = %.6f, want %.6f", baseEffort, want)
	}
}
