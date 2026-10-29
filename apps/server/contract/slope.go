package contract

import "math"

// SlopeEffortOf returns the curve of contract.json, for a search that aims at a target effort distance.
func SlopeEffortOf() SlopeEffort { return bounds.SlopeEffort }

// EffortFactor is how much harder than flat ground a route is, by the slope of its stretches: its effort distance
// over its distance. The heights are read over stretches of at least StretchMetres, since the grade between two
// neighbouring points is mostly noise, and each stretch costs Tobler's hiking function relative to flat ground.
// A route without heights, or without length, is flat.
func EffortFactor(geometry [][]float64) float64 {
	s := bounds.SlopeEffort
	if len(geometry) < 2 || len(geometry[0]) < 3 {
		return 1
	}
	var total, effort, stretch float64
	startHeight := geometry[0][2]
	for i := 1; i < len(geometry); i++ {
		metres := kmBetween(geometry[i-1], geometry[i]) * 1000
		stretch += metres
		total += metres
		if stretch < s.StretchMetres && i < len(geometry)-1 {
			continue
		}
		if stretch > 0 {
			grade := math.Max(-s.MaxGrade, math.Min(s.MaxGrade, (geometry[i][2]-startHeight)/stretch))
			effort += stretch * math.Exp(s.Decay*(math.Abs(grade-s.EasiestGrade)-math.Abs(s.EasiestGrade)))
		}
		stretch, startHeight = 0, geometry[i][2]
	}
	if total == 0 {
		return 1
	}
	return effort / total
}

// kmBetween is the web app's local equirectangular projection, with its 111.195 km per degree on purpose rather than
// geo's constant: the stretches are cut at the same points on both sides.
func kmBetween(a, b []float64) float64 {
	cos := math.Cos((a[1] + b[1]) / 2 * math.Pi / 180)
	return math.Hypot((b[0]-a[0])*cos, b[1]-a[1]) * 111.195
}
