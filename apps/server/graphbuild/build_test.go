package graphbuild

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lesloi/path-finder/apps/server/engine"
)

// A just-enough OSM PBF writer, so the tests need no data file. A PBF is a series of blocks, each a
// BlobHeader and a Blob; the blob holds the block's protobuf message uncompressed (`raw`).

func varint(v uint64) []byte {
	var b []byte
	for ; v >= 0x80; v >>= 7 {
		b = append(b, byte(v)|0x80)
	}
	return append(b, byte(v))
}

func zigzag(v int64) uint64 { return uint64(v<<1) ^ uint64(v>>63) }

func tagged(num int, wire int) []byte { return varint(uint64(num<<3 | wire)) }

func bytesField(num int, payload []byte) []byte {
	return append(append(tagged(num, 2), varint(uint64(len(payload)))...), payload...)
}

func varintField(num int, v uint64) []byte { return append(tagged(num, 0), varint(v)...) }

func packed(num int, values []uint64) []byte {
	var body []byte
	for _, v := range values {
		body = append(body, varint(v)...)
	}
	return bytesField(num, body)
}

func blob(kind string, message []byte) []byte {
	body := append(bytesField(1, message), varintField(2, uint64(len(message)))...)
	header := append(bytesField(1, []byte(kind)), varintField(3, uint64(len(body)))...)
	out := binary.BigEndian.AppendUint32(nil, uint32(len(header)))
	return append(append(out, header...), body...)
}

type pbfNode struct {
	id       int64
	lat, lon float64
}

type pbfWay struct {
	id    int64
	refs  []int64
	tags  [][2]string
	nodes []pbfNode
}

