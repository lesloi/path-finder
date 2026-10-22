// Package elevation reads IGN BD ALTI 25 m tiles and samples the height at a point. It is plain Go, so the
// race detector can cover its concurrent loading and sampling.
package elevation

import (
	"bufio"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

const rad = math.Pi / 180

// lambert converts WGS84 to Lambert-93 (EPSG:2154), the projection of the metropolitan BD ALTI.
type lambert struct{ n, f, rho0, lon0 float64 }

const (
	grsA = 6378137.0
	grsE = 0.0818191910428158
)

func tfun(phi float64) float64 {
	s := math.Sin(phi)
	return math.Tan(math.Pi/4-phi/2) / math.Pow((1-grsE*s)/(1+grsE*s), grsE/2)
}

func mfun(phi float64) float64 {
	s := math.Sin(phi)
	return math.Cos(phi) / math.Sqrt(1-grsE*grsE*s*s)
}

var l93 = func() lambert {
	p0, p1, p2 := 46.5*rad, 44*rad, 49*rad
	m1, m2 := mfun(p1), mfun(p2)
	t0, t1, t2 := tfun(p0), tfun(p1), tfun(p2)
	n := (math.Log(m1) - math.Log(m2)) / (math.Log(t1) - math.Log(t2))
	f := m1 / (n * math.Pow(t1, n))
	return lambert{n: n, f: f, rho0: grsA * f * math.Pow(t0, n), lon0: 3 * rad}
}()

func (l lambert) Forward(latDeg, lonDeg float64) (x, y float64) {
	rho := grsA * l.f * math.Pow(tfun(latDeg*rad), l.n)
	theta := l.n * (lonDeg*rad - l.lon0)
	return 700000 + rho*math.Sin(theta), 6600000 + l.rho0 - rho*math.Cos(theta)
}

type demTile struct {
	ncols, nrows int
	v            []float32 // row 0 is the northern row
}

// DEM holds BD ALTI 25 m ASC tiles in memory.
type DEM struct {
	proj         Projection
	tiles        map[[2]int]*demTile
	x0, y0, cs   float64 // lower-left corner of the lowest tile, and the cell size in metres
	tileW, tileH float64
	ncols, nrows int
}

func floorDiv(a, b int) int {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}

type ascFile struct {
	xll, yll, cs float64
	tile         *demTile
}

// ascHeader is the six lines that open an ASC tile: its size, its lower-left corner and its cell size.
type ascHeader struct {
	ncols, nrows int
	xll, yll, cs float64
	nodata       float64
}

// extent is the area of the tile in the metres of its projection.
func (h ascHeader) extent() (x0, y0, x1, y1 float64) {
	return h.xll, h.yll, h.xll + float64(h.ncols)*h.cs, h.yll + float64(h.nrows)*h.cs
}

// readHeader reads the header of an ASC tile from r, which then stands at its first value.
func readHeader(r *bufio.Reader) (ascHeader, error) {
	hdr := map[string]float64{}
	for range 6 {
		line, err := r.ReadString('\n')
		if err != nil {
			return ascHeader{}, err
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			return ascHeader{}, fmt.Errorf("bad header line %q", line)
		}
		v, err := strconv.ParseFloat(parts[1], 64)
		if err != nil {
			return ascHeader{}, err
		}
		hdr[strings.ToLower(parts[0])] = v
	}
	for _, key := range []string{"ncols", "nrows", "xllcorner", "yllcorner", "cellsize"} {
		if _, ok := hdr[key]; !ok {
			return ascHeader{}, fmt.Errorf("header has no %s", key)
		}
	}
	return ascHeader{ncols: int(hdr["ncols"]), nrows: int(hdr["nrows"]), xll: hdr["xllcorner"], yll: hdr["yllcorner"], cs: hdr["cellsize"], nodata: hdr["nodata_value"]}, nil
}

// isTile tells whether a file is a BD ALTI tile: an ASC file, plain or gzipped (about 3.4 times smaller).
func isTile(path string) bool {
	name := strings.ToLower(path)
	return strings.HasSuffix(name, ".asc") || strings.HasSuffix(name, ".asc.gz")
}

// gzipFile reads a gzipped tile. gzip.Reader.Close does not close the file it reads from, so this does both.
type gzipFile struct {
	*gzip.Reader
	f *os.File
}

func (g gzipFile) Close() error { return errors.Join(g.Reader.Close(), g.f.Close()) }

func openTile(path string) (io.ReadCloser, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".gz") {
		return f, nil
	}
	z, err := gzip.NewReader(f)
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return gzipFile{z, f}, nil
}

