package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"path/filepath"
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

func readASC(path string) (*ascFile, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 1<<20)
	hdr := map[string]float64{}
	for range 6 {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		parts := strings.Fields(line)
		if len(parts) != 2 {
			return nil, fmt.Errorf("bad header line %q", line)
		}
		v, err := strconv.ParseFloat(parts[1], 64)
		if err != nil {
			return nil, err
		}
		hdr[strings.ToLower(parts[0])] = v
	}
	nc, nr := int(hdr["ncols"]), int(hdr["nrows"])
	nodata := hdr["nodata_value"]
	t := &demTile{ncols: nc, nrows: nr, v: make([]float32, 0, nc*nr)}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	sc.Split(bufio.ScanWords)
	for sc.Scan() {
		v, err := strconv.ParseFloat(sc.Text(), 64)
		if err != nil {
			return nil, err
		}
		if v == nodata {
			t.v = append(t.v, float32(math.NaN()))
		} else {
			t.v = append(t.v, float32(v))
		}
	}
	if len(t.v) != nc*nr {
		return nil, fmt.Errorf("%s: got %d values, want %d", path, len(t.v), nc*nr)
	}
	return &ascFile{xll: hdr["xllcorner"], yll: hdr["yllcorner"], cs: hdr["cellsize"], tile: t}, nil
}

// loadDEM reads every .asc file below dir.
func loadDEM(dir string) (*DEM, error) {
	var paths []string
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(strings.ToLower(p), ".asc") {
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
		return nil, fmt.Errorf("no .asc file in %s", dir)
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

// elevation samples the elevation in metres at a WGS84 point, NaN outside the tiles.
func (d *DEM) elevation(latDeg, lonDeg float64) float32 {
	x, y := l93.forward(latDeg, lonDeg)
	return d.elevationL93(x, y)
}
