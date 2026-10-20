package graphbuild

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"

	"github.com/lesloi/path-finder/apps/server/elevation"
	"github.com/lesloi/path-finder/apps/server/engine"
)

// The build of a graph whose memory does not grow with the country: the steps that held every node in memory (the index
// of the nodes, the elevation, the degrees and the ranks are the big ones) are done by sorting records on disk and
// reading them back in order. It writes the same graph file as Build, byte for byte, for one extract that is sorted by
// node id; Build stays for several extracts and as the oracle of the tests.
//
// The order of the steps: the references of the ways are sorted by node id and joined with the extract; each node is
// numbered as it is met, and its references go back to the order of the ways; the nodes are sorted by DEM tile to be
// given their elevation; the steps of the ways are counted to find the nodes that are kept; those are sorted along the
// Hilbert curve, which gives their rank; the edges are sorted by the rank of their source; the sections are then put in
// one file. The tie of the curve is the order a node was first met in, as in Build.

const none = math.MaxUint32 // the number of a node the extract does not hold

type i32 = int32

func le32(b []byte, at int) uint32 { return binary.LittleEndian.Uint32(b[at:]) }
func put32(b []byte, at int, v uint32) {
	binary.LittleEndian.PutUint32(b[at:], v)
}

func cmpU[T uint32 | uint64 | int64](a, b T) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

func cmpThen(first int, then func() int) int {
	if first != 0 {
		return first
	}
	return then()
}

// idRef is a reference of a way to a node, and its position among all the references.
type idRef struct {
	id  int64
	seq uint32
}

// The references are sorted by node id, then by position, so that the first reference to a node is the first met.
var idRefCodec = codec[idRef]{
	size: 12,
	put: func(b []byte, r idRef) {
		binary.LittleEndian.PutUint64(b, uint64(r.id))
		put32(b, 8, r.seq)
	},
	get: func(b []byte) idRef { return idRef{int64(binary.LittleEndian.Uint64(b)), le32(b, 8)} },
	cmp: func(a, b idRef) int { return cmpThen(cmpU(a.id, b.id), func() int { return cmpU(a.seq, b.seq) }) },
}

// ref is a reference once its node is known: the position among the references, the number of its node (none when the
// extract does not hold it) and the node's position.
type ref struct {
	seq, node uint32
	lat, lon  i32
}

var refCodec = codec[ref]{
	size: 16,
	put: func(b []byte, r ref) {
		put32(b, 0, r.seq)
		put32(b, 4, r.node)
		put32(b, 8, uint32(r.lat))
		put32(b, 12, uint32(r.lon))
	},
	get: func(b []byte) ref { return ref{le32(b, 0), le32(b, 4), i32(le32(b, 8)), i32(le32(b, 12))} },
	cmp: func(a, b ref) int { return cmpU(a.seq, b.seq) },
}

// tileNode is a node and the DEM tile it falls in; the nodes of a tile are sorted by number, which is the order they
// were met in.
type tileNode struct {
	tile, node uint32
	lat, lon   i32
}

var tileNodeCodec = codec[tileNode]{
	size: 16,
	put: func(b []byte, r tileNode) {
		put32(b, 0, r.tile)
		put32(b, 4, r.node)
		put32(b, 8, uint32(r.lat))
		put32(b, 12, uint32(r.lon))
	},
	get: func(b []byte) tileNode { return tileNode{le32(b, 0), le32(b, 4), i32(le32(b, 8)), i32(le32(b, 12))} },
	cmp: func(a, b tileNode) int {
		return cmpThen(cmpU(a.tile, b.tile), func() int { return cmpU(a.node, b.node) })
	},
}

type nodeElev struct {
	node uint32
	elev i32
}

var nodeElevCodec = codec[nodeElev]{
	size: 8,
	put:  func(b []byte, r nodeElev) { put32(b, 0, r.node); put32(b, 4, uint32(r.elev)) },
	get:  func(b []byte) nodeElev { return nodeElev{le32(b, 0), i32(le32(b, 4))} },
	cmp:  func(a, b nodeElev) int { return cmpU(a.node, b.node) },
}

