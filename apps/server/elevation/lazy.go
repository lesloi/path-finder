package elevation

import (
	"cmp"
	"fmt"
	"math"
	"slices"
	"sync"
)

// LazyDEM reads the tiles of a directory when a point needs them and drops them when the sampler moves on: the memory
// is that of the tiles read ahead, not of the country. It gives the heights DEM gives: the same grid, the same merge of
// the border tiles and the same arithmetic.
//
// The tiles ahead of the points are parsed by readers goroutines, so that a sampler that walks them in the order of
// their keys (see TileKey), as the build on disk does, waits for the parse of a tile only when it has run through the
// ones before it. A point reads the four cells round it, which reach the tile of the cell, the one east of it and the
// ones north of them: a sampler in that order never needs a tile behind it, which is why the window is the cache.
//
// Use it from one goroutine for the points, and Close it when no point is left.
type LazyDEM struct {
	proj         Projection
	files        map[[2]int][]string // the files of each tile, in the order Load merges them
	keys         [][2]int            // the tiles that have a file, by row from the south, then from the west
	index        map[[2]int]int      // where each of them is in keys
	x0, y0, cs   float64
	ncols, nrows int
	minTx, minTy int    // the tile of the south-west corner of the directory
	cols, rows   int    // its size in tiles
	seen         []bool // the tiles the points of a build sample, set by KeepAt
	plan         []bool // the tiles to parse ahead of them and the ones their points reach (see Plan)

	mu      sync.Mutex
	cond    *sync.Cond
	cache   map[[2]int]*demTile // the tiles from the one being sampled on
	loads   uint64
	at      int     // the place in keys of the tile being sampled, -1 before the first point
	next    int     // the place in keys the next reader parses
	ahead   int     // how many tiles the readers may be ahead of at
	errs    []error // what the reader of each tile found, for the sampler to hear of it
	stop    bool
	readers sync.WaitGroup
	frame   frame
}

// frame is the four tiles round the cell of the point being sampled: the tile of the cell, the one east of it, and the
// ones north of them; the four cells of a point never reach further. A tile that failed carries its error here, so that
// the cells of a point tell about it, as they did when each cell read its tile.
type frame struct {
	held bool
	at   [2]int
	t    [4]slot
}

type slot struct {
	t   *demTile
	err error
}

// OpenLazy reads the header of every tile below dir, so that the grid is the one Load builds, and keeps at most cache
// tiles in memory. The tiles ahead of the points are parsed on readers goroutines: none when the cache cannot hold the
// row of tiles above the one being sampled, where reading ahead would only read tiles again.
func OpenLazy(dir string, proj Projection, cache, readers int) (*LazyDEM, error) {
	paths, err := tilePaths(dir)
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("%w in %s", ErrNoTile, dir)
	}
	headers := make([]ascHeader, len(paths))
	for i, p := range paths {
		if headers[i], err = headerOf(p); err != nil {
			return nil, err
		}
	}
	for i, h := range headers[1:] {
		if err := h.sameGrid(paths[i+1], headers[0]); err != nil {
			return nil, err
		}
	}
	d := &LazyDEM{
		proj: proj, files: map[[2]int][]string{},
		x0: math.Inf(1), y0: math.Inf(1),
		cs: headers[0].cs, ncols: headers[0].ncols, nrows: headers[0].nrows,
	}
	for _, h := range headers {
		d.x0, d.y0 = min(d.x0, h.xll), min(d.y0, h.yll)
	}
	tileW, tileH := float64(d.ncols)*d.cs, float64(d.nrows)*d.cs
	for i, h := range headers {
		key := [2]int{int(math.Round((h.xll - d.x0) / tileW)), int(math.Round((h.yll - d.y0) / tileH))}
		d.files[key] = append(d.files[key], paths[i])
	}
	d.keys = make([][2]int, 0, len(d.files))
	for key := range d.files {
		d.keys = append(d.keys, key)
	}
	slices.SortFunc(d.keys, func(a, b [2]int) int {
		return cmp.Or(cmp.Compare(a[1], b[1]), cmp.Compare(a[0], b[0]))
	})
	d.index = make(map[[2]int]int, len(d.keys))
	d.minTx, d.minTy = math.MaxInt, math.MaxInt
	maxTx, maxTy := math.MinInt, math.MinInt
	for i, key := range d.keys {
		d.index[key] = i
		d.minTx, d.minTy = min(d.minTx, key[0]), min(d.minTy, key[1])
		maxTx, maxTy = max(maxTx, key[0]), max(maxTy, key[1])
	}
	d.cols, d.rows = maxTx-d.minTx+1, maxTy-d.minTy+1
	d.seen = make([]bool, d.cols*d.rows)
	d.cache, d.at, d.errs = map[[2]int]*demTile{}, -1, make([]error, len(d.keys))
	d.cond = sync.NewCond(&d.mu)
	// The frame holds the four tiles of the point being sampled, which the window does not count: the readers may go as
	// far ahead as the cache holds beyond them.
	if cache-4 > d.reach() && readers > 0 {
		d.ahead = cache - 4
		for range readers {
			d.readers.Add(1)
			go d.parseAhead()
		}
	}
	return d, nil
}

