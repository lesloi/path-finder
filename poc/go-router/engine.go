package main

// The v2 engine: packed node and edge records, 16-bit landmark rows, a flat open-addressing
// table for search state, an avoid set for loops, and a small seeded random generator so that a
// seed always produces the same loops.

import (
	"context"
	"encoding/binary"
	"flag"
	"fmt"
	"math"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

// loopLegMaxSettled caps the nodes a single loop leg may settle.
const loopLegMaxSettled = 300_000

// metersPerDegree converts degrees of latitude to metres.
const metersPerDegree = 111194.9

// Grid cell sizes of the spatial index, in 1e-7 degrees (about 220 m).
const (
	cellLat = 20_000
	cellLon = 30_000
)

// pairKey identifies an undirected edge by its two end nodes.
func pairKey(a, b uint32) uint64 {
	if a > b {
		a, b = b, a
	}
	return uint64(a)<<32 | uint64(b)
}

// hikeClimb is the hike profile's climb penalty, in equivalent metres per metre of ascent.
const hikeClimb = 8.0

type g2 struct {
	n, e  int
	nodes []nodeV2
	off   []uint32
	edges []edgeV2
}

func align16(n int) int { return (n + 15) &^ 15 }

func mapFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	return syscall.Mmap(int(f.Fd()), 0, int(st.Size()), syscall.PROT_READ, syscall.MAP_SHARED)
}

func openG2(path string) (*g2, error) {
	data, err := mapFile(path)
	if err != nil {
		return nil, err
	}
	if string(data[:8]) != graphMagicV2 {
		return nil, fmt.Errorf("%s is not a v2 graph file", path)
	}
	n, e := int(binary.LittleEndian.Uint32(data[8:])), int(binary.LittleEndian.Uint32(data[12:]))
	nodesAt := 16
	offAt := align16(nodesAt + 12*n)
	edgesAt := align16(offAt + 4*(n+1))
	return &g2{
		n: n, e: e,
		nodes: unsafe.Slice((*nodeV2)(unsafe.Pointer(&data[nodesAt])), n),
		off:   unsafe.Slice((*uint32)(unsafe.Pointer(&data[offAt])), n+1),
		edges: unsafe.Slice((*edgeV2)(unsafe.Pointer(&data[edgesAt])), e),
	}, nil
}

func (g *g2) edgeSource(e uint32) uint32 {
	return uint32(sort.Search(len(g.off), func(i int) bool { return g.off[i] > e }) - 1)
}

type alt2 struct {
	l      int
	climb  float32
	unit   float32
	rowLen int
	rows   []uint16
}

func openAlt2(path string, g *g2) (*alt2, error) {
	data, err := mapFile(path)
	if err != nil {
		return nil, err
	}
	if string(data[:8]) != altMagicV2 {
		return nil, fmt.Errorf("%s is not a v2 landmark file", path)
	}
	l, n := int(binary.LittleEndian.Uint32(data[8:])), int(binary.LittleEndian.Uint32(data[12:]))
	if n != g.n {
		return nil, fmt.Errorf("%s was built for another graph", path)
	}
	a := &alt2{l: l, climb: math.Float32frombits(binary.LittleEndian.Uint32(data[16:])), unit: math.Float32frombits(binary.LittleEndian.Uint32(data[20:]))}
	a.rowLen = l
	if a.climb > 0 {
		a.rowLen = 2 * l
	}
	a.rows = unsafe.Slice((*uint16)(unsafe.Pointer(&data[24])), n*a.rowLen)
	return a, nil
}

// bound is a lower bound, in cost units, on the cost from the node with row rv to the target with row tg.
func (a *alt2) bound(rv []uint16, tg *[64]uint16) float32 {
	best := int32(0)
	l := a.l
	if a.climb > 0 {
		for i := 0; i < l; i++ {
			if dv, dt := rv[i], tg[i]; dv != altUnreachable && dt != altUnreachable {
				best = max(best, int32(dt)-int32(dv)-1)
			}
			if bv, bt := rv[l+i], tg[l+i]; bv != altUnreachable && bt != altUnreachable {
				best = max(best, int32(bv)-int32(bt)-1)
			}
		}
	} else {
		for i := 0; i < l; i++ {
			if dv, dt := rv[i], tg[i]; dv != altUnreachable && dt != altUnreachable {
				d := int32(dt) - int32(dv)
				if d < 0 {
					d = -d
				}
				best = max(best, d-1)
			}
		}
	}
	return float32(best) * a.unit
}

