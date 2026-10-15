package engine

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"
)

// testGraph builds a graph in memory and writes it as the graph file the engine opens.
type testGraph struct {
	nodes []node
	edges [][]edge
}

const (
	baseLat = 45.0
	baseLon = 6.0
	stepM   = 100.0
)

func (t *testGraph) addNode(latM, lonM float64, elevM float64) int {
	lat := baseLat + latM/metersPerDegree
	lon := baseLon + lonM/(metersPerDegree*math.Cos(baseLat*rad))
	t.nodes = append(t.nodes, node{Lat: int32(lat * 1e7), Lon: int32(lon * 1e7), Elev: int32(elevM * 10)})
	t.edges = append(t.edges, nil)
	return len(t.nodes) - 1
}

func (t *testGraph) dist(a, b int) float32 {
	dy := float64(t.nodes[a].Lat-t.nodes[b].Lat) * 1e-7 * metersPerDegree
	dx := float64(t.nodes[a].Lon-t.nodes[b].Lon) * 1e-7 * metersPerDegree * math.Cos(baseLat*rad)
	return float32(math.Hypot(dx, dy))
}

func (t *testGraph) connect(a, b int, kind uint8) {
	l := t.dist(a, b)
	t.edges[a] = append(t.edges[a], edge{To: uint32(b), Len: l, Kind: kind, Surf: SurfaceCompact})
	t.edges[b] = append(t.edges[b], edge{To: uint32(a), Len: l, Kind: kind, Surf: SurfaceCompact})
}

// grid adds a w by h lattice of paths and returns the node index of cell (x, y).
func (t *testGraph) grid(w, h int, elev func(x, y int) float64) func(x, y int) int {
	first := len(t.nodes)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			t.addNode(float64(y)*stepM, float64(x)*stepM, elev(x, y))
		}
	}
	at := func(x, y int) int { return first + y*w + x }
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if x+1 < w {
				t.connect(at(x, y), at(x+1, y), KindPath)
			}
			if y+1 < h {
				t.connect(at(x, y), at(x, y+1), KindPath)
			}
		}
	}
	return at
}

func (t *testGraph) write(tb testing.TB) string {
	tb.Helper()
	off := make([]uint32, len(t.nodes)+1)
	var all []edge
	for i, es := range t.edges {
		off[i] = uint32(len(all))
		all = append(all, es...)
	}
	off[len(t.nodes)] = uint32(len(all))
	path := filepath.Join(tb.TempDir(), "graph.bin")
	if err := writeGraph(path, t.nodes, off, all); err != nil {
		tb.Fatal(err)
	}
	return path
}

func flat(x, y int) float64 { return 100 }

// writeTestLandmarks builds the landmarks of the graph file at path, and returns the file they are in.
func writeTestLandmarks(tb testing.TB, path string) string {
	tb.Helper()
	e, err := Open(path, "", "any")
	if err != nil {
		tb.Fatal(err)
	}
	alt := filepath.Join(tb.TempDir(), "graph.alt")
	if err := writeLandmarks(alt, 4, uint32(e.g.n), e.g.fingerprint, 8, buildLandmarks(e.g, e.sp, e.prof, 4, 8)); err != nil {
		tb.Fatal(err)
	}
	return alt
}

func openTest(tb testing.TB, t *testGraph, withLandmarks bool) *Engine {
	tb.Helper()
	path := t.write(tb)
	alt := ""
	if withLandmarks {
		alt = writeTestLandmarks(tb, path)
	}
	e, err := Open(path, alt, "any")
	if err != nil {
		tb.Fatal(err)
	}
	return e
}

func pointOf(t *testGraph, n int) Point {
	return Point{float64(t.nodes[n].Lat) * 1e-7, float64(t.nodes[n].Lon) * 1e-7}
}

func near(tb testing.TB, got, want, tol float64, what string) {
	tb.Helper()
	if math.Abs(got-want) > tol {
		tb.Errorf("%s = %.1f, want %.1f ± %.1f", what, got, want, tol)
	}
}