// seen is what the table of nodes holds: the position of the first reference to a node, and where the node is.
type seen struct {
	first    uint32
	lat, lon i32
}

var seenCodec = codec[seen]{
	size: 12,
	put:  func(b []byte, r seen) { put32(b, 0, r.first); put32(b, 4, uint32(r.lat)); put32(b, 8, uint32(r.lon)) },
	get:  func(b []byte) seen { return seen{le32(b, 0), i32(le32(b, 4)), i32(le32(b, 8))} },
}

// curved is a node that is kept, with its place along the Hilbert curve and the position of its first reference.
type curved struct {
	key         uint64
	first, node uint32
	lat, lon    i32
	elev        i32
}

var curvedCodec = codec[curved]{
	size: 28,
	put: func(b []byte, r curved) {
		binary.LittleEndian.PutUint64(b, r.key)
		put32(b, 8, r.first)
		put32(b, 12, r.node)
		put32(b, 16, uint32(r.lat))
		put32(b, 20, uint32(r.lon))
		put32(b, 24, uint32(r.elev))
	},
	get: func(b []byte) curved {
		return curved{binary.LittleEndian.Uint64(b), le32(b, 8), le32(b, 12), i32(le32(b, 16)), i32(le32(b, 20)), i32(le32(b, 24))}
	},
	cmp: func(a, b curved) int {
		return cmpThen(cmpU(a.key, b.key), func() int { return cmpU(a.first, b.first) })
	},
}

// cellNode is a node of the graph, by rank, and the cell of the spatial index it is in.
type cellNode struct{ cell, rank uint32 }

var cellNodeCodec = codec[cellNode]{
	size: 8,
	put:  func(b []byte, r cellNode) { put32(b, 0, r.cell); put32(b, 4, r.rank) },
	get:  func(b []byte) cellNode { return cellNode{le32(b, 0), le32(b, 4)} },
	cmp: func(a, b cellNode) int {
		return cmpThen(cmpU(a.cell, b.cell), func() int { return cmpU(a.rank, b.rank) })
	},
}

// outEdge is an edge of the graph by the rank of its source, and the position of the step it comes from, which orders
// the edges of a node as Build meets them.
type outEdge struct {
	src, step, dst, length, attrs uint32
}

var outEdgeCodec = codec[outEdge]{
	size: 20,
	put: func(b []byte, r outEdge) {
		put32(b, 0, r.src)
		put32(b, 4, r.step)
		put32(b, 8, r.dst)
		put32(b, 12, r.length)
		put32(b, 16, r.attrs)
	},
	get: func(b []byte) outEdge { return outEdge{le32(b, 0), le32(b, 4), le32(b, 8), le32(b, 12), le32(b, 16)} },
	cmp: func(a, b outEdge) int { return cmpThen(cmpU(a.src, b.src), func() int { return cmpU(a.step, b.step) }) },
}

// edgeWordCodec is an edge of the graph file: the target, the length, then the kind, the surface, the flags and a
// padding byte.
var edgeWordCodec = codec[[3]uint32]{
	size: 12,
	put:  func(b []byte, r [3]uint32) { put32(b, 0, r[0]); put32(b, 4, r[1]); put32(b, 8, r[2]) },
	get:  func(b []byte) [3]uint32 { return [3]uint32{le32(b, 0), le32(b, 4), le32(b, 8)} },
}

// wordCodec is one 32-bit number of a section of the graph file.
var wordCodec = codec[uint32]{
	size: 4,
	put:  func(b []byte, v uint32) { put32(b, 0, v) },
	get:  func(b []byte) uint32 { return le32(b, 0) },
}

// wayInfo is what the build needs to know of a way once its references are in order: how many, and what kind of way it is.
type wayInfo struct{ length, attrs uint32 }

func scanPBF(path string, skipNodes, skipWays bool, each func(osm.Object) error) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := osmpbf.New(context.Background(), f, runtime.GOMAXPROCS(0))
	defer sc.Close()
	sc.SkipNodes, sc.SkipWays, sc.SkipRelations = skipNodes, skipWays, true
	for sc.Scan() {
		if err := each(sc.Object()); err != nil {
			return err
		}
	}
	return sc.Err()
}

