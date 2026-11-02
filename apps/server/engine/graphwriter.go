package engine

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"hash"
	"hash/crc64"
	"io"
	"math"
	"os"
)

// GraphWriter writes the graph file of a graph too big to be in memory, section by section: the size of every section
// but the last is known from the counts and the bounds, so each record goes to its place in the file as it comes, and
// no section is written twice. The fingerprint is that of the nodes, then the offsets, then the edges, then the small
// components and the node modes of each travel mode, in that order, so those sections are closed in that order; the
// grid and the long ways come when the build has them.
type GraphWriter struct {
	path, tmp                      string
	f                              *os.File
	head                           graphHead
	crc                            hash.Hash64
	nodes, off, edges, cells, grid *section
	small, modes                   [NumModes]*section
	long                           *section
	// The records are written from the structs a graph in memory holds, so that both writers share their layout.
	node [1]node
	edge [1]edge
	way  [1]longWay
	b    [8]byte
}

// section is the part of the file one kind of record goes to, from start: want records.
type section struct {
	name    string
	w       *bufio.Writer
	start   int64
	n, want uint64
}

func (s *section) write(b []byte) error {
	if s.n == s.want {
		return fmt.Errorf("engine: more than %d %s", s.want, s.name)
	}
	s.n++
	_, err := s.w.Write(b)
	return err
}

func (s *section) full() error {
	if s.n != s.want {
		return fmt.Errorf("engine: %d %s of %d", s.n, s.name, s.want)
	}
	return nil
}

// CreateGraph starts the graph file of nodes nodes and edges edges, whose nodes lie in bounds (least latitude, least
// longitude, greatest latitude, greatest longitude, in 1e-7 degrees) as box. It is written beside path and moved there by
// Close, so that a server never sees half of it.
func CreateGraph(path string, nodes, edges uint32, box [4]int32) (*GraphWriter, error) {
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return nil, err
	}
	w := &GraphWriter{path: path, tmp: tmp, f: f, crc: crc64.New(fingerprintTable), head: graphHead{
		nodes: nodes, edges: edges, bounds: bounds{box[0], box[1], box[2], box[3]},
		smallLimit: smallComponentNodes, longMeters: longEdgeMeters,
	}}
	nx, ny := GridSize(box)
	words := (uint64(nodes) + 63) / 64
	pos := int64(graphHeaderSize)
	open := func(name string, want uint64, fingerprinted bool) *section {
		var out io.Writer = io.NewOffsetWriter(f, pos)
		if fingerprinted {
			out = io.MultiWriter(out, w.crc)
		}
		return &section{name: name, w: bufio.NewWriterSize(out, 1<<20), start: pos, want: want}
	}
	add := func(name string, want uint64, size int, fingerprinted bool) *section {
		s := open(name, want, fingerprinted)
		pos += int64(want) * int64(size)
		pos += pad16(pos)
		return s
	}
	n := uint64(nodes)
	w.nodes = add("nodes", n, 12, true)
	w.off = add("offsets", n+1, 4, true)
	w.edges = add("edges", uint64(edges), 12, true)
	w.cells = add("grid cells", uint64(nx*ny+1), 4, false)
	w.grid = add("grid nodes", n, 4, false)
	for m := range w.small {
		w.small[m] = add(Mode(m).String()+" small component words", words, 8, true)
	}
	for m := range w.modes {
		w.modes[m] = add(Mode(m).String()+" node modes", words, 8, true)
	}
	w.long = open("long ways", math.MaxUint64, false) // the last section: how many is known at the end
	return w, nil
}

// Node adds the next node.
func (w *GraphWriter) Node(n Node) error {
	w.node[0] = n
	return w.nodes.write(bytesOf(w.node[:]))
}

// Offset adds where the edges of the next node start, then, last, how many edges there are. The nodes are all in.
func (w *GraphWriter) Offset(v uint32) error {
	if w.off.n == 0 {
		if err := w.close(w.nodes); err != nil {
			return err
		}
	}
	binary.LittleEndian.PutUint32(w.b[:], v)
	return w.off.write(w.b[:4])
}

// Edge adds the next edge, in the order of the offsets. The offsets are all in.
func (w *GraphWriter) Edge(e Edge) error {
	if w.edges.n == 0 {
		if err := w.close(w.off); err != nil {
			return err
		}
	}
	w.edge[0] = e
	return w.edges.write(bytesOf(w.edge[:]))
}

// GridCell adds where the nodes of the next cell of the spatial index start, then, last, how many nodes there are.
func (w *GraphWriter) GridCell(start uint32) error {
	binary.LittleEndian.PutUint32(w.b[:], start)
	return w.cells.write(w.b[:4])
}