func TestRouteFollowsTheLattice(t *testing.T) {
	g := &testGraph{}
	at := g.grid(6, 6, flat)
	e := openTest(t, g, false)

	r, err := e.Route(context.Background(), pointOf(g, at(0, 0)), pointOf(g, at(5, 5)))
	if err != nil {
		t.Fatal(err)
	}
	near(t, r.Distance, 10*stepM, 5, "distance")
	near(t, r.Ascent, 0, 0.01, "ascent")
	near(t, r.TrailShare, 1, 1e-6, "trail share")
	if first, last := r.Points[0], r.Points[len(r.Points)-1]; first.Point != pointOf(g, at(0, 0)) || last.Point != pointOf(g, at(5, 5)) {
		t.Errorf("route runs from %v to %v", first, last)
	}
}

func TestRoutePrefersAPathToAShorterRoad(t *testing.T) {
	g := &testGraph{}
	a, b := g.addNode(0, 0, 100), g.addNode(0, 1000, 100)
	g.connect(a, b, KindPrimary) // 1000 m, but 6 times the cost per metre
	m1, m2 := g.addNode(150, 250, 100), g.addNode(150, 750, 100)
	g.connect(a, m1, KindPath)
	g.connect(m1, m2, KindPath)
	g.connect(m2, b, KindPath) // about 1100 m
	e := openTest(t, g, false)

	r, err := e.Route(context.Background(), pointOf(g, a), pointOf(g, b))
	if err != nil {
		t.Fatal(err)
	}
	if r.Distance < 1050 || r.TrailShare < 0.99 {
		t.Errorf("took the road: %.0f m, trail share %.2f", r.Distance, r.TrailShare)
	}
}

func TestRouteMeasuresAscentWithADeadBand(t *testing.T) {
	g := &testGraph{}
	// A straight line climbing 30 m over 10 steps, with a 1 m wobble that must not count.
	var prev int
	for i := 0; i <= 10; i++ {
		wobble := 0.0
		if i%2 == 1 {
			wobble = 1
		}
		n := g.addNode(0, float64(i)*stepM, 100+3*float64(i)+wobble)
		if i > 0 {
			g.connect(prev, n, KindPath)
		}
		prev = n
	}
	e := openTest(t, g, false)

	r, err := e.Route(context.Background(), pointOf(g, 0), pointOf(g, 10))
	if err != nil {
		t.Fatal(err)
	}
	near(t, r.Ascent, 30, 3, "ascent")
}

func TestRouteErrors(t *testing.T) {
	g := &testGraph{}
	at := g.grid(3, 3, flat)
	island := g.addNode(0, 5000, 100)
	g.connect(island, g.addNode(100, 5000, 100), KindPath)
	e := openTest(t, g, false)
	ctx := context.Background()

	if _, err := e.Route(ctx, Point{46, 7}, pointOf(g, at(1, 1))); !errors.Is(err, ErrOffGraph) {
		t.Errorf("start far from the graph: err = %v, want ErrOffGraph", err)
	}
	if _, err := e.Route(ctx, pointOf(g, at(0, 0)), pointOf(g, island)); !errors.Is(err, ErrNoRoute) {
		t.Errorf("disconnected points: err = %v, want ErrNoRoute", err)
	}
	done, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := e.Route(done, pointOf(g, at(0, 0)), pointOf(g, at(2, 2))); !errors.Is(err, context.Canceled) {
		t.Errorf("cancelled context: err = %v, want context.Canceled", err)
	}
}

func TestLandmarksDoNotChangeTheRoute(t *testing.T) {
	g := &testGraph{}
	at := g.grid(8, 8, func(x, y int) float64 { return 100 + 5*float64(x) })
	plain, boosted := openTest(t, g, false), openTest(t, g, true)
	from, to := pointOf(g, at(0, 7)), pointOf(g, at(7, 0))

	a, err := plain.Route(context.Background(), from, to)
	if err != nil {
		t.Fatal(err)
	}
	b, err := boosted.Route(context.Background(), from, to)
	if err != nil {
		t.Fatal(err)
	}
	near(t, b.Distance, a.Distance, 1, "distance with landmarks")
	near(t, b.Ascent, a.Ascent, 1, "ascent with landmarks")
}

