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
	dem, err := elevation.Load(demDir)
	if err != nil {
		return err
	}
	p.step("BD ALTI: %d tiles", dem.Tiles())
	ways, lat, lon, err := readClipped(pbfPath, box)
	if err != nil {
		return err
	}
	runtime.GC()
	p.step("read the box: %d walkable ways, %d candidate nodes", len(ways), len(lat))
	return finish(p, dem, demDir, ways, lat, lon, outPath)
}

// boxNodes are the nodes of the box in the order of the file: their ids ascend, so a way finds a node by
// bisection.
type boxNodes struct {
	ids      []int64
	lat, lon []int32
}

// find returns the position of a node of the box, or false for a node outside it.
func (b *boxNodes) find(id int64) (uint32, bool) {
	k := sort.Search(len(b.ids), func(i int) bool { return b.ids[i] >= id })
	return uint32(k), k < len(b.ids) && b.ids[k] == id
}

// cut splits a way into the runs of consecutive nodes that are inside the box, as positions in b, and drops
// the runs too short to hold an edge.
func (b *boxNodes) cut(nodes osm.WayNodes) (runs [][]uint32) {
	var run []uint32
	flush := func() {
		if len(run) >= 2 {
			runs = append(runs, run)
		}
		run = nil
	}
	for _, n := range nodes {
		if k, ok := b.find(int64(n.ID)); ok {
			run = append(run, k)
		} else {
			flush()
		}
	}
	flush()
	return runs
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

	var inBox boxNodes
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
				inBox.ids, inBox.lat, inBox.lon = append(inBox.ids, lastID), append(inBox.lat, la), append(inBox.lon, lo)
			}
		case *osm.Way:
			inWays = true
			kind, surf, ok := classifyWay(o.Tags)
			if !ok {
				continue
			}
			for _, run := range inBox.cut(o.Nodes) {
				ways = append(ways, rawWay{kind: kind, surf: surf, idx: run})
			}
		}
	}
	if err := sc.Err(); err != nil {
		return nil, nil, nil, err
	}
	lat, lon = compact(ways, &inBox)
	return ways, lat, lon, nil
}

// compact keeps only the nodes that a way uses, numbered by first use, and renumbers the ways to match: what
// follows works on those nodes, not on every node of the box.
func compact(ways []rawWay, b *boxNodes) (lat, lon []int32) {
	remap := make([]uint32, len(b.ids))
	for i := range remap {
		remap[i] = math.MaxUint32
	}
	for wi := range ways {
		idx := ways[wi].idx
		for j, k := range idx {
			if remap[k] == math.MaxUint32 {
				remap[k] = uint32(len(lat))
				lat, lon = append(lat, b.lat[k]), append(lon, b.lon[k])
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
