package engine

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unsafe"
)

func TestQuantizeRoundsDownAndSaturates(t *testing.T) {
	cases := []struct {
		name string
		in   float32
		want uint16
	}{
		{"zero", 0, 0},
		{"under one unit", altUnitMeters - 0.1, 0},
		{"one unit", altUnitMeters, 1},
		{"unreachable", unreachable, altUnreachable},
		{"the last number of 16 bits", altUnitMeters*altUnreachable - 1, altUnreachable - 1},
		{"one unit too far for 16 bits", altUnitMeters * altUnreachable, altUnreachable},
		{"too far for 16 bits", altUnitMeters * 70_000, altUnreachable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := quantize(tc.in); got != tc.want {
				t.Errorf("quantize(%v) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

func TestLandmarkBoundIsALowerBound(t *testing.T) {
	var target [64]uint16
	t.Run("a metric without climb is symmetric", func(t *testing.T) {
		a := &landmarks{l: 3, unit: 16, rowLen: 3}
		target[0], target[1], target[2] = 4, 50, altUnreachable
		// The best landmark gives |4 - 10| - 1 = 5 units; the second is 50 - 52 = 2 away; the third is unreachable.
		row := []uint16{10, 52, 7}
		if got := a.bound(row, &target); got != 5*16 {
			t.Errorf("bound = %v, want 80", got)
		}
		if got := a.bound([]uint16{4, 50, 7}, &target); got != 0 {
			t.Errorf("bound between equal rows = %v, want 0", got)
		}
	})
	t.Run("a metric with climb has both directions", func(t *testing.T) {
		a := &landmarks{l: 2, climb: 8, unit: 16, rowLen: 4}
		target[0], target[1], target[2], target[3] = 30, altUnreachable, 9, 8
		// Towards the landmarks: 30 - 10 - 1 = 19. From them: 20 - 9 - 1 = 10. The unreachable one is skipped.
		row := []uint16{10, 5, 20, 12}
		if got := a.bound(row, &target); got != 19*16 {
			t.Errorf("bound = %v, want %v", got, 19*16)
		}
	})
}

func TestAvoidSetRemembersEveryKeyAcrossGrowth(t *testing.T) {
	a := newAvoidSet()
	for k := uint64(1); k <= 5000; k++ {
		a.insert(k * 7919)
		a.insert(k * 7919) // inserting twice changes nothing
	}
	if a.n != 5000 {
		t.Fatalf("%d keys, want 5000", a.n)
	}
	for k := uint64(1); k <= 5000; k++ {
		if !a.contains(k * 7919) {
			t.Fatalf("lost key %d", k*7919)
		}
	}
	if a.contains(1) {
		t.Error("contains a key that was never inserted")
	}
}

func TestSearcherGrowKeepsTheEntriesOfTheSearch(t *testing.T) {
	s := newSearcher()
	s.reset()
	keys := []uint32{1, 2, 3, 99, 4096, 1 << 20, math.MaxUint32 - 1}
	for _, k := range keys {
		i := s.find(k)
		s.slots[i] = slot{key: k, epoch: s.epoch, cost: float32(k % 1000)}
		s.used++
	}
	before := len(s.slots)
	s.grow()
	if len(s.slots) != 2*before {
		t.Errorf("table = %d slots, want %d", len(s.slots), 2*before)
	}
	for _, k := range keys {
		if sl := s.slots[s.find(k)]; sl.key != k || sl.cost != float32(k%1000) {
			t.Errorf("entry %d lost by growing: %+v", k, sl)
		}
	}
}

func TestSearcherResetWrapsItsEpoch(t *testing.T) {
	s := newSearcher()
	s.epoch = math.MaxUint32
	s.slots[3] = slot{key: 9, epoch: 5}
	s.reset()
	if s.epoch != 1 || s.slots[3] != (slot{}) {
		t.Errorf("epoch %d, slot %+v: a wrapped epoch must clear the table", s.epoch, s.slots[3])
	}
}

func TestLoopScoreCountsDistanceOverlapAndAscent(t *testing.T) {
	lp := &loopParams{distM: 10_000}
	if got := lp.score(10_000, 0, 500, 0); got != 0 {
		t.Errorf("a loop on target = %v", got)
	}
	if got := lp.score(12_000, 0, 0, 1_200); math.Abs(got-(3*0.2+3*0.1)) > 1e-9 {
		t.Errorf("distance and overlap = %v", got)
	}
	lp.ascentM = 1_000
	if got := lp.score(10_000, 0, 500, 0); math.Abs(got-1) > 1e-9 {
		t.Errorf("half the ascent missing = %v, want 2 * 500/1000", got)
	}
	lp.ascentM = 10 // under the floor of 50 m
	if got := lp.score(10_000, 0, 60, 0); math.Abs(got-2) > 1e-9 {
		t.Errorf("small ascent target = %v, want 2 * 50/50", got)
	}
	// An effort target scores the effort distance, not the length.
	withEffort := &loopParams{distM: 10_000, effort: &EffortTarget{Metres: 10_000}}
	if got := withEffort.score(8_000, 10_000, 0, 0); got != 0 {
		t.Errorf("a loop on effort = %v", got)
	}
	if got := withEffort.score(8_000, 12_000, 0, 0); math.Abs(got-0.6) > 1e-9 {
		t.Errorf("effort off by a fifth = %v, want 3 * 0.2", got)
	}
}

func TestIsUnpavedFollowsTheSurfaceThenTheKind(t *testing.T) {
	cases := []struct {
		kind, surf uint8
		want       bool
	}{
		{KindResidential, SurfacePaved, false},
		{KindResidential, SurfaceCompact, true},
		{KindPath, SurfaceRough, true},
		{KindPath, SurfaceUnknown, true},
		{KindTrack, SurfaceUnknown, true},
		{KindBridleway, SurfaceUnknown, true},
		{KindResidential, SurfaceUnknown, false},
		{KindPrimary, SurfaceUnknown, false},
		{KindTrack, SurfacePaved, false},
	}
	for _, tc := range cases {
		if got := isUnpaved(tc.kind, tc.surf); got != tc.want {
			t.Errorf("isUnpaved(kind %d, surface %d) = %v, want %v", tc.kind, tc.surf, got, tc.want)
		}
	}
}

func TestFileWritersFailOnAnUnwritablePath(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no", "such", "dir", "file")
	if err := writeGraph(missing, nil, []uint32{0}, nil); err == nil {
		t.Error("writeGraph into a missing directory: err = nil")
	}
	if err := writeLandmarks(missing, 1, 0, 0, 8, nil); err == nil {
		t.Error("writeLandmarks into a missing directory: err = nil")
	}
	if got := bytesOf([]uint16(nil)); got != nil {
		t.Errorf("bytesOf(nil) = %v", got)
	}
}

func TestLandmarkCountMustFitASearch(t *testing.T) {
	g := &testGraph{}
	g.grid(4, 4, flat)
	path := g.write(t)
	dir := t.TempDir()
	for _, count := range []int{0, -1, 33, 40} {
		if err := WriteLandmarks(path, filepath.Join(dir, "x.alt"), "any", count); err == nil {
			t.Errorf("%d landmarks: err = nil, but a search keeps %d values per node", count, maxLandmarkValues)
		}
	}
	if err := WriteLandmarks(path, filepath.Join(dir, "ok.alt"), "any", 32); err != nil {
		t.Errorf("32 landmarks fit: %v", err)
	}
}

func TestOpenRefusesFilesThatAreShorterThanTheirHeader(t *testing.T) {
	dir := t.TempDir()
	g := &testGraph{}
	g.grid(6, 6, flat)
	graph := g.write(t)
	alt := filepath.Join(dir, "a.alt")
	if err := WriteLandmarks(graph, alt, "any", 4); err != nil {
		t.Fatal(err)
	}
	truncate := func(from string, size int64) string {
		data, err := os.ReadFile(from)
		if err != nil {
			t.Fatal(err)
		}
		out := filepath.Join(dir, fmt.Sprintf("%s.%d", filepath.Base(from), size))
		if err := os.WriteFile(out, data[:size], 0o644); err != nil {
			t.Fatal(err)
		}
		return out
	}
	info, _ := os.Stat(graph)
	for _, size := range []int64{20, info.Size() / 2, info.Size() - 16} {
		if _, err := Open(truncate(graph, size), "", "any"); err == nil {
			t.Errorf("graph cut to %d of %d bytes: err = nil", size, info.Size())
		}
	}
	info, _ = os.Stat(alt)
	for _, size := range []int64{30, info.Size() - 2} {
		if _, err := Open(graph, truncate(alt, size), "any"); err == nil {
			t.Errorf("landmarks cut to %d of %d bytes: err = nil", size, info.Size())
		}
	}
}

func TestAGraphWithoutEdgesOpensWithoutPanicking(t *testing.T) {
	var b Builder
	b.AddNode(45, 6, 100)
	path := filepath.Join(t.TempDir(), "g.bin")
	if err := b.WriteGraph(path); err != nil {
		t.Fatal(err)
	}
	e, err := Open(path, "", "any")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Route(context.Background(), Point{45, 6}, Point{45, 6}); err == nil {
		t.Log("a route from a node to itself needs no edge")
	}
}

func TestAPanicInAWorkerBecomesAnError(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	req.Enough = func([]*Route) bool { panic("boom") }

	loops, err := e.Loops(context.Background(), req)
	if err == nil || !strings.Contains(err.Error(), "panicked") || loops != nil {
		t.Errorf("loops = %v, err = %v", loops, err)
	}
	// The engine still works afterwards: no lock was left held, no searcher lost.
	req.Enough = nil
	if _, err := e.Loops(context.Background(), req); err != nil {
		t.Errorf("after the panic: %v", err)
	}
}

func TestConcurrentSearchesFollowTheCPUs(t *testing.T) {
	for procs, want := range map[int]int{0: 1, 1: 1, 2: 2, 4: 4, 8: 8, 16: 16} {
		if got := concurrentSearches(procs); got != want {
			t.Errorf("%d CPUs: %d searches, want %d", procs, got, want)
		}
		if got := searchWorkers(procs); got != min(procs, 8) {
			t.Errorf("%d CPUs: %d workers", procs, got)
		}
	}
	if DefaultConcurrentSearches() < 1 {
		t.Error("the default must allow at least one search")
	}
}

func TestRecordsHaveTheSizeTheFileFormatSays(t *testing.T) {
	if got := unsafe.Sizeof(node{}); got != 12 {
		t.Errorf("a node takes %d bytes, the format says 12", got)
	}
	if got := unsafe.Sizeof(edge{}); got != 12 {
		t.Errorf("an edge takes %d bytes, the format says 12", got)
	}
}

func TestRoutesAcrossHighGroundAndBelowSeaLevelAreMeasuredRight(t *testing.T) {
	for name, heights := range map[string][2]float64{
		"a climb past 3276.7 m": {3900, 4100},
		"the top of France":     {4700, 4807.8},
		"a climb below the sea": {-5, 15},
		"across the sea level":  {-2, 18},
	} {
		t.Run(name, func(t *testing.T) {
			var b Builder
			for i := 0; i <= 10; i++ {
				b.AddNode(45+float64(i)*0.001, 6, heights[0]+(heights[1]-heights[0])*float64(i)/10)
			}
			for i := 0; i < 10; i++ {
				b.Connect(i, i+1, KindPath, SurfaceCompact)
			}
			path := filepath.Join(t.TempDir(), "g.bin")
			if err := b.WriteGraph(path); err != nil {
				t.Fatal(err)
			}
			e, err := Open(path, "", "any")
			if err != nil {
				t.Fatal(err)
			}
			r, err := e.Route(context.Background(), Point{45, 6}, Point{45.01, 6})
			if err != nil {
				t.Fatal(err)
			}
			want := heights[1] - heights[0]
			if math.Abs(r.Ascent-want) > 3 || r.Descent > 3 {
				t.Errorf("ascent %.1f m, descent %.1f m, want %.0f m up", r.Ascent, r.Descent, want)
			}
			if got := r.Points[len(r.Points)-1].Elevation; math.Abs(got-heights[1]) > 0.06 {
				t.Errorf("last point at %.1f m, want %.1f", got, heights[1])
			}
		})
	}
}

func TestAGraphOfAnotherVersionIsRefused(t *testing.T) {
	g := &testGraph{}
	g.grid(3, 3, flat)
	path := g.write(t)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	copy(data, "PFGRAPH2") // the version that stored elevations on 16 bits
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path, "", "any"); err == nil || !strings.Contains(err.Error(), "build-graph") {
		t.Errorf("err = %v, want it to say to build the graph again", err)
	}
}

func TestASteepWayUpIsNotRefusedForItsClimb(t *testing.T) {
	g := &testGraph{}
	for i := 0; i <= 10; i++ { // 1 km on the ground, 1,500 m up: about 19,000 equivalent metres for a runner
		g.addNode(float64(i)*100, 0, 500+150*float64(i))
		if i > 0 {
			g.connect(i-1, i, KindPath)
		}
	}
	e, err := Open(g.write(t), "", "paved")
	if err != nil {
		t.Fatal(err)
	}
	r, err := e.Route(context.Background(), pointOf(g, 0), pointOf(g, 10))
	if err != nil {
		t.Fatalf("a steep way up was refused: %v", err)
	}
	near(t, r.Ascent, 1500, 5, "ascent")
}

func TestLandmarksStayALowerBoundWhenTheSearchClimbsLessThanTheyDo(t *testing.T) {
	g := &testGraph{}
	at := g.grid(9, 9, func(x, y int) float64 { return 100 + 40*math.Sin(float64(x)) + 30*math.Cos(float64(y)*1.3) })
	plain, boosted := openTest(t, g, false), openTest(t, g, true) // landmarks built with a climb of 8
	if boosted.alt.climb != 8 {
		t.Fatalf("landmarks climb = %v, want 8", boosted.alt.climb)
	}
	sp, sb := newSearcher(), newSearcher()
	ctx := context.Background()
	for _, climb := range []float32{0, 1, 3, 8, 16} {
		for _, pair := range [][2]int{{at(0, 0), at(8, 8)}, {at(8, 0), at(0, 8)}, {at(4, 0), at(4, 8)}, {at(0, 4), at(8, 4)}} {
			a := sp.route(ctx, plain, climb, nil, searchLimits{}, uint32(pair[0]), uint32(pair[1]))
			b := sb.route(ctx, boosted, climb, nil, searchLimits{}, uint32(pair[0]), uint32(pair[1]))
			if a == nil || b == nil {
				t.Fatalf("climb %v: no route (%v, %v)", climb, a, b)
			}
			if math.Abs(float64(a.cost-b.cost)) > 0.01 {
				t.Errorf("climb %v, %v: cost %v with landmarks, %v without", climb, pair, b.cost, a.cost)
			}
		}
	}
}

func TestHeadersRoundTripAndRefuseAnotherVersion(t *testing.T) {
	graph := graphHead{nodes: 7, edges: 11, fingerprint: 0xDEADBEEFCAFE, bounds: bounds{minLat: -5, minLon: 6, maxLat: 7, maxLon: -8}, smallLimit: 1_000, longMeters: 500, longEdges: 3}
	if got, ok := readGraphHead(graph.encode()); !ok || got != graph {
		t.Errorf("graph header: got %+v, %v, want %+v", got, ok, graph)
	}
	alt := altHead{landmarks: 8, nodes: 7, climb: 8, unit: 16, fingerprint: 0xFEEDFACE}
	if got, ok := readAltHead(alt.encode()); !ok || got != alt {
		t.Errorf("landmark header: got %+v, %v, want %+v", got, ok, alt)
	}
	if _, ok := readGraphHead(graph.encode()[:graphHeaderSize-1]); ok {
		t.Error("a graph header cut short was read")
	}
	if _, ok := readAltHead(append([]byte("PFALT002"), make([]byte, 24)...)); ok {
		t.Error("a header of another version was read")
	}
}

var matchBand = AscentBand{Share: 0.2, FloorM: 50}

func TestClimbLiftIsZeroWithoutATargetOrWithinTheBand(t *testing.T) {
	cases := []struct {
		name           string
		ascent, target float64
	}{
		{"no target", 0, 0},
		{"on target", 1000, 1000},
		{"just inside the band", 810, 1000},
		{"within the floor of a small target", 80, 100},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := climbLift(tc.ascent, tc.target, matchBand); got != 0 {
				t.Errorf("climbLift(%v, %v) = %v, want 0", tc.ascent, tc.target, got)
			}
		})
	}
}

func TestClimbLiftPushesUpWhenTheLoopClimbsTooLittleAndDownWhenTooMuch(t *testing.T) {
	// Arrange
	target := 1000.0
	// Act
	slightly, far, over, wayOver := climbLift(700, target, matchBand), climbLift(200, target, matchBand), climbLift(1400, target, matchBand), climbLift(5000, target, matchBand)
	// Assert
	if !(slightly > 0 && far > slightly && far <= 1) {
		t.Errorf("lifts %v (a bit short) and %v (far short) should be positive, growing and capped at 1", slightly, far)
	}
	if !(over < 0 && wayOver <= over && wayOver >= -1) {
		t.Errorf("lifts %v (a bit over) and %v (far over) should be negative, growing and capped at -1", over, wayOver)
	}
}

func TestLiftedNodePicksTheHighestOrLowestNodeWithinReach(t *testing.T) {
	// Arrange: a lattice that rises towards the east
	g := &testGraph{}
	at := g.grid(21, 21, func(x, y int) float64 { return float64(x) * 10 })
	e := openTest(t, g, false)
	base := uint32(at(10, 10))
	// Act
	up := liftedNode(e.g, e.sp, base, 300, 1, nil)
	down := liftedNode(e.g, e.sp, base, 300, -1, nil)
	still := liftedNode(e.g, e.sp, base, 300, 0, nil)
	tooShort := liftedNode(e.g, e.sp, base, 20, 1, nil)
	// Assert
	if e.g.nodes[up].Elev <= e.g.nodes[base].Elev {
		t.Errorf("up is not higher than the base node")
	}
	if e.g.nodes[down].Elev >= e.g.nodes[base].Elev {
		t.Errorf("down is not lower than the base node")
	}
	if still != base {
		t.Errorf("no lift moved the node from %d to %d", base, still)
	}
	if tooShort != base {
		t.Errorf("a reach under the lattice step moved the node to %d", tooShort)
	}
}

func TestControlPointSnapReachGrowsWithTheCircle(t *testing.T) {
	cases := []struct {
		name      string
		radiusM   float64
		wantReach float64
	}{
		{"a small circle keeps the floor", 1_000, 400},
		{"a large circle", 10_000, 3_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := snapReach(tc.radiusM); got != tc.wantReach {
				t.Errorf("snapReach(%v) = %v, want %v", tc.radiusM, got, tc.wantReach)
			}
		})
	}
}

func TestClimbLiftIsZeroWithoutABand(t *testing.T) {
	// Act
	got := climbLift(200, 1000, AscentBand{})
	// Assert
	if got != 0 {
		t.Errorf("climbLift with no band = %v, want 0: a caller that sets none gets no steering", got)
	}
}

// A band of ways along the east-west axis through the start, 5 km wide, as a valley floor between walls.
func valleyBand(g *testGraph) (start int) {
	for y := -5; y <= 5; y++ {
		for x := -80; x <= 80; x++ {
			n := g.addNode(float64(y)*500, float64(x)*stepM, 100)
			if x > -80 {
				g.connect(n-1, n, KindPath)
			}
			if y > -5 {
				g.connect(n-161, n, KindPath)
			}
			if x == 0 && y == 0 {
				start = n
			}
		}
	}
	return start
}

func TestAControlCircleTurnsToWhereWaysAre(t *testing.T) {
	// Arrange
	g := &testGraph{}
	start := valleyBand(g)
	e := openTest(t, g, false)
	sn := g.nodes[start]
	slat, slon := float64(sn.Lat)*1e-7, float64(sn.Lon)*1e-7
	const rc, theta = 3000.0, math.Pi / 2 // towards the wall: its points fall 2 km from the band, past the 900 m reach
	jitter := []float64{1, 1}
	if _, ok := circlePoints(e.g, e.sp, slat, slon, rc, theta, jitter, 0, nil); ok {
		t.Fatal("the first circle was meant to fall off the ways")
	}
	// Act
	nodes, used, ok := rotatedCircle(e.g, e.sp, slat, slon, rc, theta, jitter, 0, nil)
	// Assert
	if !ok || len(nodes) != len(jitter) {
		t.Fatalf("ok = %v with %d nodes, want a circle of %d points", ok, len(nodes), len(jitter))
	}
	if used == theta {
		t.Error("the circle did not turn")
	}
}

func TestAControlCircleGivesUpWhenNoTurnReachesTheWays(t *testing.T) {
	// Arrange
	g := &testGraph{}
	start := g.grid(2, 2, flat)(0, 0)
	e := openTest(t, g, false)
	sn := g.nodes[start]
	// Act
	_, _, ok := rotatedCircle(e.g, e.sp, float64(sn.Lat)*1e-7, float64(sn.Lon)*1e-7, 20_000, 0, []float64{1, 1, 1}, 0, nil)
	// Assert
	if ok {
		t.Error("a circle 20 km wide around a 100 m lattice found ways within reach")
	}
}

func TestAControlPointDoesNotLandOnAnIsland(t *testing.T) {
	// Arrange: the nodes nearest to the first circle's points form two islands, in a valley of 1,771 nodes
	g := &testGraph{}
	start := valleyBand(g)
	for _, x := range []float64{-2598, 2598} {
		g.connect(g.addNode(4_500, x, 100), g.addNode(4_550, x, 100), KindPath)
	}
	e := openTest(t, g, false)
	sn := g.nodes[start]
	slat, slon := float64(sn.Lat)*1e-7, float64(sn.Lon)*1e-7
	// Act
	nodes, used, ok := rotatedCircle(e.g, e.sp, slat, slon, 3000, math.Pi/2, []float64{1, 1}, 0, nil)
	// Assert
	if !ok || used == math.Pi/2 {
		t.Fatalf("ok = %v, turn = %v: the first circle lands on the islands and should have been turned", ok, used)
	}
	for _, n := range nodes {
		if e.g.small.has(n) {
			t.Errorf("node %d is on an island", n)
		}
	}
}

func TestALiftedControlPointDoesNotLandOnAnIsland(t *testing.T) {
	// Arrange: a high island 250 m north of the start, in the valley's band
	g := &testGraph{}
	start := valleyBand(g)
	hi := g.addNode(250, 0, 900)
	g.connect(hi, g.addNode(300, 0, 900), KindPath)
	e := openTest(t, g, false)
	if !e.g.small.has(uint32(hi)) {
		t.Fatal("the island is not small")
	}
	// Act
	got := liftedNode(e.g, e.sp, uint32(start), 250, 1, nil)
	// Assert
	if e.g.small.has(got) {
		t.Errorf("the control point was lifted onto the island, node %d", got)
	}
}

func TestALiftedControlPointSkipsASmallNodeForTheLargeOneBesideIt(t *testing.T) {
	// Arrange: a large lattice, a small island on the north probe, and a high node of the lattice 10 m from it.
	g := &testGraph{}
	at := g.grid(41, 41, flat)
	base := at(20, 20)
	island := g.addNode(2250, 2000, 900)
	g.connect(island, g.addNode(2250, 2050, 900), KindPath)
	high := g.addNode(2250, 2010, 800)
	g.connect(high, at(20, 22), KindPath)
	e := openTest(t, g, false)
	if !e.g.small.has(uint32(island)) || e.g.small.has(uint32(high)) {
		t.Fatal("the island or the high node is on the wrong component")
	}
	// Act
	got := liftedNode(e.g, e.sp, uint32(base), 250, 1, nil)
	// Assert
	if got != uint32(high) {
		t.Errorf("lifted to %d (elevation %v), want the large high node %d", got, e.g.nodes[got].Elev, high)
	}
}
