package elevation

import (
	"container/list"
	"fmt"
	"math"
)

// LazyDEM reads the tiles of a directory when a point needs them and drops them when its cache is full: the
// memory is that of a few tiles, not of the country. It gives the heights DEM gives: the same grid, the same merge of
// the border tiles and the same arithmetic. Points taken tile by tile (see TileKey) read each tile about once.
// Unlike DEM, which is only read once loaded, it changes its cache at every sample: use it from one goroutine.
type LazyDEM struct {
	proj         Projection
	files        map[[2]int][]string // the files of each tile, in the order Load merges them
	cache        map[[2]int]*list.Element
	order        *list.List // most recently used first
	capacity     int
	loads        uint64
	x0, y0, cs   float64
	ncols, nrows int
}

type cachedTile struct {
	key  [2]int
	tile *demTile
}

// OpenLazy reads the header of every tile below dir, so that the grid is the one Load builds, and keeps at most
// cache tiles in memory.
func OpenLazy(dir string, proj Projection, cache int) (*LazyDEM, error) {
	paths, err := tilePaths(dir, nil)
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
	d := &LazyDEM{
		proj: proj, files: map[[2]int][]string{}, cache: map[[2]int]*list.Element{}, order: list.New(),
		capacity: max(cache, 1), x0: math.Inf(1), y0: math.Inf(1),
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
	return d, nil
}

// Tiles is how many tiles the directory holds, the files of a border counted once.
func (d *LazyDEM) Tiles() int { return len(d.files) }

// Loads is how many times a tile was read from its files so far.
func (d *LazyDEM) Loads() uint64 { return d.loads }

// TileKey is the tile a point falls in, as a number that sorts the tiles by row from the south, then from the west:
// points taken in this order stay in a few tiles. A point outside the grid shares the key of the nearest ring of tiles.
func (d *LazyDEM) TileKey(lat, lon int32) uint32 {
	x, y := d.proj.Forward(float64(lat)*1e-7, float64(lon)*1e-7)
	i, j, _, _ := gridPoint(x, y, d.x0, d.y0, d.cs)
	part := func(v int) uint32 { return uint32(min(max(v+1, 0), 0xffff)) }
	return part(floorDiv(j, d.nrows))<<16 | part(floorDiv(i, d.ncols))
}

// tile returns the tile at key, read and merged on a miss; nil when no file holds it.
func (d *LazyDEM) tile(key [2]int) (*demTile, error) {
	if el, ok := d.cache[key]; ok {
		d.order.MoveToFront(el)
		return el.Value.(*cachedTile).tile, nil
	}
	if len(d.files[key]) == 0 {
		return nil, nil // no file holds it: there is nothing to cache
	}
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
	d.loads++
	if d.order.Len() >= d.capacity {
		oldest := d.order.Back()
		delete(d.cache, oldest.Value.(*cachedTile).key)
		d.order.Remove(oldest)
	}
	d.cache[key] = d.order.PushFront(&cachedTile{key, merged})
	return merged, nil
}

func (d *LazyDEM) cell(gi, gj int) (float32, error) {
	tx, ty := floorDiv(gi, d.ncols), floorDiv(gj, d.nrows)
	t, err := d.tile([2]int{tx, ty})
	if err != nil || t == nil {
		return float32(math.NaN()), err
	}
	return t.v[(d.nrows-1-(gj-ty*d.nrows))*d.ncols+gi-tx*d.ncols], nil
}

// Sample is the elevation of a point in decimetres, or Unknown. The position is in 1e-7 degrees; a latitude of
// math.MinInt32 marks a point whose position was never read.
func (d *LazyDEM) Sample(lat, lon int32) (int32, error) {
	if lat == math.MinInt32 {
		return Unknown, nil
	}
	x, y := d.proj.Forward(float64(lat)*1e-7, float64(lon)*1e-7)
	i, j, tx, ty := gridPoint(x, y, d.x0, d.y0, d.cs)
	var c [4]float32
	for k, at := range [4][2]int{{i, j}, {i + 1, j}, {i, j + 1}, {i + 1, j + 1}} {
		var err error
		if c[k], err = d.cell(at[0], at[1]); err != nil {
			return Unknown, err
		}
	}
	z := blend(c[0], c[1], c[2], c[3], tx, ty)
	if math.IsNaN(float64(z)) {
		return Unknown, nil
	}
	return int32(math.Round(float64(z) * 10)), nil
}
