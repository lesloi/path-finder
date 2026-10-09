package engine

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Zones are the parts of a country, each with its own graph and landmarks, that one server answers for: the
// graph of a whole country does not build in the memory of a job, so it is built by zone (see
// graphbuild.BuildClipped) and every server maps all of them. Mapping costs no memory: a zone is a few files
// and a header each, and a search reads only the pages of its own area.
//
// A data directory is one zone when it holds a graph, else each of its subdirectories that does is a zone.
type Zones struct {
	zones []*zone
	// files is every file mapped, with the version that was mapped.
	files map[string]fileID
	// refs counts the holders of the zones: one for being current, one per search in flight. It never rises
	// again from 0, which is when the files are unmapped, once (see acquire and release).
	refs      atomic.Int64
	closeOnce sync.Once
	// cov is the area covered, computed on the first Coverage; covMu guards it.
	covMu sync.Mutex
	cov   *coverage
}

type zone struct {
	box     bounds
	engines map[string]*Engine
	graph   *graph
}

// close unmaps the graph, shared by the engines, once, and the landmarks of each engine.
func (zn *zone) close() { closeEngines(zn.engines, zn.graph) }

// zoneOpens counts the calls of OpenZones, for the tests to see a reload that does not open.
var zoneOpens atomic.Int64

// OpenZones maps the zones of a data directory for the profiles. It fails at once on a zone that cannot be
// served, or that did not finish building, rather than on the first request that needs it, or by leaving a hole
// in the map. A zone in a directory of zones must have the landmarks of every profile: with many zones, one
// that serves slowly would go unnoticed. A directory that is one zone keeps them optional.
func OpenZones(dir string, profiles ...string) (_ *Zones, err error) {
	if len(profiles) == 0 {
		return nil, errors.New("engine: no profile to open")
	}
	zoneOpens.Add(1)
	dirs, flat, err := zoneDirs(dir)
	if err != nil {
		return nil, err
	}
	z := &Zones{files: map[string]fileID{}}
	z.refs.Store(1)
	defer func() {
		if err != nil {
			z.close()
		}
	}()
	for _, d := range dirs {
		if !flat {
			for _, profile := range profiles {
				if _, err := os.Stat(filepath.Join(d, LandmarksFileName(profile))); err != nil {
					return nil, fmt.Errorf("engine: zone %s has no %s: build it with build-alt", d, LandmarksFileName(profile))
				}
			}
		}
		engines, err := OpenDir(d, profiles...)
		if err != nil {
			return nil, err
		}
		g := engines[profiles[0]].g
		z.zones = append(z.zones, &zone{box: g.sp.bounds, engines: engines, graph: g})
		z.files[g.file.path] = g.file.id
		for _, e := range engines {
			if e.alt != nil {
				z.files[e.alt.file.path] = e.alt.file.id
			}
		}
	}
	return z, nil
}

// warm reads the spatial index of each zone, which every search starts from, so that the first searches on
// files just swapped in do not wait for the disk: a new file has none of its pages in the page cache.
func (z *Zones) warm() {
	for _, zn := range z.zones {
		zn.graph.warm()
	}
}

// close unmaps every file, once. A search that still runs on them would fault: the holders count prevents it.
func (z *Zones) close() {
	z.closeOnce.Do(func() {
		for _, zn := range z.zones {
			zn.close()
		}
	})
}

// acquire takes a hold on the zones, or reports that they are being let go: the count was already 0.
func (z *Zones) acquire() bool {
	for {
		n := z.refs.Load()
		if n <= 0 {
			return false
		}
		if z.refs.CompareAndSwap(n, n+1) {
			return true
		}
	}
}

// release gives a hold back. The one that brings the count to 0 unmaps the files.
func (z *Zones) release() {
	if z.refs.Add(-1) == 0 {
		z.close()
	}
}

// scanFiles lists the files of the data directory that a server maps, with their versions. A landmark file that
// is missing is left out: in a flat directory it is optional, and elsewhere OpenZones refuses the zone.
func scanFiles(dir string, profiles []string) (map[string]fileID, error) {
	dirs, _, err := zoneDirs(dir)
	if err != nil {
		return nil, err
	}
	names := []string{GraphFileName}
	for _, profile := range profiles {
		names = append(names, LandmarksFileName(profile))
	}
	files := make(map[string]fileID, len(dirs)*len(names))
	for _, d := range dirs {
		for _, name := range names {
			path := filepath.Join(d, name)
			st, err := os.Stat(path)
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			if err != nil {
				return nil, err
			}
			files[path] = fileIDOf(st)
		}
	}
	return files, nil
}

