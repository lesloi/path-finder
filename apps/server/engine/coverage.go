package engine

import (
	"math"
	"sort"
)

// coverage is the answer of Zones.Coverage for one cell size, kept so that a request reads no graph.
type coverage struct {
	perDegree int
	cells     [][4]float64
}

// Coverage lists the cells of a grid, cellsPerDegree to the degree, that hold at least one node of a zone, as
// west, south, east and north in degrees, sorted from south to north then west to east. It reads the spatial
// index of each zone, which says what each of its cells holds without reading a node, and keeps the answer.
// Every coarse cell that a fine cell with nodes overlaps counts, and so does one within the snap distance of it
// (maxSnapMeters): a start that far from a node is served, so the error only goes towards a start the engines
// refuse (ErrOffGraph), never towards an area they would serve that is left out.
func (z *Zones) Coverage(cellsPerDegree int) [][4]float64 {
	z.covMu.Lock()
	defer z.covMu.Unlock()
	if z.cov == nil || z.cov.perDegree != cellsPerDegree {
		z.cov = &coverage{perDegree: cellsPerDegree, cells: computeCoverage(z.zones, cellsPerDegree)}
	}
	return z.cov.cells
}

// Coverage is that of the zones now served.
func (r *Reloader) Coverage(cellsPerDegree int) [][4]float64 {
	z := r.hold()
	defer r.drop(z)
	return z.Coverage(cellsPerDegree)
}

func computeCoverage(zones []*zone, perDegree int) [][4]float64 {
	type index struct{ x, y int64 }
	seen := map[index]struct{}{}
	// The snap distance in 1e-7 degrees of latitude.
	snapDegrees := float64(maxSnapMeters) / metersPerDegree
	latMargin := int64(math.Ceil(snapDegrees * 1e7))
	for _, zn := range zones {
		sp := zn.graph.sp
		for cy := 0; cy < sp.ny; cy++ {
			lat0 := int64(sp.minLat) + int64(cy)*cellLat
			// Longer in longitude away from the equator.
			cosl := max(math.Cos(float64(max(abs64(lat0), abs64(lat0+cellLat)))*1e-7*rad), 0.01)
			lonMargin := int64(float64(latMargin) / cosl)
			y0, y1 := coarse(lat0-latMargin, perDegree), coarse(lat0+cellLat-1+latMargin, perDegree)
			var lastX0, lastX1 int64 = 1 << 62, 1 << 62
			for cx := 0; cx < sp.nx; cx++ {
				c := cy*sp.nx + cx
				if sp.start[c+1] == sp.start[c] {
					continue
				}
				lon0 := int64(sp.minLon) + int64(cx)*cellLon
				x0, x1 := coarse(lon0-lonMargin, perDegree), coarse(lon0+cellLon-1+lonMargin, perDegree)
				if x0 == lastX0 && x1 == lastX1 { // the previous cell of the row marked the same ones
					continue
				}
				lastX0, lastX1 = x0, x1
				for y := y0; y <= y1; y++ {
					for x := x0; x <= x1; x++ {
						seen[index{x, y}] = struct{}{}
					}
				}
			}
		}
	}
	keys := make([]index, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].y != keys[j].y {
			return keys[i].y < keys[j].y
		}
		return keys[i].x < keys[j].x
	})
	cells := make([][4]float64, len(keys))
	n := float64(perDegree)
	for i, k := range keys {
		// From whole numbers, so that the JSON says 45.3 and not 45.300000000000004.
		cells[i] = [4]float64{float64(k.x) / n, float64(k.y) / n, float64(k.x+1) / n, float64(k.y+1) / n}
	}
	return cells
}

// coarse is the index of the cell holding a coordinate in 1e-7 degrees. It rounds down: Go's division rounds
// towards zero, which would put a negative longitude one cell off.
func coarse(units int64, perDegree int) int64 {
	scaled := units * int64(perDegree)
	q := scaled / 1e7
	if scaled%1e7 < 0 {
		q--
	}
	return q
}

func abs64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}
