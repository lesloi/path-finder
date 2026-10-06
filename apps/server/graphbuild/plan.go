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
	"time"

	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"
)

// Zone is a part of a country that a graph is built for: a name, and the box to give to `build-graph -bbox`.
type Zone struct {
	Name string
	Box  Box
	// Nodes is how many nodes of the extract the box holds: what a build of the zone keeps in memory.
	Nodes int
}

// Line is the zone as a line of the list a build reads: its name, then its box.
func (z Zone) Line() string {
	return fmt.Sprintf("%s %.3f,%.3f,%.3f,%.3f", z.Name, z.Box.MinLon, z.Box.MinLat, z.Box.MaxLon, z.Box.MaxLat)
}

// PlanOptions say how to cut a country into zones.
type PlanOptions struct {
	// Extent is the area to cover; the nodes outside it are ignored.
	Extent Box
	// MaxNodes is the most nodes of the extract a zone should hold, margin included: the memory of a build
	// follows it. A zone of one cell can hold more.
	MaxNodes int
	// MarginKm is how far a zone reaches beyond the part it answers for, so that a loop near its edge closes.
	// It should be at least the radius of the longest loop. The boxes of neighbouring zones overlap by twice it.
	MarginKm float64
	// CellDeg is the size of the cells, in degrees, that nodes are counted in; the boxes follow the cells.
	CellDeg float64
}

const maxGridCells = 50_000_000

// PlanZones cuts the extent into zones holding about MaxNodes nodes each, from one pass over the extract: it
// counts the nodes of each cell of a grid, then splits the area in two, again and again, where there are as
// many nodes on each side, until the box of a part, margin included, holds no more than MaxNodes. A part with
// no node is not a zone. The dense places get small zones and the empty ones none.
func PlanZones(pbfPath string, opt PlanOptions, log io.Writer) ([]Zone, error) {
	e := opt.Extent
	switch {
	case !(e.MinLon < e.MaxLon && e.MinLat < e.MaxLat):
		return nil, errors.New("graphbuild: the extent is empty")
	case opt.MaxNodes < 1 || opt.CellDeg <= 0 || opt.MarginKm < 0:
		return nil, errors.New("graphbuild: a zone needs a budget of nodes, a cell size and a margin")
	}
	ny, nx := int(math.Ceil((e.MaxLat-e.MinLat)/opt.CellDeg)), int(math.Ceil((e.MaxLon-e.MinLon)/opt.CellDeg))
	if float64(ny)*float64(nx) > maxGridCells {
		return nil, fmt.Errorf("graphbuild: %d by %d cells is too many: take a smaller extent or larger cells", ny, nx)
	}
	p := progress{log, time.Now()}

	counts, total, err := countNodes(pbfPath, opt, ny, nx)
	if err != nil {
		return nil, err
	}
	if total == 0 {
		return nil, errors.New("graphbuild: the extract has no node in the extent")
	}
	p.step("counted %d nodes in a grid of %d by %d cells", total, ny, nx)

	g := newGrid(counts, ny, nx)
	var zones []zoneCells
	var split func(r rect)
	split = func(r rect) {
		if r = g.trim(r); g.sum(r) == 0 {
			return
		}
		midLat := e.MinLat + (float64(r.r0+r.r1)/2)*opt.CellDeg
		cosl := math.Cos(midLat * math.Pi / 180)
		cellKm := 111.32 * opt.CellDeg
		mr := int(math.Ceil(opt.MarginKm / cellKm))
		mc := int(math.Ceil(opt.MarginKm / (cellKm * cosl)))
		grown := g.clamp(rect{r.r0 - mr, r.r1 + mr, r.c0 - mc, r.c1 + mc})
		rows, cols := r.r1-r.r0, r.c1-r.c0
		if n := g.sum(grown); n <= opt.MaxNodes || (rows == 1 && cols == 1) {
			zones = append(zones, zoneCells{core: r, grown: grown, nodes: n})
			return
		}
		// Split the longer side, in kilometres, where the nodes are shared in half.
		if float64(cols)*cosl >= float64(rows) && cols > 1 || rows == 1 {
			k := g.halfway(r, false)
			split(rect{r.r0, r.r1, r.c0, r.c0 + k})
			split(rect{r.r0, r.r1, r.c0 + k, r.c1})
		} else {
			k := g.halfway(r, true)
			split(rect{r.r0, r.r0 + k, r.c0, r.c1})
			split(rect{r.r0 + k, r.r1, r.c0, r.c1})
		}
	}
	split(rect{0, ny, 0, nx})

	// North to south, then west to east, so that the names do not move when a count changes a little.
	sort.Slice(zones, func(i, j int) bool {
		if zones[i].core.r0 != zones[j].core.r0 {
			return zones[i].core.r0 > zones[j].core.r0
		}
		return zones[i].core.c0 < zones[j].core.c0
	})
	out := make([]Zone, len(zones))
	for i, z := range zones {
		box := Box{
			MinLon: roundTo3(e.MinLon+float64(z.grown.c0)*opt.CellDeg, math.Floor), MinLat: roundTo3(e.MinLat+float64(z.grown.r0)*opt.CellDeg, math.Floor),
			MaxLon: roundTo3(e.MinLon+float64(z.grown.c1)*opt.CellDeg, math.Ceil), MaxLat: roundTo3(e.MinLat+float64(z.grown.r1)*opt.CellDeg, math.Ceil),
		}
		out[i] = Zone{Name: fmt.Sprintf("z%02d", i+1), Box: box, Nodes: z.nodes}
		if z.nodes > opt.MaxNodes {
			p.step("warning: %s holds %d nodes, over the budget of %d, and is a single cell: use a smaller cell or a smaller margin", out[i].Name, z.nodes, opt.MaxNodes)
		}
	}
	p.step("%d zones", len(out))
	return out, nil
}

