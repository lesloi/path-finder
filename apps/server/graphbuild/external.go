package graphbuild

import (
	"cmp"
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
// of the nodes, the elevation, the degrees and the ranks are the big ones) are done by putting records in order on disk
// and reading them back in that order. A step whose records each know their place in the output puts them there (see
// placed); the others sort them (see spill). It writes the same graph file as Build, byte for byte, for one extract that
// is sorted by node id; Build stays for several extracts and as the oracle of the tests.
//
// The order of the steps: the references of the ways are sorted by node id and joined with the extract; each node is
// numbered as it is met, and its references go back to the order of the ways; the nodes are sorted by DEM tile to be
// given their elevation; the steps of the ways are counted to find the nodes that are kept; those are sorted along the
// Hilbert curve, which gives their rank; the edges go to their place, after those of the nodes of lower rank; the
// sections are then put in one file. The tie of the curve is the order a node was first met in, as in Build.

const none uint32 = math.MaxUint32 // the number of a node the extract does not hold

func le32(b []byte, at int) uint32 { return binary.LittleEndian.Uint32(b[at:]) }
func put32(b []byte, at int, v uint32) {
	binary.LittleEndian.PutUint32(b[at:], v)
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
	cmp: func(a, b idRef) int { return cmp.Or(cmp.Compare(a.id, b.id), cmp.Compare(a.seq, b.seq)) },
}

// ref is a reference once its node is known: the position among the references, the number of its node (none when the
// extract does not hold it) and the node's position.
type ref struct {
	seq, node uint32
	lat, lon  int32
}

var refCodec = codec[ref]{
	size: 16,
	put: func(b []byte, r ref) {
		put32(b, 0, r.seq)
		put32(b, 4, r.node)
		put32(b, 8, uint32(r.lat))
		put32(b, 12, uint32(r.lon))
	},
	get: func(b []byte) ref { return ref{le32(b, 0), le32(b, 4), int32(le32(b, 8)), int32(le32(b, 12))} },
}

func refSeq(r ref) uint32 { return r.seq }

// tileNode is a node and the DEM tile it falls in; the nodes of a tile are sorted by number, which is the order they
// were met in. The node's place is already projected onto the grid of the tiles: the projection is the dearest part of
// finding a height after reading the tiles, and it is done once, for the tile and for the height.
type tileNode struct {
	tile, node uint32
	x, y       float64
}

var tileNodeCodec = codec[tileNode]{
	size: 24,
	put: func(b []byte, r tileNode) {
		put32(b, 0, r.tile)
		put32(b, 4, r.node)
		binary.LittleEndian.PutUint64(b[8:], math.Float64bits(r.x))
		binary.LittleEndian.PutUint64(b[16:], math.Float64bits(r.y))
	},
	get: func(b []byte) tileNode {
		return tileNode{le32(b, 0), le32(b, 4), math.Float64frombits(binary.LittleEndian.Uint64(b[8:])), math.Float64frombits(binary.LittleEndian.Uint64(b[16:]))}
	},
	cmp: func(a, b tileNode) int {
		return cmp.Or(cmp.Compare(a.tile, b.tile), cmp.Compare(a.node, b.node))
	},
}

type nodeElev struct {
	node uint32
	elev int32
}

var nodeElevCodec = codec[nodeElev]{
	size: 8,
	put:  func(b []byte, r nodeElev) { put32(b, 0, r.node); put32(b, 4, uint32(r.elev)) },
	get:  func(b []byte) nodeElev { return nodeElev{le32(b, 0), int32(le32(b, 4))} },
}

func nodeElevNode(r nodeElev) uint32 { return r.node }

// seen is what the table of nodes holds: the position of the first reference to a node, and where the node is.
type seen struct {
	first    uint32
	lat, lon int32
}

var seenCodec = codec[seen]{
	size: 12,
	put:  func(b []byte, r seen) { put32(b, 0, r.first); put32(b, 4, uint32(r.lat)); put32(b, 8, uint32(r.lon)) },
	get:  func(b []byte) seen { return seen{le32(b, 0), int32(le32(b, 4)), int32(le32(b, 8))} },
}

// curved is a node that is kept, with its place along the Hilbert curve, the position of its first reference and its
// degree: carried here, the degrees are not in memory while the ranks are given.
type curved struct {
	key         uint64
	first, node uint32
	lat, lon    int32
	elev        int32
	deg         uint32
}

var curvedCodec = codec[curved]{
	size: 32,
	put: func(b []byte, r curved) {
		binary.LittleEndian.PutUint64(b, r.key)
		put32(b, 8, r.first)
		put32(b, 12, r.node)
		put32(b, 16, uint32(r.lat))
		put32(b, 20, uint32(r.lon))
		put32(b, 24, uint32(r.elev))
		put32(b, 28, r.deg)
	},
	get: func(b []byte) curved {
		return curved{binary.LittleEndian.Uint64(b), le32(b, 8), le32(b, 12), int32(le32(b, 16)), int32(le32(b, 20)), int32(le32(b, 24)), le32(b, 28)}
	},
	cmp: func(a, b curved) int {
		return cmp.Or(cmp.Compare(a.key, b.key), cmp.Compare(a.first, b.first))
	},
}

// cellNode is a node of the graph, by rank, and its place in the list of the nodes by cell of the spatial index.
type cellNode struct{ at, rank uint32 }

var cellNodeCodec = codec[cellNode]{
	size: 8,
	put:  func(b []byte, r cellNode) { put32(b, 0, r.at); put32(b, 4, r.rank) },
	get:  func(b []byte) cellNode { return cellNode{le32(b, 0), le32(b, 4)} },
}

func cellNodeAt(r cellNode) uint32 { return r.at }

// outEdge is an edge of the graph and its place among the edges: the edges of a node are in the order of the steps of
// the ways, as Build meets them.
type outEdge struct {
	at, dst, length, attrs uint32
}

var outEdgeCodec = codec[outEdge]{
	size: 16,
	put: func(b []byte, r outEdge) {
		put32(b, 0, r.at)
		put32(b, 4, r.dst)
		put32(b, 8, r.length)
		put32(b, 12, r.attrs)
	},
	get: func(b []byte) outEdge { return outEdge{le32(b, 0), le32(b, 4), le32(b, 8), le32(b, 12)} },
}

func outEdgeAt(r outEdge) uint32 { return r.at }

// wayInfo is what the build needs to know of a way once its references are in order: how many references it has, and
// what it says of both modes (see wayAttrs).
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
	defer r.byID.wait()
	err := scanPBF(pbf, true, false, func(o osm.Object) error {
		w, ok := o.(*osm.Way)
		if !ok {
			return nil
		}
		way, ok := classifyWay(w.Tags)
		if !ok || len(w.Nodes) < 2 {
			return nil
		}
		if uint64(r.count)+uint64(len(w.Nodes)) > math.MaxUint32 {
			return errors.New("more than 2^32 - 1 references")
		}
		r.ways = append(r.ways, wayInfo{uint32(len(w.Nodes)), wayAttrs(way)})
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
func joinNodes(pbf string, r *refs, found func(h idRef, at *[2]int32, first bool) error) error {
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
	step := func(at *[2]int32) error {
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
			return ErrNotSorted
		}
		last = id
		for more && head.id < id { // the references to nodes the extract does not hold
			if err := step(nil); err != nil {
				return err
			}
		}
		if more && head.id == id {
			// Only the nodes a way references are turned into degrees: the extract holds many more of them.
			at := [2]int32{int32(math.Round(n.Lat * 1e7)), int32(math.Round(n.Lon * 1e7))}
			for more && head.id == id {
				if err := step(&at); err != nil {
					return err
				}
			}
		}
		return nil
	})
	for err == nil && more { // the references to nodes after the last of the extract
		err = step(nil)
	}
	return err
}

// ErrNotSorted is what a build on disk says of an extract whose nodes are not in the order of their ids, which the join
// of the references with the nodes needs.
var ErrNotSorted = errors.New("the extract is not sorted by node id")

// Options say how a build runs on disk: where the temporary files go (beside the graph by default), how many records one
// sort holds in memory, and how many DEM tiles the elevation keeps.
type Options struct {
	Tmp          string
	Chunk, Cache int
}

const (
	// DefaultChunk is about 64 MB of records per sort, the biggest being 32 bytes in memory; the buffers of the sorts
	// being filled at once add up. 2 M built a regional extract in the same time as 8 M with a quarter less memory; a
	// country build only gets more runs, and the merge holds each open as a file with a 1 MB buffer (about 90 of them).
	DefaultChunk = 2_000_000
	DefaultCache = 128
)

// withDefaults fills what a caller left out: the temporary files go beside the graph (never a memory-backed /tmp: the runs
// are as big as the extract), and a sort and a cache have the size of the command's defaults, not one record or one tile.
func (o Options) withDefaults(outPath string) Options {
	if o.Tmp == "" {
		o.Tmp = filepath.Dir(outPath)
	}
	if o.Chunk <= 0 {
		o.Chunk = DefaultChunk
	}
	if o.Cache <= 0 {
		o.Cache = DefaultCache
	}
	return o
}

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
	if len(pbfPaths) == 0 {
		return errors.New("build-graph needs at least one -pbf")
	}
	if demDir == "" {
		return errors.New("build-graph needs -dem, the directory of the BD ALTI tiles")
	}
	if len(pbfPaths) != 1 {
		fmt.Fprintf(log, "%d extracts: built in memory\n", len(pbfPaths))
		return Build(pbfPaths, demDir, proj, outPath, log)
	}
	start := time.Now()
	r, err := BuildOnDisk(pbfPaths[0], demDir, proj, outPath, opts, log)
	if errors.Is(err, ErrNotSorted) {
		// Only the join knows, after the pass over the ways: the in-memory build reads any extract, as it always did.
		fmt.Fprintf(log, "%v: built in memory\n", err)
		return Build(pbfPaths, demDir, proj, outPath, log)
	}
	if err != nil {
		return err
	}
	fmt.Fprintf(log, "graph built on disk in %.1f s: %d nodes, %d directed edges, %d tile reads, %d MB of temporary files in %d runs\n",
		time.Since(start).Seconds(), r.Nodes, r.Edges, r.TileLoads, r.SpilledBytes>>20, r.Runs)
	return nil
}

