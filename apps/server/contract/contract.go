// Package contract is what the server and the web app agree on: the criteria of a request, the
// routes of an answer, and the codes of a refusal. The bounds live in contract.json, which the
// web app reads too, and testdata/ holds the cases both sides' tests run. The server alone decides
// whether criteria are valid; the web app only checks them early, to spare the user a round trip.
package contract

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed contract.json
var contractJSON []byte

type limits struct {
	MaxDistanceKm    float64                    `json:"maxDistanceKm"`
	MinDistanceKm    float64                    `json:"minDistanceKm"`
	DurationMinutes  struct{ Min, Max float64 } `json:"durationMinutes"`
	MaxGainMetres    float64                    `json:"maxElevationGainMetres"`
	ClimbPerEffortKm float64                    `json:"climbPerEffortKm"`
	HillyMatchPerKm  float64                    `json:"hillyMatchPerKm"`
	Surfaces         []string                   `json:"surfaces"`
	ErrorCodes       []string                   `json:"errorCodes"`
}

var bounds = func() limits {
	var l limits
	if err := json.Unmarshal(contractJSON, &l); err != nil {
		panic(fmt.Sprintf("contract.json: %v", err))
	}
	return l
}()

// Error codes of a refusal, sent as {"error": code}: the server sends no text, the web app words each code.
const (
	CodeInvalidJSON       = "invalid-json"
	CodeInvalidCriteria   = "invalid-criteria"
	CodeStaleBuild        = "stale-build"
	CodeRateLimited       = "rate-limited"
	CodeOverloaded        = "overloaded"
	CodeGenerationTimeout = "generation-timeout"
)

// Miss is a criterion a suggestion misses, with its gap in the criterion's unit: kilometres,
// minutes, or metres.
type Miss struct {
	Criterion string  `json:"criterion"` // distance, duration or elevationGain
	Gap       float64 `json:"gap"`
}

// SurfaceStretch is a part of a route on one surface, from and to in kilometres along the route.
// The stretches of a route are in order and cover it from 0 to its distance without gaps.
type SurfaceStretch struct {
	Surface string  `json:"surface"` // paved or unpaved
	From    float64 `json:"from"`
	To      float64 `json:"to"`
}

// Route is one route of a route set. A geometry point is longitude, latitude and, with elevation
// data, the height in metres.
type Route struct {
	Geometry          [][]float64      `json:"geometry"`
	Distance          float64          `json:"distance"` // kilometres
	ElevationGain     *float64         `json:"elevationGain,omitempty"`
	ElevationLoss     *float64         `json:"elevationLoss,omitempty"`
	EstimatedDuration float64          `json:"estimatedDuration"` // minutes
	Kind              string           `json:"kind"`              // match or suggestion
	Misses            []Miss           `json:"misses"`
	UnpavedShare      float64          `json:"unpavedShare"`
	Surfaces          []SurfaceStretch `json:"surfaces"`
	Technical         bool             `json:"technical"` // holds a technical stretch
}