// A Reloader serves the zones of a data directory and swaps them for the files that replace them, without a
// restart. A search keeps the zones it started on until it ends, so a request is never cut by a swap and a
// replaced file is unmapped when the last search on it is done.
//
// A file is replaced by writing the new one aside and renaming it over the old: the mapping follows the inode,
// so a file written in place is seen half done by the searches in flight, and a shorter one faults them.
type Reloader struct {
	dir      string
	profiles []string
	cur      atomic.Pointer[Zones]
	mu       sync.Mutex // one reload at a time; guards what follows
	// failed is the files of the last reload that could not be served for what they hold, and why: the same
	// files are not opened again to fail the same way. A failure of the system is tried again.
	failed    map[string]fileID
	failedErr error
}

// NewReloader opens the zones of dir for the profiles, like OpenZones.
func NewReloader(dir string, profiles ...string) (*Reloader, error) {
	z, err := OpenZones(dir, profiles...)
	if err != nil {
		return nil, err
	}
	r := &Reloader{dir: dir, profiles: profiles}
	r.cur.Store(z)
	return r, nil
}

// Reload opens the zones again when a file of the data directory is not the one mapped, and swaps them in. It
// keeps the current zones, and says why, when the new ones cannot be served: a deployment that has renamed the
// graph before its landmarks fails, and succeeds on the call that follows the landmarks. Files that failed once
// fail again without being opened. It tells whether it swapped.
func (r *Reloader) Reload() (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cur := r.cur.Load()
	files, err := scanFiles(r.dir, r.profiles)
	if err != nil {
		return false, err
	}
	if maps.Equal(files, cur.files) {
		return false, nil
	}
	if maps.Equal(files, r.failed) {
		return false, r.failedErr
	}
	next, err := OpenZones(r.dir, r.profiles...)
	if err != nil {
		var transient transientError
		if !errors.As(err, &transient) { // the same files would fail the same way
			r.failed, r.failedErr = files, err
		}
		return false, err
	}
	r.failed, r.failedErr = nil, nil
	next.warm()
	r.cur.Store(next)
	cur.release() // the hold of being current: searches in flight keep theirs
	return true, nil
}

// Watch reloads every interval until ctx ends. A reload that fails keeps the zones served and is said once,
// not at every look: a deployment in two steps fails until its second file is in place.
func (r *Reloader) Watch(ctx context.Context, every time.Duration, logf func(format string, args ...any)) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	var failed string
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		started := time.Now()
		swapped, err := r.Reload()
		switch {
		case err != nil && err.Error() != failed:
			failed = err.Error()
			logf("the data did not reload, the zones served are kept: %v", err)
		case err == nil:
			failed = ""
			if swapped {
				logf("%d zone(s) reloaded in %s", r.Len(), time.Since(started).Round(time.Millisecond))
			}
		}
	}
}

// Len is the number of zones now served.
func (r *Reloader) Len() int { return r.cur.Load().Len() }

// Profile returns the loops of one profile over the zones served when each search starts, or nil when the
// profile was not opened.
func (r *Reloader) Profile(name string) *ProfileZones {
	if r.cur.Load().Profile(name) == nil {
		return nil
	}
	return &ProfileZones{src: r, name: name}
}

func (r *Reloader) drop(z *Zones) { z.release() }

// hold takes a hold on the current zones. A swap between the load and the hold leaves the old zones at 0 or
// about to be: then the load is done again, and finds the new ones.
func (r *Reloader) hold() *Zones {
	for {
		if z := r.cur.Load(); z.acquire() {
			return z
		}
	}
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

// Profile returns the loops of one profile over all the zones, or nil when it was not opened.
func (z *Zones) Profile(name string) *ProfileZones {
	if len(z.zones) == 0 || z.zones[0].engines[name] == nil {
		return nil
	}
	return &ProfileZones{src: z, name: name}
}

// zoneSource gives the zones a search runs on, and takes them back when it ends: fixed zones are theirs for
// good, a Reloader's are held for the search, which may begin on one set and the next on another.
type zoneSource interface {
	hold() *Zones
	drop(*Zones)
}

func (z *Zones) hold() *Zones { return z }
func (z *Zones) drop(*Zones)  {}

// ProfileZones generates the loops of one profile, from whichever zone holds the start point.
type ProfileZones struct {
	src  zoneSource
	name string
}

// Loops asks the zones whose box holds the start, the one with the most room round it first. A box is a
// rectangle round an area of any shape, so a zone with no way near the start (ErrOffGraph) leaves it to the
// next. A zone that has ways there but no loop (ErrNoLoop) is not asked again elsewhere: with the zones
// overlapping, the one with the most room already holds every way the others have round the start, and a
// second failing search would only take the time of the request. When none answers, the error is the first's.
func (a *ProfileZones) Loops(ctx context.Context, req LoopRequest) ([]*Route, error) {
	z := a.src.hold()
	defer a.src.drop(z)
	type candidate struct {
		engine *Engine
		margin float64
	}
	var candidates []candidate
	for _, zn := range z.zones {
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
