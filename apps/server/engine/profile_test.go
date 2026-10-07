package engine

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

// A profile exists for every surface preference of the contract, so that no request finds none.
func TestEveryContractSurfaceHasAProfile(t *testing.T) {
	raw, err := os.ReadFile("../contract/contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Surfaces []string `json:"surfaces"`
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Surfaces) == 0 {
		t.Fatal("the contract lists no surface")
	}
	for _, s := range c.Surfaces {
		if profiles[s] == nil || !slices.Contains(ProfileNames, s) {
			t.Errorf("no profile for the surface preference %q", s)
		}
	}
	if len(profiles) != len(c.Surfaces) || len(ProfileNames) != len(c.Surfaces) {
		t.Errorf("%d profiles for %d surface preferences", len(profiles), len(c.Surfaces))
	}
}

// A preference is soft, and the climb is steered by the target elevation gain alone.
func TestProfilesAreSoftAndShareTheClimbCost(t *testing.T) {
	const mostCost = 100 // a finite cost: a way is never excluded
	for _, name := range ProfileNames {
		t.Run(name, func(t *testing.T) {
			p := profiles[name]
			if p.Name != name {
				t.Errorf("named %q", p.Name)
			}
			if p.UpPerMeter != climbCost {
				t.Errorf("climb cost %v, want %v", p.UpPerMeter, climbCost)
			}
			costs := map[string][]float32{"kind": p.Kind[:], "surface": p.Surf[:]}
			for what, list := range costs {
				for i, v := range list {
					if v < 1 || v > mostCost {
						t.Errorf("%s %d costs %v per metre, want a finite cost of at least 1", what, i, v)
					}
				}
			}
		})
	}
}

func TestProfilesDifferWhereThePreferenceSaysSo(t *testing.T) {
	plain := profiles["any"]
	for name, tc := range map[string]struct {
		rough, steps, paved, residential func(a, b float32) bool
	}{
		"paved":   {rough: gt, steps: gt, paved: lt, residential: lt},
		"unpaved": {rough: lt, steps: lt, paved: gt, residential: gt},
	} {
		t.Run(name, func(t *testing.T) {
			p := profiles[name]
			if !tc.rough(p.Surf[SurfaceRough], plain.Surf[SurfaceRough]) {
				t.Errorf("rough surface: %v against %v for any", p.Surf[SurfaceRough], plain.Surf[SurfaceRough])
			}
			if !tc.steps(p.Kind[KindSteps], plain.Kind[KindSteps]) {
				t.Errorf("steps: %v against %v for any", p.Kind[KindSteps], plain.Kind[KindSteps])
			}
			if !tc.paved(p.Surf[SurfacePaved], plain.Surf[SurfacePaved]) {
				t.Errorf("paved surface: %v against %v for any", p.Surf[SurfacePaved], plain.Surf[SurfacePaved])
			}
			if !tc.residential(p.Kind[KindResidential], plain.Kind[KindResidential]) {
				t.Errorf("residential: %v against %v for any", p.Kind[KindResidential], plain.Kind[KindResidential])
			}
		})
	}
}

func gt(a, b float32) bool { return a > b }
func lt(a, b float32) bool { return a < b }