func readASC(path string) (*ascFile, error) {
	f, err := openTile(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 1<<20)
	h, err := readHeader(r)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	nc, nr, nodata := h.ncols, h.nrows, h.nodata
	t := &demTile{ncols: nc, nrows: nr, v: make([]float32, 0, nc*nr)}
	if t.v, err = readValues(r, nodata, t.v); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if len(t.v) != nc*nr {
		return nil, fmt.Errorf("%s: got %d values, want %d", path, len(t.v), nc*nr)
	}
	return &ascFile{xll: h.xll, yll: h.yll, cs: h.cs, tile: t}, nil
}

// sameGrid fails for a tile whose cells are not those of the first one: the grid is worked out from the first tile alone, so
// a tile of another size or resolution would be placed and read wrongly, with no error to show for it.
func sameGrid(path string, ncols, nrows int, cs float64, wantCols, wantRows int, wantCS float64) error {
	if ncols != wantCols || nrows != wantRows || cs != wantCS {
		return fmt.Errorf("%s: %d by %d cells of %v m, but the first tile has %d by %d cells of %v m", path, ncols, nrows, cs, wantCols, wantRows, wantCS)
	}
	return nil
}

// CountTiles is how many tiles are below dir, without reading any: a build can fail at once when it has none,
// and read them later, when the memory of its other steps is free.
func CountTiles(dir string) (int, error) {
	paths, err := tilePaths(dir)
	return len(paths), err
}

// tilePaths lists the tiles below dir.
func tilePaths(dir string) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && isTile(p) {
			paths = append(paths, p)
		}
		return err
	})
	return paths, err
}

// ErrNoTile is what loading says when no tile is left to read.
var ErrNoTile = errors.New("no .asc or .asc.gz file")

// Load reads every .asc and .asc.gz file below dir, written in the projection proj.
func Load(dir string, proj Projection) (*DEM, error) {
	paths, err := tilePaths(dir)
	if err != nil {
		return nil, err
	}
	files := make([]*ascFile, len(paths))
	errs := make([]error, len(paths))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, p := range paths {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			files[i], errs[i] = readASC(p)
		}()
	}
	wg.Wait()
	for _, e := range errs {
		if e != nil {
			return nil, e
		}
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("%w in %s", ErrNoTile, dir)
	}
	for i, f := range files {
		if err := sameGrid(paths[i], f.tile.ncols, f.tile.nrows, f.cs, files[0].tile.ncols, files[0].tile.nrows, files[0].cs); err != nil {
			return nil, err
		}
	}
	d := &DEM{proj: proj, tiles: map[[2]int]*demTile{}, x0: math.Inf(1), y0: math.Inf(1), cs: files[0].cs}
	d.ncols, d.nrows = files[0].tile.ncols, files[0].tile.nrows
	for _, f := range files {
		d.x0, d.y0 = min(d.x0, f.xll), min(d.y0, f.yll)
	}
	d.tileW, d.tileH = float64(d.ncols)*d.cs, float64(d.nrows)*d.cs
	for _, f := range files {
		key := [2]int{int(math.Round((f.xll - d.x0) / d.tileW)), int(math.Round((f.yll - d.y0) / d.tileH))}
		if prev := d.tiles[key]; prev != nil {
			prev.mergeFrom(f.tile)
			continue
		}
		d.tiles[key] = f.tile
	}
	return d, nil
}

