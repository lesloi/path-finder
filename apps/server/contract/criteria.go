package contract

import (
	"encoding/json"
	"fmt"
	"math"
)

// CriteriaError is a request body that is not valid criteria, with the field that failed.
// Messages name the field, never its value: the server keeps no location.
type CriteriaError struct {
	Field   string // start, target, elevationGain, surface, pace or includeTechnical
	Message string
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

// Criteria of a route set. Distances are in kilometres, durations in minutes, elevation gain in
// metres, and pace in minutes per kilometre on flat ground.
type Criteria struct {
	Start         [2]float64     `json:"start"` // longitude, latitude
	Target        Target         `json:"target"`
	ElevationGain *ElevationGain `json:"elevationGain,omitempty"`
	Surface       string         `json:"surface"`
	Pace          float64        `json:"pace"`
	// IncludeTechnical allows the ways tagged technical (see engine.EdgeTechnical). Without it they are excluded,
	// which is the one hard rule of the criteria: a surface preference only weights (DECISIONS.md, Routing). It is never assumed.
	IncludeTechnical bool `json:"includeTechnical"`
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
	start, ok := obj["start"].([]any)
	if !ok || len(start) != 2 {
		return fail("start", "start must be a longitude and a latitude")
	}
	lon, lonOK := within(start[0], -180, 180)
	lat, latOK := within(start[1], -90, 90)
	if !lonOK || !latOK {
		return fail("start", "start must be a longitude and a latitude")
	}
	c.Start = [2]float64{lon, lat}

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

	include, ok := obj["includeTechnical"].(bool)
	if !ok {
		return fail("includeTechnical", "includeTechnical must be true or false")
	}
	// A paved request excludes them whatever the client sends, as the web form does.
	c.IncludeTechnical = include && c.Surface != "paved"

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

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// ClimbPerEffortKm is the metres of elevation gain that count as 1 km of effort distance.
func ClimbPerEffortKm() float64 { return bounds.ClimbPerEffortKm }

// HillyMatchPerKm is the metres of elevation gain per km from which a route is hilly.
func HillyMatchPerKm() float64 { return bounds.HillyMatchPerKm }
