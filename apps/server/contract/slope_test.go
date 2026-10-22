package contract

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// The web app's tests run the same cases through its own count.
func TestEffortFactorCases(t *testing.T) {
	data, err := os.ReadFile("testdata/slope-effort-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string      `json:"name"`
		Geometry [][]float64 `json:"geometry"`
		Factor   float64     `json:"factor"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			got := EffortFactor(tc.Geometry)

			if math.Abs(got-tc.Factor) > 1e-9 {
				t.Errorf("got %v, want %v", got, tc.Factor)
			}
		})
	}
}
