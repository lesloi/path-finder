package engine

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
)

// Zones are the parts of a country, each with its own graph and landmarks, that one server answers for: the
// graph of a whole country does not build in the memory of a job, so it is built by zone (see
// graphbuild.BuildClipped) and every server maps all of them. Mapping costs no memory: a zone is a few files
// and a header each, and a search reads only the pages of its own area.
//
// A data directory is one zone when it holds a graph, else each of its subdirectories that does is a zone.
type Zones struct {
	zones []*zone
}

type zone struct {
	box     bounds
	engines map[string]*Engine
}

// OpenZones maps the zones of a data directory for the activities. It fails at once on a zone that cannot be
// served, rather than on the first request that needs it.
func OpenZones(dir string, activities ...string) (*Zones, error) {
	if len(activities) == 0 {
		return nil, errors.New("engine: no activity to open")
	}
	dirs, err := zoneDirs(dir)
	if err != nil {
		return nil, err
	}
	z := &Zones{}
	for _, d := range dirs {
		engines, err := OpenDir(d, activities...)
		if err != nil {
			return nil, err
		}
		g := engines[activities[0]].g
		z.zones = append(z.zones, &zone{box: bounds{minLat: g.sp.minLat, minLon: g.sp.minLon, maxLat: g.sp.maxLat, maxLon: g.sp.maxLon}, engines: engines})
	}
	return z, nil
}

// zoneDirs lists the directories that hold a zone, in name order.
func zoneDirs(dir string) ([]string, error) {
	if _, err := os.Stat(filepath.Join(dir, GraphFileName)); err == nil {
		return []string{dir}, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("engine: reading the data directory: %w", err)
	}
	var dirs []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(dir, e.Name())
		if _, err := os.Stat(filepath.Join(sub, GraphFileName)); err == nil {
			dirs = append(dirs, sub)
		}
	}
	if len(dirs) == 0 {
		return nil, fmt.Errorf("engine: no graph in %s, nor in a directory of it: build one with build-graph", dir)
	}
	return dirs, nil
}

// Len is the number of zones.
func (z *Zones) Len() int { return len(z.zones) }

// Activity returns the loops of one activity over all the zones, or nil when it was not opened.
func (z *Zones) Activity(name string) *ActivityZones {
	if len(z.zones) == 0 || z.zones[0].engines[name] == nil {
		return nil
	}
	return &ActivityZones{z: z, name: name}
}

// ActivityZones generates the loops of one activity, from whichever zone holds the start point.
type ActivityZones struct {
	z    *Zones
	name string
}

// Loops asks the zones whose box holds the start, the one with the most room round it first. A box is a
// rectangle round an area of any shape, so a zone with no way near the start (ErrOffGraph), or no loop from it
// (ErrNoLoop, near its edge), leaves the start to the next. When none answers, the error is the first zone's.
func (a *ActivityZones) Loops(ctx context.Context, req LoopRequest) ([]*Route, error) {
	type candidate struct {
		engine *Engine
		margin float64
	}
	var candidates []candidate
	for _, zn := range a.z.zones {
		if m := margin(zn.box, req.Start.Lat, req.Start.Lon); m >= 0 {
			candidates = append(candidates, candidate{zn.engines[a.name], m})
		}
	}
	if len(candidates) == 0 {
		return nil, ErrOffGraph
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].margin > candidates[j].margin })
	var first error
	for _, c := range candidates {
		loops, err := c.engine.Loops(ctx, req)
		if err == nil || !(errors.Is(err, ErrOffGraph) || errors.Is(err, ErrNoLoop)) {
			return loops, err
		}
		if first == nil {
			first = err
		}
	}
	return nil, first
}

// margin is the distance in metres from a point to the nearest edge of a box, negative outside it.
func margin(b bounds, lat, lon float64) float64 {
	cosl := math.Cos(lat * rad)
	toEdges := [4]float64{
		(lat - float64(b.minLat)*1e-7) * metersPerDegree,
		(float64(b.maxLat)*1e-7 - lat) * metersPerDegree,
		(lon - float64(b.minLon)*1e-7) * metersPerDegree * cosl,
		(float64(b.maxLon)*1e-7 - lon) * metersPerDegree * cosl,
	}
	return min(toEdges[0], toEdges[1], toEdges[2], toEdges[3])
}