type ctx2 struct {
	g   *g2
	alt *alt2
}

type spatial2 struct {
	minLat, minLon int32
	nx, ny         int
	start          []uint32
	nodes          []uint32
}

func newSpatial2(g *g2) *spatial2 {
	s := &spatial2{minLat: math.MaxInt32, minLon: math.MaxInt32}
	maxLat, maxLon := int32(math.MinInt32), int32(math.MinInt32)
	for _, n := range g.nodes {
		s.minLat, maxLat = min(s.minLat, n.Lat), max(maxLat, n.Lat)
		s.minLon, maxLon = min(s.minLon, n.Lon), max(maxLon, n.Lon)
	}
	s.ny, s.nx = int((maxLat-s.minLat)/cellLat)+1, int((maxLon-s.minLon)/cellLon)+1
	s.start = make([]uint32, s.nx*s.ny+1)
	cell := func(i int) int {
		return int((g.nodes[i].Lat-s.minLat)/cellLat)*s.nx + int((g.nodes[i].Lon-s.minLon)/cellLon)
	}
	for i := range g.nodes {
		s.start[cell(i)+1]++
	}
	for c := 1; c < len(s.start); c++ {
		s.start[c] += s.start[c-1]
	}
	s.nodes = make([]uint32, g.n)
	fill := make([]uint32, s.nx*s.ny)
	for i := range g.nodes {
		c := cell(i)
		s.nodes[s.start[c]+fill[c]] = uint32(i)
		fill[c]++
	}
	return s
}

func (s *spatial2) nearest(g *g2, latDeg, lonDeg float64) (uint32, float64, bool) {
	lat, lon := int32(latDeg*1e7), int32(lonDeg*1e7)
	cy, cx := int(lat-s.minLat)/cellLat, int(lon-s.minLon)/cellLon
	cosl := math.Cos(latDeg * rad)
	best, node, found := math.Inf(1), uint32(0), false
	visit := func(x, y int) {
		if x < 0 || y < 0 || x >= s.nx || y >= s.ny {
			return
		}
		c := y*s.nx + x
		for _, n := range s.nodes[s.start[c]:s.start[c+1]] {
			dy := float64(g.nodes[n].Lat-lat) * 1e-7 * metersPerDegree
			dx := float64(g.nodes[n].Lon-lon) * 1e-7 * metersPerDegree * cosl
			if d := dx*dx + dy*dy; d < best {
				best, node, found = d, n, true
			}
		}
	}
	for r := 0; r < 200; r++ {
		for x := cx - r; x <= cx+r; x++ {
			visit(x, cy-r)
			if r > 0 {
				visit(x, cy+r)
			}
		}
		for y := cy - r + 1; y <= cy+r-1; y++ {
			visit(cx-r, y)
			visit(cx+r, y)
		}
		if found && math.Sqrt(best) <= float64(r)*200 {
			break
		}
	}
	return node, math.Sqrt(best), found
}

// avoid2 is a set of undirected edges as a flat open-addressing table of pair keys.
type avoid2 struct {
	keys []uint64
	n    int
}

func newAvoid2() *avoid2 { return &avoid2{keys: make([]uint64, 1<<10)} }

func hash64(k uint64) int { return int((k * 0x9E3779B97F4A7C15) >> 32) }

func (a *avoid2) contains(k uint64) bool {
	mask := len(a.keys) - 1
	for i := hash64(k) & mask; ; i = (i + 1) & mask {
		switch a.keys[i] {
		case 0:
			return false
		case k:
			return true
		}
	}
}

