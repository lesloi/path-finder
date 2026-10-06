package engine

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
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
// served, or that did not finish building, rather than on the first request that needs it, or by leaving a hole
// in the map. A zone in a directory of zones must have the landmarks of every activity: with many zones, one
// that serves slowly would go unnoticed. A directory that is one zone keeps them optional.
func OpenZones(dir string, activities ...string) (*Zones, error) {
	if len(activities) == 0 {
		return nil, errors.New("engine: no activity to open")
	}
	dirs, flat, err := zoneDirs(dir)
	if err != nil {
		return nil, err
	}
	z := &Zones{}
	for _, d := range dirs {
		if !flat {
			for _, activity := range activities {
				if _, err := os.Stat(filepath.Join(d, LandmarksFileName(activity))); err != nil {
					return nil, fmt.Errorf("engine: zone %s has no %s: build it with build-alt", d, LandmarksFileName(activity))
				}
			}
		}
		engines, err := OpenDir(d, activities...)
		if err != nil {
			return nil, err
		}
		z.zones = append(z.zones, &zone{box: engines[activities[0]].g.sp.bounds, engines: engines})
	}
	return z, nil
}

// zoneDirs lists the directories that hold a zone, in name order, and whether the directory is itself the zone.
// A subdirectory may be a link, as the directories of a volume often are. One with landmarks or a temporary
// file but no graph is a zone whose build failed. A directory with a graph of its own and zones beside it is
// refused: serving the graph alone would leave the zones out without a word.
func zoneDirs(dir string) (dirs []string, flat bool, err error) {
	_, statErr := os.Stat(filepath.Join(dir, GraphFileName))
	flat = statErr == nil
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, false, fmt.Errorf("engine: reading the data directory: %w", err)
	}
	for _, e := range entries {
		sub := filepath.Join(dir, e.Name())
		if info, err := os.Stat(sub); err != nil || !info.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(sub, GraphFileName)); err == nil {
			dirs = append(dirs, sub)
			continue
		} else if !errors.Is(err, fs.ErrNotExist) {
			return nil, false, err
		}
		if flat {
			continue // the source data of a build, or whatever else the directory holds
		}
		for _, pattern := range []string{"*.alt", "*.tmp"} {
			if left, _ := filepath.Glob(filepath.Join(sub, pattern)); len(left) > 0 {
				return nil, false, fmt.Errorf("engine: %s holds %s but no %s: its build did not finish", sub, filepath.Base(left[0]), GraphFileName)
			}
		}
	}
	if flat {
		if len(dirs) > 0 {
			return nil, false, fmt.Errorf("engine: %s holds a %s and zones (%s): keep one of the two", dir, GraphFileName, filepath.Base(dirs[0]))
		}
		return []string{dir}, true, nil
	}
	if len(dirs) == 0 {
		return nil, false, fmt.Errorf("engine: no graph in %s, nor in a directory of it: build one with build-graph", dir)
	}
	return dirs, false, nil
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
// rectangle round an area of any shape, so a zone with no way near the start (ErrOffGraph) leaves it to the
// next. A zone that has ways there but no loop (ErrNoLoop) is not asked again elsewhere: with the zones
// overlapping, the one with the most room already holds every way the others have round the start, and a
// second failing search would only take the time of the request. When none answers, the error is the first's.
func (a *ActivityZones) Loops(ctx context.Context, req LoopRequest) ([]*Route, error) {
	type candidate struct {
		engine *Engine
		margin float64
	}
	var candidates []candidate
	for _, zn := range a.z.zones {
		if m := edgeDistance(zn.box, req.Start.Lat, req.Start.Lon); m >= 0 {
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
		if !errors.Is(err, ErrOffGraph) {
			return loops, err
		}
		if first == nil {
			first = err
		}
	}
	return nil, first
}

// edgeDistance is the distance in metres from a point to the nearest edge of a box, negative outside it.
func edgeDistance(b bounds, lat, lon float64) float64 {
	cosl := math.Cos(lat * rad)
	toEdges := [4]float64{
		(lat - float64(b.minLat)*1e-7) * metersPerDegree,
		(float64(b.maxLat)*1e-7 - lat) * metersPerDegree,
		(lon - float64(b.minLon)*1e-7) * metersPerDegree * cosl,
		(float64(b.maxLon)*1e-7 - lon) * metersPerDegree * cosl,
	}
	return min(toEdges[0], toEdges[1], toEdges[2], toEdges[3])
}