func loopRequest(g *testGraph, at func(x, y int) int) LoopRequest {
	return LoopRequest{Start: pointOf(g, at(10, 10)), Distance: 3000, Ascent: 0, Candidates: 12, Seed: 7}
}

func TestLoopsComeBackAndAreClose(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)

	loops, err := e.Loops(context.Background(), loopRequest(g, at))
	if err != nil {
		t.Fatal(err)
	}
	if len(loops) < 6 {
		t.Fatalf("%d loops out of 12 candidates", len(loops))
	}
	for _, l := range loops {
		if first, last := l.Points[0], l.Points[len(l.Points)-1]; first != last {
			t.Errorf("loop is open: %v to %v", first, last)
		}
		near(t, l.Distance, 3000, 1200, "distance")
		var sum float64
		for _, s := range l.Stretches {
			sum += s.Meters
		}
		near(t, sum, l.Distance, 1, "stretches")
	}
	distinct := map[float64]bool{}
	for _, l := range loops {
		distinct[l.Distance] = true
	}
	if len(distinct) < 3 {
		t.Errorf("only %d different loops", len(distinct))
	}
}

func TestLoopsAreDeterministicForASeed(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := loopRequest(g, at)

	total := func() (sum float64) {
		loops, err := e.Loops(context.Background(), req)
		if err != nil {
			t.Fatal(err)
		}
		for _, l := range loops {
			sum += l.Distance
		}
		return
	}
	if a, b := total(), total(); a != b {
		t.Errorf("same seed, different loops: %.0f m then %.0f m in total", a, b)
	}
}

func TestLoopsMeasureDescentAndSurfaces(t *testing.T) {
	g := &testGraph{}
	// A hill the loops must cross, with a rough path on the right and a paved road on the left.
	at := g.grid(21, 21, func(x, y int) float64 { return 100 + float64(x)*3 })
	for from := range g.edges {
		for i := range g.edges[from] {
			if g.nodes[from].Lon > g.nodes[at(10, 10)].Lon {
				g.edges[from][i].Kind, g.edges[from][i].Surf = KindTrack, SurfaceRough
			} else {
				g.edges[from][i].Kind, g.edges[from][i].Surf = KindResidential, SurfacePaved
			}
		}
	}
	e := openTest(t, g, false)

	loops, err := e.Loops(context.Background(), loopRequest(g, at))
	if err != nil {
		t.Fatal(err)
	}
	var paved, unpaved bool
	for _, l := range loops {
		near(t, l.Descent, l.Ascent, 6, "descent of a loop")
		for _, s := range l.Stretches {
			paved, unpaved = paved || !s.Unpaved, unpaved || s.Unpaved
		}
	}
	if !paved || !unpaved {
		t.Errorf("loops around the middle cover both surfaces: paved %v, unpaved %v", paved, unpaved)
	}
}

func TestLoopsErrors(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := loopRequest(g, at)

	done, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := e.Loops(done, req); !errors.Is(err, context.Canceled) {
		t.Errorf("cancelled context: err = %v, want context.Canceled", err)
	}
	if _, err := e.Loops(context.Background(), LoopRequest{Start: req.Start}); err == nil {
		t.Error("loops without a distance: err = nil")
	}
	req.Start = Point{46, 7}
	if _, err := e.Loops(context.Background(), req); !errors.Is(err, ErrOffGraph) {
		t.Errorf("start off the graph: err = %v, want ErrOffGraph", err)
	}
	req = loopRequest(g, at)
	req.Distance = 500_000 // nothing a lattice of 2 km can close
	if _, err := e.Loops(context.Background(), req); !errors.Is(err, ErrNoLoop) {
		t.Errorf("impossible distance: err = %v, want ErrNoLoop", err)
	}
}

func TestCancellationKeepsTheLoopsFinishedSoFar(t *testing.T) {
	g := &testGraph{}
	at := g.grid(80, 80, flat)
	e := openTest(t, g, false)
	req := LoopRequest{Start: pointOf(g, at(40, 40)), Distance: 20000, Candidates: 100000, Seed: 1}

	// The context ends as soon as a loop is found, so at least one is finished whatever the machine's speed.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req.Enough = func([]*Route) bool {
		cancel()
		return false
	}
	start := time.Now()
	loops, err := e.Loops(ctx, req)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if took := time.Since(start); took > 5*time.Second {
		t.Errorf("kept working %v after the context ended", took)
	}
	if len(loops) == 0 {
		t.Error("no loop kept: the one finished before the end is lost")
	}
}