func (a *avoid2) insert(k uint64) {
	if (a.n+1)*2 > len(a.keys) {
		old := a.keys
		a.keys, a.n = make([]uint64, len(old)*2), 0
		for _, x := range old {
			if x != 0 {
				a.insert(x)
			}
		}
	}
	mask := len(a.keys) - 1
	for i := hash64(k) & mask; ; i = (i + 1) & mask {
		switch a.keys[i] {
		case 0:
			a.keys[i] = k
			a.n++
			return
		case k:
			return
		}
	}
}

type slot2 struct {
	key, epoch uint32
	cost       float32
	edge       uint32
}

type item2 struct {
	f, g float32
	node uint32
}

type searcher2 struct {
	slots   []slot2
	epoch   uint32
	used    int
	heap    []item2
	settled int
}

const (
	noEdge       = math.MaxUint32
	maxRetained2 = 1 << 23
	avoidMult2   = 6
	minMult2     = float32(0.995)
)

var mult2 = func() (t [numKinds][numSurfs]float32) {
	p := profiles["hike"]
	for k := range t {
		for s := range t[k] {
			t[k][s] = p.Kind[k] * p.Surf[s]
		}
	}
	return
}()

func newSearcher2() *searcher2 { return &searcher2{slots: make([]slot2, 1<<14)} }

// searcherPool keeps grown search tables between requests, so a loop does not pay to regrow
// them (copying tens of MB, which cannot be interrupted) every time.
var searcherPool = sync.Pool{New: func() any { return newSearcher2() }}

func (s *searcher2) reset() {
	if len(s.slots) > maxRetained2 {
		s.slots = make([]slot2, 1<<14)
	}
	s.epoch++
	if s.epoch == 0 {
		clear(s.slots)
		s.epoch = 1
	}
	s.used = 0
	s.heap = s.heap[:0]
}

func (s *searcher2) find(key uint32) int {
	mask := len(s.slots) - 1
	i := int(key*0x9E3779B1) & mask
	for {
		sl := &s.slots[i]
		if sl.epoch != s.epoch || sl.key == key {
			return i
		}
		i = (i + 1) & mask
	}
}

func (s *searcher2) grow() {
	old := s.slots
	s.slots = make([]slot2, len(old)*2)
	for _, sl := range old {
		if sl.epoch == s.epoch {
			s.slots[s.find(sl.key)] = sl
		}
	}
}

func (s *searcher2) push(it item2) {
	h := append(s.heap, it)
	i := len(h) - 1
	for i > 0 {
		p := (i - 1) / 2
		if h[p].f <= h[i].f {
			break
		}
		h[p], h[i] = h[i], h[p]
		i = p
	}
	s.heap = h
}

func (s *searcher2) pop() (item2, bool) {
	h := s.heap
	if len(h) == 0 {
		return item2{}, false
	}
	top := h[0]
	last := len(h) - 1
	h[0] = h[last]
	h = h[:last]
	i := 0
	for {
		l, r, m := 2*i+1, 2*i+2, i
		if l < last && h[l].f < h[m].f {
			m = l
		}
		if r < last && h[r].f < h[m].f {
			m = r
		}
		if m == i {
			break
		}
		h[m], h[i] = h[i], h[m]
		i = m
	}
	s.heap = h
	return top, true
}

type route2 struct {
	nodes, edges []uint32
	cost         float32
}

