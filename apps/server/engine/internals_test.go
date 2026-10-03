package engine

import (
	"math"
	"path/filepath"
	"testing"
)

func TestQuantizeRoundsDownAndSaturates(t *testing.T) {
	cases := []struct {
		name string
		in   float32
		want uint16
	}{
		{"zero", 0, 0},
		{"under one unit", altUnitMeters - 0.1, 0},
		{"one unit", altUnitMeters, 1},
		{"unreachable", unreachable, altUnreachable},
		{"too far for 16 bits", altUnitMeters * 70_000, altUnreachable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := quantize(tc.in); got != tc.want {
				t.Errorf("quantize(%v) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

func TestLandmarkBoundIsALowerBound(t *testing.T) {
	var target [64]uint16
	t.Run("a metric without climb is symmetric", func(t *testing.T) {
		a := &landmarks{l: 3, unit: 16, rowLen: 3}
		target[0], target[1], target[2] = 4, 50, altUnreachable
		// The best landmark gives |4 - 10| - 1 = 5 units; the second is 50 - 52 = 2 away; the third is unreachable.
		row := []uint16{10, 52, 7}
		if got := a.bound(row, &target); got != 5*16 {
			t.Errorf("bound = %v, want 80", got)
		}
		if got := a.bound([]uint16{4, 50, 7}, &target); got != 0 {
			t.Errorf("bound between equal rows = %v, want 0", got)
		}
	})
	t.Run("a metric with climb has both directions", func(t *testing.T) {
		a := &landmarks{l: 2, climb: 8, unit: 16, rowLen: 4}
		target[0], target[1], target[2], target[3] = 30, altUnreachable, 9, 8
		// Towards the landmarks: 30 - 10 - 1 = 19. From them: 20 - 9 - 1 = 10. The unreachable one is skipped.
		row := []uint16{10, 5, 20, 12}
		if got := a.bound(row, &target); got != 19*16 {
			t.Errorf("bound = %v, want %v", got, 19*16)
		}
	})
}

func TestAvoidSetRemembersEveryKeyAcrossGrowth(t *testing.T) {
	a := newAvoidSet()
	for k := uint64(1); k <= 5000; k++ {
		a.insert(k * 7919)
		a.insert(k * 7919) // inserting twice changes nothing
	}
	if a.n != 5000 {
		t.Fatalf("%d keys, want 5000", a.n)
	}
	for k := uint64(1); k <= 5000; k++ {
		if !a.contains(k * 7919) {
			t.Fatalf("lost key %d", k*7919)
		}
	}
	if a.contains(1) {
		t.Error("contains a key that was never inserted")
	}
}

func TestSearcherGrowKeepsTheEntriesOfTheSearch(t *testing.T) {
	s := newSearcher()
	s.reset()
	keys := []uint32{1, 2, 3, 99, 4096, 1 << 20, math.MaxUint32 - 1}
	for _, k := range keys {
		i := s.find(k)
		s.slots[i] = slot{key: k, epoch: s.epoch, cost: float32(k % 1000)}
		s.used++
	}
	before := len(s.slots)
	s.grow()
	if len(s.slots) != 2*before {
		t.Errorf("table = %d slots, want %d", len(s.slots), 2*before)
	}
	for _, k := range keys {
		if sl := s.slots[s.find(k)]; sl.key != k || sl.cost != float32(k%1000) {
			t.Errorf("entry %d lost by growing: %+v", k, sl)
		}
	}
}

func TestSearcherResetWrapsItsEpoch(t *testing.T) {
	s := newSearcher()
	s.epoch = math.MaxUint32
	s.slots[3] = slot{key: 9, epoch: 5}
	s.reset()
	if s.epoch != 1 || s.slots[3] != (slot{}) {
		t.Errorf("epoch %d, slot %+v: a wrapped epoch must clear the table", s.epoch, s.slots[3])
	}
}

func TestLoopScoreCountsDistanceOverlapAndAscent(t *testing.T) {
	lp := &loopParams{distM: 10_000}
	if got := lp.score(10_000, 500, 0); got != 0 {
		t.Errorf("a loop on target = %v", got)
	}
	if got := lp.score(12_000, 0, 1_200); math.Abs(got-(3*0.2+3*0.1)) > 1e-9 {
		t.Errorf("distance and overlap = %v", got)
	}
	lp.ascentM = 1_000
	if got := lp.score(10_000, 500, 0); math.Abs(got-1) > 1e-9 {
		t.Errorf("half the ascent missing = %v, want 2 * 500/1000", got)
	}
	lp.ascentM = 10 // under the floor of 50 m
	if got := lp.score(10_000, 60, 0); math.Abs(got-2) > 1e-9 {
		t.Errorf("small ascent target = %v, want 2 * 50/50", got)
	}
}

func TestIsUnpavedFollowsTheSurfaceThenTheKind(t *testing.T) {
	cases := []struct {
		kind, surf uint8
		want       bool
	}{
		{KindResidential, SurfacePaved, false},
		{KindResidential, SurfaceCompact, true},
		{KindPath, SurfaceRough, true},
		{KindPath, SurfaceUnknown, true},
		{KindTrack, SurfaceUnknown, true},
		{KindBridleway, SurfaceUnknown, true},
		{KindResidential, SurfaceUnknown, false},
		{KindPrimary, SurfaceUnknown, false},
		{KindTrack, SurfacePaved, false},
	}
	for _, tc := range cases {
		if got := isUnpaved(tc.kind, tc.surf); got != tc.want {
			t.Errorf("isUnpaved(kind %d, surface %d) = %v, want %v", tc.kind, tc.surf, got, tc.want)
		}
	}
}

func TestFileWritersFailOnAnUnwritablePath(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no", "such", "dir", "file")
	if err := writeGraph(missing, nil, []uint32{0}, nil); err == nil {
		t.Error("writeGraph into a missing directory: err = nil")
	}
	if err := writeLandmarks(missing, 1, 0, 8, nil); err == nil {
		t.Error("writeLandmarks into a missing directory: err = nil")
	}
	if got := bytesOf([]uint16(nil)); got != nil {
		t.Errorf("bytesOf(nil) = %v", got)
	}
}
