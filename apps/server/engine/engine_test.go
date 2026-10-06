package engine

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
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

func openTest(tb testing.TB, t *testGraph, withLandmarks bool) *Engine {
	tb.Helper()
	path := t.write(tb)
	alt := ""
	if withLandmarks {
		e, err := Open(path, "", "hike")
		if err != nil {
			tb.Fatal(err)
		}
		alt = filepath.Join(tb.TempDir(), "graph.alt")
		rows := buildLandmarks(e.g, e.sp, e.prof, 4, 8)
		if err := writeLandmarks(alt, 4, uint32(e.g.n), 8, rows); err != nil {
			tb.Fatal(err)
		}
	}
	e, err := Open(path, alt, "hike")
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
	if _, err := Open(filepath.Join(t.TempDir(), "missing.bin"), "", "hike"); err == nil {
		t.Error("missing graph: err = nil")
	}
	if _, err := Open(path, path, "hike"); err == nil {
		t.Error("graph file given as landmarks: err = nil")
	}
}

func TestOpenAllSharesTheGraphBetweenActivities(t *testing.T) {
	g := &testGraph{}
	at := g.grid(6, 6, flat)
	engines, err := OpenAll(g.write(t), map[string]string{"hike": "", "run": ""})
	if err != nil {
		t.Fatal(err)
	}
	if engines["hike"].g != engines["run"].g || engines["hike"].sp != engines["run"].sp {
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
	if err := WriteLandmarks(filepath.Join(dir, GraphFileName), filepath.Join(dir, LandmarksFileName("hike")), "hike", 2); err != nil {
		t.Fatal(err)
	}

	engines, err := OpenDir(dir, "hike", "run")
	if err != nil {
		t.Fatal(err)
	}
	if engines["hike"].alt == nil || engines["run"].alt != nil {
		t.Errorf("landmarks: hike %v, run %v; only hike has a file", engines["hike"].alt != nil, engines["run"].alt != nil)
	}
	if leftovers, _ := filepath.Glob(filepath.Join(dir, "*.tmp")); len(leftovers) != 0 {
		t.Errorf("temporary files left behind: %v", leftovers)
	}
}

func TestOpenDirFailsWithoutAGraph(t *testing.T) {
	_, err := OpenDir(t.TempDir(), "hike")
	if err == nil || !strings.Contains(err.Error(), "opening the data") {
		t.Errorf("err = %v", err)
	}
}

func TestAFailedWriteLeavesNoFile(t *testing.T) {
	dir := t.TempDir()
	if err := WriteLandmarks(filepath.Join(dir, "missing.bin"), filepath.Join(dir, "x.alt"), "hike", 2); err == nil {
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

func TestWarmReadsEveryPageOfAMappedFile(t *testing.T) {
	page := os.Getpagesize()
	path := filepath.Join(t.TempDir(), "data")
	if err := os.WriteFile(path, make([]byte, 3*page+1), 0o644); err != nil {
		t.Fatal(err)
	}
	data, err := mapFile(path) // warms what it maps
	if err != nil {
		t.Fatal(err)
	}
	if got := warm(data); got != 4 {
		t.Errorf("warm read %d pages of a file of three pages and a byte, want 4", got)
	}
	if got := warm(nil); got != 0 {
		t.Errorf("warm read %d pages of an empty mapping", got)
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
	if err := WriteLandmarks(graph, filepath.Join(dir, LandmarksFileName("hike")), "hike", 2); err != nil {
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

	engines, err := OpenDir(dir, "hike", "run")
	if err != nil {
		t.Fatalf("a read-only data directory: %v", err)
	}
	if engines["hike"].alt == nil {
		t.Error("the landmarks were not opened")
	}
	if _, err := engines["hike"].Route(context.Background(), Point{Lat: 45, Lon: 6}, Point{Lat: 45.003, Lon: 6}); err != nil {
		t.Errorf("a route on a read-only graph: %v", err)
	}
	if now, _ := filepath.Glob(filepath.Join(dir, "*")); len(now) != len(files) {
		t.Errorf("opening the data wrote into its directory: %v", now)
	}
}
