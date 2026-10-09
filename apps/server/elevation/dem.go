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

// lambert converts WGS84 to Lambert-93 (EPSG:2154), the projection of BD ALTI.
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

func (l lambert) forward(latDeg, lonDeg float64) (x, y float64) {
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

// extent is the area of the tile in Lambert-93 metres.
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
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	sc.Split(bufio.ScanWords)
	for sc.Scan() {
		v, err := strconv.ParseFloat(sc.Text(), 64)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		if v == nodata {
			t.v = append(t.v, float32(math.NaN()))
		} else {
			t.v = append(t.v, float32(v))
		}
	}
	// A gzip file reports a damaged stream, and its checksum, as a read error: without this a tile that is cut or
	// corrupt could still hold the right number of values.
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if len(t.v) != nc*nr {
		return nil, fmt.Errorf("%s: got %d values, want %d", path, len(t.v), nc*nr)
	}
	return &ascFile{xll: h.xll, yll: h.yll, cs: h.cs, tile: t}, nil
}

// Load reads every .asc and .asc.gz file below dir.
func Load(dir string) (*DEM, error) { return load(dir, nil) }

// within is the test of a tile header that holds when the tile meets the box, given by its latitudes and
// longitudes in degrees.
func within(minLat, minLon, maxLat, maxLon float64) func(ascHeader) bool {
	// A box is not a rectangle in Lambert-93: the rectangle through points all along its edges holds it.
	x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	const steps = 8
	for i := 0; i <= steps; i++ {
		for j := 0; j <= steps; j++ {
			x, y := Lambert93(minLat+(maxLat-minLat)*float64(i)/steps, minLon+(maxLon-minLon)*float64(j)/steps)
			x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
		}
	}
	return func(h ascHeader) bool {
		tx0, ty0, tx1, ty1 := h.extent()
		return tx0 < x1 && tx1 > x0 && ty0 < y1 && ty1 > y0
	}
}

// CountWithin is how many tiles below dir meet the box: it reads only their headers, so a job can tell at
// once that it has not been given the tiles of its zone.
func CountWithin(dir string, minLat, minLon, maxLat, maxLon float64) (int, error) {
	keep, n := within(minLat, minLon, maxLat, maxLon), 0
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !isTile(p) {
			return err
		}
		ok, herr := headerKept(p, keep)
		if ok {
			n++
		}
		return herr
	})
	return n, err
}

// LoadWithin reads the tiles below dir that meet the box: the memory of a build is then that of the
// tiles of its zone, not of the whole country. It reads only the header of the others.
func LoadWithin(dir string, minLat, minLon, maxLat, maxLon float64) (*DEM, error) {
	d, err := load(dir, within(minLat, minLon, maxLat, maxLon))
	if errors.Is(err, errNoTile) {
		return nil, fmt.Errorf("no tile of %s meets the box %.3f,%.3f,%.3f,%.3f", dir, minLon, minLat, maxLon, maxLat)
	}
	return d, err
}

// errNoTile is what loading says when no tile is left to read.
var errNoTile = errors.New("no .asc or .asc.gz file")

// load reads the tiles below dir that keep accepts (all of them when it is nil).
func load(dir string, keep func(ascHeader) bool) (*DEM, error) {
	var paths []string
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && isTile(p) {
			if keep != nil {
				ok, herr := headerKept(p, keep)
				if herr != nil {
					return herr
				}
				if !ok {
					return nil
				}
			}
			paths = append(paths, p)
		}
		return err
	})
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
		return nil, fmt.Errorf("%w in %s", errNoTile, dir)
	}
	d := &DEM{tiles: map[[2]int]*demTile{}, x0: math.Inf(1), y0: math.Inf(1), cs: files[0].cs}
	d.ncols, d.nrows = files[0].tile.ncols, files[0].tile.nrows
	for _, f := range files {
		d.x0, d.y0 = min(d.x0, f.xll), min(d.y0, f.yll)
	}
	d.tileW, d.tileH = float64(d.ncols)*d.cs, float64(d.nrows)*d.cs
	for _, f := range files {
		key := [2]int{int(math.Round((f.xll - d.x0) / d.tileW)), int(math.Round((f.yll - d.y0) / d.tileH))}
		if prev := d.tiles[key]; prev != nil {
			// Border tiles come with each neighbouring département, empty outside it: merge them.
			for i, v := range f.tile.v {
				if math.IsNaN(float64(prev.v[i])) {
					prev.v[i] = v
				}
			}
			continue
		}
		d.tiles[key] = f.tile
	}
	return d, nil
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

// elevationL93 samples the elevation in metres at a Lambert-93 point, NaN outside the tiles.
func (d *DEM) elevationL93(x, y float64) float32 {
	fx, fy := (x-d.x0)/d.cs-0.5, (y-d.y0)/d.cs-0.5
	i, j := int(math.Floor(fx)), int(math.Floor(fy))
	tx, ty := float32(fx-float64(i)), float32(fy-float64(j))
	a, b := d.cell(i, j), d.cell(i+1, j)
	c, e := d.cell(i, j+1), d.cell(i+1, j+1)
	bottom, top := a+(b-a)*tx, c+(e-c)*tx
	return bottom + (top-bottom)*ty
}

// At samples the elevation in metres at a WGS84 point, NaN outside the tiles.
func (d *DEM) At(latDeg, lonDeg float64) float32 {
	x, y := l93.forward(latDeg, lonDeg)
	return d.elevationL93(x, y)
}

// Tiles is the number of tiles loaded.
func (d *DEM) Tiles() int { return len(d.tiles) }

// Lambert93 converts a WGS84 point in degrees to Lambert-93 metres, the projection of BD ALTI.
func Lambert93(latDeg, lonDeg float64) (x, y float64) { return l93.forward(latDeg, lonDeg) }

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

// headerKept reads only the header of a tile, to tell whether keep wants it.
func headerKept(path string, keep func(ascHeader) bool) (bool, error) {
	f, err := openTile(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	h, err := readHeader(bufio.NewReader(f))
	if err != nil {
		return false, fmt.Errorf("%s: %w", path, err)
	}
	return keep(h), nil
}
