package engine

import (
	"fmt"
	"math"
	"os"
)

// Node and Edge are the records of a graph file: a position with its elevation, and a way from
// a node, with its length in metres, kind (Kind*) and surface group (Surface*).
type (
	Node = node
	Edge = edge
)

// The parameters of the sections a graph file stores (see GraphWriter): a build computes them with these, and a server
// refuses a graph made with others.
const (
	SmallComponentNodes = smallComponentNodes
	LongEdgeMeters      = longEdgeMeters
)

// WriteGraph writes a graph in CSR form to path: node i has the edges off[i] to off[i+1] of edges.
func WriteGraph(path string, nodes []Node, off []uint32, edges []Edge) error {
	return writeAtomic(path, func(tmp string) error { return writeGraph(tmp, nodes, off, edges) })
}

// Cells gives the cell of the spatial index that holds a point, for a graph whose nodes lie in the box b (least
// latitude, least longitude, greatest latitude, greatest longitude). The grid is worked out once, not at each point.
func Cells(b [4]int32) func(lat, lon int32) uint32 {
	nx, _ := GridSize(b)
	return func(lat, lon int32) uint32 { return uint32(cellIndex(lat, lon, b[0], b[1], nx)) }
}

// writeAtomic has write fill a temporary file beside path, then moves it into place, so a server that
// starts, or a job that copies the directory, never sees a half-written file.
func writeAtomic(path string, write func(tmp string) error) error {
	tmp := path + ".tmp"
	if err := write(tmp); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// Builder assembles a graph in memory and writes it as the file Open maps. It is meant for graphs
// small enough to hold in memory, such as the stand-in graph of the end-to-end tests.
type Builder struct {
	nodes []node
	edges [][]edge
}

// AddNode adds a node and returns its index. Elevation is in metres.
func (b *Builder) AddNode(lat, lon, elevation float64) int {
	b.nodes = append(b.nodes, node{Lat: int32(math.Round(lat * 1e7)), Lon: int32(math.Round(lon * 1e7)), Elev: int32(math.Round(elevation * 10))})
	b.edges = append(b.edges, nil)
	return len(b.nodes) - 1
}

// Connect joins two nodes with a way of the given kind and surface, usable both ways by both travel modes. Its length
// is the distance between the nodes.
func (b *Builder) Connect(from, to int, kind, surface uint8) {
	b.connect(from, to, kind, surface, 0, EdgeFoot|EdgeBike)
}

// ConnectFoot is Connect for a way only walkers may use.
func (b *Builder) ConnectFoot(from, to int, kind, surface uint8) {
	b.connect(from, to, kind, surface, 0, EdgeFoot)
}

// ConnectBike is Connect for a way only bikes may use.
func (b *Builder) ConnectBike(from, to int, kind, surface uint8) {
	b.connect(from, to, kind, surface, 0, EdgeBike)
}

// ConnectTechnical is Connect for a way that asks for the hands on foot (EdgeTechnical).
func (b *Builder) ConnectTechnical(from, to int, kind, surface uint8) {
	b.connect(from, to, kind, surface, EdgeTechnical, EdgeFoot|EdgeBike)
}

// ConnectTechnicalBike is Connect for a way whose mtb:scale is 0 to 3 (EdgeTechnicalBike).
func (b *Builder) ConnectTechnicalBike(from, to int, kind, surface uint8) {
	b.connect(from, to, kind, surface, EdgeTechnicalBike, EdgeFoot|EdgeBike)
}

func (b *Builder) connect(from, to int, kind, surface, flags, modes uint8) {
	length := b.distance(from, to)
	b.edges[from] = append(b.edges[from], edge{To: uint32(to), Len: length, Kind: kind, Surf: surface, Flags: flags, Modes: modes})
	b.edges[to] = append(b.edges[to], edge{To: uint32(from), Len: length, Kind: kind, Surf: surface, Flags: flags, Modes: modes})
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
	return WriteGraph(path, b.nodes, off, all)
}

// LandmarkRequest says which landmarks to build: the unit metric of a travel mode, which every surface preference of
// the mode shares, or the costs and climb of one surface preference.
type LandmarkRequest struct {
	Mode Mode
	// Profile is empty for the unit metric, or the surface preference whose costs the landmarks hold.
	Profile string
	Count   int
}

// unit tells whether the request is for the metric every profile of a mode shares.
func (r LandmarkRequest) unit() bool { return r.Profile == "" }

// WriteLandmarks computes the landmarks of a graph file for a mode and a metric and writes them to path, for Open to
// map with the same.
func WriteLandmarks(graphPath, path string, req LandmarkRequest) error {
	p, g, up, err := openForLandmarks(graphPath, req)
	if err != nil {
		return err
	}
	defer g.file.unmap()
	rows := buildLandmarks(g, g.sp, p, req.Mode, req.Count, up)
	head := newAltHead(req.Count, uint32(g.n), g.fingerprint, req.Mode, metricOf(req), req.Profile, up)
	return writeAtomic(path, func(tmp string) error { return writeLandmarks(tmp, head, rows) })
}

// metricOf is the metric a request builds.
func metricOf(req LandmarkRequest) uint32 {
	if req.unit() {
		return altMetricUnit
	}
	return altMetricCosts
}

// openForLandmarks finds the profile and the climb of a request, maps the graph and checks that the count fits a
// search. The caller unmaps the graph.
func openForLandmarks(graphPath string, req LandmarkRequest) (p *Profile, g *graph, up float32, err error) {
	if req.unit() {
		p = unitProfile()
	} else {
		p = profiles[req.Profile]
		if p == nil {
			return nil, nil, 0, fmt.Errorf("engine: unknown profile %q", req.Profile)
		}
		up = p.UpPerMeter
	}
	perNode := 1
	if up > 0 {
		perNode = 2
	}
	if most := maxLandmarkValues / perNode; req.Count < 1 || req.Count > most {
		return nil, nil, 0, fmt.Errorf("engine: %d landmarks is out of range (1 to %d)", req.Count, most)
	}
	if g, err = openGraph(graphPath); err != nil {
		return nil, nil, 0, err
	}
	return p, g, up, nil
}