// Tiles is how many tiles the directory holds, the files of a border counted once.
func (d *LazyDEM) Tiles() int { return len(d.files) }

// Loads is how many times a tile was read from its files so far, the ones read ahead counted whether a point used them
// or not.
func (d *LazyDEM) Loads() uint64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.loads
}

// Close stops the readers, waiting for the tiles they are parsing. It can be called again, and the points may go on
// when it is: they then read the tiles themselves, one at a time, as they did without a window.
func (d *LazyDEM) Close() {
	d.mu.Lock()
	d.stop = true
	d.cond.Broadcast()
	d.mu.Unlock()
	d.readers.Wait()
}

// Project is the place of a point, given in 1e-7 degrees, in metres in the projection of the tiles. A caller that asks for
// the key of a point and then for its height projects it once, and gives the result to TileKeyAt and SampleAt.
func (d *LazyDEM) Project(lat, lon int32) (x, y float64) {
	return d.proj.Forward(float64(lat)*1e-7, float64(lon)*1e-7)
}

// TileKey is the tile a point falls in, as a number that sorts the tiles by row from the south, then from the west:
// points taken in this order stay in a few tiles. A point outside the grid shares the key of the nearest ring of tiles.
func (d *LazyDEM) TileKey(lat, lon int32) uint32 { return d.TileKeyAt(d.Project(lat, lon)) }

// TileKeyAt is TileKey for a projected point.
func (d *LazyDEM) TileKeyAt(x, y float64) uint32 {
	i, j, _, _ := gridPoint(x, y, d.x0, d.y0, d.cs)
	return tileKey(floorDiv(i, d.ncols), floorDiv(j, d.nrows))
}

// KeepAt is TileKeyAt for a point a build will sample: it tells the readers which tiles to parse ahead, so that they
// skip the ones of the directory the points never reach.
func (d *LazyDEM) KeepAt(x, y float64) uint32 {
	i, j, _, _ := gridPoint(x, y, d.x0, d.y0, d.cs)
	tx, ty := floorDiv(i, d.ncols), floorDiv(j, d.nrows)
	if tx >= d.minTx && tx < d.minTx+d.cols && ty >= d.minTy && ty < d.minTy+d.rows {
		d.seen[(ty-d.minTy)*d.cols+tx-d.minTx] = true
	}
	return tileKey(tx, ty)
}

// tileKey is the number of a tile, by row from the south then from the west, clamped to the keys of a uint32.
func tileKey(tx, ty int) uint32 {
	part := func(v int) uint32 { return uint32(min(max(v+1, 0), 0xffff)) }
	return part(ty)<<16 | part(tx)
}

// Plan tells the readers which tiles to parse: the ones the points of a build sample, and the ones their cells reach,
// the east and north neighbours of a tile. A build calls it once no more point will be kept; without it the readers
// parse every tile of the directory from the first point on, which is right and reads the ones in between for nothing.
func (d *LazyDEM) Plan() {
	plan := make([]bool, len(d.keys))
	for i, key := range d.keys {
		for dy := -1; dy <= 0 && !plan[i]; dy++ {
			for dx := -1; dx <= 0 && !plan[i]; dx++ {
				tx, ty := key[0]+dx, key[1]+dy
				if tx >= d.minTx && tx < d.minTx+d.cols && ty >= d.minTy && ty < d.minTy+d.rows {
					plan[i] = d.seen[(ty-d.minTy)*d.cols+tx-d.minTx]
				}
			}
		}
	}
	d.mu.Lock()
	d.plan = plan
	d.mu.Unlock()
}

// wanted tells whether the readers parse the tile at i: every one of them until a build sets its plan.
func (d *LazyDEM) wanted(i int) bool { return d.plan == nil || d.plan[i] }

// reach is how far ahead of the point being sampled its frame can reach in keys: the tiles of a row, and the one east of
// them in the row above.
func (d *LazyDEM) reach() int {
	worst := 0
	for i, key := range d.keys {
		for _, next := range [3][2]int{{key[0] + 1, key[1]}, {key[0], key[1] + 1}, {key[0] + 1, key[1] + 1}} {
			if j, ok := d.index[next]; ok {
				worst = max(worst, j-i)
			}
		}
	}
	return worst
}

// parseAhead parses the tiles ahead of the point being sampled, in the order of their keys, until the tiles end or the
// directory is closed.
func (d *LazyDEM) parseAhead() {
	defer d.readers.Done()
	for {
		d.mu.Lock()
		for !d.stop && (d.at < 0 || d.next >= len(d.keys) || d.next-d.at >= d.ahead) {
			d.cond.Wait()
		}
		if d.stop || d.next >= len(d.keys) {
			d.mu.Unlock()
			return
		}
		if d.next < d.at {
			// The points jumped over tiles: the ones in between are never needed.
			d.next = d.at
		}
		i, key := d.next, d.keys[d.next]
		d.next++
		if _, ok := d.cache[key]; ok || !d.wanted(i) {
			// A point of the sampler read it first, for the first tiles of a build have no reader to wait for; or no
			// point of the build reaches it, and Plan says so.
			d.mu.Unlock()
			continue
		}
		d.mu.Unlock()

		t, err := d.load(key)

		d.mu.Lock()
		if err != nil {
			d.errs[i] = err
		} else {
			d.loads++
			d.cache[key] = t
		}
		d.cond.Broadcast()
		d.mu.Unlock()
	}
}

