package engine

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// accessGraph is a junction with two branches: a both-mode way to a foot node, reached on foot only through a
// foot-only way, and a both-mode way to a bike node, reached by bike only through a bike-only way. Each mode can leave
// the junction but neither reaches the other's end.
func accessGraph() (g *testGraph, footEnd, bikeEnd int) {
	g = &testGraph{}
	junction := g.addNode(0, 0, 100)
	nearFoot := g.addNode(0, stepM, 100)
	g.connect(junction, nearFoot, KindPath)
	footEnd = g.addNode(0, 2*stepM, 100)
	g.connectModes(nearFoot, footEnd, KindFootway, EdgeFoot)
	// A dead end of both modes past each end keeps the node reachable by the other mode's snapping, so that the test
	// measures the edge and not the snap.
	g.connect(footEnd, g.addNode(0, 3*stepM, 100), KindPath)
	nearBike := g.addNode(stepM, 0, 100)
	g.connect(junction, nearBike, KindResidential)
	bikeEnd = g.addNode(2*stepM, 0, 100)
	g.connectModes(nearBike, bikeEnd, KindCycleway, EdgeBike)
	g.connect(bikeEnd, g.addNode(3*stepM, 0, 100), KindPath)
	return g, footEnd, bikeEnd
}

func TestModeNamesRoundTrip(t *testing.T) {
	for _, name := range ModeNames {
		m, ok := ParseMode(name)
		if !ok || m.String() != name || m.Bit() != 1<<m {
			t.Errorf("%q: mode %d, ok %v, bit %d", name, m, ok, m.Bit())
		}
	}
	if _, ok := ParseMode("walk"); ok {
		t.Error("an unknown mode name was read")
	}
	if got := Mode(9).String(); got != "mode(9)" {
		t.Errorf("mode 9 = %q", got)
	}
}