// scratchPattern names the scratch directories: MkdirTemp puts a random string where the star is.
const scratchPattern = "pf-external-*"

// scratch makes the directory of the runs below tmp, and returns a function that removes it.
func scratch(tmp string) (string, func(), error) {
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		return "", nil, err
	}
	engine.SweepScratch(tmp, scratchPattern)
	dir, err := os.MkdirTemp(tmp, scratchPattern)
	if err != nil {
		return "", nil, err
	}
	return dir, func() { os.RemoveAll(dir) }, nil
}

// take gives the next place of i and moves it on.
func take(next []uint32, i uint32) uint32 {
	at := next[i]
	next[i]++
	return at
}

// forEachStep calls f for each step of each way, in the order of the ways, with the two references of the step and the
// position of the second among all the references. The references come in the order of their position.
func forEachStep(refs *placed[ref], ways []wayInfo, f func(a, b ref, attrs uint32) error) error {
	m, err := refs.reader()
	if err != nil {
		return err
	}
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

// maxReaders is how many goroutines parse the BD ALTI tiles ahead of the sampler of a build on disk: the CPUs, as many
// at most as the build in memory reads them with.
const maxReaders = 8

// readAhead is how many readers a build on disk puts on the tiles: the parse of a tile is most of the elevation step,
// and the sampling of one is far shorter than its read.
func readAhead() int { return min(runtime.GOMAXPROCS(0), maxReaders) }

// BuildOnDisk writes the graph of one extract (sorted by node id) and the tiles below demDir to outPath, as Build does,
// with the memory of a few sorts, a few tiles and a few numbers per node, and the rest on disk below opts.Tmp.
func BuildOnDisk(pbf, demDir string, proj elevation.Projection, outPath string, opts Options, log io.Writer) (Report, error) {
	var rep Report
	opts = opts.withDefaults(outPath)
	p := progress{log, time.Now()}
	dem, err := elevation.OpenLazy(demDir, proj, opts.Cache, readAhead())
	if err != nil {
		return rep, err
	}
	// A build that fails before its elevation step leaves the readers waiting for a point that never comes.
	defer dem.Close()
	dir, cleanup, err := scratch(opts.Tmp)
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
	defer seenTab.finish()
	defer r.byID.wait()
	byTile := newSpill(dir, "tile", tileNodeCodec, chunk)
	defer byTile.wait()
	bySeq := newPlaced(dir, "seq", refCodec, refSeq, r.count, chunk)
	var nodes uint32
	current := none
	err = joinNodes(pbf, r, func(h idRef, at *[2]int32, first bool) error {
		lat, lon := int32(math.MinInt32), int32(0)
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
			x, y := dem.Project(lat, lon)
			if err := byTile.push(tileNode{dem.KeepAt(x, y), current, x, y}); err != nil {
				return err
			}
		}
		u := none
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
	// The tiles are parsed ahead of the points, on the readers of LazyDEM: the parse is most of the step, and the cells
	// of a point never reach a tile behind its own, so a window is all the memory it needs.
	known := make([]uint64, (nodes+63)/64)
	byNode := newPlaced(dir, "elev", nodeElevCodec, nodeElevNode, nodes, chunk)
	dem.Plan() // the readers parse the tiles of the points and their neighbours, not the ones in between
	tiles, err := byTile.merge()
	if err != nil {
		return rep, err
	}
	err = tiles.each(func(t tileNode) error {
		elev, err := dem.SampleAt(t.x, t.y)
		if err != nil {
			return err
		}
		if elev != elevation.Unknown {
			known[t.node/64] |= 1 << (t.node % 64)
		}
		return byNode.push(nodeElev{t.node, elev})
	})
	if err != nil {
		return rep, err
	}
	byTile.finish(&tot)
	dem.Close() // the readers stop before the tiles are counted and dropped
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
	minLat, minLon, maxLat, maxLon := int32(math.MaxInt32), int32(math.MaxInt32), int32(math.MinInt32), int32(math.MinInt32)
	var kept uint32
	all, err := seenTab.reader()
	if err != nil {
		return rep, err
	}
	defer all.close()
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

	// The nodes along the Hilbert curve; a tie goes to the node met first. The nodes of each cell of the spatial index
	// are counted on the way, so that each node's place in the grid is known when its rank is.
	cv := newCurve(minLat, minLon, maxLat, maxLon)
	box := [4]int32{minLat, minLon, maxLat, maxLon}
	nx, ny := engine.GridSize(box)
	cellOf := engine.Cells(box)
	cells := make([]uint32, nx*ny+1)
	byCurve := newSpill(dir, "curve", curvedCodec, chunk)
	defer byCurve.wait()
	all, err = seenTab.reader()
	if err != nil {
		return rep, err
	}
	defer all.close()
	elevs, err := byNode.reader()
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
			cells[cellOf(s.lat, s.lon)+1]++
			if err := byCurve.push(curved{cv.key(s.lat, s.lon), s.first, uint32(u), s.lat, s.lon, e.elev, d}); err != nil {
				return rep, err
			}
		}
	}
	all.close()
	// The table is complete and every read of it is done: from here it would only hold 12 bytes per node, beside the
	// edge partitions, until the scratch directory goes away.
	os.Remove(seenTab.path)
	byNode.finish(&tot)
	deg = nil
	for c := 1; c < len(cells); c++ {
		cells[c] += cells[c-1]
	}

	// The graph file: each section goes to its place as it comes, and the spatial index's cell starts are known now.
	graph, err := engine.CreateGraph(outPath, kept, uint32(edges), box)
	if err != nil {
		return rep, err
	}
	defer graph.Abort()
	for _, c := range cells {
		if err := graph.GridCell(c); err != nil {
			return rep, err
		}
	}

	// Ranks: the nodes are written in rank order. Each node's next edge, and each cell's next node, has its place counted
	// from where the node's edges, or the cell's nodes, start.
	byCell := newPlaced(dir, "cell", cellNodeCodec, cellNodeAt, kept, chunk)
	nextInCell := cells[:len(cells)-1] // the starts are written: they become the cursors of the cells
	cells = nil
	remap := make([]uint32, nodes)
	nextEdge := make([]uint32, kept)
	var rank, cum uint32
	ordered, err := byCurve.merge()
	if err != nil {
		return rep, err
	}
	err = ordered.each(func(c curved) error {
		remap[c.node] = rank
		if err := graph.Node(engine.Node{Lat: c.lat, Lon: c.lon, Elev: c.elev}); err != nil {
			return err
		}
		nextEdge[rank] = cum
		cum += c.deg
		rank++
		return byCell.push(cellNode{take(nextInCell, cellOf(c.lat, c.lon)), rank - 1})
	})
	if err != nil {
		return rep, err
	}
	byCurve.finish(&tot)
	if rank != kept || uint64(cum) != edges {
		return rep, fmt.Errorf("%d nodes and %d edges out, %d and %d in", rank, cum, kept, edges)
	}
	nextInCell = nil
	// The offsets are where the edges of each node start, before the edges move them on.
	for _, o := range nextEdge {
		if err := graph.Offset(o); err != nil {
			return rep, err
		}
	}
	if err := graph.Offset(cum); err != nil {
		return rep, err
	}

	// The edges, in the order of the rank of their source, then of the way steps: the steps come in order, so each edge
	// takes the next place of its source. Once they are all in, a node's next place is where its edges end.
	byEdge := newPlaced(dir, "edge", outEdgeCodec, outEdgeAt, uint32(edges), chunk)
	err = forEachStep(bySeq, ways, func(a, b ref, attrs uint32) error {
		if !usable(a, b) {
			return nil
		}
		ra, rb := remap[a.node], remap[b.node]
		length := math.Float32bits(float32(haversineM(a.lat, a.lon, b.lat, b.lon)))
		// The access is the same both ways; the direction a bike may ride against a oneway is not.
		wayModes := uint8(attrs >> 24)
		for _, d := range [2]struct {
			from, to uint32
			forward  bool
		}{{ra, rb, true}, {rb, ra, false}} {
			modes := edgeModes(wayModes, d.forward)
			if err := byEdge.push(outEdge{take(nextEdge, d.from), d.to, length, attrs&0x00FFFFFF | uint32(modes)<<24}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return rep, err
	}
	bySeq.finish(&tot)
	remap = nil
	// The edges leave in the order of the graph, so the two sections that depend on them are found as they go: the
	// ways too long for a scan of the nodes around an area, and the components, joined by each way once.
	// The components of each mode are found as the edges go: a way only joins the components of the modes that may use
	// it, so that a bike-only connector does not turn a foot island into a large component.
	var components [engine.NumModes]*engine.Components
	for m := range components {
		components[m] = engine.NewComponents(int(kept))
	}
	var nodeModes [engine.NumModes][]uint64
	for m := range nodeModes {
		nodeModes[m] = make([]uint64, (uint64(kept)+63)/64)
	}
	var src uint32
	err = byEdge.each(func(e outEdge) error {
		for e.at >= nextEdge[src] {
			src++
		}
		length := math.Float32frombits(e.length)
		modes := uint8(e.attrs >> 24)
		if e.dst > src { // every edge is stored both ways
			for m, c := range components {
				if modes&engine.Mode(m).Bit() != 0 {
					c.Join(src, e.dst)
				}
			}
			if length > engine.LongEdgeMeters {
				if err := graph.Long(src, e.dst, modes&engine.EdgeAllModes); err != nil {
					return err
				}
			}
		}
		for m := range nodeModes {
			if modes&engine.Mode(m).Bit() != 0 {
				nodeModes[m][src>>6] |= 1 << (src & 63)
				nodeModes[m][e.dst>>6] |= 1 << (e.dst & 63)
			}
		}
		return graph.Edge(engine.Edge{To: e.dst, Len: length, Kind: uint8(e.attrs), Surf: uint8(e.attrs >> 8), Flags: uint8(e.attrs >> 16), Modes: modes})
	})
	if err != nil {
		return rep, err
	}
	byEdge.finish(&tot)
	nextEdge = nil
	for m, c := range components {
		for _, word := range c.SmallBitmap(engine.SmallComponentNodes) {
			if err := graph.Small(engine.Mode(m), word); err != nil {
				return rep, err
			}
		}
	}
	components = [engine.NumModes]*engine.Components{}
	for m := range nodeModes {
		for _, word := range nodeModes[m] {
			if err := graph.NodeModes(engine.Mode(m), word); err != nil {
				return rep, err
			}
		}
	}

	// The spatial index: the nodes by cell.
	err = byCell.each(func(c cellNode) error { return graph.GridNode(c.rank) })
	if err != nil {
		return rep, err
	}
	byCell.finish(&tot)
	if err := graph.Close(); err != nil {
		return rep, err
	}
	st, _ := os.Stat(outPath)
	p.step("written %s (%d MB)", outPath, st.Size()>>20)
	return Report{Nodes: uint64(kept), Edges: edges, TileLoads: rep.TileLoads, Runs: tot.runs, SpilledBytes: tot.bytes}, nil
}
