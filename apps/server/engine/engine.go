package engine

// The engine: packed node and edge records, 16-bit landmark rows, a flat open-addressing
// table for search state, an avoid set for loops, and a small seeded random generator so that a
// seed always produces the same loops.

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"runtime"
	"sort"
	"sync"

	"github.com/lesloi/path-finder/apps/server/geo"
	"sync/atomic"
	"syscall"
	"unsafe"
)

// loopLegMaxSettled caps the nodes a single loop leg may settle.
const loopLegMaxSettled = 300_000

// minDetourShare is the least a loop through waypoints adds to the direct loop, as a share of the target
// distance, so that loops differ even when the waypoints alone nearly make the target.
const minDetourShare = 0.15

// metersPerDegree converts degrees of latitude to metres.
const metersPerDegree = geo.MetersPerDegree

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

type graph struct {
	n, e int
	// fingerprint is the one in the file header: the landmarks built for this graph hold the same.
	fingerprint uint64
	nodes       []node
	off         []uint32
	edges       []edge
	sp          *spatial
	// small holds the nodes of components too small to hold a loop (control points keep off them), and long the ways
	// too long for a scan of the nodes around an area to find: the build found both, so that no search reads the
	// whole graph to.
	small nodeSet
	long  [][2]uint32
	// forbiddenMu guards lastForbidden, the set of the last areas asked for: a request asks twice, for its
	// direct loop and for its loops, and the set is read only once built.
	forbiddenMu   sync.Mutex
	lastForbidden *forbidden
	file          mapped
}

func align16(n int) int { return (n + 15) &^ 15 }

// fileID identifies the version of a file: a replaced file has another inode, a rewritten one another size or
// time.
type fileID struct {
	dev, ino uint64
	size     int64
	mtimeNs  int64
}

func fileIDOf(st os.FileInfo) fileID {
	id := fileID{size: st.Size(), mtimeNs: st.ModTime().UnixNano()}
	if sys, ok := st.Sys().(*syscall.Stat_t); ok {
		id.dev, id.ino = uint64(sys.Dev), sys.Ino
	}
	return id
}

// transientError marks a failure of the system rather than of the content of a file (no descriptor left, no
// memory to map, a disk error): the same files may be served at the next try.
type transientError struct{ error }

func (e transientError) Unwrap() error { return e.error }

// mapped is a file mapped read-only: the bytes, the path they were mapped from and which version of it.
type mapped struct {
	data []byte
	path string
	id   fileID
}

// openMappings counts the files mapped and not yet unmapped, for the tests to see that a replaced version is
// let go.
var openMappings atomic.Int64

// mapFile maps a file. Its version is the one of the descriptor that is mapped, not of the path, which may
// already name another file.
func mapFile(path string) (mapped, error) {
	f, err := os.Open(path)
	if err != nil {
		return mapped{}, transientError{err}
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return mapped{}, transientError{err}
	}
	data, err := syscall.Mmap(int(f.Fd()), 0, int(st.Size()), syscall.PROT_READ, syscall.MAP_SHARED)
	if err != nil {
		return mapped{}, transientError{err}
	}
	openMappings.Add(1)
	return mapped{data: data, path: path, id: fileIDOf(st)}, nil
}

// unmap releases the mapping. Nothing may read the file after: its slices would fault.
func (m *mapped) unmap() {
	if m.data == nil {
		return
	}
	_ = syscall.Munmap(m.data)
	m.data = nil
	openMappings.Add(-1)
}

// maxLandmarkValues is how many landmark distances a search keeps for its target: the landmarks, twice
// over when the metric includes climbing.
const maxLandmarkValues = 64

// view reads count records of type T at an offset of a mapped file, or fails when the file is too short:
// a truncated copy would otherwise fault on the first access.
func view[T any](data []byte, at, count int) ([]T, error) {
	var zero T
	if count == 0 {
		return nil, nil
	}
	if at < 0 || count < 0 || at > len(data) || count > (len(data)-at)/int(unsafe.Sizeof(zero)) {
		return nil, errors.New("file is shorter than its header says")
	}
	return unsafe.Slice((*T)(unsafe.Pointer(&data[at])), count), nil
}

