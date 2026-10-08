package contract

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

type criteriaCase struct {
	Name               string          `json:"name"`
	Body               json.RawMessage `json:"body"`
	CountElevationGain *bool           `json:"countElevationGain"`
	Expect             struct {
		Field    string          `json:"field"`
		Criteria json.RawMessage `json:"criteria"`
	} `json:"expect"`
}

// The web app's tests run the same cases through its own check.
func TestParseCriteriaCases(t *testing.T) {
	data, err := os.ReadFile("testdata/criteria-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []criteriaCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			count := tc.CountElevationGain == nil || *tc.CountElevationGain
			c, err := ParseCriteria(tc.Body, count)
			if tc.Expect.Field != "" {
				var ce *CriteriaError
				if !errors.As(err, &ce) || ce.Field != tc.Expect.Field {
					t.Fatalf("err = %v, want a CriteriaError on %s", err, tc.Expect.Field)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			got, _ := json.Marshal(c)
			var gotAny, wantAny any
			_ = json.Unmarshal(got, &gotAny)
			_ = json.Unmarshal(tc.Expect.Criteria, &wantAny)
			if !reflect.DeepEqual(gotAny, wantAny) {
				t.Errorf("got %s, want %s", got, tc.Expect.Criteria)
			}
		})
	}
}

func TestErrorCodesAreThoseOfTheContractFile(t *testing.T) {
	want := []string{CodeInvalidJSON, CodeInvalidCriteria, CodeStaleBuild, CodeRateLimited, CodeOverloaded, CodeGenerationTimeout}
	if !reflect.DeepEqual(bounds.ErrorCodes, want) {
		t.Errorf("contract.json errorCodes = %v, constants = %v", bounds.ErrorCodes, want)
	}
}

// The web app parses the same file, so a field renamed here fails its test too.
func TestRouteSetMatchesTheWebAppsSample(t *testing.T) {
	gain, loss := 250.0, 240.0
	routes := []Route{
		{
			Geometry: [][]float64{{6.1294, 45.8992, 450.5}, {6.13, 45.9, 455}}, Distance: 10.2,
			ElevationGain: &gain, ElevationLoss: &loss, EstimatedDuration: 62, Kind: "match",
			Misses: []Miss{}, UnpavedShare: 0.4, Technical: true,
			Surfaces: []SurfaceStretch{{"paved", 0, 6.12}, {"unpaved", 6.12, 10.2}},
		},
		{
			Geometry: [][]float64{{6.1294, 45.8992}, {6.13, 45.9}}, Distance: 12.9, EstimatedDuration: 80,
			Kind: "suggestion", Misses: []Miss{{"distance", 2.9}}, UnpavedShare: 0,
			Surfaces: []SurfaceStretch{{"paved", 0, 12.9}},
		},
	}
	got, err := json.Marshal(map[string]any{"routes": routes})
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("testdata/route-set.json")
	if err != nil {
		t.Fatal(err)
	}
	var gotAny, wantAny any
	if err := json.Unmarshal(got, &gotAny); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(want, &wantAny); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotAny, wantAny) {
		t.Errorf("route set JSON changed; testdata/route-set.json is what the web app reads:\n%s", got)
	}
}

func TestTargetDistanceFromADuration(t *testing.T) {
	c := Criteria{Target: Target{Duration: 60}, Pace: 6}
	if d, err := c.TargetDistanceKm(); err != nil || d != 10 {
		t.Errorf("distance = %v, %v", d, err)
	}
	c.ElevationGain = &ElevationGain{Metres: 300}
	if d, _ := c.TargetDistanceKm(); d != 7 {
		t.Errorf("with 300 m of gain, distance = %v, want 7", d)
	}
	c.ElevationGain = &ElevationGain{Shortcut: "hilly"}
	if d, _ := c.TargetDistanceKm(); d < 9.09 || d > 9.1 {
		t.Errorf("hilly distance = %v, want about 9.09", d)
	}
	c.Target.Duration = 12
	if _, err := c.TargetDistanceKm(); err == nil {
		t.Error("a duration too short for 2 km: err = nil")
	}
}

func TestCriteriaErrorSaysWhatIsWrong(t *testing.T) {
	_, err := ParseCriteria([]byte(`{"start":[200,45]}`), true)
	var ce *CriteriaError
	if !errors.As(err, &ce) || ce.Field != "start" || ce.Error() == "" || ce.Error() != ce.Message {
		t.Errorf("err = %#v", err)
	}
}
