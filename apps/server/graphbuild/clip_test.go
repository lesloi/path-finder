package graphbuild

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	clipLat, clipLon = 45.9, 6.1
	clipStep         = 0.002
)

// clipPBF writes a PBF with a path of five nodes going north through the centre of the elevation tile (ids
// 1 to 5), and a second path of three nodes 0.012° east of it (ids 11 to 13), in the tile too.
func clipPBF(t *testing.T, dir string) string {
	t.Helper()
	writeHills(t, dir, clipLat, clipLon)
	var nodes []pbfNode
	for i := int64(1); i <= 5; i++ {
		nodes = append(nodes, pbfNode{i, clipLat + float64(i-3)*clipStep, clipLon})
	}
	for i := int64(11); i <= 13; i++ {
		nodes = append(nodes, pbfNode{i, clipLat + float64(i-12)*clipStep, clipLon + 0.012})
	}
	path := filepath.Join(dir, "all.pbf")
	writePBF(t, path, nodes, []pbfWay{
		{id: 10, refs: []int64{1, 2, 3, 4, 5}, tags: [][2]string{{"highway", "path"}}},
		{id: 20, refs: []int64{11, 12, 13}, tags: [][2]string{{"highway", "path"}}},
	})
	return path
}

// graphSize reads the counts of nodes and directed edges from the header of a graph file.
func graphSize(t *testing.T, graph string) (nodes, edges int) {
	t.Helper()
	data, err := os.ReadFile(graph)
	if err != nil {
		t.Fatal(err)
	}
	return int(binary.LittleEndian.Uint32(data[8:])), int(binary.LittleEndian.Uint32(data[12:]))
}

func TestBuildClippedKeepsWhatIsInsideTheBox(t *testing.T) {
	dir := t.TempDir()
	pbf := clipPBF(t, dir)
	box := Box{MinLon: clipLon - 0.005, MinLat: clipLat - 0.01, MaxLon: clipLon + 0.005, MaxLat: clipLat + 0.01}

	var log bytes.Buffer
	out := filepath.Join(dir, "clipped.bin")
	if err := BuildClipped(pbf, dir, out, box, &log); err != nil {
		t.Fatal(err)
	}
	if nodes, edges := graphSize(t, out); nodes != 5 || edges != 8 {
		t.Errorf("clipped: %d nodes and %d directed edges, want the 5 and 8 of the first path only\n%s", nodes, edges, log.String())
	}

	all := filepath.Join(dir, "all.bin")
	if err := Build([]string{pbf}, dir, all, &log); err != nil {
		t.Fatal(err)
	}
	if nodes, edges := graphSize(t, all); nodes != 8 || edges != 12 {
		t.Errorf("unclipped: %d nodes and %d directed edges, want 8 and 12", nodes, edges)
	}
}

func TestBuildClippedCutsAWayAtTheBox(t *testing.T) {
	dir := t.TempDir()
	pbf := clipPBF(t, dir)
	// Only nodes 2, 3 and 4 are inside: the way leaves the box at both ends.
	box := Box{MinLon: clipLon - 0.005, MinLat: clipLat - 1.5*clipStep, MaxLon: clipLon + 0.005, MaxLat: clipLat + 1.5*clipStep}
	out := filepath.Join(dir, "cut.bin")
	if err := BuildClipped(pbf, dir, out, box, &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if nodes, edges := graphSize(t, out); nodes != 3 || edges != 4 {
		t.Errorf("%d nodes and %d directed edges, want the 3 and 4 inside the box", nodes, edges)
	}
}

func TestBuildClippedRefusesWhatItCannotRead(t *testing.T) {
	dir := t.TempDir()
	writeHills(t, dir, clipLat, clipLon)
	box := Box{MinLon: clipLon - 1, MinLat: clipLat - 1, MaxLon: clipLon + 1, MaxLat: clipLat + 1}
	out := filepath.Join(dir, "g.bin")

	// Nodes in descending order: the extract is not sorted, and a node could not be found among the others.
	unsorted := filepath.Join(dir, "unsorted.pbf")
	writePBF(t, unsorted, []pbfNode{{3, clipLat, clipLon}, {2, clipLat, clipLon}, {1, clipLat, clipLon}},
		[]pbfWay{{id: 10, refs: []int64{1, 2, 3}, tags: [][2]string{{"highway", "path"}}}})
	if err := BuildClipped(unsorted, dir, out, box, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "sort") {
		t.Errorf("an extract with unsorted nodes: err = %v, want it to say to sort it", err)
	}
	if err := BuildClipped(filepath.Join(dir, "missing.pbf"), dir, out, box, &bytes.Buffer{}); err == nil {
		t.Error("a PBF that does not exist: err = nil")
	}
	if err := BuildClipped(unsorted, dir, out, Box{MinLon: 1, MaxLon: 0}, &bytes.Buffer{}); err == nil {
		t.Error("an empty box: err = nil")
	}
}

func TestParseBox(t *testing.T) {
	got, err := ParseBox("1.5, 48.2,2.5,49")
	if err != nil || got != (Box{MinLon: 1.5, MinLat: 48.2, MaxLon: 2.5, MaxLat: 49}) {
		t.Errorf("ParseBox = %+v, %v", got, err)
	}
	for _, bad := range []string{"", "1,2,3", "1,2,3,4,5", "a,2,3,4", "3,2,1,4", "1,4,3,2", "1,2,3,200"} {
		if _, err := ParseBox(bad); err == nil {
			t.Errorf("ParseBox(%q): err = nil", bad)
		}
	}
}
