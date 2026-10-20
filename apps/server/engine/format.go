package engine

import (
	"bufio"
	"encoding/binary"
	"hash/crc64"
	"math"
	"os"
	"unsafe"
)

// File formats. The graph packs what a search reads together: one 12-byte record per node
// (position and elevation) and per edge (target, length, kind, surface, flags), so that visiting a
// node or an edge touches one cache line instead of four arrays. Landmark distances are
// quantized to 16 bits.
//
//	graph:     "PFGRAPH8" | N u32 | E u32 | fingerprint u64 | bounds 4*i32 | small-component size u32 | long-way
//	           length f32 | long ways L u32 | pad16 | nodes N*12 | pad16 | offsets (N+1)*4 | pad16 | edges E*12 | pad16 |
//	           grid cells (nx*ny+1)*4 | pad16 | grid nodes N*4 | pad16 | small components ceil(N/64)*8 | pad16 |
//	           long ways L*8
//	landmarks: "PFALT003" | L u32 | N u32 | climb f32 | unit f32 | fingerprint u64 | rows N*rowLen u16
//
// The bounds are the least and greatest latitude and longitude of the nodes, in the order min latitude, min
// longitude, max latitude, max longitude: the grid over them (cells of cellLat by cellLon) is the spatial
// index that finds the nearest node to a point, written at build time so that opening a graph reads no node.
// The fingerprint is a CRC-64 of the graph's nodes, offsets and edges. The landmarks hold the one of the
// graph they were built for, so that a graph built again, even with as many nodes, refuses the old ones.
//
// The last two sections are what the build knows when it writes the edges and a search would otherwise read the
// whole graph to find: the nodes of the components of fewer than smallComponentNodes nodes as a bitmap (all zero
// when no component reaches that size), and the ways longer than longEdgeMeters as pairs of nodes, the lower
// number first, in the order of the graph. The header holds the two parameters they were made with, so that a
// change is refused, not served wrong.
//
// A landmark row holds L distances from the landmarks, then L towards them when the metric
// includes climbing. A distance is floor(cost / unit); 0xFFFF means unreachable or too far.
const (
	graphMagic      = "PFGRAPH8"
	altMagic        = "PFALT003"
	graphHeaderSize = 64 // magic, counts, fingerprint, bounds, the sections' parameters, padding: the nodes start on a 16-byte boundary
	altHeaderSize   = 32
	altUnitMeters   = 16
	altUnreachable  = 0xFFFF
)

type node struct {
	Lat, Lon int32 // 1e-7 degrees
	Elev     int32 // decimetres: signed, and wide enough for any height on Earth and any depth below the sea
}

type edge struct {
	To    uint32
	Len   float32 // metres
	Kind  uint8
	Surf  uint8
	Flags uint8 // EdgeTechnical…
	_     uint8
}

// EdgeTechnical flags a way that asks for the hands, ropes or chains: on foot, a sac_scale of
// demanding_mountain_hiking (T3). It only tells a route that holds one.
const EdgeTechnical uint8 = 1

var fingerprintTable = crc64.MakeTable(crc64.ECMA)

// fingerprint identifies the content of a graph: what its landmarks must have been built for.
func fingerprint(nodes []node, off []uint32, edges []edge) uint64 {
	sum := crc64.Update(0, fingerprintTable, bytesOf(nodes))
	sum = crc64.Update(sum, fingerprintTable, bytesOf(off))
	return crc64.Update(sum, fingerprintTable, bytesOf(edges))
}

// bounds are the extent of a graph, in 1e-7 degrees.
type bounds struct{ minLat, minLon, maxLat, maxLon int32 }

// graphHead and altHead are the headers of a graph file and of a landmark file: the only place that knows
// where each field lies, for the writers and the readers alike.
type graphHead struct {
	nodes, edges uint32
	fingerprint  uint64
	bounds
	// What the stored sections were made with.
	smallLimit uint32
	longMeters float32
	// longEdges is how many ways the list of long ones holds.
	longEdges uint32
}

type altHead struct {
	landmarks, nodes uint32
	climb, unit      float32
	fingerprint      uint64 // of the graph the landmarks were built for
}

func (h graphHead) encode() []byte {
	b, le := make([]byte, graphHeaderSize), binary.LittleEndian
	copy(b, graphMagic)
	le.PutUint32(b[8:], h.nodes)
	le.PutUint32(b[12:], h.edges)
	le.PutUint64(b[16:], h.fingerprint)
	le.PutUint32(b[24:], uint32(h.minLat))
	le.PutUint32(b[28:], uint32(h.minLon))
	le.PutUint32(b[32:], uint32(h.maxLat))
	le.PutUint32(b[36:], uint32(h.maxLon))
	le.PutUint32(b[40:], h.smallLimit)
	le.PutUint32(b[44:], math.Float32bits(h.longMeters))
	le.PutUint32(b[48:], h.longEdges)
	return b
}

