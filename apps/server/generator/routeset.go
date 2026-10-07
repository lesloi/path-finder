package generator

import (
	"math"
	"sort"

	"github.com/lesloi/path-finder/apps/server/contract"
)

const (
	maxRoutes = 5
	// minRoutes is how many routes suggestions fill the set up to.
	minRoutes = 3
	// maxShared is the largest share of a route's geometry another route in the set may cover.
	maxShared = 0.5
	// startRadius is the radius around the start point left out of the comparison, in metres, since
	// every loop goes through it: at most startRadius, and a share of the target distance for short routes.
	startRadius      = 500
	startRadiusShare = 0.1
)

// How far a route may be from the criteria, relative to them; elevation gain floors are in metres.
type tolerance struct{ distance, elevationGain, elevationGainFloor float64 }

var (
	matchTolerance      = tolerance{0.1, 0.2, 50}
	suggestionTolerance = tolerance{0.25, 0.5, 100}
)

// Bounds of the flat and hilly shortcuts, in metres of elevation gain per km of the route.
var (
	flatLevel  = struct{ match, suggestion float64 }{10, 20}
	hillyLevel = struct{ match, suggestion float64 }{contract.HillyMatchPerKm(), 5}
)

// candidate is a loop from the engine, in the units of the contract.
type candidate struct {
	geometry      [][]float64 // longitude, latitude and height
	distance      float64     // kilometres
	elevationGain *float64    // metres
	elevationLoss *float64
	unpavedShare  float64
	technical     bool
	surfaces      []contract.SurfaceStretch
}

// effortDistance is the distance plus the climb, in kilometres.
func effortDistance(distance float64, elevationGain *float64) float64 {
	if elevationGain == nil {
		return distance
	}
	return distance + *elevationGain/contract.ClimbPerEffortKm()
}

// check is how a route fares against one criterion. relative is its gap relative to the
// criterion, for ranking.
type check struct {
	criterion         string
	gap, relative     float64
	match, suggestion bool
}

func againstTarget(criterion string, gap, scale, match, suggestion float64) check {
	size := math.Abs(gap)
	return check{criterion, gap, size / scale, size <= match, size <= suggestion}
}

func againstLevel(distance, gain float64, level string) check {
	l := hillyLevel
	if level == "flat" {
		l = flatLevel
	}
	perKm := gain / distance
	bound := l.match * distance
	gap := gain - bound
	if level == "flat" {
		return check{"elevationGain", gap, math.Max(0, gap) / bound, perKm <= l.match, perKm <= l.suggestion}
	}
	return check{"elevationGain", gap, math.Max(0, -gap) / bound, perKm >= l.match, perKm >= l.suggestion}
}

func checks(c contract.Criteria, cand *candidate, estimatedDuration float64) []check {
	var out []check
	if c.Target.Distance > 0 {
		t := c.Target.Distance
		out = append(out, againstTarget("distance", cand.distance-t, t, matchTolerance.distance*t, suggestionTolerance.distance*t))
	} else {
		t := c.Target.Duration
		out = append(out, againstTarget("duration", estimatedDuration-t, t, matchTolerance.distance*t, suggestionTolerance.distance*t))
	}
	// Without a target elevation gain, or a route with none, only the distance counts.
	if cand.elevationGain == nil || c.ElevationGain == nil {
		return out
	}
	gain := *cand.elevationGain
	if s := c.ElevationGain.Shortcut; s != "" {
		return append(out, againstLevel(cand.distance, gain, s))
	}
	t := c.ElevationGain.Metres
	m, s := matchTolerance, suggestionTolerance
	return append(out, againstTarget("elevationGain", gain-t,
		// Below this target, the floor of the match tolerance applies.
		math.Max(t, m.elevationGainFloor/m.elevationGain),
		math.Max(m.elevationGain*t, m.elevationGainFloor),
		math.Max(s.elevationGain*t, s.elevationGainFloor)))
}

// surfaceMismatch is the share of the route on the surface the user did not ask for.
func surfaceMismatch(surface string, unpavedShare float64) float64 {
	switch surface {
	case "unpaved":
		return 1 - unpavedShare
	case "paved":
		return unpavedShare
	}
	return 0
}

type ranked struct {
	route contract.Route
	score float64
	cells map[cell]struct{}
}

func classify(c contract.Criteria, cand *candidate, radius float64) (ranked, bool) {
	estimated := effortDistance(cand.distance, cand.elevationGain) * c.Pace
	results := checks(c, cand, estimated)
	misses := []contract.Miss{}
	score := 0.0
	for _, r := range results {
		if !r.suggestion {
			return ranked{}, false
		}
		if !r.match {
			misses = append(misses, contract.Miss{Criterion: r.criterion, Gap: r.gap})
		}
		score += r.relative
	}
	visits := cellsAlong(cand.geometry, c.Start, radius)
	score += surfaceMismatch(c.Surface, cand.unpavedShare) + retraceShare(visits)
	kind := "match"
	if len(misses) > 0 {
		kind = "suggestion"
	}
	cells := make(map[cell]struct{}, len(visits))
	for _, v := range visits {
		cells[v.cell] = struct{}{}
	}
	return ranked{contract.Route{
		Geometry: cand.geometry, Distance: cand.distance, ElevationGain: cand.elevationGain,
		ElevationLoss: cand.elevationLoss, EstimatedDuration: estimated, Kind: kind, Misses: misses,
		UnpavedShare: cand.unpavedShare, Surfaces: cand.surfaces, Technical: cand.technical,
	}, score, cells}, true
}

// buildRouteSet keeps the candidates that fit the criteria, the best first: up to maxRoutes
// matches, then suggestions only to fill the set up to minRoutes, none sharing most of its
// geometry with a better one. Fewer is fine, and none is possible.
func buildRouteSet(c contract.Criteria, targetKm float64, candidates []*candidate) []contract.Route {
	radius := math.Min(startRadius, startRadiusShare*targetKm*1000)
	var all []ranked
	for _, cand := range candidates {
		if r, ok := classify(c, cand, radius); ok {
			all = append(all, r)
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].score < all[j].score })

	var picked []ranked
	pick := func(kind string, size int) {
		for _, entry := range all {
			if len(picked) >= size {
				return
			}
			if entry.route.Kind != kind {
				continue
			}
			shares := false
			for _, p := range picked {
				if sharedShare(p.cells, entry.cells) > maxShared {
					shares = true
					break
				}
			}
			if !shares {
				picked = append(picked, entry)
			}
		}
	}
	pick("match", maxRoutes)
	pick("suggestion", minRoutes)
	routes := make([]contract.Route, len(picked))
	for i, p := range picked {
		routes[i] = p.route
	}
	return routes
}