// route finds the cheapest route, or nil when there is none or ctx is cancelled.
// The context is read every 1,024 settled nodes, so a cancellation takes effect within microseconds.
// maxSettled caps the nodes one search may settle (0 for no cap): a loop leg that needs more is
// not worth finding, and a huge search would also have to regrow its table, which cannot be interrupted.
func (s *searcher2) route(ctx context.Context, cx *ctx2, climb float32, avoid *avoid2, maxSettled int, src, dst uint32) *route2 {
	s.reset()
	s.settled = 0
	if ctx.Err() != nil { // short searches never reach the periodic check below
		return nil
	}
	g := cx.g
	nodes, edges := g.nodes, g.edges
	var tg [64]uint16
	var rows []uint16
	if cx.alt != nil {
		rows = cx.alt.rows
		copy(tg[:], rows[int(dst)*cx.alt.rowLen:int(dst)*cx.alt.rowLen+cx.alt.rowLen])
	}
	t := nodes[dst]
	cosl := math.Cos(float64(t.Lat) * 1e-7 * rad)
	kx := float32(1e-7 * metersPerDegree)
	ky := kx * float32(cosl)
	zt := float32(t.Elev) * 0.1
	directional := cx.alt != nil && cx.alt.climb > 0
	h := func(v uint32) float32 {
		nv := &nodes[v]
		dy := float32(nv.Lat-t.Lat) * kx
		dx := float32(nv.Lon-t.Lon) * ky
		est := float32(math.Sqrt(float64(dx*dx+dy*dy))) * minMult2
		var climbTerm float32
		if rise := zt - float32(nv.Elev)*0.1; rise > 0 {
			climbTerm = rise * climb
		}
		switch {
		case directional:
			// The landmark bound already includes climbing: keep the larger bound.
			return max(est+climbTerm, cx.alt.bound(cx.alt.rows[int(v)*cx.alt.rowLen:int(v)*cx.alt.rowLen+cx.alt.rowLen], &tg))
		case cx.alt != nil:
			return max(est, cx.alt.bound(cx.alt.rows[int(v)*cx.alt.rowLen:int(v)*cx.alt.rowLen+cx.alt.rowLen], &tg)) + climbTerm
		}
		return est + climbTerm
	}
	sn := nodes[src]
	dsrc := float32(math.Hypot(float64(sn.Lat-t.Lat)*1e-7*metersPerDegree, float64(sn.Lon-t.Lon)*1e-7*metersPerDegree*cosl))
	maxCost := 10*dsrc + 5000

	s.slots[s.find(src)] = slot2{key: src, epoch: s.epoch, cost: 0, edge: noEdge}
	s.used++
	s.push(item2{f: h(src), node: src})
	found := false
	for {
		it, ok := s.pop()
		if !ok {
			break
		}
		u := it.node
		if it.g > s.slots[s.find(u)].cost {
			continue
		}
		if it.g > maxCost {
			break
		}
		s.settled++
		if maxSettled > 0 && s.settled > maxSettled {
			return nil
		}
		if s.settled&1023 == 0 && ctx.Err() != nil {
			return nil
		}
		if u == dst {
			found = true
			break
		}
		nu := &nodes[u]
		for e := g.off[u]; e < g.off[u+1]; e++ {
			ed := &edges[e]
			nv := &nodes[ed.To]
			c := ed.Len * mult2[ed.Kind][ed.Surf]
			if dz := float32(nv.Elev-nu.Elev) * 0.1; dz > 0 {
				c += dz * climb
			}
			if avoid != nil && avoid.contains(pairKey(u, ed.To)) {
				c *= avoidMult2
			}
			ng := it.g + c
			i := s.find(ed.To)
			fresh := s.slots[i].epoch != s.epoch
			if fresh || ng < s.slots[i].cost {
				if fresh {
					if (s.used+1)*2 > len(s.slots) {
						if ctx.Err() != nil { // growing copies tens of MB and cannot be interrupted
							return nil
						}
						s.grow()
						i = s.find(ed.To)
					}
					s.used++
				}
				s.slots[i] = slot2{key: ed.To, epoch: s.epoch, cost: ng, edge: e}
				s.push(item2{f: ng + h(ed.To), g: ng, node: ed.To})
			}
		}
	}
	if !found {
		return nil
	}
	r := &route2{cost: s.slots[s.find(dst)].cost, nodes: []uint32{dst}}
	for v := dst; v != src; {
		e := s.slots[s.find(v)].edge
		r.edges = append(r.edges, e)
		v = g.edgeSource(e)
		r.nodes = append(r.nodes, v)
	}
	for i, j := 0, len(r.nodes)-1; i < j; i, j = i+1, j-1 {
		r.nodes[i], r.nodes[j] = r.nodes[j], r.nodes[i]
	}
	for i, j := 0, len(r.edges)-1; i < j; i, j = i+1, j-1 {
		r.edges[i], r.edges[j] = r.edges[j], r.edges[i]
	}
	return r
}