// readGraphHead reads the header of a graph file; ok is false for a file too short or of a version that is not read.
func readGraphHead(data []byte) (h graphHead, ok bool) {
	if len(data) < graphHeaderSize {
		return h, false
	}
	switch string(data[:8]) {
	case graphMagic:
	default:
		return h, false
	}
	le := binary.LittleEndian
	h.nodes, h.edges, h.fingerprint = le.Uint32(data[8:]), le.Uint32(data[12:]), le.Uint64(data[16:])
	h.minLat, h.minLon = int32(le.Uint32(data[24:])), int32(le.Uint32(data[28:]))
	h.maxLat, h.maxLon = int32(le.Uint32(data[32:])), int32(le.Uint32(data[36:]))
	h.smallLimit, h.longMeters, h.longEdges = le.Uint32(data[40:]), math.Float32frombits(le.Uint32(data[44:])), le.Uint32(data[48:])
	return h, true
}

func (h altHead) encode() []byte {
	b, le := make([]byte, altHeaderSize), binary.LittleEndian
	copy(b, altMagic)
	le.PutUint32(b[8:], h.landmarks)
	le.PutUint32(b[12:], h.nodes)
	le.PutUint32(b[16:], math.Float32bits(h.climb))
	le.PutUint32(b[20:], math.Float32bits(h.unit))
	le.PutUint64(b[24:], h.fingerprint)
	return b
}

// readAltHead reads the header of a landmark file; ok is false for a file too short or of a version that is not read.
func readAltHead(data []byte) (h altHead, ok bool) {
	if len(data) < altHeaderSize || string(data[:8]) != altMagic {
		return h, false
	}
	le := binary.LittleEndian
	h.landmarks, h.nodes = le.Uint32(data[8:]), le.Uint32(data[12:])
	h.climb, h.unit = math.Float32frombits(le.Uint32(data[16:])), math.Float32frombits(le.Uint32(data[20:]))
	h.fingerprint = le.Uint64(data[24:])
	return h, true
}

func pad16(n int64) int64 { return (16 - n%16) % 16 }

func bytesOf[T any](s []T) []byte {
	if len(s) == 0 {
		return nil
	}
	var zero T
	return unsafe.Slice((*byte)(unsafe.Pointer(&s[0])), len(s)*int(unsafe.Sizeof(zero)))
}

// writeFile creates path, has fill write it, and syncs and closes it: the file is on disk before a
// caller moves it into place, and is closed whatever happens.
func writeFile(path string, fill func(w *bufio.Writer) error) (err error) {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}()
	w := bufio.NewWriterSize(f, 1<<20)
	if err := fill(w); err != nil {
		return err
	}
	if err := w.Flush(); err != nil {
		return err
	}
	return f.Sync()
}

// writeGraph writes a graph in the format above.
func writeGraph(path string, nodes []node, off []uint32, edges []edge) error {
	return writeFile(path, func(w *bufio.Writer) error {
		sp := computeSpatial(nodes)
		small, long := smallBitmap(len(nodes), off, edges, smallComponentNodes), longEdgeList(off, edges, len(nodes))
		head := graphHead{nodes: uint32(len(nodes)), edges: uint32(len(edges)), fingerprint: fingerprint(nodes, off, edges), bounds: sp.bounds,
			smallLimit: smallComponentNodes, longMeters: longEdgeMeters, longEdges: uint32(len(long))}
		if _, err := w.Write(head.encode()); err != nil {
			return err
		}
		pos := int64(graphHeaderSize)
		for _, b := range [][]byte{bytesOf(nodes), bytesOf(off), bytesOf(edges), bytesOf(sp.start), bytesOf(sp.nodes), bytesOf(small), bytesOf(long)} {
			if _, err := w.Write(b); err != nil {
				return err
			}
			pos += int64(len(b))
			p := pad16(pos)
			if _, err := w.Write(make([]byte, p)); err != nil {
				return err
			}
			pos += p
		}
		return nil
	})
}

// GridSize is the number of cells of the spatial index over a box (min latitude, min longitude, max latitude, max
// longitude), along longitude then along latitude.
func GridSize(b [4]int32) (nx, ny int) { return gridSize(b[0], b[1], b[2], b[3]) }

// writeLandmarks writes landmark rows in the format above, for the graph with the given fingerprint.
func writeLandmarks(path string, landmarks int, nodes uint32, graphFingerprint uint64, climb float32, rows []uint16) error {
	return writeLandmarksWith(path, landmarks, nodes, graphFingerprint, climb, func(w *bufio.Writer) error {
		_, err := w.Write(bytesOf(rows))
		return err
	})
}

// writeLandmarksWith is writeLandmarks for rows that fill writes as it makes them, so that they need not be in
// memory all at once.
func writeLandmarksWith(path string, landmarks int, nodes uint32, graphFingerprint uint64, climb float32, fill func(w *bufio.Writer) error) error {
	return writeFile(path, func(w *bufio.Writer) error {
		head := altHead{landmarks: uint32(landmarks), nodes: nodes, climb: climb, unit: altUnitMeters, fingerprint: graphFingerprint}
		if _, err := w.Write(head.encode()); err != nil {
			return err
		}
		return fill(w)
	})
}
