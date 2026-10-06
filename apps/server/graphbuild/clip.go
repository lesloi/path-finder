package graphbuild

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"

	"github.com/lesloi/path-finder/apps/server/elevation"
)

// Box is an area in degrees: the zone a clipped build keeps.
type Box struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

// BuildClipped is Build for the part of one extract inside box, in a single pass whose memory follows the
// box, not the extract: a zone of a country is built from the country's extract. A way that leaves the box is
// cut where it does, so give the box some margin around the zone, to let loops near its edge close.
//
// The extract must be sorted, as the ones of Geofabrik are (nodes by id, then ways): it is read once, and a
// way finds its nodes among those of the box by their id.
func BuildClipped(pbfPath, demDir, outPath string, box Box, log io.Writer) error {
	if !(box.MinLon < box.MaxLon && box.MinLat < box.MaxLat) {
		return errors.New("graphbuild: the box is empty: its minimums must be below its maximums")
	}
	p := progress{log, time.Now()}
	// Only the tiles of the box are read, and after the extract: the memory of the nodes is freed by then.
	// Their headers are checked first, so that a job without the tiles of its zone fails at once.
	tiles, err := elevation.CountWithin(demDir, box.MinLat, box.MinLon, box.MaxLat, box.MaxLon)
	if err != nil {
		return err
	}
	if tiles == 0 {
		return fmt.Errorf("graphbuild: no BD ALTI tile of %s meets the box", demDir)
	}
	p.step("BD ALTI: %d tiles meet the box", tiles)
	ways, lat, lon, err := readClipped(pbfPath, box)
	if err != nil {
		return err
	}
	runtime.GC()
	p.step("read the box: %d walkable ways, %d candidate nodes", len(ways), len(lat))
	dem, err := elevation.LoadWithin(demDir, box.MinLat, box.MinLon, box.MaxLat, box.MaxLon)
	if err != nil {
		return err
	}
	return finish(p, dem, demDir, ways, lat, lon, outPath)
}

func readClipped(path string, box Box) (ways []rawWay, lat, lon []int32, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, nil, err
	}
	defer f.Close()
	sc := osmpbf.New(context.Background(), f, runtime.GOMAXPROCS(0))
	defer sc.Close()
	sc.SkipRelations = true

	e7 := func(deg float64) int32 { return int32(math.Round(deg * 1e7)) }
	minLat, minLon, maxLat, maxLon := e7(box.MinLat), e7(box.MinLon), e7(box.MaxLat), e7(box.MaxLon)

	// The nodes of the box, in the order of the file: their ids ascend, so a way finds a node by bisection.
	var nodes nodeStore
	lastID, inWays := int64(math.MinInt64), false
	for sc.Scan() {
		switch o := sc.Object().(type) {
		case *osm.Node:
			if inWays || int64(o.ID) <= lastID {
				return nil, nil, nil, fmt.Errorf("graphbuild: %s is not sorted by type then id: sort it first (osmium sort)", path)
			}
			lastID = int64(o.ID)
			la, lo := e7(o.Lat), e7(o.Lon)
			if la >= minLat && la <= maxLat && lo >= minLon && lo <= maxLon {
				nodes.add(lastID, la, lo)
			}
		case *osm.Way:
			inWays = true
			if kind, surf, ok := classifyWay(o.Tags); ok {
				for _, run := range cutInBox(o.Nodes, &nodes) {
					ways = append(ways, rawWay{kind: kind, surf: surf, idx: run})
				}
			}
		}
	}
	if err := sc.Err(); err != nil {
		return nil, nil, nil, err
	}
	lat, lon = compact(&nodes, ways)
	return ways, lat, lon, nil
}

// cutInBox cuts a way into the runs of consecutive nodes that are in the store, numbered as the store does, and
// keeps those of two nodes or more: a way that leaves the box is cut where it does.
func cutInBox(refs osm.WayNodes, nodes *nodeStore) (runs [][]uint32) {
	var run []uint32
	flush := func() {
		if len(run) >= 2 {
			runs = append(runs, run)
		}
		run = nil
	}
	for _, n := range refs {
		if k, ok := nodes.find(int64(n.ID)); ok {
			run = append(run, uint32(k))
		} else {
			flush()
		}
	}
	flush()
	return runs
}

// compact keeps only the nodes that a way uses, numbered by first use, and renumbers the ways to match: what
// follows works on those, and the store can go.
func compact(nodes *nodeStore, ways []rawWay) (lat, lon []int32) {
	remap := make([]uint32, nodes.n)
	for i := range remap {
		remap[i] = math.MaxUint32
	}
	for wi := range ways {
		idx := ways[wi].idx
		for j, k := range idx {
			if remap[k] == math.MaxUint32 {
				remap[k] = uint32(len(lat))
				la, lo := nodes.at(int(k))
				lat, lon = append(lat, la), append(lon, lo)
			}
			idx[j] = remap[k]
		}
	}
	return lat, lon
}

// ParseBox reads a box from "minLon,minLat,maxLon,maxLat", in degrees.
func ParseBox(s string) (Box, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return Box{}, fmt.Errorf("graphbuild: a box is minLon,minLat,maxLon,maxLat; got %q", s)
	}
	var v [4]float64
	for i, part := range parts {
		x, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil {
			return Box{}, fmt.Errorf("graphbuild: box %q: %w", s, err)
		}
		v[i] = x
	}
	b := Box{MinLon: v[0], MinLat: v[1], MaxLon: v[2], MaxLat: v[3]}
	if !(b.MinLon < b.MaxLon && b.MinLat < b.MaxLat && b.MinLon >= -180 && b.MaxLon <= 180 && b.MinLat >= -90 && b.MaxLat <= 90) {
		return Box{}, fmt.Errorf("graphbuild: box %q is empty or outside the globe", s)
	}
	return b, nil
}

// nodeStore holds the nodes of a box in blocks of fixed size, so that growing it never copies what it holds: a
// slice that doubles leaves its old array to be collected, and for tens of millions of nodes that doubles the
// memory of the build. Ids ascend, so a node is found by bisection, over the blocks and then in one.
type nodeStore struct {
	blocks [][]nodeRecord
	n      int
}

type nodeRecord struct {
	id       int64
	lat, lon int32
}

const nodeBlock = 1 << 20

func (s *nodeStore) add(id int64, lat, lon int32) {
	if s.n%nodeBlock == 0 {
		s.blocks = append(s.blocks, make([]nodeRecord, 0, nodeBlock))
	}
	last := &s.blocks[len(s.blocks)-1]
	*last = append(*last, nodeRecord{id, lat, lon})
	s.n++
}

// find returns the number of the node with this id, in the order they were added.
func (s *nodeStore) find(id int64) (int, bool) {
	b := sort.Search(len(s.blocks), func(i int) bool { return s.blocks[i][len(s.blocks[i])-1].id >= id })
	if b == len(s.blocks) {
		return 0, false
	}
	block := s.blocks[b]
	k := sort.Search(len(block), func(i int) bool { return block[i].id >= id })
	if block[k].id != id {
		return 0, false
	}
	return b*nodeBlock + k, true
}

func (s *nodeStore) at(i int) (lat, lon int32) {
	r := s.blocks[i/nodeBlock][i%nodeBlock]
	return r.lat, r.lon
}
