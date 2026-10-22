package contract

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/lesloi/path-finder/apps/server/geo"
)

// CriteriaError is a request body that is not valid criteria, with the field that failed.
// Messages name the field, never its value: the server keeps no location.
type CriteriaError struct {
	Field   string // start, shape, destination, target, elevationGain, surface, pace, waypoints or avoidedAreas
	Message string
	// Waypoint is the waypoint at fault, counted from 1, or 0 when none is singled out.
	Waypoint int
	// Area is the avoided area at fault, counted from 1, or 0 when none is singled out.
	Area int
}

func (e *CriteriaError) Error() string { return e.Message }

// Target is a distance in kilometres or a duration in minutes; exactly one is set.
type Target struct {
	Distance float64 `json:"distance,omitempty"`
	Duration float64 `json:"duration,omitempty"`
}

// ElevationGain is a target in metres, or the "flat" or "hilly" shortcut.
type ElevationGain struct {
	Shortcut string
	Metres   float64
}

func (g ElevationGain) MarshalJSON() ([]byte, error) {
	if g.Shortcut != "" {
		return json.Marshal(g.Shortcut)
	}
	return json.Marshal(g.Metres)
}

// ShapeOutAndBack is a route to a destination that comes back by the same way. A loop has no shape of its own:
// Criteria.Shape is empty for one.
const ShapeOutAndBack = "outAndBack"

// Criteria of a route set. Distances are in kilometres, durations in minutes, elevation gain in
// metres, and pace in minutes per kilometre on flat ground.
type Criteria struct {
	Start [2]float64 `json:"start"` // longitude, latitude
	// Shape is ShapeOutAndBack, or empty for a loop. An out-and-back route has no target and no target elevation
	// gain: its destination sets the distance.
	Shape string `json:"shape,omitempty"`
	// Destination is where an out-and-back route turns back, after the waypoints. A loop has none.
	Destination   *[2]float64    `json:"destination,omitempty"`
	Target        Target         `json:"target,omitzero"`
	ElevationGain *ElevationGain `json:"elevationGain,omitempty"`
	Surface       string         `json:"surface"`
	Pace          float64        `json:"pace"`
	// Waypoints a route goes through, in this order.
	Waypoints [][2]float64 `json:"waypoints,omitempty"` // longitude, latitude
	// AvoidedAreas no route goes through.
	AvoidedAreas []AvoidedArea `json:"avoidedAreas,omitempty"`
}

// AvoidedArea is a circle routes keep out of: its centre as longitude and latitude, and its radius in metres.
type AvoidedArea struct {
	Center [2]float64 `json:"center"`
	Radius float64    `json:"radius"`
}

// contains tells whether a position, as longitude and latitude, is inside the area.
func (a AvoidedArea) contains(p [2]float64) bool {
	dy := (p[1] - a.Center[1]) * geo.MetersPerDegree
	dx := (p[0] - a.Center[0]) * geo.MetersPerDegree * math.Cos(a.Center[1]*math.Pi/180)
	return math.Hypot(dx, dy) <= a.Radius
}

// TargetDistanceKm is the distance to ask the engine for. It fails when a target duration is too
// short for the target elevation gain.
func (c Criteria) TargetDistanceKm() (float64, error) {
	if c.Target.Distance > 0 {
		return c.Target.Distance, nil
	}
	effort := c.Target.Duration / c.Pace
	var distance float64
	switch {
	case c.ElevationGain != nil && c.ElevationGain.Shortcut == "hilly":
		// The distance plus its least climb, at the match rate per km, makes the effort distance.
		distance = effort / (1 + bounds.HillyMatchPerKm/bounds.ClimbPerEffortKm)
	case c.ElevationGain != nil:
		distance = effort - c.ElevationGain.Metres/bounds.ClimbPerEffortKm
	default:
		distance = effort
	}
	if distance < bounds.MinDistanceKm {
		return 0, fmt.Errorf("target duration leaves %v km, under %v km", distance, bounds.MinDistanceKm)
	}
	return distance, nil
}

func fail(field, message string) (Criteria, error) {
	return Criteria{}, &CriteriaError{Field: field, Message: message}
}

func number(v any) (float64, bool) {
	n, ok := v.(float64)
	return n, ok && !math.IsNaN(n) && !math.IsInf(n, 0)
}

func within(v any, lo, hi float64) (float64, bool) {
	n, ok := number(v)
	return n, ok && n >= lo && n <= hi
}