func TestABikeOnlyWayIsNotForFootAndAFootOnlyWayIsNotForBike(t *testing.T) {
	// Arrange
	g, footEnd, bikeEnd := accessGraph()
	path := g.write(t)
	foot, err := Open(path, "", EngineKey{Foot, "any"})
	if err != nil {
		t.Fatal(err)
	}
	bike, err := Open(path, "", EngineKey{Bike, "any"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// Act and Assert: each mode reaches its own end, and neither crosses the other mode's way.
	if _, err := foot.Route(ctx, pointOf(g, 0), pointOf(g, footEnd)); err != nil {
		t.Errorf("a foot route over its own way: %v", err)
	}
	if _, err := bike.Route(ctx, pointOf(g, 0), pointOf(g, footEnd)); !errors.Is(err, ErrNoRoute) {
		t.Errorf("a bike route over a foot-only way: err = %v", err)
	}
	if _, err := bike.Route(ctx, pointOf(g, 0), pointOf(g, bikeEnd)); err != nil {
		t.Errorf("a bike route over its own way: %v", err)
	}
	if _, err := foot.Route(ctx, pointOf(g, 0), pointOf(g, bikeEnd)); !errors.Is(err, ErrNoRoute) {
		t.Errorf("a foot route over a bike-only way: err = %v", err)
	}
}

func TestTheBikeDirectionOfAOnewayIsStoredAndNotReadYet(t *testing.T) {
	// Arrange: a oneway whose reverse edge is closed to bikes in this direction only
	g := &testGraph{}
	for i := 0; i < 3; i++ {
		g.addNode(float64(i)*stepM, 0, 100)
	}
	g.connectModes(0, 1, KindResidential, EdgeFoot|EdgeBike)
	l := g.dist(1, 2)
	g.edges[1] = append(g.edges[1], edge{To: 2, Len: l, Kind: KindResidential, Surf: SurfaceCompact, Modes: EdgeFoot | EdgeBike | EdgeBikeThisWay})
	g.edges[2] = append(g.edges[2], edge{To: 1, Len: l, Kind: KindResidential, Surf: SurfaceCompact, Modes: EdgeFoot | EdgeBike})
	path := g.write(t)
	bike, err := Open(path, "", EngineKey{Bike, "any"})
	if err != nil {
		t.Fatal(err)
	}
	// Act: v1 ignores oneway, so the bike may ride the reverse edge too
	reverse := uint32(0)
	for e := bike.g.off[2]; e < bike.g.off[3]; e++ {
		if bike.g.edges[e].To == 1 {
			reverse = e
		}
	}
	if bike.g.edges[reverse].Modes&EdgeBikeThisWay != 0 {
		t.Fatal("the fixture does not hold a reverse edge closed in this direction")
	}

	// Assert: the direction bit is in the file, and the search does not read it
	if _, err := bike.Route(context.Background(), pointOf(g, 2), pointOf(g, 0)); err != nil {
		t.Errorf("a bike route against a oneway in v1: %v", err)
	}
}

func TestASnapNeverLandsOnANodeTheModeCannotReach(t *testing.T) {
	// Arrange: a both-mode road, and a bike-only node 20 m north of the point, nearer than the road
	g := &testGraph{}
	g.addNode(0, 0, 100)
	g.addNode(0, stepM, 100)
	g.connect(0, 1, KindResidential)
	bikeNode := g.addNode(20, stepM/2, 100)
	g.connectModes(0, bikeNode, KindCycleway, EdgeBike)
	g.connectModes(1, bikeNode, KindCycleway, EdgeBike)
	path := g.write(t)
	foot, err := Open(path, "", EngineKey{Foot, "any"})
	if err != nil {
		t.Fatal(err)
	}
	bike, err := Open(path, "", EngineKey{Bike, "any"})
	if err != nil {
		t.Fatal(err)
	}
	at := pointOf(g, bikeNode)

	// Act
	footNode, err := foot.snapStart(at, nil)
	if err != nil {
		t.Fatal(err)
	}
	bikeNodeAt, err := bike.snapStart(at, nil)
	if err != nil {
		t.Fatal(err)
	}

	// Assert
	if foot.nodeUsable(uint32(bikeNode)) || footNode == uint32(bikeNode) {
		t.Errorf("the foot snap landed on the bike-only node %d", footNode)
	}
	if bikeNodeAt != uint32(bikeNode) {
		t.Errorf("the bike snap landed on node %d, want the bike-only node %d", bikeNodeAt, bikeNode)
	}
}

func TestABikeOnlyConnectorDoesNotMakeAFootIslandLarge(t *testing.T) {
	// Arrange: a large both-mode lattice, an island of five nodes reachable only on foot, and a bike-only way from
	// the island to the lattice. For a bike the island is large; for a foot it stays a component of its own.
	g := &testGraph{}
	at := g.grid(40, 40, flat)
	island := make([]int, 5)
	island[0] = g.addNode(9_000, 0, 100)
	for i := 1; i < len(island); i++ {
		island[i] = g.addNode(9_000, float64(i)*stepM, 100)
		g.connect(island[i-1], island[i], KindPath)
	}
	g.connectModes(island[len(island)-1], at(0, 0), KindCycleway, EdgeBike)
	e, err := Open(g.write(t), "", EngineKey{Foot, "any"})
	if err != nil {
		t.Fatal(err)
	}

	// Act and Assert
	for _, n := range island {
		if !e.g.small[Foot].has(uint32(n)) {
			t.Errorf("foot node %d of the island is not small", n)
		}
		if e.g.small[Bike].has(uint32(n)) {
			t.Errorf("bike node %d of the island is small though the bike way reaches the lattice", n)
		}
	}
}

func TestOpenDirPrefersAProfilesCostsFile(t *testing.T) {
	// Arrange: a graph with the mode's unit file and the costs of one profile
	dir := t.TempDir()
	var b Builder
	for i := 0; i < 4; i++ {
		b.AddNode(45+float64(i)*0.001, 6, 100+float64(i)*10)
	}
	for i := 0; i < 3; i++ {
		b.Connect(i, i+1, KindPath, SurfaceCompact)
	}
	graph := filepath.Join(dir, GraphFileName)
	if err := b.WriteGraph(graph); err != nil {
		t.Fatal(err)
	}
	if err := WriteLandmarks(graph, filepath.Join(dir, LandmarksFileName(Foot)), LandmarkRequest{Mode: Foot, Count: 2}); err != nil {
		t.Fatal(err)
	}
	if err := WriteLandmarks(graph, filepath.Join(dir, LandmarksCostsFileName(Foot, "paved")), LandmarkRequest{Mode: Foot, Profile: "paved", Count: 2}); err != nil {
		t.Fatal(err)
	}

	// Act
	engines, err := OpenDir(dir, footKey("any"), footKey("paved"))

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	if got := engines[footKey("any")].alt; got == nil || got.metric != altMetricUnit {
		t.Errorf("any landmarks: %+v, want the unit file", got)
	}
	if got := engines[footKey("paved")].alt; got == nil || got.metric != altMetricCosts {
		t.Errorf("paved landmarks: %+v, want its costs file", got)
	}
}

func TestOpenAllRefusesAUnitFileSharedByTwoModes(t *testing.T) {
	// Arrange: one foot unit file given to a foot engine and a bike engine
	g, _, _ := accessGraph()
	dir := t.TempDir()
	path := g.write(t)
	alt := filepath.Join(dir, "foot.alt")
	if err := WriteLandmarks(path, alt, LandmarkRequest{Mode: Foot, Count: 2}); err != nil {
		t.Fatal(err)
	}

	// Act
	_, err := OpenAll(path, map[EngineKey]string{
		{Foot, "any"}: alt,
		{Bike, "any"}: alt,
	})

	// Assert
	if err == nil || !strings.Contains(err.Error(), "shared") {
		t.Errorf("err = %v, want a refusal to share the file between modes", err)
	}
}

func TestALandmarkFileWithAnUnknownModeOrUnitIsRefused(t *testing.T) {
	g, _, _ := accessGraph()
	path := g.write(t)
	dir := t.TempDir()
	alt := filepath.Join(dir, "foot.alt")
	if err := WriteLandmarks(path, alt, LandmarkRequest{Mode: Foot, Count: 2}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(alt)
	if err != nil {
		t.Fatal(err)
	}
	write := func(name string, at int, value []byte) string {
		t.Helper()
		b := append([]byte(nil), data...)
		copy(b[at:], value)
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}

	// Act and Assert
	if _, err := Open(path, write("mode.alt", 32, []byte{9, 0, 0, 0}), footKey("any")); err == nil || !strings.Contains(err.Error(), "travel mode") {
		t.Errorf("an unknown mode: err = %v", err)
	}
	if _, err := Open(path, write("unit.alt", 20, []byte{1, 0, 0, 0}), footKey("any")); err == nil || !strings.Contains(err.Error(), "unit") {
		t.Errorf("an unknown unit: err = %v", err)
	}
}

func TestTheLandmarksOfAnotherModeOrMetricAreRefused(t *testing.T) {
	// Arrange
	g, _, _ := accessGraph()
	dir := t.TempDir()
	path := g.write(t)
	unit := filepath.Join(dir, "foot.alt")
	if err := WriteLandmarks(path, unit, LandmarkRequest{Mode: Foot, Count: 4}); err != nil {
		t.Fatal(err)
	}
	costs := filepath.Join(dir, "foot-any.alt")
	if err := WriteLandmarks(path, costs, LandmarkRequest{Mode: Foot, Profile: "any", Count: 4}); err != nil {
		t.Fatal(err)
	}

	// Act and Assert: another mode, another metric's profile, and a profile without its costs file
	if _, err := Open(path, unit, EngineKey{Bike, "any"}); err == nil || !strings.Contains(err.Error(), "mode") {
		t.Errorf("a foot landmark file for a bike: err = %v", err)
	}
	if _, err := Open(path, unit, EngineKey{Foot, "unpaved"}); err != nil {
		t.Errorf("the unit metric serves every profile of its mode: %v", err)
	}
	if _, err := Open(path, costs, EngineKey{Foot, "paved"}); err == nil || !strings.Contains(err.Error(), "profile") {
		t.Errorf("the costs of any for the paved profile: err = %v", err)
	}
	if _, err := Open(path, costs, EngineKey{Foot, "any"}); err != nil {
		t.Errorf("the costs of their own profile: %v", err)
	}
}

func TestTheUnitLandmarksHoldNoClimbAndOneValuePerLandmark(t *testing.T) {
	// Arrange: a graph that climbs
	g := &testGraph{}
	at := g.grid(6, 6, func(x, y int) float64 { return 100 + 20*float64(x) })
	path := g.write(t)
	alt := filepath.Join(t.TempDir(), "foot.alt")
	if err := WriteLandmarks(path, alt, LandmarkRequest{Mode: Foot, Count: 4}); err != nil {
		t.Fatal(err)
	}

	// Act
	e, err := Open(path, alt, EngineKey{Foot, "any"})
	if err != nil {
		t.Fatal(err)
	}

	// Assert
	if e.alt.climb != 0 || e.alt.metric != altMetricUnit || e.alt.rowLen != 4 {
		t.Errorf("unit landmarks: climb %v, metric %d, row length %d", e.alt.climb, e.alt.metric, e.alt.rowLen)
	}
	// The distance between two neighbours is their length, not their length plus the climb.
	row := e.alt.rows[e.alt.rowLen*at(0, 0) : e.alt.rowLen*(at(0, 0)+1)]
	target := e.alt.rows[e.alt.rowLen*at(0, 5) : e.alt.rowLen*(at(0, 5)+1)]
	for i := range row {
		if row[i] == altUnreachable || target[i] == altUnreachable {
			continue
		}
		along := float32(5 * stepM)
		if got := float32(max(int32(target[i])-int32(row[i]), int32(row[i])-int32(target[i]))) * altUnitMeters; got > along+2*altUnitMeters {
			t.Errorf("the unit landmarks count %.0f m over 500 m: they hold more than the length", got)
		}
	}
}

func TestTheBikeLandmarksReachWhereOnlyABikeGoes(t *testing.T) {
	// Arrange: marks on an ellipse around the bounding box, and a graph whose east end only a bike reaches
	g, _, bikeEnd := accessGraph()
	path := g.write(t)
	dir := t.TempDir()
	footAlt := filepath.Join(dir, "foot.alt")
	bikeAlt := filepath.Join(dir, "bike.alt")
	for _, req := range []LandmarkRequest{{Mode: Foot, Count: 2}, {Mode: Bike, Count: 2}} {
		alt := footAlt
		if req.Mode == Bike {
			alt = bikeAlt
		}
		if err := WriteLandmarks(path, alt, req); err != nil {
			t.Fatal(err)
		}
	}
	foot, err := Open(path, footAlt, EngineKey{Foot, "any"})
	if err != nil {
		t.Fatal(err)
	}
	bike, err := Open(path, bikeAlt, EngineKey{Bike, "any"})
	if err != nil {
		t.Fatal(err)
	}

	// Assert: a node only a bike reaches is reachable in the bike file and not in the foot one
	row := func(a *landmarks, n int) []uint16 {
		return a.rows[a.rowLen*n : a.rowLen*(n+1)]
	}
	reaches := func(a *landmarks, n int) bool {
		for _, v := range row(a, n) {
			if v != altUnreachable {
				return true
			}
		}
		return false
	}
	if reaches(foot.alt, bikeEnd) {
		t.Error("the foot landmarks reach a node only a bike way serves")
	}
	if !reaches(bike.alt, bikeEnd) {
		t.Error("the bike landmarks do not reach the bike-only node")
	}
	if _, err := os.Stat(footAlt); err != nil {
		t.Fatal(err)
	}
}