// roundTo3 rounds to a thousandth of a degree, outwards, to the number that its decimal form reads back as.
func roundTo3(v float64, round func(float64) float64) float64 {
	r, _ := strconv.ParseFloat(strconv.FormatFloat(round(v*1000)/1000, 'f', 3, 64), 64)
	return r
}

func countNodes(path string, opt PlanOptions, ny, nx int) (counts []uint32, total int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	sc := osmpbf.New(context.Background(), f, runtime.GOMAXPROCS(0))
	defer sc.Close()
	sc.SkipWays, sc.SkipRelations = true, true
	e := opt.Extent
	counts = make([]uint32, ny*nx)
	for sc.Scan() {
		n, ok := sc.Object().(*osm.Node)
		if !ok || n.Lat < e.MinLat || n.Lat >= e.MaxLat || n.Lon < e.MinLon || n.Lon >= e.MaxLon {
			continue
		}
		row, col := int((n.Lat-e.MinLat)/opt.CellDeg), int((n.Lon-e.MinLon)/opt.CellDeg)
		counts[min(row, ny-1)*nx+min(col, nx-1)]++
		total++
	}
	return counts, total, sc.Err()
}

// rect is a block of cells: rows r0 to r1 and columns c0 to c1, the ends excluded.
type rect struct{ r0, r1, c0, c1 int }

type zoneCells struct {
	core, grown rect
	nodes       int
}

// grid is the node counts of the cells, with their running sums, so that the count of a block costs four reads.
type grid struct {
	ny, nx int
	counts []uint32
	sums   []uint64 // (ny+1) by (nx+1)
}

func newGrid(counts []uint32, ny, nx int) *grid {
	g := &grid{ny: ny, nx: nx, counts: counts, sums: make([]uint64, (ny+1)*(nx+1))}
	for r := 0; r < ny; r++ {
		for c := 0; c < nx; c++ {
			g.sums[(r+1)*(nx+1)+c+1] = uint64(counts[r*nx+c]) + g.sums[r*(nx+1)+c+1] + g.sums[(r+1)*(nx+1)+c] - g.sums[r*(nx+1)+c]
		}
	}
	return g
}

func (g *grid) sum(r rect) int {
	w := g.nx + 1
	return int(g.sums[r.r1*w+r.c1] + g.sums[r.r0*w+r.c0] - g.sums[r.r0*w+r.c1] - g.sums[r.r1*w+r.c0])
}

func (g *grid) clamp(r rect) rect {
	return rect{max(r.r0, 0), min(r.r1, g.ny), max(r.c0, 0), min(r.c1, g.nx)}
}

// trim drops the empty rows and columns from the edges of a block.
func (g *grid) trim(r rect) rect {
	for r.r0 < r.r1 && g.sum(rect{r.r0, r.r0 + 1, r.c0, r.c1}) == 0 {
		r.r0++
	}
	for r.r1 > r.r0 && g.sum(rect{r.r1 - 1, r.r1, r.c0, r.c1}) == 0 {
		r.r1--
	}
	for r.c0 < r.c1 && g.sum(rect{r.r0, r.r1, r.c0, r.c0 + 1}) == 0 {
		r.c0++
	}
	for r.c1 > r.c0 && g.sum(rect{r.r0, r.r1, r.c1 - 1, r.c1}) == 0 {
		r.c1--
	}
	return r
}

// halfway is how many rows (or columns) from the start of a block hold half of its nodes, leaving both sides one
// at least.
func (g *grid) halfway(r rect, rows bool) int {
	half, length := g.sum(r)/2, r.c1-r.c0
	if rows {
		length = r.r1 - r.r0
	}
	for k := 1; k < length; k++ {
		part := rect{r.r0, r.r0 + k, r.c0, r.c1}
		if !rows {
			part = rect{r.r0, r.r1, r.c0, r.c0 + k}
		}
		if g.sum(part) >= half {
			return k
		}
	}
	return length - 1
}
