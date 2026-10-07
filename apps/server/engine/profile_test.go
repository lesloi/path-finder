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

// A preference is soft and the climb is steered by the target elevation gain alone.
func TestProfilesAreSoftAndShareTheClimbCost(t *testing.T) {
	for name, p := range profiles {
		if p.Name != name {
			t.Errorf("%s is named %q", name, p.Name)
		}
		if p.UpPerMeter != climbCost {
			t.Errorf("%s: climb cost %v, want %v", name, p.UpPerMeter, climbCost)
		}
		for k, v := range p.Kind {
			if v < 1 || v > 100 {
				t.Errorf("%s: %s costs %v per metre, want a finite cost of at least 1", name, kindNames[k], v)
			}
		}
		for s, v := range p.Surf {
			if v < 1 || v > 100 {
				t.Errorf("%s: surface %d costs %v per metre, want a finite cost of at least 1", name, s, v)
			}
		}
	}
}

func TestProfilesDifferWhereThePreferenceSaysSo(t *testing.T) {
	plain, paved, unpaved := profiles["any"], profiles["paved"], profiles["unpaved"]
	if paved.Surf[SurfaceRough] <= plain.Surf[SurfaceRough] || paved.Kind[KindSteps] <= plain.Kind[KindSteps] {
		t.Error("paved does not penalise rough surfaces and steps more than any")
	}
	if unpaved.Surf[SurfaceRough] >= plain.Surf[SurfaceRough] || unpaved.Kind[KindSteps] >= plain.Kind[KindSteps] {
		t.Error("unpaved does not tolerate rough surfaces and steps more than any")
	}
	if unpaved.Surf[SurfacePaved] <= plain.Surf[SurfacePaved] || unpaved.Kind[KindResidential] <= plain.Kind[KindResidential] {
		t.Error("unpaved does not penalise paved ways more than any")
	}
}
