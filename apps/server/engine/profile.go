package engine

import "math"

const rad = math.Pi / 180

// Way kinds the router distinguishes; the profile tables below are indexed by them.
const (
	KindPath uint8 = iota
	KindFootway
	KindPedestrian
	KindBridleway
	KindTrack
	KindCycleway
	KindSteps
	KindLivingStreet
	KindResidential
	KindService
	KindUnclassified
	KindTertiary
	KindSecondary
	KindPrimary
	KindTrunk
	NumKinds
)

var kindNames = [NumKinds]string{
	"path", "footway", "pedestrian", "bridleway", "track", "cycleway", "steps", "living_street",
	"residential", "service", "unclassified", "tertiary", "secondary", "primary", "trunk",
}

// Surface groups, from the best to the roughest.
const (
	SurfaceUnknown uint8 = iota
	SurfacePaved
	SurfaceCompact
	SurfaceRough
	NumSurfaces
)

// isTrail tells whether a way kind counts as off-road for the trail share.
func isTrail(kind uint8) bool {
	switch kind {
	case KindPath, KindTrack, KindBridleway, KindFootway, KindSteps:
		return true
	}
	return false
}

// climbCost is the extra cost of a metre of ascent, in equivalent metres, the same for every profile: the
// target elevation gain steers the climb, not the surface preference.
const climbCost = 8

// Profile is a surface preference expressed as data: cost multipliers per way kind and per surface,
// plus the extra cost of climbing. Costs are in equivalent metres. A preference is soft: every
// multiplier is finite and at least 1, so it weights the search and never excludes a way.
type Profile struct {
	Name       string
	Kind       [NumKinds]float32
	Surf       [NumSurfaces]float32
	UpPerMeter float32 // equivalent metres added per metre of ascent
}

// ProfileNames are the surface preferences a profile exists for, the ones of the contract.
var ProfileNames = []string{"any", "paved", "unpaved"}

// anyProfile is the profile of no preference, from the costs validated so far. The others derive from it.
func anyProfile() *Profile {
	return &Profile{
		Name: "any",
		Kind: [NumKinds]float32{
			KindPath: 1.0, KindFootway: 1.0, KindPedestrian: 1.0, KindBridleway: 1.05, KindTrack: 1.0, KindCycleway: 1.3,
			KindSteps: 1.6, KindLivingStreet: 1.3, KindResidential: 1.5, KindService: 1.6, KindUnclassified: 1.7,
			KindTertiary: 2.2, KindSecondary: 3.5, KindPrimary: 6, KindTrunk: 12,
		},
		Surf:       [NumSurfaces]float32{SurfaceUnknown: 1.0, SurfacePaved: 1.1, SurfaceCompact: 1.0, SurfaceRough: 1.15},
		UpPerMeter: climbCost,
	}
}

// derive is the profile named name, from the profile of no preference changed by adjust.
func derive(name string, adjust func(p *Profile)) *Profile {
	p := anyProfile()
	p.Name = name
	adjust(p)
	return p
}

var profiles = map[string]*Profile{
	"any": anyProfile(),
	// paved prefers ways that are paved: it makes streets cheaper and the ways that are rough or usually
	// unpaved dearer, and avoids steps. Footways and pedestrian ways stay at 1, which keeps the search
	// heuristic admissible.
	"paved": derive("paved", func(p *Profile) {
		p.Kind[KindPath] = 1.3
		p.Kind[KindTrack] = 1.3
		p.Kind[KindBridleway] = 1.4
		p.Kind[KindCycleway] = 1.1
		p.Kind[KindSteps] = 3
		p.Kind[KindLivingStreet] = 1.1
		p.Kind[KindResidential] = 1.2
		p.Kind[KindService] = 1.3
		p.Kind[KindUnclassified] = 1.3
		p.Surf[SurfacePaved] = 1.0
		p.Surf[SurfaceCompact] = 1.2
		p.Surf[SurfaceRough] = 1.5
	}),
	// unpaved prefers paths and tracks: it tolerates rough surfaces and steps, and pays for paved ways. The
	// multipliers stay at or above 1, so that the search heuristic stays admissible.
	"unpaved": derive("unpaved", func(p *Profile) {
		p.Kind[KindSteps] = 1.0
		p.Kind[KindCycleway] = 1.8
		p.Kind[KindLivingStreet] = 1.8
		p.Kind[KindResidential] = 2.2
		p.Kind[KindService] = 2.2
		p.Kind[KindUnclassified] = 2.2
		p.Kind[KindTertiary] = 3.5
		p.Kind[KindSecondary] = 5
		p.Surf[SurfacePaved] = 1.5
		p.Surf[SurfaceRough] = 1.0
	}),
}

// minMult is the smallest cost per metre, which keeps the A* heuristic admissible.
func (p *Profile) minMult() float32 {
	k, s := float32(math.MaxFloat32), float32(math.MaxFloat32)
	for _, v := range p.Kind {
		k = min(k, v)
	}
	for _, v := range p.Surf {
		s = min(s, v)
	}
	return k * s * 0.995
}