func ascent2(g *g2, nodes []uint32) float64 {
	const deadBandM = 2.0
	up, ref := 0.0, float64(g.nodes[nodes[0]].Elev)*0.1
	for _, n := range nodes[1:] {
		z := float64(g.nodes[n].Elev) * 0.1
		if z-ref >= deadBandM {
			up += z - ref
			ref = z
		} else if ref-z >= deadBandM {
			ref = z
		}
	}
	return up
}

// splitmix is a small seeded random generator: the same seed always yields the same loops.
type splitmix struct{ s uint64 }

func newSplitmix(seed, stream uint64) *splitmix {
	return &splitmix{seed*0x9E3779B97F4A7C15 ^ stream*0xD1B54A32D192ED03 ^ 0x123456789ABCDEF1}
}

func (r *splitmix) next() uint64 {
	r.s += 0x9E3779B97F4A7C15
	z := r.s
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
	z = (z ^ (z >> 27)) * 0x94D049BB133111EB
	return z ^ (z >> 31)
}

func (r *splitmix) f64() float64          { return float64(r.next()>>11) / float64(uint64(1)<<53) }
func (r *splitmix) below(n uint64) uint64 { return r.next() % n }

type loopParams2 struct {
	lat, lon       float64
	distM, ascentM float64
	candidates     int
	seed           uint64
}

type loop2 struct {
	dist, ascent, trail, overlap, score float64
}

func (lp *loopParams2) score(dist, ascent, overlap float64) float64 {
	s := 3*math.Abs(dist-lp.distM)/lp.distM + 3*overlap/dist
	if lp.ascentM > 0 {
		s += 2 * math.Abs(ascent-lp.ascentM) / math.Max(lp.ascentM, 50)
	}
	return s
}

func measure2(g *g2, nodes, edges []uint32) (dist, trail, overlap float64) {
	seen := newAvoid2()
	for i, e := range edges {
		l := float64(g.edges[e].Len)
		dist += l
		if isTrail(g.edges[e].Kind) {
			trail += l
		}
		k := pairKey(nodes[i], nodes[i+1])
		if seen.contains(k) {
			overlap += l
		} else {
			seen.insert(k)
		}
	}
	return
}

func candidate2(ctx context.Context, cx *ctx2, sp *spatial2, s *searcher2, lp *loopParams2, start uint32, index int) *loop2 {
	g := cx.g
	rng := newSplitmix(lp.seed, uint64(index))
	climb := float32(hikeClimb) * float32(2*rng.f64())
	k := 2 + int(rng.below(3))
	theta := rng.f64() * 2 * math.Pi
	rc := lp.distM / (2 * math.Pi * 1.3)
	sn := g.nodes[start]
	slat, slon := float64(sn.Lat)*1e-7, float64(sn.Lon)*1e-7
	cosl := math.Cos(slat * rad)
	jitter := make([]float64, k)
	for j := range jitter {
		jitter[j] = 0.85 + 0.3*rng.f64()
	}
	var best *loop2
	for iter := 0; iter < 4; iter++ {
		if ctx.Err() != nil {
			return best
		}
		cxm, cym := rc*math.Cos(theta), rc*math.Sin(theta)
		points := []uint32{start}
		for j := 0; j < k; j++ {
			phi := theta + math.Pi + 2*math.Pi*float64(j+1)/float64(k+1)
			x, y := cxm+rc*jitter[j]*math.Cos(phi), cym+rc*jitter[j]*math.Sin(phi)
			n, d, ok := sp.nearest(g, slat+y/metersPerDegree, slon+x/(metersPerDegree*cosl))
			if !ok || d > 400 {
				return best
			}
			points = append(points, n)
		}
		points = append(points, start)
		avoid := newAvoid2()
		var nodes, edges []uint32
		for j := 1; j < len(points); j++ {
			if points[j-1] == points[j] {
				return best
			}
			var av *avoid2
			if avoid.n > 0 {
				av = avoid
			}
			leg := s.route(ctx, cx, climb, av, loopLegMaxSettled, points[j-1], points[j])
			if leg == nil {
				return best
			}
			if len(nodes) == 0 {
				nodes = append(nodes, leg.nodes...)
			} else {
				nodes = append(nodes, leg.nodes[1:]...)
			}
			edges = append(edges, leg.edges...)
			for q := 1; q < len(leg.nodes); q++ {
				avoid.insert(pairKey(leg.nodes[q-1], leg.nodes[q]))
			}
		}
		dist, trail, overlap := measure2(g, nodes, edges)
		asc := ascent2(g, nodes)
		sc := lp.score(dist, asc, overlap)
		if best == nil || sc < best.score {
			best = &loop2{dist, asc, trail, overlap, sc}
		}
		if math.Abs(dist-lp.distM) < 0.03*lp.distM {
			break
		}
		rc *= lp.distM / dist
	}
	return best
}

