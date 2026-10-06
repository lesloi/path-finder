package engine

import (
	"bufio"
	"encoding/binary"
	"hash/crc64"
	"io"
	"math"
	"os"
	"unsafe"
)

// File formats. The graph packs what a search reads together: one 12-byte record per node
// (position and elevation) and per edge (target, length, kind, surface), so that visiting a
// node or an edge touches one cache line instead of four arrays. Landmark distances are
// quantized to 16 bits.
//
//	graph:     "PFGRAPH5" | N u32 | E u32 | fingerprint u64 | bounds 4*i32 | pad16 | nodes N*12 | pad16 |
//	           offsets (N+1)*4 | pad16 | edges E*12 | pad16 | grid cells (nx*ny+1)*4 | pad16 | grid nodes N*4
//	landmarks: "PFALT003" | L u32 | N u32 | climb f32 | unit f32 | fingerprint u64 | rows N*rowLen u16
//
// The bounds are the least and greatest latitude and longitude of the nodes, in the order min latitude, min
// longitude, max latitude, max longitude: the grid over them (cells of cellLat by cellLon) is the spatial
// index that finds the nearest node to a point, written at build time so that opening a graph reads no node.
// The fingerprint is a CRC-64 of the graph's nodes, offsets and edges. The landmarks hold the one of the
// graph they were built for, so that a graph built again, even with as many nodes, refuses the old ones.
//
// A landmark row holds L distances from the landmarks, then L towards them when the metric
// includes climbing. A distance is floor(cost / unit); 0xFFFF means unreachable or too far.
const (
	graphMagic      = "PFGRAPH5"
	altMagic        = "PFALT003"
	graphHeader     = 48 // magic, counts, fingerprint, bounds, padding: the nodes start on a 16-byte boundary
	graphHeaderUsed = 40 // the bytes of it that hold something: the padding is the rest
	altHeader       = 32
	altUnitMeters   = 16
	altUnreachable  = 0xFFFF
)

type node struct {
	Lat, Lon int32 // 1e-7 degrees
	Elev     int32 // decimetres: signed, and wide enough for any height on Earth and any depth below the sea
}

type edge struct {
	To   uint32
	Len  float32 // metres
	Kind uint8
	Surf uint8
	_    uint16
}

var fingerprintTable = crc64.MakeTable(crc64.ECMA)

// fingerprint identifies the content of a graph: what its landmarks must have been built for.
func fingerprint(nodes []node, off []uint32, edges []edge) uint64 {
	sum := crc64.Update(0, fingerprintTable, bytesOf(nodes))
	sum = crc64.Update(sum, fingerprintTable, bytesOf(off))
	return crc64.Update(sum, fingerprintTable, bytesOf(edges))
}

// bounds are the extent of a graph, in 1e-7 degrees.
type bounds struct{ minLat, minLon, maxLat, maxLon int32 }

// readBounds reads the bounds from the header of a graph file.
func readBounds(header []byte) bounds {
	v := func(at int) int32 { return int32(binary.LittleEndian.Uint32(header[at:])) }
	return bounds{minLat: v(24), minLon: v(28), maxLat: v(32), maxLon: v(36)}
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
		if _, err := io.WriteString(w, graphMagic); err != nil {
			return err
		}
		fp := fingerprint(nodes, off, edges)
		sp := computeSpatial(nodes)
		if err := binary.Write(w, binary.LittleEndian, []uint32{uint32(len(nodes)), uint32(len(edges)), uint32(fp), uint32(fp >> 32),
			uint32(sp.minLat), uint32(sp.minLon), uint32(sp.maxLat), uint32(sp.maxLon)}); err != nil {
			return err
		}
		if _, err := w.Write(make([]byte, graphHeader-graphHeaderUsed)); err != nil {
			return err
		}
		pos := int64(graphHeader)
		for _, b := range [][]byte{bytesOf(nodes), bytesOf(off), bytesOf(edges), bytesOf(sp.start), bytesOf(sp.nodes)} {
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

// writeLandmarks writes landmark rows in the format above.
func writeLandmarks(path string, landmarks int, nodes uint32, graphFingerprint uint64, climb float32, rows []uint16) error {
	return writeFile(path, func(w *bufio.Writer) error {
		if _, err := io.WriteString(w, altMagic); err != nil {
			return err
		}
		if err := binary.Write(w, binary.LittleEndian, []uint32{uint32(landmarks), nodes, math.Float32bits(climb), math.Float32bits(altUnitMeters), uint32(graphFingerprint), uint32(graphFingerprint >> 32)}); err != nil {
			return err
		}
		_, err := w.Write(bytesOf(rows))
		return err
	})
}