// refs is what the pass over the ways leaves: their references as runs sorted by node id, and the ways.
type refs struct {
	byID  *spill[idRef]
	count uint32
	ways  []wayInfo
}

// spillRefs writes the references of the walkable ways of the extract as runs sorted by node id.
func spillRefs(pbf, dir string, chunk int) (*refs, error) {
	r := &refs{byID: newSpill(dir, "id", idRefCodec, chunk)}
	err := scanPBF(pbf, true, false, func(o osm.Object) error {
		w, ok := o.(*osm.Way)
		if !ok {
			return nil
		}
		kind, surf, flags, ok := classifyWay(w.Tags)
		if !ok || len(w.Nodes) < 2 {
			return nil
		}
		if uint64(r.count)+uint64(len(w.Nodes)) > math.MaxUint32 {
			return errors.New("more than 2^32 - 1 references")
		}
		r.ways = append(r.ways, wayInfo{uint32(len(w.Nodes)), uint32(kind) | uint32(surf)<<8 | uint32(flags)<<16})
		for _, n := range w.Nodes {
			if err := r.byID.push(idRef{int64(n.ID), r.count}); err != nil {
				return err
			}
			r.count++
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r, r.byID.flush()
}

// joinNodes joins the references with the nodes of the extract in one merge, and calls found(reference, position, first)
// for each: the position is nil for a node that is not in the extract, and first is true for the first reference to a node.
func joinNodes(pbf string, r *refs, found func(h idRef, at *[2]i32, first bool) error) error {
	ids, err := r.byID.merge()
	if err != nil {
		return err
	}
	defer ids.close()
	head, more, err := ids.next()
	if err != nil {
		return err
	}
	last, lastFound := int64(math.MinInt64), int64(math.MinInt64)
	step := func(at *[2]i32) error {
		first := head.id != lastFound
		lastFound = head.id
		if err := found(head, at, first); err != nil {
			return err
		}
		head, more, err = ids.next()
		return err
	}
	err = scanPBF(pbf, false, true, func(o osm.Object) error {
		n, ok := o.(*osm.Node)
		if !ok {
			return nil
		}
		id := int64(n.ID)
		if id < last {
			return errors.New("the extract is not sorted by node id")
		}
		last = id
		at := [2]i32{i32(math.Round(n.Lat * 1e7)), i32(math.Round(n.Lon * 1e7))}
		for more && head.id <= id {
			var p *[2]i32
			if head.id == id {
				p = &at
			}
			if err := step(p); err != nil {
				return err
			}
		}
		return nil
	})
	for err == nil && more { // the references to nodes after the last of the extract
		err = step(nil)
	}
	return err
}

// Options say how a build runs on disk: where the temporary files go (beside the graph by default), how many records one
// sort holds in memory, and how many DEM tiles the elevation keeps.
type Options struct {
	Tmp          string
	Chunk, Cache int
}

const (
	// DefaultChunk is about 100 MB of records per sort.
	DefaultChunk = 8_000_000
	DefaultCache = 128
)

// Report says what a build on disk counted.
type Report struct {
	Nodes, Edges uint64
	TileLoads    uint64
	Runs         int
	SpilledBytes int64
}

// BuildGraph builds the graph file of the extracts, on disk when there is one extract: its memory then does not grow
// with the country. Several extracts, which are the small territories, are joined in memory.
func BuildGraph(pbfPaths []string, demDir string, proj elevation.Projection, outPath string, opts Options, log io.Writer) error {
	if len(pbfPaths) != 1 {
		fmt.Fprintf(log, "%d extracts: built in memory\n", len(pbfPaths))
		return Build(pbfPaths, demDir, proj, outPath, log)
	}
	if opts.Tmp == "" {
		opts.Tmp = filepath.Dir(outPath) // never a memory-backed /tmp: the runs are as big as the extract
	}
	start := time.Now()
	r, err := BuildOnDisk(pbfPaths[0], demDir, proj, outPath, opts.Tmp, opts, log)
	if err != nil {
		return err
	}
	fmt.Fprintf(log, "graph built on disk in %.1f s: %d nodes, %d directed edges, %d tile reads, %d MB of temporary files in %d runs\n",
		time.Since(start).Seconds(), r.Nodes, r.Edges, r.TileLoads, r.SpilledBytes>>20, r.Runs)
	return nil
}

// scratch makes the directory of the runs below tmp, and returns a function that removes it.
func scratch(tmp string) (string, func(), error) {
	dir := filepath.Join(tmp, fmt.Sprintf("pf-external-%d", os.Getpid()))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, err
	}
	return dir, func() { os.RemoveAll(dir) }, nil
}

// forEachStep calls f for each step of each way, in the order of the ways, with the two references of the step and the
// position of the second among all the references. The references come sorted by position.
func forEachStep(refs *spill[ref], ways []wayInfo, f func(a, b ref, attrs uint32) error) error {
	m, err := refs.merge()
	if err != nil {
		return err
	}
	defer m.close()
	var expect uint32
	take := func() (ref, error) {
		r, ok, err := m.next()
		if err == nil && (!ok || r.seq != expect) {
			err = fmt.Errorf("reference %d was lost on the way", expect)
		}
		expect++
		return r, err
	}
	for _, w := range ways {
		prev, err := take()
		if err != nil {
			return err
		}
		for i := uint32(1); i < w.length; i++ {
			cur, err := take()
			if err != nil {
				return err
			}
			if err := f(prev, cur, w.attrs); err != nil {
				return err
			}
			prev = cur
		}
	}
	return nil
}

// BuildOnDisk writes the graph of one extract (sorted by node id) and the tiles below demDir to outPath, as Build does,
// with the memory of a few sorts, a few tiles and a few numbers per node, and the rest on disk below tmp.
func BuildOnDisk(pbf, demDir string, proj elevation.Projection, outPath, tmp string, opts Options, log io.Writer) (Report, error) {
	var rep Report
	p := progress{log, time.Now()}
	if n, err := elevation.CountTiles(demDir); err != nil {
		return rep, err
	} else if n == 0 {
		return rep, fmt.Errorf("%w in %s", elevation.ErrNoTile, demDir)
	}
	dem, err := elevation.OpenLazy(demDir, proj, opts.Cache)
	if err != nil {
		return rep, err
	}
	dir, cleanup, err := scratch(tmp)
	if err != nil {
		return rep, err
	}
	defer cleanup()
	var tot totals
	chunk := opts.Chunk

	// Each node met is numbered 0, 1, 2… in the order of its id; its references leave in the order of the ways.
	r, err := spillRefs(pbf, dir, chunk)
	if err != nil {
		return rep, err
	}
	p.step("pass 1: %d walkable ways", len(r.ways))
	seenTab, err := createTable(dir, "nodes.tab", seenCodec)
	if err != nil {
		return rep, err
	}
	byTile := newSpill(dir, "tile", tileNodeCodec, chunk)
	bySeq := newSpill(dir, "seq", refCodec, chunk)
	var nodes uint32
	current := uint32(none)
	err = joinNodes(pbf, r, func(h idRef, at *[2]i32, first bool) error {
		lat, lon := i32(math.MinInt32), i32(0)
		if at != nil {
			lat, lon = at[0], at[1]
		}
		if at != nil && first {
			if nodes == none {
				return errors.New("more than 2^32 - 1 nodes")
			}
			current = nodes
			nodes++
			if err := seenTab.put(seen{h.seq, lat, lon}); err != nil {
				return err
			}
			if err := byTile.push(tileNode{dem.TileKey(lat, lon), current, lat, lon}); err != nil {
				return err
			}
		}
		u := uint32(none)
		if at != nil {
			u = current
		}
		return bySeq.push(ref{h.seq, u, lat, lon})
	})
	if err != nil {
		return rep, err
	}
	ways := r.ways
	r.byID.finish(&tot)
	p.step("%d candidate nodes joined with the extract", nodes)

	// The elevation of every node, tile by tile; only whether it is known stays in memory, the number goes back on disk.
	known := make([]uint64, (nodes+63)/64)
	byNode := newSpill(dir, "elev", nodeElevCodec, chunk)
	tiles, err := byTile.merge()
	if err != nil {
		return rep, err
	}
	for {
		t, ok, err := tiles.next()
		if err != nil {
			return rep, err
		}
		if !ok {
			break
		}
		elev, err := dem.Sample(t.lat, t.lon)
		if err != nil {
			tiles.close()
			return rep, err
		}
		if elev != elevation.Unknown {
			known[t.node/64] |= 1 << (t.node % 64)
		}
		if err := byNode.push(nodeElev{t.node, elev}); err != nil {
			return rep, err
		}
	}
	byTile.finish(&tot)
	rep.TileLoads = dem.Loads()
	dem = nil
	runtime.GC() // the tiles are the biggest thing in memory, and they are out of reach now
	p.step("elevation sampled")
	isKnown := func(u uint32) bool { return u != none && known[u/64]>>(u%64)&1 == 1 }
	usable := func(a, b ref) bool { return a.node != b.node && isKnown(a.node) && isKnown(b.node) }

	// The degree of each node: the nodes of no step are left out of the graph.
	deg := make([]uint32, nodes)
	var edges uint64
	err = forEachStep(bySeq, ways, func(a, b ref, _ uint32) error {
		if usable(a, b) {
			deg[a.node]++
			deg[b.node]++
			edges += 2
		}
		return nil
	})
	if err != nil {
		return rep, err
	}
	if edges == 0 {
		return rep, errors.New(noEdges(demDir))
	}
	if edges > math.MaxUint32 {
		return rep, errors.New("more than 2^32 - 1 edges")
	}
	minLat, minLon, maxLat, maxLon := i32(math.MaxInt32), i32(math.MaxInt32), i32(math.MinInt32), i32(math.MinInt32)
	var kept uint32
	all, err := seenTab.reader()
	if err != nil {
		return rep, err
	}
	for _, d := range deg {
		s, err := all.next()
		if err != nil {
			return rep, err
		}
		if d > 0 {
			minLat, maxLat = min(minLat, s.lat), max(maxLat, s.lat)
			minLon, maxLon = min(minLon, s.lon), max(maxLon, s.lon)
			kept++
		}
	}
	all.close()
	p.step("graph: %d nodes, %d directed edges", kept, edges)

	// The nodes along the Hilbert curve; a tie goes to the node met first.
	cv := newCurve(minLat, minLon, maxLat, maxLon)
	byCurve := newSpill(dir, "curve", curvedCodec, chunk)
	all, err = seenTab.reader()
	if err != nil {
		return rep, err
	}
	elevs, err := byNode.merge()
	if err != nil {
		return rep, err
	}
	for u, d := range deg {
		s, err := all.next()
		if err != nil {
			return rep, err
		}
		e, ok, err := elevs.next()
		if err != nil || !ok {
			return rep, fmt.Errorf("an elevation was lost on the way: %v", err)
		}
		if d > 0 {
			if err := byCurve.push(curved{cv.key(s.lat, s.lon), s.first, uint32(u), s.lat, s.lon, e.elev}); err != nil {
				return rep, err
			}
		}
	}
	all.close()
	byNode.finish(&tot)

	// Ranks: the nodes and their offsets are written in rank order, and the grid of the spatial index is counted.
	nx, ny := engine.GridSize([4]i32{minLat, minLon, maxLat, maxLon})
	counts := make([]uint32, nx*ny+1)
	byCell := newSpill(dir, "cell", cellNodeCodec, chunk)
	nodesOut, err := createTable(dir, "nodes.sec", wordCodec)
	if err != nil {
		return rep, err
	}
	offOut, err := createTable(dir, "off.sec", wordCodec)
	if err != nil {
		return rep, err
	}
	if err := offOut.put(0); err != nil {
		return rep, err
	}
	remap := make([]uint32, nodes)
	var rank, cum uint32
	ordered, err := byCurve.merge()
	if err != nil {
		return rep, err
	}
	for {
		c, ok, err := ordered.next()
		if err != nil {
			return rep, err
		}
		if !ok {
			break
		}
		remap[c.node] = rank
		for _, v := range []uint32{uint32(c.lat), uint32(c.lon), uint32(c.elev)} {
			if err := nodesOut.put(v); err != nil {
				return rep, err
			}
		}
		cum += deg[c.node]
		if err := offOut.put(cum); err != nil {
			return rep, err
		}
		cell := uint32(int((c.lat-minLat)/engine.CellLat)*nx + int((c.lon-minLon)/engine.CellLon))
		counts[cell+1]++
		if err := byCell.push(cellNode{cell, rank}); err != nil {
			return rep, err
		}
		rank++
	}
	byCurve.finish(&tot)
	if rank != kept || uint64(cum) != edges {
		return rep, fmt.Errorf("%d nodes and %d edges out, %d and %d in", rank, cum, kept, edges)
	}
	deg = nil
	_ = seenTab.finish()

	// The edges, in the order of the rank of their source, then of the way steps.
	byEdge := newSpill(dir, "edge", outEdgeCodec, chunk)
	err = forEachStep(bySeq, ways, func(a, b ref, attrs uint32) error {
		if !usable(a, b) {
			return nil
		}
		ra, rb := remap[a.node], remap[b.node]
		length := math.Float32bits(float32(haversineM(a.lat, a.lon, b.lat, b.lon)))
		if err := byEdge.push(outEdge{ra, b.seq, rb, length, attrs}); err != nil {
			return err
		}
		return byEdge.push(outEdge{rb, b.seq, ra, length, attrs})
	})
	if err != nil {
		return rep, err
	}
	bySeq.finish(&tot)
	remap = nil
	edgesOut, err := createTable(dir, "edges.sec", edgeWordCodec)
	if err != nil {
		return rep, err
	}
	var written uint64
	ordered2, err := byEdge.merge()
	if err != nil {
		return rep, err
	}
	for {
		e, ok, err := ordered2.next()
		if err != nil {
			return rep, err
		}
		if !ok {
			break
		}
		if err := edgesOut.put([3]uint32{e.dst, e.length, e.attrs & 0xFFFFFF}); err != nil {
			return rep, err
		}
		written++
	}
	byEdge.finish(&tot)
	if written != edges {
		return rep, fmt.Errorf("%d edges out, %d in", written, edges)
	}

	// The spatial index: where each cell starts, and the nodes sorted by cell.
	for c := 1; c < len(counts); c++ {
		counts[c] += counts[c-1]
	}
	cellsOut, err := createTable(dir, "cells.sec", wordCodec)
	if err != nil {
		return rep, err
	}
	for _, c := range counts {
		if err := cellsOut.put(c); err != nil {
			return rep, err
		}
	}
	counts = nil
	gridOut, err := createTable(dir, "grid.sec", wordCodec)
	if err != nil {
		return rep, err
	}
	ordered3, err := byCell.merge()
	if err != nil {
		return rep, err
	}
	for {
		c, ok, err := ordered3.next()
		if err != nil {
			return rep, err
		}
		if !ok {
			break
		}
		if err := gridOut.put(c.rank); err != nil {
			return rep, err
		}
	}
	byCell.finish(&tot)
	for _, t := range []interface{ finish() error }{nodesOut, offOut, edgesOut, cellsOut, gridOut} {
		if err := t.finish(); err != nil {
			return rep, err
		}
	}
	err = engine.WriteGraphFromParts(outPath, engine.GraphParts{
		Nodes: nodesOut.path, Off: offOut.path, Edges: edgesOut.path, GridCells: cellsOut.path, GridNodes: gridOut.path,
		NodeCount: kept, EdgeCount: uint32(edges), Bounds: [4]i32{minLat, minLon, maxLat, maxLon},
	})
	if err != nil {
		return rep, err
	}
	st, _ := os.Stat(outPath)
	p.step("written %s (%d MB)", outPath, st.Size()>>20)
	return Report{Nodes: uint64(kept), Edges: edges, TileLoads: rep.TileLoads, Runs: tot.runs, SpilledBytes: tot.bytes}, nil
}
