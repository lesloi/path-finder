package main

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
//	graph:     "PFGRAPH2" | N u32 | E u32 | nodes N*12 | pad16 | offsets (N+1)*4 | pad16 | edges E*12
//	landmarks: "PFALT002" | L u32 | N u32 | climb f32 | unit f32 | rows N*rowLen u16
//
// A landmark row holds L distances from the landmarks, then L towards them when the metric
// includes climbing. A distance is floor(cost / unit); 0xFFFF means unreachable or too far.
const (
	graphMagicV2   = "PFGRAPH2"
	altMagicV2     = "PFALT002"
	altUnitMeters  = 16
	altUnreachable = 0xFFFF
)

type nodeV2 struct {
	Lat, Lon int32 // 1e-7 degrees
	Elev     int16 // decimetres
	_        int16
}

type edgeV2 struct {
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

// writeGraphV2 writes a graph in the format above.
func writeGraphV2(path string, nodes []nodeV2, off []uint32, edges []edgeV2) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	if _, err := io.WriteString(w, graphMagicV2); err != nil {
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
	if err := w.Flush(); err != nil {
		return err
	}
	return f.Close()
}

// writeALTV2 writes landmark rows in the format above.
func writeALTV2(path string, landmarks int, nodes uint32, climb float32, rows []uint16) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	if _, err := io.WriteString(w, altMagicV2); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, []uint32{uint32(landmarks), nodes, math.Float32bits(climb), math.Float32bits(altUnitMeters)}); err != nil {
		return err
	}
	if _, err := w.Write(bytesOf(rows)); err != nil {
		return err
	}
	if err := w.Flush(); err != nil {
		return err
	}
	return f.Close()
}
