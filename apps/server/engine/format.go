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
// (position and elevation) and per edge (target, length, kind, surface, flags, modes), so that visiting a
// node or an edge touches one cache line instead of four arrays. Landmark distances are
// quantized to 16 bits.
//
//	graph:     "PFGRAPH9" | N u32 | E u32 | fingerprint u64 | bounds 4*i32 | small-component size u32 | long-way
//	           length f32 | long ways L u32 | pad16 | nodes N*12 | pad16 | offsets (N+1)*4 | pad16 | edges E*12 | pad16 |
//	           grid cells (nx*ny+1)*4 | pad16 | grid nodes N*4 | pad16 | small components ceil(N/64)*8, foot then bike |
//	           pad16 | node modes ceil(N/64)*8, foot then bike | pad16 | long ways L*12
//	landmarks: "PFALT004" | L u32 | N u32 | climb f32 | unit f32 | fingerprint u64 | mode u32 | metric u32 |
//	           profile u32 | pad4 | rows N*rowLen u16
//
// The bounds are the least and greatest latitude and longitude of the nodes, in the order min latitude, min
// longitude, max latitude, max longitude: the grid over them (cells of cellLat by cellLon) is the spatial
// index that finds the nearest node to a point, written at build time so that opening a graph reads no node.
// The fingerprint is a CRC-64 of the graph's nodes, offsets, edges, small components and node modes, in that
// order; it identifies what the landmarks must have been built for.
//
// The last sections are what the build knows when it writes the edges and a search would otherwise read the
// whole graph to find: the nodes of the components of fewer than smallComponentNodes nodes, one bitmap per
// travel mode (all zero when no component of a mode reaches that size); the nodes that have an edge of each
// mode, so that snapping never moves a point onto a node the mode cannot reach; and the ways longer than
// longEdgeMeters, with the modes that may use them. The header holds the two parameters they were made with,
// so that a change is refused, not served wrong.
//
// A landmark row holds L distances from the landmarks, then L towards them when the metric includes climbing.
// A distance is floor(cost / unit); 0xFFFF means unreachable or too far. A landmark file is built for one
// travel mode and one metric: length only (altMetricUnit) or a surface preference's costs and climb
// (altMetricCosts), the latter naming the profile it was built for.
const (
	graphMagic      = "PFGRAPH9"
	altMagic        = "PFALT004"
	graphHeaderSize = 64 // magic, counts, fingerprint, bounds, the sections' parameters, padding: the nodes start on a 16-byte boundary
	altHeaderSize   = 48
	altUnitMeters   = 16
	altUnreachable  = 0xFFFF

	// altMetricUnit is the landmark metric of length only, the one the server serves: its distances are a lower
	// bound for every surface preference of the mode.
	altMetricUnit uint32 = 1
	// altMetricCosts is the landmark metric of a surface preference's own costs and climb, for a measurement or a
	// fallback when the unit one is too slow on a country.
	altMetricCosts uint32 = 2
)

type node struct {
	Lat, Lon int32 // 1e-7 degrees
	Elev     int32 // decimetres: signed, and wide enough for any height on Earth and any depth below the sea
}

// edge is a way from a node. Len is in metres; Kind and Surf index the profile tables; Flags holds the
// technical bits of the modes; Modes the modes that may use the way and, for a bike, the direction it is open
// in.
type edge struct {
	To    uint32
	Len   float32
	Kind  uint8
	Surf  uint8
	Flags uint8
	Modes uint8
}

// The Modes byte holds two modes and the bike direction bit: a third travel mode, or another per-mode bit, needs a
// new graph format.
const (
	// EdgeFoot is set in edge.Modes for a way a walker may use.
	EdgeFoot uint8 = 1 << iota
	// EdgeBike is set in edge.Modes for a way a bike may use. The access is symmetric: oneway is stored
	// separately and not enforced in v1.
	EdgeBike
	// EdgeBikeThisWay is set in edge.Modes when this direction is the one a bike may ride against a oneway.
	// v1 does not read it: it is written so that a later version can enforce oneway without rebuilding France.
	EdgeBikeThisWay
	// EdgeAllModes are the access bits of edge.Modes; EdgeBikeThisWay is a direction, not an access.
	EdgeAllModes = EdgeFoot | EdgeBike
)