func openGraph(path string) (_ *graph, err error) {
	m, err := mapFile(path)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			m.unmap()
		}
	}()
	data := m.data
	head, ok := readGraphHead(data)
	if !ok {
		return nil, fmt.Errorf("%s is not a graph file of a version this server reads: build it again with build-graph", path)
	}
	n, e := int(head.nodes), int(head.edges)
	nodesAt := graphHeaderSize
	offAt := align16(nodesAt + 12*n)
	edgesAt := align16(offAt + 4*(n+1))
	if head.smallLimit != smallComponentNodes || head.longMeters != longEdgeMeters {
		return nil, fmt.Errorf("%s was built with other parameters (small components under %d nodes, long ways over %g m, where this server reads %d and %d): build it again with build-graph",
			path, head.smallLimit, head.longMeters, smallComponentNodes, longEdgeMeters)
	}
	g := &graph{n: n, e: e, fingerprint: head.fingerprint, file: m}
	if g.nodes, err = view[node](data, nodesAt, n); err != nil {
		return nil, fmt.Errorf("%s: nodes: %w", path, err)
	}
	if g.off, err = view[uint32](data, offAt, n+1); err != nil {
		return nil, fmt.Errorf("%s: offsets: %w", path, err)
	}
	if g.edges, err = view[edge](data, edgesAt, e); err != nil {
		return nil, fmt.Errorf("%s: edges: %w", path, err)
	}
	g.sp = &spatial{bounds: head.bounds}
	g.sp.nx, g.sp.ny = gridSize(head.minLat, head.minLon, head.maxLat, head.maxLon)
	startAt := align16(edgesAt + 12*e)
	listAt := align16(startAt + 4*(g.sp.nx*g.sp.ny+1))
	if g.sp.start, err = view[uint32](data, startAt, g.sp.nx*g.sp.ny+1); err != nil {
		return nil, fmt.Errorf("%s: index cells: %w", path, err)
	}
	if g.sp.nodes, err = view[uint32](data, listAt, n); err != nil {
		return nil, fmt.Errorf("%s: index nodes: %w", path, err)
	}
	smallAt := align16(listAt + 4*n)
	longAt := align16(smallAt + 8*((n+63)/64))
	if g.small, err = view[uint64](data, smallAt, (n+63)/64); err != nil {
		return nil, fmt.Errorf("%s: small components: %w", path, err)
	}
	if g.long, err = view[[2]uint32](data, longAt, int(head.longEdges)); err != nil {
		return nil, fmt.Errorf("%s: long ways: %w", path, err)
	}
	return g, nil
}

// warmSink keeps the reads of warm from being dropped as unused.
var warmSink atomic.Uint32

// warm reads one value in each page of the grid of the spatial index, which finding the node nearest to a
// start reads, to bring it into the page cache.
func (g *graph) warm() {
	const perPage = 4096 / 4
	var sum uint32
	for i := 0; i < len(g.sp.start); i += perPage {
		sum += g.sp.start[i]
	}
	warmSink.Add(sum)
}

func (g *graph) edgeSource(e uint32) uint32 {
	return uint32(sort.Search(len(g.off), func(i int) bool { return g.off[i] > e }) - 1)
}

type landmarks struct {
	file   mapped
	l      int
	climb  float32
	unit   float32
	rowLen int
	rows   []uint16
}

func openLandmarks(path string, g *graph) (_ *landmarks, err error) {
	m, err := mapFile(path)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			m.unmap()
		}
	}()
	data := m.data
	head, ok := readAltHead(data)
	if !ok {
		return nil, fmt.Errorf("%s is not a landmark file of this version: build it again with build-alt", path)
	}
	l, n := int(head.landmarks), int(head.nodes)
	if n != g.n || head.fingerprint != g.fingerprint {
		return nil, fmt.Errorf("%s was built for another graph: build it again with build-alt", path)
	}
	a := &landmarks{file: m, l: l, climb: head.climb, unit: head.unit}
	a.rowLen = l
	if a.climb > 0 {
		a.rowLen = 2 * l
	}
	if l < 1 || a.rowLen > maxLandmarkValues {
		return nil, fmt.Errorf("%s holds %d landmarks, which a search cannot use (1 to %d values per node)", path, l, maxLandmarkValues)
	}
	if a.rows, err = view[uint16](data, altHeaderSize, n*a.rowLen); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return a, nil
}

