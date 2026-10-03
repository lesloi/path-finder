package engine

import (
	"math"
	"os"
)

// Node and Edge are the records of a graph file: a position with its elevation, and a way from
// a node, with its length in metres, kind (Kind*) and surface group (Surface*).
type (
	Node = node
	Edge = edge
)

// WriteGraph writes a graph in CSR form to path: node i has the edges off[i] to off[i+1] of edges.
func WriteGraph(path string, nodes []Node, off []uint32, edges []Edge) error {
	return writeGraph(path, nodes, off, edges)
}

// Builder assembles a graph in memory and writes it as the file Open maps. It is meant for graphs
// small enough to hold in memory, such as the stand-in graph of the end-to-end tests.
type Builder struct {
	nodes []node
	edges [][]edge
}

// AddNode adds a node and returns its index. Elevation is in metres.
func (b *Builder) AddNode(lat, lon, elevation float64) int {
	b.nodes = append(b.nodes, node{Lat: int32(math.Round(lat * 1e7)), Lon: int32(math.Round(lon * 1e7)), Elev: int16(math.Round(elevation * 10))})
	b.edges = append(b.edges, nil)
	return len(b.nodes) - 1
}

// Connect joins two nodes with a way of the given kind and surface, usable both ways. Its length is
// the distance between the nodes.
func (b *Builder) Connect(from, to int, kind, surface uint8) {
	length := b.distance(from, to)
	b.edges[from] = append(b.edges[from], edge{To: uint32(to), Len: length, Kind: kind, Surf: surface})
	b.edges[to] = append(b.edges[to], edge{To: uint32(from), Len: length, Kind: kind, Surf: surface})
}

func (b *Builder) distance(from, to int) float32 {
	a, c := b.nodes[from], b.nodes[to]
	dy := float64(a.Lat-c.Lat) * 1e-7 * metersPerDegree
	dx := float64(a.Lon-c.Lon) * 1e-7 * metersPerDegree * math.Cos(float64(a.Lat)*1e-7*rad)
	return float32(math.Hypot(dx, dy))
}

// WriteGraph writes the graph to path.
func (b *Builder) WriteGraph(path string) error {
	off := make([]uint32, len(b.nodes)+1)
	var all []edge
	for i, es := range b.edges {
		off[i] = uint32(len(all))
		all = append(all, es...)
	}
	off[len(b.nodes)] = uint32(len(all))
	return writeGraph(path, b.nodes, off, all)
}

// WriteLandmarks computes the landmarks of a graph file for an activity profile and writes them to
// path, for Open to map with the same profile.
func WriteLandmarks(graphPath, path, profile string, count int) error {
	p := profiles[profile]
	if p == nil {
		return os.ErrInvalid
	}
	g, err := openGraph(graphPath)
	if err != nil {
		return err
	}
	rows := buildLandmarks(g, newSpatial(g), p, count, p.UpPerMeter)
	return writeLandmarks(path, count, uint32(g.n), p.UpPerMeter, rows)
}
