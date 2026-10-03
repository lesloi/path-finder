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
	cosLat := math.Cos(start[1] * math.Pi / 180)
	toMetres := func(p []float64) (x, y float64) {
		return (p[0] - start[0]) * math.Pi / 180 * earthRadius * cosLat, (p[1] - start[1]) * math.Pi / 180 * earthRadius
	}
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
		x, y := toMetres(p)
		if i+1 == len(geometry) {
			visit(x, y, along)
			break
		}
		nx, ny := toMetres(geometry[i+1])
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

// sharedShare is the share of the smaller of two sets of cells that the other one also covers.
func sharedShare(a, b map[cell]struct{}) float64 {
	small, large := a, b
	if len(a) > len(b) {
		small, large = b, a
	}
	if len(small) == 0 {
		return 0
	}
	shared := 0
	for c := range small {
		if _, ok := large[c]; ok {
			shared++
		}
	}
	return float64(shared) / float64(len(small))
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
