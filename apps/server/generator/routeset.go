package generator

import (
	"math"
	"sort"

	"github.com/lesloi/path-finder/apps/server/contract"
)

const (
	maxRoutes = 8
	// minRoutes is how many routes suggestions, then wide suggestions, fill the set up to.
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
	// wideTolerance only fills a set that suggestions leave short of minRoutes. Not measured yet.
	wideTolerance = tolerance{0.35, 0.75, 150}
)

// tier is how far a route is from a criterion: a match, a suggestion, a wide suggestion, or out of reach.
// A wide suggestion is sent as a suggestion; it only ranks after the others.
type tier int

const (
	tierMatch tier = iota
	tierSuggestion
	tierWide
	tierOut
)

// tolerances is in tier order.
var tolerances = [tierOut]tolerance{matchTolerance, suggestionTolerance, wideTolerance}

// distanceBound and gainBound are the largest gap a tolerance accepts from a target.
func (t tolerance) distanceBound(target float64) float64 { return t.distance * target }
func (t tolerance) gainBound(target float64) float64 {
	return math.Max(t.elevationGain*target, t.elevationGainFloor)
}

// boundsOf is the largest gap each tier accepts from a target.
func boundsOf(target float64, bound func(tolerance, float64) float64) (out [tierOut]float64) {
	for i, t := range tolerances {
		out[i] = bound(t, target)
	}
	return
}

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
	criterion     string
	gap, relative float64
	tier          tier
}

func againstTarget(criterion string, gap, scale float64, bounds [tierOut]float64) check {
	size := math.Abs(gap)
	t := tierOut
	for i, bound := range bounds {
		if size <= bound {
			t = tier(i)
			break
		}
	}
	return check{criterion, gap, size / scale, t}
}

// tierOfLevel is the tier of a shortcut, which has no wide level: a shortcut is a kind of terrain, not a
// number to be approximated.
func tierOfLevel(matches, suggests bool) tier {
	switch {
	case matches:
		return tierMatch
	case suggests:
		return tierSuggestion
	}
	return tierOut
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
		return check{"elevationGain", gap, math.Max(0, gap) / bound, tierOfLevel(perKm <= l.match, perKm <= l.suggestion)}
	}
	return check{"elevationGain", gap, math.Max(0, -gap) / bound, tierOfLevel(perKm >= l.match, perKm >= l.suggestion)}
}

func checks(c contract.Criteria, cand *candidate, estimatedDuration float64) []check {
	var out []check
	if c.Target.Distance > 0 {
		t := c.Target.Distance
		out = append(out, againstTarget("distance", cand.distance-t, t, boundsOf(t, tolerance.distanceBound)))
	} else {
		t := c.Target.Duration
		out = append(out, againstTarget("duration", estimatedDuration-t, t, boundsOf(t, tolerance.distanceBound)))
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
	m := matchTolerance
	return append(out, againstTarget("elevationGain", gain-t,
		// Below this target, the floor of the match tolerance applies.
		math.Max(t, m.elevationGainFloor/m.elevationGain),
		boundsOf(t, tolerance.gainBound)))
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
	tier  tier
	cells map[cell]struct{}
}

func classify(c contract.Criteria, cand *candidate, radius float64) (ranked, bool) {
	estimated := effortDistance(cand.distance, cand.elevationGain) * c.Pace
	results := checks(c, cand, estimated)
	misses := []contract.Miss{}
	score, worst := 0.0, tierMatch
	for _, r := range results {
		if r.tier == tierOut {
			return ranked{}, false
		}
		if r.tier != tierMatch {
			misses = append(misses, contract.Miss{Criterion: r.criterion, Gap: r.gap})
		}
		worst = max(worst, r.tier)
		score += r.relative
	}
	visits := cellsAlong(cand.geometry, c.Start, radius)
	score += surfaceMismatch(c.Surface, cand.unpavedShare) + retraceShare(visits)
	kind := "match"
	if worst != tierMatch {
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
	}, score, worst, cells}, true
}

// ranking holds the candidates that fit the criteria, the best first. Each is classified once as it is added,
// since the search asks for the route set after every loop found.
type ranking struct {
	criteria contract.Criteria
	radius   float64
	all      []ranked
}

func newRanking(c contract.Criteria, targetKm float64) *ranking {
	return &ranking{criteria: c, radius: math.Min(startRadius, startRadiusShare*targetKm*1000)}
}

// add ranks candidates among those already there. The sort is stable, so equal scores keep the order the
// candidates were added in.
func (r *ranking) add(candidates ...*candidate) {
	for _, cand := range candidates {
		if entry, ok := classify(r.criteria, cand, r.radius); ok {
			r.all = append(r.all, entry)
		}
	}
	sort.SliceStable(r.all, func(i, j int) bool { return r.all[i].score < r.all[j].score })
}

// routes keeps the best up to limit matches, then suggestions only to fill the set up to minRoutes, then wide
// suggestions for what is still missing, none sharing most of its geometry with a better one. Fewer is fine,
// and none is possible.
func (r *ranking) routes(limit int) []contract.Route {
	var picked []ranked
	pick := func(t tier, size int) {
		for _, entry := range r.all {
			if len(picked) >= size {
				return
			}
			if entry.tier != t {
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
	pick(tierMatch, limit)
	pick(tierSuggestion, minRoutes)
	pick(tierWide, minRoutes)
	routes := make([]contract.Route, len(picked))
	for i, p := range picked {
		routes[i] = p.route
	}
	return routes
}

// buildRouteSet keeps the candidates that fit the criteria, the best first: up to limit matches, then
// suggestions only to fill the set up to minRoutes.
func buildRouteSet(c contract.Criteria, targetKm float64, candidates []*candidate, limit int) []contract.Route {
	r := newRanking(c, targetKm)
	r.add(candidates...)
	return r.routes(limit)
}