// generate2 returns nil when no loop is found or ctx is cancelled.
func generate2(ctx context.Context, cx *ctx2, sp *spatial2, lp *loopParams2) *loop2 {
	start, d, ok := sp.nearest(cx.g, lp.lat, lp.lon)
	if !ok || d > 400 {
		return nil
	}
	// GOMAXPROCS follows the container's CPU limit (Go 1.25+); NumCPU would not.
	workers := min(runtime.GOMAXPROCS(0), 8)
	var next atomic.Int64
	var mu sync.Mutex
	var winners []*loop2
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s := searcherPool.Get().(*searcher2)
			defer searcherPool.Put(s)
			var best *loop2
			for {
				i := int(next.Add(1) - 1)
				if i >= lp.candidates || ctx.Err() != nil {
					break
				}
				if l := candidate2(ctx, cx, sp, s, lp, start, i); l != nil && (best == nil || l.score < best.score) {
					best = l
				}
			}
			if best != nil {
				mu.Lock()
				winners = append(winners, best)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if ctx.Err() != nil {
		return nil
	}
	var best *loop2
	for _, w := range winners {
		if best == nil || w.score < best.score {
			best = w
		}
	}
	return best
}

func openV2(graphPath, altPath string) (*ctx2, *spatial2, time.Duration) {
	g, err := openG2(graphPath)
	if err != nil {
		fail(err)
	}
	cx := &ctx2{g: g}
	if altPath != "" {
		if cx.alt, err = openAlt2(altPath, g); err != nil {
			fail(err)
		}
	}
	t := time.Now()
	sp := newSpatial2(g)
	return cx, sp, time.Since(t)
}

func engineCmd(name string, args []string) {
	fs := flag.NewFlagSet(name, flag.ExitOnError)
	graph := fs.String("graph", "graph.bin", "v2 graph file")
	altPath := fs.String("alt", "", "v2 landmark file")
	kind := fs.String("kind", "route", "route or loop")
	clients := fs.Int("clients", 4, "concurrent clients")
	seconds := fs.Int("seconds", 10, "duration")
	cands := fs.Int("n", 100, "candidates per loop request")
	seed := fs.Uint64("seed", 1, "random seed")
	runs := fs.Int("runs", 20, "cancellation runs")
	from := fs.String("from", "", "lat,lon (route)")
	to := fs.String("to", "", "lat,lon (route)")
	fs.Parse(args)
	cx, sp, took := openV2(*graph, *altPath)
	fmt.Printf("graph: %d nodes; spatial index built in %.0fms\n", cx.g.n, float64(took.Milliseconds()))
	switch name {
	case "route":
		routeOnce(cx, sp, *from, *to)
	case "table":
		v2Table(cx, sp)
	case "loop":
		for _, lc := range loopCases {
			lp := &loopParams2{lat: lc.lat, lon: lc.lon, distM: lc.distKm * 1000, ascentM: lc.ascentM, candidates: *cands, seed: *seed}
			t := time.Now()
			if l := generate2(context.Background(), cx, sp, lp); l != nil {
				fmt.Printf("%3.0f km D+ %5.0f target -> %.2f km, D+ %.0f m, trail %.0f%%, overlap %.1f%%, score %.3f, %.2fs\n",
					lc.distKm, lc.ascentM, l.dist/1000, l.ascent, 100*l.trail/l.dist, 100*l.overlap/l.dist, l.score, time.Since(t).Seconds())
			} else {
				fmt.Printf("%3.0f km: no loop\n", lc.distKm)
			}
		}
	case "bench":
		v2Bench(cx, sp, *kind, *clients, *seconds, *cands)
	case "cancel":
		v2Cancel(cx, sp, *kind, *runs, *cands)
	}
}

func v2Cases() []testCase { return append(append([]testCase{}, alpsCases...), longCases...) }

func v2Route(ctx context.Context, cx *ctx2, sp *spatial2, s *searcher2, c testCase) *route2 {
	a, _, ok1 := sp.nearest(cx.g, c.flat, c.flon)
	b, _, ok2 := sp.nearest(cx.g, c.tlat, c.tlon)
	if !ok1 || !ok2 {
		return nil
	}
	return s.route(ctx, cx, hikeClimb, nil, 0, a, b)
}

func v2Table(cx *ctx2, sp *spatial2) {
	s := newSearcher2()
	fmt.Printf("%-38s %8s %7s %6s %10s %9s\n", "case", "km", "D+", "trail", "best of 5", "settled")
	for _, c := range v2Cases()[6:] {
		var best time.Duration
		var r *route2
		for range 5 {
			t := time.Now()
			r = v2Route(context.Background(), cx, sp, s, c)
			if d := time.Since(t); best == 0 || d < best {
				best = d
			}
		}
		if r == nil {
			fmt.Printf("%-38s no route\n", c.name)
			continue
		}
		dist, trail, _ := measure2(cx.g, r.nodes, r.edges)
		fmt.Printf("%-38s %8.2f %7.0f %5.0f%% %8.0fms %8dk  cost %.2f\n", c.name, dist/1000, ascent2(cx.g, r.nodes), 100*trail/dist,
			float64(best.Microseconds())/1000, s.settled/1000, r.cost/1000)
	}
}

func v2Bench(cx *ctx2, sp *spatial2, kind string, clients, seconds, candidates int) {
	runtime.GC()
	before := memStatus()
	cases := v2Cases()
	deadline := time.Now().Add(time.Duration(seconds) * time.Second)
	var mu sync.Mutex
	var lat []time.Duration
	var wg sync.WaitGroup
	start := time.Now()
	for c := 0; c < clients; c++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s := newSearcher2()
			rng := newSplitmix(uint64(c), 7)
			for time.Now().Before(deadline) {
				t0 := time.Now()
				ok := false
				if kind == "route" {
					ok = v2Route(context.Background(), cx, sp, s, cases[rng.below(uint64(len(cases)))]) != nil
				} else {
					lc := loopCases[rng.below(uint64(len(loopCases)))]
					lp := &loopParams2{lat: lc.lat, lon: lc.lon, distM: lc.distKm * 1000, ascentM: lc.ascentM, candidates: candidates, seed: rng.next()}
					ok = generate2(context.Background(), cx, sp, lp) != nil
				}
				if ok {
					mu.Lock()
					lat = append(lat, time.Since(t0))
					mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start).Seconds()
	sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
	after := memStatus()
	ms := func(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
	fmt.Printf("%d clients, %ds: %d ok, %.1f req/s, p50 %.0fms, p95 %.0fms, max %.0fms\n", clients, seconds, len(lat),
		float64(len(lat))/elapsed, ms(percentile(lat, 0.5)), ms(percentile(lat, 0.95)), ms(percentile(lat, 1)))
	fmt.Printf("  memory MB: before RSS %d (anon %d, file %d) | after RSS %d (anon %d, file %d) | peak RSS %d\n",
		before["VmRSS"], before["RssAnon"], before["RssFile"], after["VmRSS"], after["RssAnon"], after["RssFile"], after["VmHWM"])
}

// v2Cancel starts requests, cancels each after a random delay, and measures how long the
// request takes to return once cancelled.
func v2Cancel(cx *ctx2, sp *spatial2, kind string, runs, candidates int) {
	rng := newSplitmix(42, 1)
	cases := v2Cases()[6:] // the long routes, the slow ones without landmarks
	var lat []time.Duration
	finished := 0
	s := newSearcher2()
	for i := 0; i < runs; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		var at atomic.Int64
		var delay time.Duration
		if kind == "route" {
			delay = time.Duration(5+rng.below(120)) * time.Millisecond
		} else {
			delay = time.Duration(30+rng.below(400)) * time.Millisecond
		}
		go func() {
			time.Sleep(delay)
			at.Store(time.Now().UnixNano())
			cancel()
		}()
		done := false
		if kind == "route" {
			done = v2Route(ctx, cx, sp, s, cases[rng.below(uint64(len(cases)))]) != nil
		} else {
			lc := loopCases[rng.below(uint64(len(loopCases)))]
			done = generate2(ctx, cx, sp, &loopParams2{lat: lc.lat, lon: lc.lon, distM: lc.distKm * 1000, ascentM: lc.ascentM, candidates: candidates, seed: rng.next()}) != nil
		}
		ret := time.Now().UnixNano()
		cancel()
		if done || at.Load() == 0 {
			finished++ // completed before the cancellation fired
			continue
		}
		lat = append(lat, time.Duration(ret-at.Load()))
	}
	sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
	us := func(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
	fmt.Printf("%s: %d cancelled, %d finished first | time to return after cancel: min %.2f ms, median %.2f ms, p95 %.2f ms, max %.2f ms\n",
		kind, len(lat), finished, us(percentile(lat, 0)), us(percentile(lat, 0.5)), us(percentile(lat, 0.95)), us(percentile(lat, 1)))
}

// memStatus reads the kernel's view of this process, in MB: peak and current resident memory,
// split into anonymous (heap) and file-backed (the mapped graph) pages.
func memStatus() map[string]int {
	out := map[string]int{}
	data, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(data), "\n") {
		var kb int
		for _, key := range []string{"VmHWM", "VmRSS", "RssAnon", "RssFile"} {
			if strings.HasPrefix(line, key+":") {
				fmt.Sscanf(strings.TrimSpace(strings.TrimPrefix(line, key+":")), "%d", &kb)
				out[key] = kb / 1024
			}
		}
	}
	return out
}

func percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	return sorted[min(len(sorted)-1, int(p*float64(len(sorted))))]
}

// routeOnce finds one route and prints its figures.
func routeOnce(cx *ctx2, sp *spatial2, from, to string) {
	flat, flon, err := parsePoint(from)
	if err != nil {
		fail(err)
	}
	tlat, tlon, err := parsePoint(to)
	if err != nil {
		fail(err)
	}
	a, da, ok1 := sp.nearest(cx.g, flat, flon)
	b, db, ok2 := sp.nearest(cx.g, tlat, tlon)
	if !ok1 || !ok2 {
		fail(fmt.Errorf("a point is too far from the graph"))
	}
	s := newSearcher2()
	t0 := time.Now()
	r := s.route(context.Background(), cx, hikeClimb, nil, 0, a, b)
	took := time.Since(t0)
	if r == nil {
		fail(fmt.Errorf("no route"))
	}
	dist, trail, _ := measure2(cx.g, r.nodes, r.edges)
	fmt.Printf("snap %.0f m / %.0f m | %.2f km, +%.0f m, trail %.0f%%, cost %.0f, settled %d, %v\n",
		da, db, dist/1000, ascent2(cx.g, r.nodes), 100*trail/dist, r.cost, s.settled, took.Round(time.Microsecond))
	var byKind [numKinds]float64
	for _, e := range r.edges {
		byKind[cx.g.edges[e].Kind] += float64(cx.g.edges[e].Len)
	}
	for k, m := range byKind {
		if m > 0 {
			fmt.Printf("  %-14s %6.2f km\n", kindNames[k], m/1000)
		}
	}
}