// ParseCriteria reads criteria from a request body, within the bounds of
// contract.json. It returns a *CriteriaError naming the field on anything else, including a target
// duration too short for the target elevation gain or too long at the user's pace. Without countElevationGain, the target elevation gain is checked but dropped.
func ParseCriteria(body []byte, countElevationGain bool) (Criteria, error) {
	var raw any
	if err := json.Unmarshal(body, &raw); err != nil {
		return fail("start", "criteria must be JSON")
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		return fail("start", "criteria must be an object")
	}

	var c Criteria
	start := obj["start"]
	if c.Start, ok = position(start); !ok {
		return fail("start", "start must be a longitude and a latitude")
	}

	switch shape, present := obj["shape"]; {
	case !present || shape == "loop":
	case shape == ShapeOutAndBack:
		c.Shape = ShapeOutAndBack
	default:
		return fail("shape", "unknown route shape")
	}
	outAndBack := c.Shape == ShapeOutAndBack
	if raw, present := obj["destination"]; present {
		d, ok := position(raw)
		if !outAndBack || !ok {
			return fail("destination", "a destination must be a longitude and a latitude, for an out-and-back route")
		}
		c.Destination = &d
	} else if outAndBack {
		return fail("destination", "an out-and-back route needs a destination")
	}

	// The destination sets the distance of an out-and-back route, so neither a target nor an elevation gain applies.
	if outAndBack {
		if _, present := obj["target"]; present {
			return fail("target", "an out-and-back route has no target")
		}
		if _, present := obj["elevationGain"]; present {
			return fail("elevationGain", "an out-and-back route has no target elevation gain")
		}
	} else {
		target, ok := obj["target"].(map[string]any)
		if !ok || len(target) != 1 {
			return fail("target", "target must be a distance or a duration")
		}
		if v, isDistance := target["distance"]; isDistance {
			d, ok := within(v, bounds.MinDistanceKm, bounds.MaxDistanceKm)
			if !ok {
				return fail("target", "target distance out of bounds")
			}
			c.Target.Distance = d
		} else {
			d, ok := within(target["duration"], bounds.DurationMinutes.Min, bounds.DurationMinutes.Max)
			if !ok {
				return fail("target", "target duration out of bounds")
			}
			c.Target.Duration = d
		}
	}

	var gain *ElevationGain
	switch v := obj["elevationGain"].(type) {
	case nil:
		if _, present := obj["elevationGain"]; present {
			return fail("elevationGain", "target elevation gain out of bounds")
		}
	case string:
		if v != "flat" && v != "hilly" {
			return fail("elevationGain", "target elevation gain out of bounds")
		}
		gain = &ElevationGain{Shortcut: v}
	default:
		m, ok := within(v, 0, bounds.MaxGainMetres)
		if !ok {
			return fail("elevationGain", "target elevation gain out of bounds")
		}
		gain = &ElevationGain{Metres: m}
	}

	surface, _ := obj["surface"].(string)
	if !contains(bounds.Surfaces, surface) {
		return fail("surface", "unknown surface preference")
	}
	c.Surface = surface

	pace, ok := number(obj["pace"])
	if !ok || pace <= 0 {
		return fail("pace", "pace must be a positive number")
	}
	c.Pace = pace

	if raw, present := obj["waypoints"]; present {
		list, ok := raw.([]any)
		if !ok || len(list) > bounds.MaxWaypoints {
			return fail("waypoints", "waypoints must be a short list of longitudes and latitudes")
		}
		for _, item := range list {
			p, ok := position(item)
			if !ok {
				return fail("waypoints", "a waypoint must be a longitude and a latitude")
			}
			c.Waypoints = append(c.Waypoints, p)
		}
	}

	if raw, present := obj["avoidedAreas"]; present {
		list, ok := raw.([]any)
		if !ok || len(list) > bounds.MaxAvoidedAreas {
			return fail("avoidedAreas", "avoided areas must be a short list of circles")
		}
		for i, item := range list {
			area, ok := avoidedArea(item)
			if !ok {
				return Criteria{}, &CriteriaError{Field: "avoidedAreas", Message: "an avoided area must be a centre and a radius within bounds", Area: i + 1}
			}
			if area.contains(c.Start) {
				return Criteria{}, &CriteriaError{Field: "avoidedAreas", Message: "the start is inside an avoided area", Area: i + 1}
			}
			for _, w := range c.Waypoints {
				if area.contains(w) {
					return Criteria{}, &CriteriaError{Field: "avoidedAreas", Message: "a waypoint is inside an avoided area", Area: i + 1}
				}
			}
			if c.Destination != nil && area.contains(*c.Destination) {
				return Criteria{}, &CriteriaError{Field: "avoidedAreas", Message: "the destination is inside an avoided area", Area: i + 1}
			}
			c.AvoidedAreas = append(c.AvoidedAreas, area)
		}
	}

	if outAndBack {
		return c, nil
	}
	if countElevationGain {
		c.ElevationGain = gain
	}
	// With a target duration, bounds the distance it makes at this pace too.
	distance, err := c.TargetDistanceKm()
	if err != nil {
		return fail("target", err.Error())
	}
	if distance > bounds.MaxDistanceKm {
		return fail("target", "target duration makes too long a route at this pace")
	}
	return c, nil
}

// avoidedArea reads a centre and a radius.
func avoidedArea(v any) (AvoidedArea, bool) {
	obj, ok := v.(map[string]any)
	if !ok {
		return AvoidedArea{}, false
	}
	center, ok := position(obj["center"])
	radius, radiusOK := within(obj["radius"], bounds.AvoidedRadius.Min, bounds.AvoidedRadius.Max)
	return AvoidedArea{Center: center, Radius: radius}, ok && radiusOK
}

// position reads a longitude and a latitude.
func position(v any) (p [2]float64, ok bool) {
	pair, isList := v.([]any)
	if !isList || len(pair) != 2 {
		return p, false
	}
	lon, lonOK := within(pair[0], -180, 180)
	lat, latOK := within(pair[1], -90, 90)
	return [2]float64{lon, lat}, lonOK && latOK
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// ClimbPerEffortKm is the metres of elevation gain that count as 1 km of effort distance when a target duration is turned
// into a distance: no route exists yet, so there is no slope to read, and this rate stands in for it on a typical loop.
func ClimbPerEffortKm() float64 { return bounds.ClimbPerEffortKm }

// HillyMatchPerKm is the metres of elevation gain per km from which a route is hilly.
func HillyMatchPerKm() float64 { return bounds.HillyMatchPerKm }

// MaxDistanceKm is the longest route a request may ask for, and the longest an out-and-back route may make.
func MaxDistanceKm() float64 { return bounds.MaxDistanceKm }
