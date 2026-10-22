package graphbuild

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"

	"github.com/lesloi/path-finder/apps/server/contract"
)

// Categories of the points of interest, as the tiles name them.
const (
	categoryWater     = "water"
	categoryViewpoint = "viewpoint"
	categoryToilets   = "toilets"
	categoryShelter   = "shelter"
)

// classifyPOI tells which category a tagged object belongs to, if any, and whether a water point is seasonal.
// An object has one category and water comes first: a hut with drinking water is a water point. An object that says
// drinking_water=no is not a water point, but it can still be something else (toilets often say it). Any value of
// seasonal but "no" counts: the tag holds the season, such as summer.
func classifyPOI(tags osm.Tags) (category string, seasonal bool) {
	drinking := tags.Find("drinking_water")
	if drinking != "no" && (tags.Find("amenity") == "drinking_water" || drinking == "yes") {
		s := tags.Find("seasonal")
		return categoryWater, s != "" && s != "no"
	}
	amenity, tourism := tags.Find("amenity"), tags.Find("tourism")
	switch {
	case tourism == "viewpoint":
		return categoryViewpoint, false
	// Toilets of a shop (access=customers) are not for passers-by.
	case amenity == "toilets" && accessible(tags) && tags.Find("access") != "customers":
		return categoryToilets, false
	case accessible(tags) && ((amenity == "shelter" && !notForWalkers[tags.Find("shelter_type")]) ||
		tourism == "alpine_hut" || tourism == "wilderness_hut"):
		return categoryShelter, false
	}
	return "", false
}

// notForWalkers are the shelter_type values of shelters that are no stop for a walker: a bus stop, livestock, bombs.
var notForWalkers = map[string]bool{"public_transport": true, "field_shelter": true, "bomb_shelter": true}

// accessible tells whether anyone may walk up to the object: access=private and access=no keep it out. Fee-paying
// objects stay in: they are still a stop.
func accessible(tags osm.Tags) bool {
	access := tags.Find("access")
	return access != "private" && access != "no"
}

// poiScan is what the files hold: the points that have a position of their own, and the ways that need one.
type poiScan struct {
	seen   map[string]bool // "n<id>" or "w<id>": files of an extract may overlap
	points []poiPoint
	ways   []poiWay
}

type poiPoint struct {
	category string
	lat, lon float64
	seasonal bool
	name     string
}

type poiWay struct {
	category string
	seasonal bool
	name     string
	refs     []int64
}

// BuildPOIs turns OSM PBF files into the tiles of points of interest, one JSON file per tile that holds any, at
// out/<x>/<y>.json on the grid of the contract. Relations are left out. It writes into an empty or new directory
// only, so tiles of two builds are never mixed: putting the new tiles in service is up to whoever runs it.
func BuildPOIs(pbfs []string, out string, log io.Writer) error {
	if len(pbfs) == 0 {
		return errors.New("build-pois needs at least one -pbf")
	}
	if entries, err := os.ReadDir(out); err == nil && len(entries) > 0 {
		return fmt.Errorf("%s is not empty: write the tiles of a build in a new directory", out)
	}
	scan := &poiScan{seen: map[string]bool{}}
	for _, path := range pbfs {
		if err := scan.read(path); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
	}
	fmt.Fprintf(log, "pass 1: %d points and %d ways of interest\n", len(scan.points), len(scan.ways))

	// A way has no position: the mean of its nodes stands for it. Only the nodes of these ways are wanted.
	want := map[int64]struct{}{}
	for _, w := range scan.ways {
		for _, ref := range w.refs {
			want[ref] = struct{}{}
		}
	}
	pos := make(map[int64][2]float64, len(want))
	if len(want) > 0 {
		for _, path := range pbfs {
			if err := readNodePositions(path, want, pos); err != nil {
				return fmt.Errorf("%s: %w", path, err)
			}
		}
	}
	for _, w := range scan.ways {
		var lat, lon float64
		var n int
		done := map[int64]bool{}
		for _, ref := range w.refs {
			if p, ok := pos[ref]; ok && !done[ref] {
				done[ref] = true
				lat, lon, n = lat+p[0], lon+p[1], n+1
			}
		}
		if n > 0 {
			scan.points = append(scan.points, poiPoint{w.category, lat / float64(n), lon / float64(n), w.seasonal, w.name})
		}
	}

	tiles := map[[2]int][]contract.POI{}
	for _, p := range scan.points {
		x, y := contract.POITileOf(p.lat, p.lon)
		tiles[[2]int{x, y}] = append(tiles[[2]int{x, y}], contract.POI{
			Category: p.category, Position: [2]float64{round5(p.lon), round5(p.lat)}, Seasonal: p.seasonal, Name: p.name,
		})
	}
	fmt.Fprintf(log, "%d points of interest in %d tiles\n", len(scan.points), len(tiles))
	return writeTiles(out, tiles)
}

func round5(v float64) float64 { return math.Round(v*1e5) / 1e5 }

func (s *poiScan) read(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := osmpbf.New(context.Background(), f, runtime.GOMAXPROCS(0))
	defer sc.Close()
	sc.SkipRelations = true
	for sc.Scan() {
		switch o := sc.Object().(type) {
		case *osm.Node:
			category, seasonal := classifyPOI(o.Tags)
			if key := "n" + strconv.FormatInt(int64(o.ID), 10); category != "" && !s.seen[key] {
				s.seen[key] = true
				s.points = append(s.points, poiPoint{category, o.Lat, o.Lon, seasonal, o.Tags.Find("name")})
			}
		case *osm.Way:
			category, seasonal := classifyPOI(o.Tags)
			if key := "w" + strconv.FormatInt(int64(o.ID), 10); category != "" && !s.seen[key] {
				s.seen[key] = true
				refs := make([]int64, len(o.Nodes))
				for i, n := range o.Nodes {
					refs[i] = int64(n.ID)
				}
				s.ways = append(s.ways, poiWay{category, seasonal, o.Tags.Find("name"), refs})
			}
		}
	}
	return sc.Err()
}

func readNodePositions(path string, want map[int64]struct{}, pos map[int64][2]float64) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := osmpbf.New(context.Background(), f, runtime.GOMAXPROCS(0))
	defer sc.Close()
	sc.SkipWays, sc.SkipRelations = true, true
	for sc.Scan() {
		if n, ok := sc.Object().(*osm.Node); ok {
			if _, wanted := want[int64(n.ID)]; wanted {
				pos[int64(n.ID)] = [2]float64{n.Lat, n.Lon}
			}
		}
	}
	return sc.Err()
}

func writeTiles(out string, tiles map[[2]int][]contract.POI) error {
	for xy, pois := range tiles {
		sort.Slice(pois, func(i, j int) bool { // the same extract gives the same files
			a, b := pois[i], pois[j]
			if a.Position != b.Position {
				return a.Position[0] < b.Position[0] || (a.Position[0] == b.Position[0] && a.Position[1] < b.Position[1])
			}
			return strings.Compare(a.Category, b.Category) < 0
		})
		dir := filepath.Join(out, strconv.Itoa(xy[0]))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		data, err := json.Marshal(contract.POITile{POIs: pois})
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, strconv.Itoa(xy[1])+".json"), data, 0o644); err != nil {
			return err
		}
	}
	return nil
}