// GridNode adds the next node of the spatial index, by cell.
func (w *GraphWriter) GridNode(n uint32) error {
	binary.LittleEndian.PutUint32(w.b[:], n)
	return w.grid.write(w.b[:4])
}

// Small adds the next word of the bitmap of the nodes of small components of a mode (see SmallComponentNodes). The
// words come after the edges, which its first call closes: the fingerprint reads them in that order.
func (w *GraphWriter) Small(mode Mode, word uint64) error {
	if w.modes[Foot].n > 0 || w.modes[Bike].n > 0 {
		return fmt.Errorf("engine: the small components must all come before the node modes")
	}
	if w.small[mode].n == 0 && w.small[Foot].n == 0 && w.small[Bike].n == 0 {
		if err := w.edges.full(); err != nil {
			return err
		}
		if err := w.edges.w.Flush(); err != nil {
			return err
		}
	}
	if mode == Bike && w.small[Bike].n == 0 {
		if err := w.small[Foot].w.Flush(); err != nil {
			return err
		}
	}
	if mode == Foot && w.small[Bike].n > 0 {
		return fmt.Errorf("engine: the foot small components must all come before the bike ones")
	}
	binary.LittleEndian.PutUint64(w.b[:], word)
	return w.small[mode].write(w.b[:8])
}

// NodeModes adds the next word of the bitmap of the nodes that have an edge of a mode. The bitmaps come after the
// small components, which their first call closes, and one after the other.
func (w *GraphWriter) NodeModes(mode Mode, word uint64) error {
	if w.modes[Foot].n == 0 && w.modes[Bike].n == 0 {
		for m := range w.small {
			if err := w.small[m].full(); err != nil {
				return err
			}
			if err := w.small[m].w.Flush(); err != nil {
				return err
			}
		}
	}
	if mode == Bike && w.modes[Bike].n == 0 {
		if err := w.modes[Foot].w.Flush(); err != nil {
			return err
		}
	}
	if mode == Foot && w.modes[Bike].n > 0 {
		return fmt.Errorf("engine: the foot node modes must all come before the bike ones")
	}
	binary.LittleEndian.PutUint64(w.b[:], word)
	return w.modes[mode].write(w.b[:8])
}

// Long adds the next way longer than LongEdgeMeters, its lower node first, with the modes that may use it, in the
// order of the graph.
func (w *GraphWriter) Long(a, b uint32, modes uint8) error {
	w.way[0] = longWay{A: a, B: b, Modes: modes}
	return w.long.write(bytesOf(w.way[:]))
}

// close checks that a section is complete and puts what it holds in the file.
func (w *GraphWriter) close(s *section) error {
	if err := s.full(); err != nil {
		return err
	}
	return s.w.Flush()
}

// Close checks that every section is complete, writes the header and moves the file into place. The file is removed
// whatever goes wrong.
func (w *GraphWriter) Close() error {
	err := w.finish()
	if err != nil {
		w.Abort()
		return err
	}
	if err := os.Rename(w.tmp, w.path); err != nil {
		w.Abort()
		return err
	}
	// The temporary name is free again: an Abort deferred by the caller must not take the file of the next build.
	w.tmp = ""
	return nil
}

func (w *GraphWriter) finish() error {
	// The sections closed here are those the fingerprint reads, in its order: the edges may still hold bytes when the
	// small components start, which Small flushes first.
	order := []*section{w.nodes, w.off, w.edges, w.small[Foot], w.small[Bike], w.modes[Foot], w.modes[Bike], w.cells, w.grid}
	for _, s := range order {
		if err := w.close(s); err != nil {
			return err
		}
	}
	if err := w.long.w.Flush(); err != nil {
		return err
	}
	w.head.longEdges = uint32(w.long.n)
	w.head.fingerprint = w.crc.Sum64()
	end := w.long.start + int64(w.long.n)*12
	if err := w.f.Truncate(end + pad16(end)); err != nil {
		return err
	}
	if _, err := w.f.WriteAt(w.head.encode(), 0); err != nil {
		return err
	}
	if err := w.f.Sync(); err != nil {
		return err
	}
	f := w.f
	w.f = nil
	return f.Close()
}

// Abort removes the file of a graph that is not to be written; after a Close that succeeded, it does nothing.
func (w *GraphWriter) Abort() {
	if w.f != nil {
		w.f.Close()
		w.f = nil
	}
	if w.tmp != "" {
		os.Remove(w.tmp)
		w.tmp = ""
	}
}