// bound is a lower bound, in cost units, on the cost from the node with row rv to the target with row tg.
func (a *landmarks) bound(rv []uint16, tg *[maxLandmarkValues]uint16) float32 {
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

// Engine routes and generates loops on a graph for one surface-preference profile. It is safe for
// concurrent use: the graph and landmarks are read-only, and engines of other profiles share them.
type Engine struct {
	g       *graph
	alt     *landmarks
	sp      *spatial
	prof    *Profile
	mult    [NumKinds][NumSurfaces]float32
	minMult float32
}

// spatial is a grid over the graph: the nodes of each cell, as numbers in one list, so that finding the
// nearest node to a point reads a few cells. It is written into the graph file at build time.
type spatial struct {
	bounds
	nx, ny int
	start  []uint32 // start[c] to start[c+1] is the slice of nodes holding the nodes of cell c
	nodes  []uint32
}

// gridSize is the number of cells of a grid over a bounding box.
func gridSize(minLat, minLon, maxLat, maxLon int32) (nx, ny int) {
	if maxLat < minLat || maxLon < minLon { // no node
		return 1, 1
	}
	return int((maxLon-minLon)/cellLon) + 1, int((maxLat-minLat)/cellLat) + 1
}

// cellIndex is the cell of the grid that holds a point, given the least latitude and longitude of the grid and the
// number of cells along longitude.
func cellIndex(lat, lon, minLat, minLon int32, nx int) int {
	return int((lat-minLat)/cellLat)*nx + int((lon-minLon)/cellLon)
}

func computeSpatial(nodes []node) *spatial {
	s := &spatial{bounds: bounds{minLat: math.MaxInt32, minLon: math.MaxInt32, maxLat: math.MinInt32, maxLon: math.MinInt32}}
	for _, n := range nodes {
		s.minLat, s.maxLat = min(s.minLat, n.Lat), max(s.maxLat, n.Lat)
		s.minLon, s.maxLon = min(s.minLon, n.Lon), max(s.maxLon, n.Lon)
	}
	if len(nodes) == 0 {
		s.minLat, s.minLon, s.maxLat, s.maxLon = 0, 0, 0, 0
	}
	s.nx, s.ny = gridSize(s.minLat, s.minLon, s.maxLat, s.maxLon)
	s.start = make([]uint32, s.nx*s.ny+1)
	cell := func(i int) int { return cellIndex(nodes[i].Lat, nodes[i].Lon, s.minLat, s.minLon, s.nx) }
	for i := range nodes {
		s.start[cell(i)+1]++
	}
	for c := 1; c < len(s.start); c++ {
		s.start[c] += s.start[c-1]
	}
	s.nodes = make([]uint32, len(nodes))
	fill := make([]uint32, s.nx*s.ny)
	for i := range nodes {
		c := cell(i)
		s.nodes[s.start[c]+fill[c]] = uint32(i)
		fill[c]++
	}
	return s
}

// ringM is how far a ring of cells reaches farther than the one inside it (a cell is 0.002° of latitude).
const ringM = 200

// nearest is the node closest to a point.
func (s *spatial) nearest(g *graph, latDeg, lonDeg float64) (uint32, float64, bool) {
	return s.nearestOutside(g, latDeg, lonDeg, nil, 0)
}

// nearestOutside is the node closest to a point that is not in skip. With a positive reachM it looks no farther
// than that, so a point with only skipped nodes around it is refused at once and not after the whole index.
func (s *spatial) nearestOutside(g *graph, latDeg, lonDeg float64, skip nodeSet, reachM float64) (uint32, float64, bool) {
	var skipFn func(uint32) bool
	if skip != nil {
		skipFn = skip.has
	}
	return s.nearestWhere(g, latDeg, lonDeg, skipFn, reachM)
}

// nearestWhere is nearestOutside for any set of nodes to skip, given as a filter, or nil for none.
func (s *spatial) nearestWhere(g *graph, latDeg, lonDeg float64, skip func(uint32) bool, reachM float64) (uint32, float64, bool) {
	rings := 200
	if reachM > 0 {
		rings = min(rings, int(reachM/ringM)+2)
	}
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
			if skip != nil && skip(n) {
				continue
			}
			dy := float64(g.nodes[n].Lat-lat) * 1e-7 * metersPerDegree
			dx := float64(g.nodes[n].Lon-lon) * 1e-7 * metersPerDegree * cosl
			if d := dx*dx + dy*dy; d < best {
				best, node, found = d, n, true
			}
		}
	}
	// Rings of cells around the point, 200 at most. A ring adds about 200 m (a cell is 0.002° of latitude), so once a
	// node is found no farther ring can hold a nearer one.
	for r := 0; r < rings; r++ {
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
		if found && math.Sqrt(best) <= float64(r)*ringM {
			break
		}
	}
	return node, math.Sqrt(best), found
}

// avoidSet is a set of undirected edges as a flat open-addressing table of pair keys.
type avoidSet struct {
	keys []uint64
	n    int
}

