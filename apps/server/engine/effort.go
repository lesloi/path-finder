package engine

import "math"

// The engine weights a route's stretches as the ranking does, from contract.EffortFactor: the same projection
// (111.195 km per degree, as the web app's curve), the same stretches of StretchMetres, the same grading and the
// same curve. A loop found for a target effort is then the one the ranking estimates at that duration.
const effortMetresPerDegree = 111_195.0

// effortFactor is the mean weight of a path's stretches: its effort distance over its length, as the ranking reads
// it from the route's geometry. A path shorter than one stretch, or a zero curve, is flat.
func effortFactor(g *graph, nodes []uint32, s SlopeEffort) float64 {
	return effortFactorOf(len(nodes), func(i int) (lat, lon, elev float64) {
		n := &g.nodes[nodes[i]]
		return float64(n.Lat) * 1e-7, float64(n.Lon) * 1e-7, float64(n.Elev) * 0.1
	}, s)
}

// effortFactorOfPoints is effortFactor from the positions of a route, such as the direct loop a loop request reuses.
func effortFactorOfPoints(points []Position, s SlopeEffort) float64 {
	return effortFactorOf(len(points), func(i int) (lat, lon, elev float64) {
		return points[i].Lat, points[i].Lon, points[i].Elevation
	}, s)
}

// effortFactorOf is the curve of contract.EffortFactor over at: the height at the start of each stretch of at least
// StretchMetres, and the grade it makes, weighted by the stretch's length.
func effortFactorOf(n int, at func(i int) (lat, lon, elev float64), s SlopeEffort) float64 {
	if n < 2 || s.StretchMetres <= 0 {
		return 1
	}
	lat, lon, startHeight := at(0)
	var total, effort, stretch float64
	for i := 1; i < n; i++ {
		nextLat, nextLon, height := at(i)
		metres := straightMetres(lat, lon, nextLat, nextLon)
		stretch += metres
		total += metres
		lat, lon = nextLat, nextLon
		if stretch < s.StretchMetres && i < n-1 {
			continue
		}
		if stretch > 0 {
			grade := math.Max(-s.MaxGrade, math.Min(s.MaxGrade, (height-startHeight)/stretch))
			effort += stretch * math.Exp(s.Decay*(math.Abs(grade-s.EasiestGrade)-math.Abs(s.EasiestGrade)))
		}
		stretch, startHeight = 0, height
	}
	if total == 0 {
		return 1
	}
	return effort / total
}

// straightMetres is the distance between two positions in degrees, as contract.kmBetween projects it.
func straightMetres(lat0, lon0, lat1, lon1 float64) float64 {
	cos := math.Cos((lat0 + lat1) / 2 * rad)
	return math.Hypot((lon1-lon0)*cos, lat1-lat0) * effortMetresPerDegree
}