// load parses the files of a tile and merges the border tiles as Load does.
func (d *LazyDEM) load(key [2]int) (*demTile, error) {
	var merged *demTile
	for _, p := range d.files[key] {
		f, err := readASC(p)
		if err != nil {
			return nil, err
		}
		if merged == nil {
			merged = f.tile
			continue
		}
		merged.mergeFrom(f.tile)
	}
	return merged, nil
}

// read parses a tile itself, when the readers are past it or cannot reach it, and keeps it.
func (d *LazyDEM) read(key [2]int) (*demTile, error) {
	t, err := d.load(key)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	d.loads++
	d.cache[key] = t
	d.mu.Unlock()
	return t, nil
}

// tile gives the tile at key, from memory, from the reader parsing it, or by reading it here.
func (d *LazyDEM) tile(key [2]int) (*demTile, error) {
	if len(d.files[key]) == 0 {
		return nil, nil // no file holds it: there is nothing to read
	}
	i := d.index[key]
	d.mu.Lock()
	for {
		if t, ok := d.cache[key]; ok {
			d.mu.Unlock()
			return t, nil
		}
		if err := d.errs[i]; err != nil {
			d.mu.Unlock()
			return nil, err
		}
		// A reader that took the tile has left it in the cache, or its error above: anything else is a tile no reader
		// will come to, one behind the window, one the plan leaves out, or the first points of a build, which no
		// reader waits for yet.
		if d.stop || d.at < 0 || i < d.at || i-d.at >= d.ahead || !d.wanted(i) {
			d.mu.Unlock()
			return d.read(key)
		}
		d.cond.Wait()
	}
}

// advance tells the readers where the point being sampled has gone: the tiles behind it are never needed again, and the
// ones ahead may be parsed.
func (d *LazyDEM) advance(key [2]int) {
	i, ok := d.index[key]
	if !ok {
		return // a point that falls in no tile of the directory
	}
	d.mu.Lock()
	if i > d.at {
		for j := max(d.at, 0); j < i; j++ {
			delete(d.cache, d.keys[j])
		}
		d.at = i
		d.cond.Broadcast()
	}
	d.mu.Unlock()
}

// useTile puts the four tiles round the cell of a point in the frame, reading the ones that are not in memory yet.
func (d *LazyDEM) useTile(key [2]int) {
	if d.frame.held && key == d.frame.at {
		return
	}
	d.advance(key)
	var f frame
	f.held, f.at = true, key
	for dy := range 2 {
		for dx := range 2 {
			t, err := d.tile([2]int{key[0] + dx, key[1] + dy})
			f.t[dy*2+dx] = slot{t, err}
		}
	}
	d.frame = f
}

// cell is a value of the grid, from the frame of the point being sampled: the four cells of a point are the ones of
// that frame, and a tile that failed to read fails at the cell that reads it.
func (d *LazyDEM) cell(gi, gj int) (float32, error) {
	tx, ty := floorDiv(gi, d.ncols), floorDiv(gj, d.nrows)
	s := d.frame.t[(ty-d.frame.at[1])*2+tx-d.frame.at[0]]
	if s.err != nil {
		return float32(math.NaN()), s.err
	}
	if s.t == nil {
		return float32(math.NaN()), nil
	}
	return s.t.v[(d.nrows-1-(gj-ty*d.nrows))*d.ncols+gi-tx*d.ncols], nil
}

// Sample is the elevation of a point in decimetres, or Unknown. The position is in 1e-7 degrees; a latitude of
// math.MinInt32 marks a point whose position was never read.
func (d *LazyDEM) Sample(lat, lon int32) (int32, error) {
	if lat == math.MinInt32 {
		return Unknown, nil
	}
	return d.SampleAt(d.Project(lat, lon))
}

// SampleAt is Sample for a projected point. The point must have a known position: one that was never read (see Sample)
// is not projected, it goes through Sample.
func (d *LazyDEM) SampleAt(x, y float64) (int32, error) {
	i, j, fx, fy := gridPoint(x, y, d.x0, d.y0, d.cs)
	d.useTile([2]int{floorDiv(i, d.ncols), floorDiv(j, d.nrows)})
	var c [4]float32
	for k, at := range [4][2]int{{i, j}, {i + 1, j}, {i, j + 1}, {i + 1, j + 1}} {
		var err error
		if c[k], err = d.cell(at[0], at[1]); err != nil {
			return Unknown, err
		}
	}
	z := blend(c[0], c[1], c[2], c[3], fx, fy)
	if math.IsNaN(float64(z)) {
		return Unknown, nil
	}
	return int32(math.Round(float64(z) * 10)), nil
}