// mergeFrom fills the empty cells of t from another file of the same tile: border tiles come with each neighbouring
// département, empty outside it. The loaded and the lazy DEM both use it, so that they merge alike.
func (t *demTile) mergeFrom(other *demTile) {
	for i, v := range other.v {
		if math.IsNaN(float64(t.v[i])) {
			t.v[i] = v
		}
	}
}

func (d *DEM) cell(gi, gj int) float32 {
	tx, ty := floorDiv(gi, d.ncols), floorDiv(gj, d.nrows)
	t := d.tiles[[2]int{tx, ty}]
	if t == nil {
		return float32(math.NaN())
	}
	c := gi - tx*d.ncols
	rowFromBottom := gj - ty*d.nrows
	return t.v[(d.nrows-1-rowFromBottom)*d.ncols+c]
}

// gridPoint is where a point of the grid of the tiles falls: the cell below and left of it, and how far the
// point is from the centre of that cell, as a share of a cell.
func gridPoint(x, y, x0, y0, cs float64) (i, j int, tx, ty float32) {
	fx, fy := (x-x0)/cs-0.5, (y-y0)/cs-0.5
	i, j = int(math.Floor(fx)), int(math.Floor(fy))
	return i, j, float32(fx - float64(i)), float32(fy - float64(j))
}

// blend is the bilinear mix of the four cells round a point: a at (i, j), b east of it, c north, e north-east. The
// loaded and the lazy DEM both use it, so that they give the same heights to the last bit.
func blend(a, b, c, e, tx, ty float32) float32 {
	bottom, top := a+(b-a)*tx, c+(e-c)*tx
	return bottom + (top-bottom)*ty
}

// elevationAt samples the elevation in metres at a point of the grid of the tiles, NaN outside the tiles.
func (d *DEM) elevationAt(x, y float64) float32 {
	i, j, tx, ty := gridPoint(x, y, d.x0, d.y0, d.cs)
	return blend(d.cell(i, j), d.cell(i+1, j), d.cell(i, j+1), d.cell(i+1, j+1), tx, ty)
}

// At samples the elevation in metres at a WGS84 point, NaN outside the tiles.
func (d *DEM) At(latDeg, lonDeg float64) float32 {
	x, y := d.proj.Forward(latDeg, lonDeg)
	return d.elevationAt(x, y)
}

// Tiles is the number of tiles loaded.
func (d *DEM) Tiles() int { return len(d.tiles) }

// Lambert93Grid is the projection of the metropolitan BD ALTI tiles.
var Lambert93Grid Projection = l93

// Unknown marks a node with no elevation: the point is outside the tiles, or its position is unknown.
const Unknown = math.MinInt32

// Sample returns the elevation of each point, in decimetres, or Unknown. Positions are in 1e-7 degrees;
// a latitude of math.MinInt32 marks a point whose position was never read. It samples on every CPU.
func (d *DEM) Sample(lat, lon []int32) []int32 {
	elev := make([]int32, len(lat))
	chunk := (len(lat) + runtime.NumCPU() - 1) / runtime.NumCPU()
	var wg sync.WaitGroup
	for lo := 0; lo < len(lat); lo += chunk {
		hi := min(lo+chunk, len(lat))
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := lo; i < hi; i++ {
				elev[i] = Unknown
				if lat[i] == math.MinInt32 {
					continue
				}
				if z := d.At(float64(lat[i])*1e-7, float64(lon[i])*1e-7); !math.IsNaN(float64(z)) {
					elev[i] = int32(math.Round(float64(z) * 10))
				}
			}
		}()
	}
	wg.Wait()
	return elev
}

// headerOf reads the header of a tile.
func headerOf(path string) (ascHeader, error) {
	f, err := openTile(path)
	if err != nil {
		return ascHeader{}, err
	}
	defer f.Close()
	h, err := readHeader(bufio.NewReader(f))
	if err != nil {
		return ascHeader{}, fmt.Errorf("%s: %w", path, err)
	}
	return h, nil
}