const (
	// EdgeTechnical flags a way that asks for the hands, ropes or chains: on foot, a sac_scale of
	// demanding_mountain_hiking (T3). It only tells a route that holds one.
	EdgeTechnical uint8 = 1 << iota
	// EdgeTechnicalBike flags a way with an mtb:scale of 0 to 3, the hardest a bike route may hold.
	EdgeTechnicalBike
)

// longWay is a way longer than LongEdgeMeters, with the modes that may use it. The lower node comes first
// and the record is 12 bytes, like a node and an edge, so that a view of the section is an array.
type longWay struct {
	A, B  uint32
	Modes uint8
	_     [3]byte
}

var fingerprintTable = crc64.MakeTable(crc64.ECMA)

// fingerprint identifies the content of a graph: what its landmarks must have been built for. The sections come
// in a fixed order, whatever the order the writers fill them in.
func fingerprint(nodes []node, off []uint32, edges []edge, small, modes [NumModes][]uint64) uint64 {
	sum := uint64(0)
	for _, b := range [][]byte{
		bytesOf(nodes), bytesOf(off), bytesOf(edges),
		bytesOf(small[Foot]), bytesOf(small[Bike]),
		bytesOf(modes[Foot]), bytesOf(modes[Bike]),
	} {
		sum = crc64.Update(sum, fingerprintTable, b)
	}
	return sum
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
	mode             uint32
	metric           uint32
	// profile is the position of the surface preference in ProfileNames, from 1, for altMetricCosts; 0 for the
	// unit metric, which every preference shares.
	profile uint32
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
	le.PutUint32(b[32:], h.mode)
	le.PutUint32(b[36:], h.metric)
	le.PutUint32(b[40:], h.profile)
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
	h.mode, h.metric, h.profile = le.Uint32(data[32:]), le.Uint32(data[36:]), le.Uint32(data[40:])
	return h, true
}

// profileID is the position of a surface preference in ProfileNames, from 1, and 0 for a name that is not one.
func profileID(name string) uint32 {
	for i, n := range ProfileNames {
		if n == name {
			return uint32(i) + 1
		}
	}
	return 0
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
		small := smallBitmaps(len(nodes), off, edges, smallComponentNodes)
		modes := nodeModeBitmaps(len(nodes), off, edges)
		long := longEdgeList(off, edges, len(nodes))
		head := graphHead{nodes: uint32(len(nodes)), edges: uint32(len(edges)), fingerprint: fingerprint(nodes, off, edges, small, modes),
			bounds: sp.bounds, smallLimit: smallComponentNodes, longMeters: longEdgeMeters, longEdges: uint32(len(long))}
		if _, err := w.Write(head.encode()); err != nil {
			return err
		}
		pos := int64(graphHeaderSize)
		sections := [][]byte{
			bytesOf(nodes), bytesOf(off), bytesOf(edges), bytesOf(sp.start), bytesOf(sp.nodes),
			bytesOf(small[Foot]), bytesOf(small[Bike]), bytesOf(modes[Foot]), bytesOf(modes[Bike]), bytesOf(long),
		}
		for _, b := range sections {
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

// newAltHead is the header of a landmark file for a graph, a mode and a metric. climb is what the metric charges
// per metre of ascent, 0 for the unit metric; the profile is only named by a costs metric.
func newAltHead(landmarks int, nodes uint32, graphFingerprint uint64, mode Mode, metric uint32, profile string, climb float32) altHead {
	return altHead{
		landmarks: uint32(landmarks), nodes: nodes, climb: climb, unit: altUnitMeters,
		fingerprint: graphFingerprint, mode: uint32(mode), metric: metric, profile: profileID(profile),
	}
}

// writeLandmarks writes landmark rows in the format above.
func writeLandmarks(path string, head altHead, rows []uint16) error {
	return writeLandmarksWith(path, head, func(w *bufio.Writer) error {
		_, err := w.Write(bytesOf(rows))
		return err
	})
}

// writeLandmarksWith is writeLandmarks for rows that fill writes as it makes them, so that they need not be in
// memory all at once.
func writeLandmarksWith(path string, head altHead, fill func(w *bufio.Writer) error) error {
	return writeFile(path, func(w *bufio.Writer) error {
		if _, err := w.Write(head.encode()); err != nil {
			return err
		}
		return fill(w)
	})
}