func newAvoidSet() *avoidSet { return &avoidSet{keys: make([]uint64, 1<<10)} }

func hash64(k uint64) int { return int((k * 0x9E3779B97F4A7C15) >> 32) }

func (a *avoidSet) contains(k uint64) bool {
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

func (a *avoidSet) insert(k uint64) {
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

type slot struct {
	key, epoch uint32
	cost       float32
	edge       uint32
}

type item struct {
	f, g float32
	node uint32
}

type searcher struct {
	slots   []slot
	epoch   uint32
	used    int
	heap    []item
	settled int
	// stop is why the last route returned nil.
	stop stopReason
}

// stopReason tells why a search found no route.
type stopReason uint8

const (
	stopExhausted stopReason = iota // every node it could reach was settled
	stopCutoff                      // the cheapest open node cost more than a route is worth
	stopCap                         // it settled as many nodes as it was allowed
	stopCanceled
)

const (
	noEdge           = math.MaxUint32
	maxRetainedSlots = 1 << 23
	avoidMult        = 6
)

func newSearcher() *searcher { return &searcher{slots: make([]slot, 1<<14)} }

// searcherPool keeps grown search tables between requests, so a loop does not pay to regrow
// them (copying tens of MB, which cannot be interrupted) every time.
var searcherPool = sync.Pool{New: func() any { return newSearcher() }}

func (s *searcher) reset() {
	if len(s.slots) > maxRetainedSlots {
		s.slots = make([]slot, 1<<14)
	}
	s.epoch++
	if s.epoch == 0 {
		clear(s.slots)
		s.epoch = 1
	}
	s.used = 0
	s.heap = s.heap[:0]
}

func (s *searcher) find(key uint32) int {
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

func (s *searcher) grow() {
	old := s.slots
	s.slots = make([]slot, len(old)*2)
	for _, sl := range old {
		if sl.epoch == s.epoch {
			s.slots[s.find(sl.key)] = sl
		}
	}
}

func (s *searcher) push(it item) {
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

func (s *searcher) pop() (item, bool) {
	h := s.heap
	if len(h) == 0 {
		return item{}, false
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

type route struct {
	nodes, edges []uint32
	cost         float32
}

// searchLimits bound what a search may use and do. The zero value bounds nothing.
type searchLimits struct {
	// maxSettled caps the nodes one search may settle (0 for no cap): a loop leg that needs more is not worth
	// finding, and a huge search would also have to regrow its table, which cannot be interrupted.
	maxSettled int
	// forbidden, when set, is the ways a search must not use: those that touch an avoided area.
	forbidden *forbidden
}

// route finds the cheapest route, or nil when there is none or ctx is cancelled.
// The context is read every 1,024 settled nodes, so a cancellation takes effect within microseconds.
// lim bounds the search, see searchLimits.
func (s *searcher) route(ctx context.Context, cx *Engine, climb float32, avoid *avoidSet, lim searchLimits, src, dst uint32) *route {
	s.reset()
	s.settled = 0
	s.stop = stopExhausted
	if ctx.Err() != nil { // short searches never reach the periodic check below
		s.stop = stopCanceled
		return nil
	}
	g := cx.g
	nodes, edges := g.nodes, g.edges
	var tg [maxLandmarkValues]uint16
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
	// The landmark bound includes the climb it was built with. A search that penalises climbing less
	// has costs of at least climb/alt.climb times it (cost = flat + climb*ascent, and flat >= flat*ratio),
	// so scaling keeps the bound a lower bound.
	scale := float32(1)
	if directional && climb < cx.alt.climb {
		scale = climb / cx.alt.climb
	}
	h := func(v uint32) float32 {
		nv := &nodes[v]
		dy := float32(nv.Lat-t.Lat) * kx
		dx := float32(nv.Lon-t.Lon) * ky
		est := float32(math.Sqrt(float64(dx*dx+dy*dy))) * cx.minMult
		var climbTerm float32
		if rise := zt - float32(nv.Elev)*0.1; rise > 0 {
			climbTerm = rise * climb
		}
		switch {
		case directional:
			// The landmark bound already includes climbing: keep the larger bound.
			return max(est+climbTerm, scale*cx.alt.bound(cx.alt.rows[int(v)*cx.alt.rowLen:int(v)*cx.alt.rowLen+cx.alt.rowLen], &tg))
		case cx.alt != nil:
			return max(est, cx.alt.bound(cx.alt.rows[int(v)*cx.alt.rowLen:int(v)*cx.alt.rowLen+cx.alt.rowLen], &tg)) + climbTerm
		}
		return est + climbTerm
	}
	sn := nodes[src]
	dsrc := float32(math.Hypot(float64(sn.Lat-t.Lat)*1e-7*metersPerDegree, float64(sn.Lon-t.Lon)*1e-7*metersPerDegree*cosl))
	// Beyond ten times the crow-flies distance plus the climb to the target, and 5 km, a route is not worth
	// finding. The climb counts, or a short but steep way up would be refused.
	maxCost := 10*(dsrc+climb*max(0, zt-float32(sn.Elev)*0.1)) + 5000

	s.slots[s.find(src)] = slot{key: src, epoch: s.epoch, cost: 0, edge: noEdge}
	s.used++
	s.push(item{f: h(src), node: src})
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
			s.stop = stopCutoff
			break
		}
		s.settled++
		if lim.maxSettled > 0 && s.settled > lim.maxSettled {
			s.stop = stopCap
			return nil
		}
		if s.settled&1023 == 0 && ctx.Err() != nil {
			s.stop = stopCanceled
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
			if lim.forbidden.holds(u, ed.To) {
				continue
			}
			c := ed.Len * cx.mult[ed.Kind][ed.Surf]
			if dz := float32(nv.Elev-nu.Elev) * 0.1; dz > 0 {
				c += dz * climb
			}
			if avoid != nil && avoid.contains(pairKey(u, ed.To)) {
				c *= avoidMult
			}
			ng := it.g + c
			i := s.find(ed.To)
			fresh := s.slots[i].epoch != s.epoch
			if fresh || ng < s.slots[i].cost {
				if fresh {
					if (s.used+1)*2 > len(s.slots) {
						if ctx.Err() != nil { // growing copies tens of MB and cannot be interrupted
							s.stop = stopCanceled
							return nil
						}
						s.grow()
						i = s.find(ed.To)
					}
					s.used++
				}
				s.slots[i] = slot{key: ed.To, epoch: s.epoch, cost: ng, edge: e}
				s.push(item{f: ng + h(ed.To), g: ng, node: ed.To})
			}
		}
	}
	if !found {
		return nil
	}
	r := &route{cost: s.slots[s.find(dst)].cost, nodes: []uint32{dst}}
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

func ascent(g *graph, nodes []uint32) float64 {
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

// descent is the elevation loss along nodes, counted as ascent is.
func descent(g *graph, nodes []uint32) float64 {
	back := make([]uint32, len(nodes))
	for i, n := range nodes {
		back[len(nodes)-1-i] = n
	}
	return ascent(g, back)
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

type loopParams struct {
	distM, ascentM float64
	ascentBand     AscentBand
	// effort, when set, is the target duration as an effort distance: loops are sized and scored on their effort
	// distance instead of their length. distM then only sizes the first circle.
	effort     *EffortTarget
	candidates int
	seed       uint64
	// anchors are the nodes every loop goes through in order, from the start node back to it: the start
	// node, the user's waypoints, the start node. Nil for a loop with no waypoints. baseM is the length
	// of the cheapest loop through them, and baseEffort its effort distance.
	anchors    []uint32
	baseM      float64
	baseEffort float64
	// stats, when set, counts why candidates fail. Nil in the product: finding why costs extra searches.
	stats *LoopStats
	// forbidden is what the request's avoided areas leave out of the searches, or nil for none.
	forbidden *forbidden
}

type loopResult struct {
	nodes, edges                        []uint32
	dist, ascent, trail, overlap, score float64
}

func (lp *loopParams) score(dist, effort, ascent, overlap float64) float64 {
	length, target := dist, lp.distM
	if lp.effort != nil {
		length, target = effort, lp.effort.Metres
	}
	s := 3*math.Abs(length-target)/target + 3*overlap/dist
	if lp.ascentM > 0 {
		s += 2 * math.Abs(ascent-lp.ascentM) / math.Max(lp.ascentM, 50)
	}
	return s
}

func measure(g *graph, nodes, edges []uint32) (dist, trail, overlap float64) {
	seen := newAvoidSet()
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

// chainLegs routes each leg between consecutive points, a leg avoiding the ways the earlier ones used.
// It returns CauseNone on success, otherwise why a leg failed. With diagnosing, which costs extra searches,
// the cause is told apart as diagnose does; without, it is what the search itself saw.
func chainLegs(ctx context.Context, cx *Engine, s *searcher, climb float32, lim searchLimits, diagnosing bool, points []uint32) (nodes, edges []uint32, cause LegCause) {
	avoid := newAvoidSet()
	for j := 1; j < len(points); j++ {
		if points[j-1] == points[j] {
			return nil, nil, CauseSameNode
		}
		var av *avoidSet
		if avoid.n > 0 {
			av = avoid
		}
		leg := s.route(ctx, cx, climb, av, lim, points[j-1], points[j])
		if leg == nil {
			if diagnosing {
				return nil, nil, diagnose(ctx, cx, s, climb, av, lim, points[j-1], points[j], s.stop)
			}
			return nil, nil, searchCause(s.stop)
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
	return nodes, edges, CauseNone
}

// withControlPoints inserts the control points into the legs between the anchors, each into the leg it
// is nearest to, and in the order along that leg. Positions are metres east and north of the start.
func withControlPoints(anchors, control []uint32, xy func(uint32) (x, y float64)) []uint32 {
	type placed struct {
		node uint32
		t    float64
	}
	legs := make([][]placed, len(anchors)-1)
	for _, c := range control {
		cx, cy := xy(c)
		bestLeg, bestT, bestD := 0, 0.0, math.Inf(1)
		for i := range legs {
			ax, ay := xy(anchors[i])
			bx, by := xy(anchors[i+1])
			dx, dy := bx-ax, by-ay
			t := 0.0
			if l2 := dx*dx + dy*dy; l2 > 0 {
				t = math.Max(0, math.Min(1, ((cx-ax)*dx+(cy-ay)*dy)/l2))
			}
			if d := math.Hypot(cx-(ax+t*dx), cy-(ay+t*dy)); d < bestD {
				bestLeg, bestT, bestD = i, t, d
			}
		}
		legs[bestLeg] = append(legs[bestLeg], placed{c, bestT})
	}
	out := []uint32{anchors[0]}
	for i, leg := range legs {
		sort.SliceStable(leg, func(a, b int) bool { return leg[a].t < leg[b].t })
		for _, p := range leg {
			out = append(out, p.node)
		}
		out = append(out, anchors[i+1])
	}
	return out
}

// collapse drops the points equal to the one before them.
func collapse(points []uint32) []uint32 {
	out := points[:0:0]
	for _, p := range points {
		if n := len(out); n == 0 || out[n-1] != p {
			out = append(out, p)
		}
	}
	return out
}

// loopPoints is the chain a loop is routed through: the start, the control points and the start again, with a point
// that repeats the one before it dropped. With anchors, the control points only add detours between the fixed points.
// A chain of fewer than three points does not make a loop.
func loopPoints(start uint32, circle, anchors []uint32, xy func(uint32) (x, y float64)) []uint32 {
	circle = collapse(circle)
	if anchors != nil {
		return collapse(withControlPoints(anchors, circle, xy))
	}
	return collapse(append(append([]uint32{start}, circle...), start))
}

// liftReach is how far, as a share of the circle's radius, a control point may move to a higher or lower
// node when the loop is as far from its elevation gain as can be.
const liftReach = 0.4

// A control point is moved to the nearest node within snapReach of it. On a long loop, in a valley with
// steep sides, most points of the circle fall where no way is mapped within 400 m, and 87 of 100 candidates
// were lost at Chamonix; the reach follows the circle, and the resizing then corrects the distance.
const snapReachShare = 0.3

func snapReach(radiusM float64) float64 {
	return math.Max(float64(maxSnapMeters), snapReachShare*radiusM)
}

// climbLift tells how the next resizing should move the control points to fix the elevation gain: a share
// of 1 at most towards higher nodes (positive) when the loop climbs too little, towards lower ones
// (negative) when it climbs too much, and 0 with no target, no band or inside the band.
func climbLift(ascent, target float64, band AscentBand) float64 {
	if target <= 0 || band == (AscentBand{}) || math.Abs(ascent-target) <= math.Max(band.Share*target, band.FloorM) {
		return 0
	}
	return math.Max(-1, math.Min(1, (target-ascent)/target))
}

// liftedNode is the highest node (lift > 0) or lowest (lift < 0) among base and those nearest to eight
// points reachM around it, leaving out the nodes of small components, or base for no lift. Fixed directions keep
// a seed's loops the same.
func liftedNode(g *graph, sp *spatial, base uint32, reachM, lift float64, f *forbidden) uint32 {
	if lift == 0 {
		return base
	}
	b := g.nodes[base]
	lat, lon := float64(b.Lat)*1e-7, float64(b.Lon)*1e-7
	cosl := math.Cos(lat * rad)
	sign := int32(1)
	if lift < 0 {
		sign = -1
	}
	best, small := base, g.small
	for k := 0; k < 8; k++ {
		a := float64(k) * math.Pi / 4
		n, d, ok := sp.nearest(g, lat+reachM*math.Sin(a)/metersPerDegree, lon+reachM*math.Cos(a)/(metersPerDegree*cosl))
		if ok && d <= maxSnapMeters && sign*g.nodes[n].Elev > sign*g.nodes[best].Elev && !small.has(n) && !f.has(n) {
			best = n
		}
	}
	return best
}

// circleTries is how many turns of the control circle are tried before a candidate is given up.
const circleTries = 8

// goldenAngle spreads successive turns of the circle as evenly as can be, whatever their number.
const goldenAngle = 2.399963229728653

// circlePoints is the node of each control point of the circle of radius rc whose centre lies towards theta
// from the point (slat, slon), or false when one is farther than snapReach from any way.
func circlePoints(g *graph, sp *spatial, slat, slon, rc, theta float64, jitter []float64, lift float64, f *forbidden) ([]uint32, bool) {
	cosl := math.Cos(slat * rad)
	cxm, cym := rc*math.Cos(theta), rc*math.Sin(theta)
	nodes := make([]uint32, 0, len(jitter))
	small := g.small
	for j := range jitter {
		phi := theta + math.Pi + 2*math.Pi*float64(j+1)/float64(len(jitter)+1)
		x, y := cxm+rc*jitter[j]*math.Cos(phi), cym+rc*jitter[j]*math.Sin(phi)
		n, d, ok := sp.nearestWhere(g, slat+y/metersPerDegree, slon+x/(metersPerDegree*cosl), f.skip(), 0)
		if !ok || d > snapReach(rc) || small.has(n) {
			return nil, false
		}
		nodes = append(nodes, liftedNode(g, sp, n, math.Abs(lift)*liftReach*rc, lift, f))
	}
	return nodes, true
}

// rotatedCircle is circlePoints for theta, or for the first of the next turns that falls on ways. In a valley
// most directions lead to a wall: at Chamonix, 30 km, 44 % of the circles had a point beyond reach, and turning
// it up to circleTries times leaves none. The turn it used comes back, to be kept for the resizings.
func rotatedCircle(g *graph, sp *spatial, slat, slon, rc, theta float64, jitter []float64, lift float64, f *forbidden) ([]uint32, float64, bool) {
	for r := 0; r < circleTries; r++ {
		turned := theta + float64(r)*goldenAngle
		if nodes, ok := circlePoints(g, sp, slat, slon, rc, turned, jitter, lift, f); ok {
			return nodes, turned, true
		}
	}
	return nil, theta, false
}

func candidate(ctx context.Context, cx *Engine, sp *spatial, s *searcher, lp *loopParams, start uint32, index int) *loopResult {
	best, cause := candidateLoop(ctx, cx, sp, s, lp, start, index)
	if lp.stats != nil && ctx.Err() == nil {
		lp.stats.record(cause, best == nil)
	}
	return best
}

// candidateLoop is candidate, and says why it stopped short of its four resizings, if it did.
func candidateLoop(ctx context.Context, cx *Engine, sp *spatial, s *searcher, lp *loopParams, start uint32, index int) (*loopResult, LegCause) {
	g := cx.g
	rng := newSplitmix(lp.seed, uint64(index))
	climb := cx.prof.UpPerMeter * float32(2*rng.f64())
	k := 2 + int(rng.below(3))
	theta := rng.f64() * 2 * math.Pi
	// With waypoints, the circle only has to make up what the loop through them lacks.
	extraM := lp.distM
	if lp.anchors != nil {
		target, base := lp.distM, lp.baseM
		if lp.effort != nil {
			target, base = lp.effort.Metres, lp.baseEffort
		}
		extraM = math.Max(target-base, minDetourShare*target)
	}
	rc := extraM / (2 * math.Pi * 1.3)
	sn := g.nodes[start]
	slat, slon := float64(sn.Lat)*1e-7, float64(sn.Lon)*1e-7
	cosl := math.Cos(slat * rad)
	xy := func(n uint32) (float64, float64) {
		nd := g.nodes[n]
		return (float64(nd.Lon)*1e-7 - slon) * metersPerDegree * cosl, (float64(nd.Lat)*1e-7 - slat) * metersPerDegree
	}
	jitter := make([]float64, k)
	for j := range jitter {
		jitter[j] = 0.85 + 0.3*rng.f64()
	}
	var best *loopResult
	lift := 0.0
	for iter := 0; iter < 4; iter++ {
		if ctx.Err() != nil {
			return best, CauseCanceled
		}
		circle, turned, ok := rotatedCircle(g, sp, slat, slon, rc, theta, jitter, lift, lp.forbidden)
		if !ok {
			return best, CauseNoSnap
		}
		theta = turned
		points := loopPoints(start, circle, lp.anchors, xy)
		if len(points) < 3 {
			// Every control point fell on the one before it: the chain is no loop.
			return best, CauseSameNode
		}
		nodes, edges, cause := chainLegs(ctx, cx, s, climb, searchLimits{loopLegMaxSettled, lp.forbidden}, lp.stats != nil, points)
		if cause != CauseNone {
			return best, cause
		}
		dist, trail, overlap := measure(g, nodes, edges)
		effort := 0.0
		if lp.effort != nil {
			effort = dist * effortFactor(g, nodes, lp.effort.Slope)
		}
		asc := ascent(g, nodes)
		sc := lp.score(dist, effort, asc, overlap)
		if best == nil || sc < best.score {
			best = &loopResult{nodes, edges, dist, asc, trail, overlap, sc}
		}
		lift = climbLift(asc, lp.ascentM, lp.ascentBand)
		measured, target := dist, lp.distM
		if lp.effort != nil {
			measured, target = effort, lp.effort.Metres
		}
		if math.Abs(measured-target) < 0.03*target && lift == 0 {
			break
		}
		if lp.anchors != nil {
			// Only the detour is resized: the loop through the waypoints stays what it is.
			added := dist - lp.baseM
			if lp.effort != nil {
				added = effort - lp.baseEffort
			}
			if added > 1 {
				rc *= extraM / added
			} else {
				rc *= 2
			}
		} else if lp.effort != nil {
			rc *= lp.effort.Metres / effort
		} else {
			rc *= lp.distM / dist
		}
	}
	return best, CauseNone
}

// maxSearchWorkers is how many CPUs one loop search uses at most: beyond it, more workers find nothing
// faster, since the candidates run out.
const maxSearchWorkers = 8

func searchWorkers(procs int) int { return min(procs, maxSearchWorkers) }

// DefaultConcurrentSearches is how many loop searches to let run at once on this machine: one per CPU. More
// at once do not raise the throughput, they only make each one wait longer: on one CPU, four at once answered
// the same 13 requests a second as one at a time, with a median of 206 ms and a 99th percentile of 1.7 s against
// 21 ms and 0.5 s, and held four times the memory; what they save is the requests refused, 41 % of those of
// eight clients against 65 %, and the web app asks again. A container counts at least 2 CPUs to Go: a
// deployment with fewer sets LOOP_LIMIT itself.
func DefaultConcurrentSearches() int { return concurrentSearches(runtime.GOMAXPROCS(0)) }

func concurrentSearches(procs int) int { return max(1, procs) }

// generate runs lp.candidates candidates on the workers, and returns them in no particular order.
// After each one, enough sees every loop found so far, one call at a time, and returns true to
// stop the search: the candidates still running are dropped. When ctx ends it returns the
// candidates finished so far. A panic in a worker, which would take the whole process down since
// nothing above it can recover, stops the search and comes back as an error.
func generate(ctx context.Context, cx *Engine, sp *spatial, lp *loopParams, start uint32, enough func([]*loopResult) bool) ([]*loopResult, error) {
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	// GOMAXPROCS follows the container's CPU limit (Go 1.25+); NumCPU would not.
	workers := searchWorkers(runtime.GOMAXPROCS(0))
	var next atomic.Int64
	var mu sync.Mutex
	var found []*loopResult
	var failure error
	done := false
	report := func(l *loopResult) {
		mu.Lock()
		defer mu.Unlock()
		if done {
			return
		}
		found = append(found, l)
		if enough != nil && enough(found) {
			done = true
			stop()
		}
	}
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					mu.Lock()
					failure, done = fmt.Errorf("engine: a loop search panicked: %v", r), true
					mu.Unlock()
					stop()
				}
			}()
			s := searcherPool.Get().(*searcher)
			defer searcherPool.Put(s)
			for {
				i := int(next.Add(1) - 1)
				if i >= lp.candidates || ctx.Err() != nil {
					return
				}
				if l := candidate(ctx, cx, sp, s, lp, start, i); l != nil {
					report(l)
				}
			}
		}()
	}
	wg.Wait()
	return found, failure
}
