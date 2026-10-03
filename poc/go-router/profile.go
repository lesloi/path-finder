package main

import "math"

// Way kinds the router distinguishes; the profile tables below are indexed by them.
const (
	kPath uint8 = iota
	kFootway
	kPedestrian
	kBridleway
	kTrack
	kCycleway
	kSteps
	kLivingStreet
	kResidential
	kService
	kUnclassified
	kTertiary
	kSecondary
	kPrimary
	kTrunk
	numKinds
)

var kindNames = [numKinds]string{
	"path", "footway", "pedestrian", "bridleway", "track", "cycleway", "steps", "living_street",
	"residential", "service", "unclassified", "tertiary", "secondary", "primary", "trunk",
}

// Surface groups, from the best to the roughest.
const (
	sUnknown uint8 = iota
	sPaved
	sCompact
	sRough
	numSurfs
)

// isTrail tells whether a way kind counts as off-road for the trail share.
func isTrail(kind uint8) bool {
	switch kind {
	case kPath, kTrack, kBridleway, kFootway, kSteps:
		return true
	}
	return false
}

// Profile is an activity expressed as data: cost multipliers per way kind and per surface,
// plus the extra cost of climbing. Costs are in equivalent metres.
type Profile struct {
	Name       string
	Kind       [numKinds]float32
	Surf       [numSurfs]float32
	UpPerMeter float32 // equivalent metres added per metre of ascent
}

var profiles = map[string]*Profile{
	"hike": {
		Name: "hike",
		Kind: [numKinds]float32{
			kPath: 1.0, kFootway: 1.0, kPedestrian: 1.0, kBridleway: 1.05, kTrack: 1.0, kCycleway: 1.3,
			kSteps: 1.6, kLivingStreet: 1.3, kResidential: 1.5, kService: 1.6, kUnclassified: 1.7,
			kTertiary: 2.2, kSecondary: 3.5, kPrimary: 6, kTrunk: 12,
		},
		Surf:       [numSurfs]float32{sUnknown: 1.0, sPaved: 1.1, sCompact: 1.0, sRough: 1.15},
		UpPerMeter: 8,
	},
	"run": {
		Name: "run",
		Kind: [numKinds]float32{
			kPath: 1.05, kFootway: 1.0, kPedestrian: 1.0, kBridleway: 1.1, kTrack: 1.0, kCycleway: 1.1,
			kSteps: 3, kLivingStreet: 1.3, kResidential: 1.5, kService: 1.6, kUnclassified: 1.7,
			kTertiary: 2.2, kSecondary: 3.5, kPrimary: 6, kTrunk: 12,
		},
		Surf:       [numSurfs]float32{sUnknown: 1.0, sPaved: 1.0, sCompact: 1.0, sRough: 1.5},
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
