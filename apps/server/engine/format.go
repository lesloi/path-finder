package engine

import (
	"bufio"
	"encoding/binary"
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
//	graph:     "PFGRAPH3" | N u32 | E u32 | nodes N*12 | pad16 | offsets (N+1)*4 | pad16 | edges E*12
//	landmarks: "PFALT002" | L u32 | N u32 | climb f32 | unit f32 | rows N*rowLen u16
//
// A landmark row holds L distances from the landmarks, then L towards them when the metric
// includes climbing. A distance is floor(cost / unit); 0xFFFF means unreachable or too far.
const (
	graphMagic     = "PFGRAPH3"
	altMagicV2     = "PFALT002"
	altUnitMeters  = 16
	altUnreachable = 0xFFFF
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
		if err := binary.Write(w, binary.LittleEndian, []uint32{uint32(len(nodes)), uint32(len(edges))}); err != nil {
			return err
		}
		pos := int64(16)
		for _, b := range [][]byte{bytesOf(nodes), bytesOf(off), bytesOf(edges)} {
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
func writeLandmarks(path string, landmarks int, nodes uint32, climb float32, rows []uint16) error {
	return writeFile(path, func(w *bufio.Writer) error {
		if _, err := io.WriteString(w, altMagicV2); err != nil {
			return err
		}
		if err := binary.Write(w, binary.LittleEndian, []uint32{uint32(landmarks), nodes, math.Float32bits(climb), math.Float32bits(altUnitMeters)}); err != nil {
			return err
		}
		_, err := w.Write(bytesOf(rows))
		return err
	})
}