func TestOpenRejectsBadInput(t *testing.T) {
	g := &testGraph{}
	g.grid(3, 3, flat)
	path := g.write(t)

	if _, err := Open(path, "", "teleport"); err == nil {
		t.Error("unknown profile: err = nil")
	}
	if _, err := Open(filepath.Join(t.TempDir(), "missing.bin"), "", "any"); err == nil {
		t.Error("missing graph: err = nil")
	}
	if _, err := Open(path, path, "any"); err == nil {
		t.Error("graph file given as landmarks: err = nil")
	}
}

func TestOpenAllSharesTheGraphBetweenProfiles(t *testing.T) {
	g := &testGraph{}
	at := g.grid(6, 6, flat)
	engines, err := OpenAll(g.write(t), map[string]string{"any": "", "paved": ""})
	if err != nil {
		t.Fatal(err)
	}
	if engines["any"].g != engines["paved"].g || engines["any"].sp != engines["paved"].sp {
		t.Error("engines map the graph twice")
	}
	for name, e := range engines {
		if _, err := e.Route(context.Background(), pointOf(g, at(0, 0)), pointOf(g, at(5, 5))); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := OpenAll(g.write(t), map[string]string{"teleport": ""}); err == nil {
		t.Error("unknown profile: err = nil")
	}
}

func TestLoopsStopWhenTheCallerHasEnough(t *testing.T) {
	g := &testGraph{}
	at := g.grid(80, 80, flat)
	e := openTest(t, g, false)
	req := LoopRequest{Start: pointOf(g, at(40, 40)), Distance: 20000, Candidates: 100000, Seed: 1}
	calls := 0
	req.Enough = func(found []*Route) bool {
		calls++
		if len(found) != calls {
			t.Errorf("call %d saw %d loops: Enough must see every new loop, once", calls, len(found))
		}
		return len(found) >= 3
	}

	start := time.Now()
	loops, err := e.Loops(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if len(loops) != 3 {
		t.Errorf("%d loops, want exactly the 3 that were enough", len(loops))
	}
	if took := time.Since(start); took > 5*time.Second {
		t.Errorf("took %v to find 3 loops out of 100000 candidates", took)
	}
}

func TestOpenDirOpensTheGraphAndTheLandmarksItHolds(t *testing.T) {
	dir := t.TempDir()
	var b Builder
	for i := 0; i < 4; i++ {
		b.AddNode(45+float64(i)*0.001, 6, 100)
	}
	for i := 0; i < 3; i++ {
		b.Connect(i, i+1, KindPath, SurfaceCompact)
	}
	if err := b.WriteGraph(filepath.Join(dir, GraphFileName)); err != nil {
		t.Fatal(err)
	}
	if err := WriteLandmarks(filepath.Join(dir, GraphFileName), filepath.Join(dir, LandmarksFileName("any")), "any", 2); err != nil {
		t.Fatal(err)
	}

	engines, err := OpenDir(dir, "any", "paved")
	if err != nil {
		t.Fatal(err)
	}
	if engines["any"].alt == nil || engines["paved"].alt != nil {
		t.Errorf("landmarks: any %v, paved %v; only any has a file", engines["any"].alt != nil, engines["paved"].alt != nil)
	}
	if leftovers, _ := filepath.Glob(filepath.Join(dir, "*.tmp")); len(leftovers) != 0 {
		t.Errorf("temporary files left behind: %v", leftovers)
	}
}

func TestOpenDirFailsWithoutAGraph(t *testing.T) {
	_, err := OpenDir(t.TempDir(), "any")
	if err == nil || !strings.Contains(err.Error(), "opening the data") {
		t.Errorf("err = %v", err)
	}
}

func TestAFailedWriteLeavesNoFile(t *testing.T) {
	dir := t.TempDir()
	if err := WriteLandmarks(filepath.Join(dir, "missing.bin"), filepath.Join(dir, "x.alt"), "any", 2); err == nil {
		t.Error("landmarks of a graph that does not exist: err = nil")
	}
	if err := WriteLandmarks(filepath.Join(dir, "missing.bin"), filepath.Join(dir, "x.alt"), "teleport", 2); err == nil {
		t.Error("unknown profile: err = nil")
	}
	if err := writeAtomic(filepath.Join(dir, "y"), func(tmp string) error {
		_ = os.WriteFile(tmp, []byte("half"), 0o644)
		return errors.New("disk full")
	}); err == nil {
		t.Error("failing write: err = nil")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("files left behind: %v", entries)
	}
}

func TestOpenDirOnAReadOnlyDirectory(t *testing.T) {
	dir := t.TempDir()
	var b Builder
	for i := 0; i < 4; i++ {
		b.AddNode(45+float64(i)*0.001, 6, 100)
	}
	for i := 0; i < 3; i++ {
		b.Connect(i, i+1, KindPath, SurfaceCompact)
	}
	graph := filepath.Join(dir, GraphFileName)
	if err := b.WriteGraph(graph); err != nil {
		t.Fatal(err)
	}
	if err := WriteLandmarks(graph, filepath.Join(dir, LandmarksFileName("any")), "any", 2); err != nil {
		t.Fatal(err)
	}
	// What a read-only volume looks like to the pod: no file and no directory can be written.
	files, _ := filepath.Glob(filepath.Join(dir, "*"))
	for _, f := range files {
		if err := os.Chmod(f, 0o444); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	if f, err := os.OpenFile(filepath.Join(dir, "probe"), os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
		f.Close()
		t.Skip("the directory is writable anyway (running as root?)")
	}

	engines, err := OpenDir(dir, "any", "paved")
	if err != nil {
		t.Fatalf("a read-only data directory: %v", err)
	}
	if engines["any"].alt == nil {
		t.Error("the landmarks were not opened")
	}
	if _, err := engines["any"].Route(context.Background(), Point{Lat: 45, Lon: 6}, Point{Lat: 45.003, Lon: 6}); err != nil {
		t.Errorf("a route on a read-only graph: %v", err)
	}
	if now, _ := filepath.Glob(filepath.Join(dir, "*")); len(now) != len(files) {
		t.Errorf("opening the data wrote into its directory: %v", now)
	}
}

// Rebuilding a graph from the same data can number its nodes differently, with the same count: its old
// landmarks then bound the wrong nodes, and must be refused rather than trusted.
func TestLandmarksOfAnotherGraphOfTheSameSizeAreRefused(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, heights [4]float64) string {
		var b Builder
		for i, h := range heights {
			b.AddNode(45+float64(i)*0.001, 6, h)
		}
		for i := 0; i < 3; i++ {
			b.Connect(i, i+1, KindPath, SurfaceCompact)
		}
		path := filepath.Join(dir, name)
		if err := b.WriteGraph(path); err != nil {
			t.Fatal(err)
		}
		return path
	}
	first := write("first.bin", [4]float64{100, 110, 120, 130})
	second := write("second.bin", [4]float64{130, 120, 110, 100}) // 4 nodes and 6 edges too
	alt := filepath.Join(dir, "first.alt")
	if err := WriteLandmarks(first, alt, "any", 2); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(first, alt, "any"); err != nil {
		t.Fatalf("the landmarks of their own graph: %v", err)
	}
	if _, err := Open(second, alt, "any"); err == nil || !strings.Contains(err.Error(), "another graph") {
		t.Errorf("landmarks of another graph: err = %v, want it to refuse them", err)
	}
}

// The spatial index is written into the graph file at build time: opening a graph reads no node.
func TestAnOpenedGraphUsesTheSpatialIndexOfItsFile(t *testing.T) {
	g := &testGraph{}
	g.grid(6, 6, flat)
	path := g.write(t)
	e, err := Open(path, "", "any")
	if err != nil {
		t.Fatal(err)
	}
	want := computeSpatial(e.g.nodes)
	got := e.sp
	if got.minLat != want.minLat || got.minLon != want.minLon || got.maxLat != want.maxLat || got.maxLon != want.maxLon || got.nx != want.nx || got.ny != want.ny {
		t.Errorf("bounds of the index: got %+v, want %+v", got, want)
	}
	if !slices.Equal(got.start, want.start) || !slices.Equal(got.nodes, want.nodes) {
		t.Error("the index of the file differs from the one computed from the nodes")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data[:len(data)-64], 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path, "", "any"); err == nil || !strings.Contains(err.Error(), "shorter") {
		t.Errorf("a file cut in its index: err = %v, want it to say it is too short", err)
	}
}

// offset is the point latM metres north and lonM metres east of the lattice's corner.
func offset(latM, lonM float64) Point {
	return Point{baseLat + latM/metersPerDegree, baseLon + lonM/(metersPerDegree*math.Cos(baseLat*rad))}
}

// visitOrder tells whether the loop passes through the points in this order, going back over a point
// being allowed.
func visitOrder(l *Route, points ...Point) bool {
	next := 0
	for _, p := range l.Points {
		if next < len(points) && p.Point == points[next] {
			next++
		}
	}
	return next == len(points)
}

func TestLoopsGoThroughTheWaypointsInOrder(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	cases := map[string][]int{
		"one waypoint":    {at(14, 10)},
		"three waypoints": {at(14, 10), at(14, 14), at(8, 15)},
	}
	for name, nodes := range cases {
		t.Run(name, func(t *testing.T) {
			req := loopRequest(g, at)
			var want []Point
			for _, n := range nodes {
				req.Waypoints = append(req.Waypoints, pointOf(g, n))
				want = append(want, pointOf(g, n))
			}

			loops, err := e.Loops(context.Background(), req)

			if err != nil {
				t.Fatal(err)
			}
			if len(loops) < 4 {
				t.Fatalf("%d loops out of 12 candidates", len(loops))
			}
			for _, l := range loops {
				if first, last := l.Points[0], l.Points[len(l.Points)-1]; first != last || first.Point != req.Start {
					t.Errorf("loop does not start and end at the start point")
				}
				if !visitOrder(l, want...) {
					t.Errorf("loop misses the waypoints or visits them out of order")
				}
				near(t, l.Distance, 3000, 1500, "distance")
			}
		})
	}
}

func TestLoopsReachTheTargetThroughWaypoints(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	req.Waypoints = []Point{pointOf(g, at(12, 10))} // 400 m there and back: the loop must detour for 3 km

	loops, err := e.Loops(context.Background(), req)

	if err != nil {
		t.Fatal(err)
	}
	var close int
	for _, l := range loops {
		if math.Abs(l.Distance-3000) < 600 {
			close++
		}
	}
	if close == 0 {
		t.Errorf("none of %d loops is within 600 m of the target", len(loops))
	}
}

func TestLoopsAcceptAWaypointOnTheStartPointOrRepeated(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	start, w := pointOf(g, at(10, 10)), pointOf(g, at(13, 10))
	cases := map[string][]Point{
		"on the start point": {start, w},
		"repeated":           {w, w},
	}
	for name, waypoints := range cases {
		t.Run(name, func(t *testing.T) {
			req := loopRequest(g, at)
			req.Waypoints = waypoints

			loops, err := e.Loops(context.Background(), req)

			if err != nil || len(loops) < 4 {
				t.Errorf("%d loops, err = %v", len(loops), err)
			}
		})
	}
}

func TestLoopsMoveAWaypointToTheNearestWayWithinItsRange(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat) // spans 0 to 2000 m
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	req.Waypoints = []Point{offset(2200, 1000)} // 200 m north of the lattice's last row

	loops, err := e.Loops(context.Background(), req)

	if err != nil || len(loops) == 0 {
		t.Fatalf("%d loops, err = %v", len(loops), err)
	}
	if !visitOrder(loops[0], pointOf(g, at(10, 20))) {
		t.Error("loop does not go through the way nearest to the waypoint")
	}
}

func TestLoopsRefuseAWaypointFarFromAnyWay(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	req.Waypoints = []Point{pointOf(g, at(12, 10)), offset(2300, 1000), pointOf(g, at(8, 10))}

	_, err := e.Loops(context.Background(), req)

	var we *WaypointError
	if !errors.As(err, &we) || we.Index != 2 {
		t.Fatalf("err = %v, want a *WaypointError for waypoint 2", err)
	}
	if !errors.Is(err, ErrOffGraph) {
		t.Error("a refused waypoint is not an ErrOffGraph")
	}
}

func TestLoopsWithoutWaypointsAreTheSameWhateverTheEmptyForm(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	withEmpty := req
	withEmpty.Waypoints = []Point{}

	a, errA := e.Loops(context.Background(), req)
	b, errB := e.Loops(context.Background(), withEmpty)

	if errA != nil || errB != nil {
		t.Fatal(errA, errB)
	}
	sum := func(loops []*Route) (s float64) {
		for _, l := range loops {
			s += l.Distance
		}
		return
	}
	if len(a) != len(b) || sum(a) != sum(b) {
		t.Errorf("%d loops (%.0f m) against %d (%.0f m)", len(a), sum(a), len(b), sum(b))
	}
}

func TestDirectLoopGoesThroughTheWaypointsByTheCheapestWay(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	start := pointOf(g, at(10, 10))

	r, err := e.DirectLoop(context.Background(), start, []Point{pointOf(g, at(14, 10)), pointOf(g, at(14, 13))}, nil)

	if err != nil {
		t.Fatal(err)
	}
	near(t, r.Distance, 400+300+700, 1, "distance") // 400 m up, 300 m across, then 300 m and 400 m back
	if !visitOrder(r, pointOf(g, at(14, 10)), pointOf(g, at(14, 13))) || r.Points[len(r.Points)-1].Point != start {
		t.Error("the loop is not start, waypoints in order, start")
	}
}

func TestDirectLoopErrors(t *testing.T) {
	g := &testGraph{}
	at := g.grid(21, 21, flat)
	e := openTest(t, g, false)
	start, w := pointOf(g, at(10, 10)), pointOf(g, at(12, 10))

	var we *WaypointError
	if _, err := e.DirectLoop(context.Background(), start, []Point{w, offset(2300, 1000)}, nil); !errors.As(err, &we) || we.Index != 2 {
		t.Errorf("waypoint off the graph: err = %v, want a *WaypointError for waypoint 2", err)
	}
	if _, err := e.DirectLoop(context.Background(), Point{46, 7}, []Point{w}, nil); !errors.Is(err, ErrOffGraph) || errors.As(err, &we) {
		t.Errorf("start off the graph: err = %v, want ErrOffGraph and no waypoint", err)
	}
	g.addNode(2100, 2100, 100) // a way of its own, joined to nothing
	e = openTest(t, g, false)
	island := offset(2100, 2100)
	if _, err := e.DirectLoop(context.Background(), start, []Point{island}, nil); !errors.Is(err, ErrNoRoute) {
		t.Errorf("unreachable waypoint: err = %v, want ErrNoRoute", err)
	}
}

func TestLoopsAreSteeredTowardsTheElevationGainWhenGivenABand(t *testing.T) {
	// Arrange: a lattice that rises towards the east, and a target the first loops miss
	g := &testGraph{}
	at := g.grid(21, 21, func(x, y int) float64 { return float64(x) * 20 })
	e := openTest(t, g, false)
	req := loopRequest(g, at)
	req.Ascent = 300
	steered := req
	steered.AscentBand = AscentBand{Share: 0.2, FloorM: 50}
	// Act
	plain, err := e.Loops(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	withBand, err := e.Loops(context.Background(), steered)
	if err != nil {
		t.Fatal(err)
	}
	// Assert: the same seed gives other loops only because the band steers them
	if reflect.DeepEqual(shapes(plain), shapes(withBand)) {
		t.Error("a band changed no loop: the engine does not steer by elevation gain")
	}
}

// shapes lists the length and gain of loops in a fixed order: Loops returns them in no particular order.
func shapes(loops []*Route) [][2]float64 {
	out := make([][2]float64, len(loops))
	for i, l := range loops {
		out[i] = [2]float64{math.Round(l.Distance), math.Round(l.Ascent)}
	}
	sort.Slice(out, func(i, j int) bool { return out[i][0] < out[j][0] || out[i][0] == out[j][0] && out[i][1] < out[j][1] })
	return out
}