// writePBF writes a file holding the nodes, then the ways.
func writePBF(t *testing.T, path string, nodes []pbfNode, ways []pbfWay) {
	t.Helper()
	strs := [][]byte{nil} // index 0 is the empty string
	index := map[string]uint64{}
	str := func(s string) uint64 {
		if i, ok := index[s]; ok {
			return i
		}
		strs = append(strs, []byte(s))
		index[s] = uint64(len(strs) - 1)
		return index[s]
	}
	var group []byte
	if len(nodes) > 0 { // the reader only knows dense nodes: delta-coded ids and positions, in 1e-7 degrees
		var ids, lats, lons []uint64
		var id, lat, lon int64
		for _, n := range nodes {
			la, lo := int64(math.Round(n.lat*1e7)), int64(math.Round(n.lon*1e7))
			ids, lats, lons = append(ids, zigzag(n.id-id)), append(lats, zigzag(la-lat)), append(lons, zigzag(lo-lon))
			id, lat, lon = n.id, la, lo
		}
		dense := append(append(packed(1, ids), packed(8, lats)...), packed(9, lons)...)
		group = append(group, bytesField(2, dense)...)
	}
	for _, w := range ways {
		var keys, vals, refs []uint64
		for _, tag := range w.tags {
			keys, vals = append(keys, str(tag[0])), append(vals, str(tag[1]))
		}
		prev := int64(0)
		for _, r := range w.refs {
			refs, prev = append(refs, zigzag(r-prev)), r
		}
		way := varintField(1, uint64(w.id))
		way = append(way, packed(2, keys)...)
		way = append(way, packed(3, vals)...)
		way = append(way, packed(8, refs)...)
		group = append(group, bytesField(3, way)...)
	}
	var table []byte
	for _, s := range strs {
		table = append(table, bytesField(1, s)...)
	}
	block := append(bytesField(1, table), bytesField(2, group)...)

	header := bytesField(4, []byte("OsmSchema-V0.6"))
	var file bytes.Buffer
	file.Write(blob("OSMHeader", header))
	file.Write(blob("OSMData", block))
	if err := os.WriteFile(path, file.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeHills writes one ASC tile of 2 km around the centre, rising 0.1 m per metre towards the north.
func writeHills(t *testing.T, dir string, lat, lon float64) {
	t.Helper()
	x, y := l93.forward(lat, lon)
	const cells, size = 80, 25
	xll, yll := math.Floor(x/size)*size-cells/2*size, math.Floor(y/size)*size-cells/2*size
	var b strings.Builder
	fmt.Fprintf(&b, "ncols %d\nnrows %d\nxllcorner %v\nyllcorner %v\ncellsize %d\nNODATA_value -99999.00\n", cells, cells, xll, yll, size)
	for r := 0; r < cells; r++ {
		for c := 0; c < cells; c++ {
			fmt.Fprintf(&b, "%v ", 600+0.1*float64((cells-1-r)*size))
		}
		b.WriteString("\n")
	}
	if err := os.WriteFile(filepath.Join(dir, "tile.asc"), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestBuildMakesAGraphTheEngineRoutesOn(t *testing.T) {
	const lat, lon = 45.9, 6.1
	dir := t.TempDir()
	writeHills(t, dir, lat, lon)

	// A path of five nodes going north (ids 1 to 5, 0.002° apart: about 220 m), split over two files, and
	// a motorway and a node outside the tiles that must stay out.
	step := 0.002
	var all []pbfNode
	for i := int64(1); i <= 5; i++ {
		all = append(all, pbfNode{i, lat + float64(i-3)*step, lon})
	}
	far := pbfNode{6, 47.5, 2.0}
	writePBF(t, filepath.Join(dir, "a.pbf"), all[:3], []pbfWay{
		{id: 10, refs: []int64{1, 2, 3, 4, 5}, tags: [][2]string{{"highway", "path"}, {"surface", "gravel"}}},
		{id: 11, refs: []int64{1, 6}, tags: [][2]string{{"highway", "motorway"}}},
	})
	writePBF(t, filepath.Join(dir, "b.pbf"), append(all[3:], far), []pbfWay{
		{id: 12, refs: []int64{5, 6}, tags: [][2]string{{"highway", "residential"}}}, // leads outside the elevation tiles
	})

	graph := filepath.Join(dir, "graph.bin")
	var log bytes.Buffer
	if err := Build([]string{filepath.Join(dir, "a.pbf"), filepath.Join(dir, "b.pbf")}, dir, graph, &log); err != nil {
		t.Fatal(err)
	}
	for _, step := range []string{"BD ALTI: 1 tiles", "pass 1: 2 walkable ways", "graph: 5 nodes, 8 directed edges"} {
		if !strings.Contains(log.String(), step) {
			t.Errorf("progress lacks %q:\n%s", step, log.String())
		}
	}

	e, err := engine.Open(graph, "", "hike")
	if err != nil {
		t.Fatal(err)
	}
	r, err := e.Route(context.Background(), engine.Point{Lat: lat - 2*step, Lon: lon}, engine.Point{Lat: lat + 2*step, Lon: lon})
	if err != nil {
		t.Fatal(err)
	}
	if r.Distance < 870 || r.Distance > 900 {
		t.Errorf("distance = %.0f m for four steps of 222 m", r.Distance)
	}
	// 0.1 m of height per metre northwards, over 890 m: about 89 m.
	if r.Ascent < 80 || r.Ascent > 95 {
		t.Errorf("ascent = %.1f m, want about 89", r.Ascent)
	}
	if len(r.Stretches) != 1 || !r.Stretches[0].Unpaved {
		t.Errorf("stretches = %+v: a gravel path is unpaved", r.Stretches)
	}
}

func TestBuildFailsOnMissingInput(t *testing.T) {
	dir := t.TempDir()
	if err := Build([]string{"missing.pbf"}, dir, filepath.Join(dir, "g.bin"), os.Stderr); err == nil {
		t.Error("no elevation tile: err = nil")
	}
	writeHills(t, dir, 45.9, 6.1)
	if err := Build([]string{filepath.Join(dir, "missing.pbf")}, dir, filepath.Join(dir, "g.bin"), os.Stderr); err == nil {
		t.Error("a PBF that does not exist: err = nil")
	}
	if err := os.WriteFile(filepath.Join(dir, "broken.pbf"), []byte("not a pbf"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build([]string{filepath.Join(dir, "broken.pbf")}, dir, filepath.Join(dir, "g.bin"), os.Stderr); err == nil {
		t.Error("a file that is no PBF: err = nil")
	}
}
