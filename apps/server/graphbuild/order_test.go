package graphbuild

import (
	"math/rand"
	"testing"
)

// gridWays is a w×h grid of candidate nodes, joined row by row and column by column, with the nodes
// numbered in a shuffled order, as the order of an OSM file bears no relation to the map.
func gridWays(w, h int) (ways []rawWay, lat, lon, elev []int32) {
	n := w * h
	perm := rand.New(rand.NewSource(1)).Perm(n)
	lat, lon, elev = make([]int32, n), make([]int32, n), make([]int32, n)
	at := func(x, y int) uint32 { return uint32(perm[y*w+x]) }
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			i := at(x, y)
			lat[i], lon[i], elev[i] = int32(y)*cellStep, int32(x)*cellStep, 1000
			if x+1 < w {
				ways = append(ways, rawWay{idx: []uint32{i, at(x+1, y)}})
			}
			if y+1 < h {
				ways = append(ways, rawWay{idx: []uint32{i, at(x, y+1)}})
			}
		}
	}
	return ways, lat, lon, elev
}

const cellStep = 2000 // 0.0002°, about 22 m

func TestNodesAreNumberedInSpatialOrder(t *testing.T) {
	ways, lat, lon, elev := gridWays(64, 64)
	nodes, _, _ := assemble(ways, lat, lon, elev)
	if len(nodes) != 64*64 {
		t.Fatalf("%d nodes kept, want %d", len(nodes), 64*64)
	}
	// Consecutive nodes are neighbours on the map, so a search reads few pages. In the shuffled input,
	// two consecutive nodes are about 20 cells apart.
	var total float64
	for i := 1; i < len(nodes); i++ {
		dy, dx := float64(nodes[i].Lat-nodes[i-1].Lat)/cellStep, float64(nodes[i].Lon-nodes[i-1].Lon)/cellStep
		total += max(abs(dx), abs(dy))
	}
	if mean := total / float64(len(nodes)-1); mean > 2 {
		t.Errorf("consecutive nodes are %.1f cells apart on average, want at most 2", mean)
	}
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func TestHilbertKeyIsACurveThroughEveryCell(t *testing.T) {
	const side = 16
	var cellOf [side * side][2]int
	seen := map[uint64]bool{}
	for y := uint32(0); y < side; y++ {
		for x := uint32(0); x < side; x++ {
			k := hilbertKey(x, y, 4)
			if k >= side*side || seen[k] {
				t.Fatalf("(%d,%d) has key %d: out of range or taken", x, y, k)
			}
			seen[k] = true
			cellOf[k] = [2]int{int(x), int(y)}
		}
	}
	for k := 1; k < len(cellOf); k++ {
		dx, dy := cellOf[k][0]-cellOf[k-1][0], cellOf[k][1]-cellOf[k-1][1]
		if dx*dx+dy*dy != 1 {
			t.Fatalf("keys %d and %d are cells %v and %v: not neighbours", k-1, k, cellOf[k-1], cellOf[k])
		}
	}
}
