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

// Profile is an activity expressed as data: cost multipliers per way kind and per surface,
// plus the extra cost of climbing. Costs are in equivalent metres.
type Profile struct {
	Name       string
	Kind       [NumKinds]float32
	Surf       [NumSurfaces]float32
	UpPerMeter float32 // equivalent metres added per metre of ascent
}

var profiles = map[string]*Profile{
	"hike": {
		Name: "hike",
		Kind: [NumKinds]float32{
			KindPath: 1.0, KindFootway: 1.0, KindPedestrian: 1.0, KindBridleway: 1.05, KindTrack: 1.0, KindCycleway: 1.3,
			KindSteps: 1.6, KindLivingStreet: 1.3, KindResidential: 1.5, KindService: 1.6, KindUnclassified: 1.7,
			KindTertiary: 2.2, KindSecondary: 3.5, KindPrimary: 6, KindTrunk: 12,
		},
		Surf:       [NumSurfaces]float32{SurfaceUnknown: 1.0, SurfacePaved: 1.1, SurfaceCompact: 1.0, SurfaceRough: 1.15},
		UpPerMeter: 8,
	},
	"run": {
		Name: "run",
		Kind: [NumKinds]float32{
			KindPath: 1.05, KindFootway: 1.0, KindPedestrian: 1.0, KindBridleway: 1.1, KindTrack: 1.0, KindCycleway: 1.1,
			KindSteps: 3, KindLivingStreet: 1.3, KindResidential: 1.5, KindService: 1.6, KindUnclassified: 1.7,
			KindTertiary: 2.2, KindSecondary: 3.5, KindPrimary: 6, KindTrunk: 12,
		},
		Surf:       [NumSurfaces]float32{SurfaceUnknown: 1.0, SurfacePaved: 1.0, SurfaceCompact: 1.0, SurfaceRough: 1.5},
		UpPerMeter: 12,
	},
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
