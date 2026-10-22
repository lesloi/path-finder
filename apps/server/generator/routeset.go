package generator

import (
	"math"
	"slices"
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
	// technicalStretches is never nil: the contract sends [] and not null for a route with none.
	technicalStretches []contract.TechnicalStretch
	// direct marks the loop straight through the waypoints. Its length is set by them, not by the target, and it
	// goes back over its steps where the graph offers no other way: it is not held to either.
	direct bool
}

// effortDistance is the distance weighted by the slope of each stretch, in kilometres.
func (c *candidate) effortDistance() float64 {
	return c.distance * contract.EffortFactor(c.geometry)
}

// check is how a route fares against one criterion. relative is its gap relative to the
// criterion, for ranking.
type check struct {
	gap, relative float64
	tier          tier
}

func againstTarget(gap, scale float64, bounds [tierOut]float64) check {
	size := math.Abs(gap)
	t := tierOut
	for i, bound := range bounds {
		if size <= bound {
			t = tier(i)
			break
		}
	}
	return check{gap, size / scale, t}
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
		return check{gap, math.Max(0, gap) / bound, tierOfLevel(perKm <= l.match, perKm <= l.suggestion)}
	}
	return check{gap, math.Max(0, -gap) / bound, tierOfLevel(perKm >= l.match, perKm >= l.suggestion)}
}

func checks(c contract.Criteria, cand *candidate, estimatedDuration float64) []check {
	var out []check
	if c.Target.Distance > 0 {
		t := c.Target.Distance
		out = append(out, againstTarget(cand.distance-t, t, boundsOf(t, tolerance.distanceBound)))
	} else {
		t := c.Target.Duration
		out = append(out, againstTarget(estimatedDuration-t, t, boundsOf(t, tolerance.distanceBound)))
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
	return append(out, againstTarget(gain-t,
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
	route  contract.Route
	score  float64
	tier   tier
	cells  map[cell]struct{}
	direct bool
}

func classify(c contract.Criteria, cand *candidate, radius float64) (ranked, bool) {
	estimated := cand.effortDistance() * c.Pace
	results := checks(c, cand, estimated)
	score, worst := 0.0, tierMatch
	for _, r := range results {
		if r.tier == tierOut {
			// The direct loop is offered beyond the target: the waypoints set its length, and no detour shortens it.
			// Short of the target the loops through the waypoints, with their detours, make up for it.
			if !cand.direct || r.gap < 0 {
				return ranked{}, false
			}
			r.tier = tierWide
		}
		worst = max(worst, r.tier)
		score += r.relative
	}
	visits := cellsAlong(cand.geometry, c.Start, radius)
	score += surfaceMismatch(c.Surface, cand.unpavedShare)
	// Going back over its steps is what a single access leaves the direct loop, not a flaw to rank it down for.
	if !cand.direct {
		score += retraceShare(visits)
	}
	kind := "match"
	if worst != tierMatch {
		kind = "suggestion"
	}
	cells := make(map[cell]struct{}, len(visits))
	for _, v := range visits {
		cells[v.cell] = struct{}{}
	}
	return ranked{route: contract.Route{
		Geometry: cand.geometry, Distance: cand.distance, ElevationGain: cand.elevationGain,
		ElevationLoss: cand.elevationLoss, EstimatedDuration: estimated, Kind: kind,
		UnpavedShare: cand.unpavedShare, Surfaces: cand.surfaces, Technical: cand.technical,
		TechnicalStretches: cand.technicalStretches,
	}, score: score, tier: worst, cells: cells, direct: cand.direct}, true
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

// sharing is how much of a route another one covers, for the ranking to leave out a duplicate. The direct loop
// that goes back over its steps covers few cells, so against it the share of the larger route counts: the loops that
// go through the same waypoint are not duplicates of it.
func sharing(a, b ranked) float64 {
	if a.direct || b.direct {
		return coveredShare(a.cells, b.cells)
	}
	return sharedShare(a.cells, b.cells)
}

// routes keeps the best up to limit matches, then suggestions only to fill the set up to minRoutes, then wide
// suggestions for what is still missing, none sharing most of its geometry with a better one. Fewer is fine,
// and none is possible. The direct loop through the waypoints, if it is no duplicate, always has a place, taken from
// the worst route: matches that fill the set would leave it out, and it is what the user asked for.
func (r *ranking) routes(limit int) []contract.Route {
	var picked []ranked
	shares := func(entry ranked) bool {
		return slices.ContainsFunc(picked, func(p ranked) bool { return sharing(p, entry) > maxShared })
	}
	pick := func(t tier, size int) {
		for _, entry := range r.all {
			if len(picked) >= size {
				return
			}
			if entry.tier != t {
				continue
			}
			if !shares(entry) {
				picked = append(picked, entry)
			}
		}
	}
	pick(tierMatch, limit)
	pick(tierSuggestion, minRoutes)
	pick(tierWide, minRoutes)
	// There is at most one direct loop. The sort restores the order the picks above give: by tier, then by score.
	if i := slices.IndexFunc(r.all, func(e ranked) bool { return e.direct }); i >= 0 {
		entry := r.all[i]
		if !slices.ContainsFunc(picked, func(p ranked) bool { return p.direct }) && !shares(entry) {
			if len(picked) >= limit {
				picked = picked[:limit-1]
			}
			picked = append(picked, entry)
			sort.SliceStable(picked, func(i, j int) bool {
				return picked[i].tier < picked[j].tier || picked[i].tier == picked[j].tier && picked[i].score < picked[j].score
			})
		}
	}
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
