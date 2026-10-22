package generator

import "math"

const (
	// gridCell is the side of the grid cells used to compare routes, in metres.
	gridCell = 25
	// sampleStep is the step along a geometry, in metres, fine enough not to skip a cell.
	sampleStep = 5
	// retraceMinLoop is the metres a route must go before coming back to a cell counts as walking it twice.
	retraceMinLoop = 100
	earthRadius    = 6_371_000
)

type cell [2]int

// cellVisit is a grid cell a route enters, and how far along the route it does, in metres.
type cellVisit struct {
	cell  cell
	along float64
}

// cellsAlong returns the grid cells a geometry of longitude, latitude points passes through, in
// order, farther than startRadius metres from the start point.
func cellsAlong(geometry [][]float64, start [2]float64, startRadius float64) []cellVisit {
	toMetres := metresFrom(start)
	var visits []cellVisit
	visit := func(x, y, along float64) {
		if math.Hypot(x, y) <= startRadius {
			return
		}
		c := cell{int(math.Floor(x / gridCell)), int(math.Floor(y / gridCell))}
		if n := len(visits); n == 0 || visits[n-1].cell != c {
			visits = append(visits, cellVisit{c, along})
		}
	}
	along := 0.0
	for i, p := range geometry {
		x, y := toMetres(p[0], p[1])
		if i+1 == len(geometry) {
			visit(x, y, along)
			break
		}
		nx, ny := toMetres(geometry[i+1][0], geometry[i+1][1])
		length := math.Hypot(nx-x, ny-y)
		steps := max(1, int(math.Ceil(length/sampleStep)))
		for s := 0; s < steps; s++ {
			f := float64(s) / float64(steps)
			visit(x+(nx-x)*f, y+(ny-y)*f, along+length*f)
		}
		along += length
	}
	return visits
}

// sharedCells counts the cells two sets have in common, and the sizes of the smaller and the larger set.
func sharedCells(a, b map[cell]struct{}) (shared, small, large int) {
	s, l := a, b
	if len(a) > len(b) {
		s, l = b, a
	}
	for c := range s {
		if _, ok := l[c]; ok {
			shared++
		}
	}
	return shared, len(s), len(l)
}

// sharedShare is the share of the smaller of two sets of cells that the other one also covers.
func sharedShare(a, b map[cell]struct{}) float64 {
	shared, small, _ := sharedCells(a, b)
	if small == 0 {
		return 0
	}
	return float64(shared) / float64(small)
}

// coveredShare is the share of the larger of two sets of cells that the other one also covers.
func coveredShare(a, b map[cell]struct{}) float64 {
	shared, _, large := sharedCells(a, b)
	if large == 0 {
		return 0
	}
	return float64(shared) / float64(large)
}

// retraceShare is the share of a route walked twice, such as out-and-back stretches, from its
// cells in order. Coming back to a cell only counts after retraceMinLoop metres, so weaving
// along a cell edge does not.
func retraceShare(visits []cellVisit) float64 {
	if len(visits) == 0 {
		return 0
	}
	last := map[cell]int{}
	twice := map[int]struct{}{}
	for i, v := range visits {
		if prev, ok := last[v.cell]; ok && v.along-visits[prev].along >= retraceMinLoop {
			twice[prev] = struct{}{}
			twice[i] = struct{}{}
		}
		last[v.cell] = i
	}
	return float64(len(twice)) / float64(len(visits))
}

// metresFrom returns the projection of longitude and latitude to metres east and north of start, flat
// enough for the tens of kilometres a route set covers.
func metresFrom(start [2]float64) func(lon, lat float64) (x, y float64) {
	cosLat := math.Cos(start[1] * math.Pi / 180)
	return func(lon, lat float64) (x, y float64) {
		return (lon - start[0]) * math.Pi / 180 * earthRadius * cosLat, (lat - start[1]) * math.Pi / 180 * earthRadius
	}
}

// crowFlies is the length in metres of the straight lines from start through the points and back.
func crowFlies(start [2]float64, points [][2]float64) float64 {
	toMetres := metresFrom(start)
	var total, px, py float64
	for _, p := range append(append([][2]float64{}, points...), start) {
		x, y := toMetres(p[0], p[1])
		total += math.Hypot(x-px, y-py)
		px, py = x, y
	}
	return total
}
