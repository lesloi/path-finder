package engine

import (
	"fmt"
	"math"
	"os"
	"runtime"
	"sync"
	"time"
)

const unreachable = float32(1e30)

type dijkItem struct {
	d float32
	n uint32
}

// dijkstraAll fills dist with the cost from src (or towards src when backward) under the
// profile's multipliers and a climb penalty of up per metre.
func dijkstraAll(g *graph, p *Profile, src uint32, dist []float32, up float32, backward bool) {
	for i := range dist {
		dist[i] = unreachable
	}
	dist[src] = 0
	heap := []dijkItem{{0, src}}
	push := func(it dijkItem) {
		heap = append(heap, it)
		i := len(heap) - 1
		for i > 0 {
			q := (i - 1) / 2
			if heap[q].d <= heap[i].d {
				break
			}
			heap[q], heap[i] = heap[i], heap[q]
			i = q
		}
	}
	for len(heap) > 0 {
		it := heap[0]
		last := len(heap) - 1
		heap[0] = heap[last]
		heap = heap[:last]
		i := 0
		for {
			l, r, m := 2*i+1, 2*i+2, i
			if l < last && heap[l].d < heap[m].d {
				m = l
			}
			if r < last && heap[r].d < heap[m].d {
				m = r
			}
			if m == i {
				break
			}
			heap[m], heap[i] = heap[i], heap[m]
			i = m
		}
		if it.d > dist[it.n] {
			continue
		}
		u := it.n
		for e := g.off[u]; e < g.off[u+1]; e++ {
			ed := &g.edges[e]
			v := ed.To
			nd := it.d + ed.Len*p.Kind[ed.Kind]*p.Surf[ed.Surf]
			if up > 0 {
				// Forward we climb from u to v; backward the real trip goes from v to u.
				dz := float32(g.nodes[v].Elev-g.nodes[u].Elev) * 0.1
				if backward {
					dz = -dz
				}
				if dz > 0 {
					nd += dz * up
				}
			}
			if nd < dist[v] {
				dist[v] = nd
				push(dijkItem{nd, v})
			}
		}
	}
}

// quantize rounds a distance down to a 16-bit number of altUnitMeters.
func quantize(x float32) uint16 {
	if x >= unreachable {
		return altUnreachable
	}
	q := math.Floor(float64(x) / altUnitMeters)
	if q >= altUnreachable {
		return altUnreachable
	}
	return uint16(q)
}

// buildLandmarks picks landmarks around the edge of the covered area and computes their distances,
// as the landmark rows of the v2 file.
func buildLandmarks(g *graph, sp *spatial, p *Profile, count int, up float32) []uint16 {
	t0 := time.Now()
	// Reachable set from the middle of the area, to keep landmarks off disconnected islands.
	minLat, maxLat, minLon, maxLon := int32(math.MaxInt32), int32(math.MinInt32), int32(math.MaxInt32), int32(math.MinInt32)
	for _, n := range g.nodes {
		minLat, maxLat = min(minLat, n.Lat), max(maxLat, n.Lat)
		minLon, maxLon = min(minLon, n.Lon), max(maxLon, n.Lon)
	}
	center, _, _ := sp.nearest(g, float64(minLat+maxLat)/2e7, float64(minLon+maxLon)/2e7)
	reach := make([]float32, g.n)
	dijkstraAll(g, p, center, reach, 0, false)

	// Landmarks on an ellipse inscribed in the bounding box, each snapped to the nearest reachable node.
	var marks []uint32
	for i := 0; i < count; i++ {
		a := 2 * math.Pi * float64(i) / float64(count)
		lat := float64(minLat+maxLat)/2e7 + 0.5*float64(maxLat-minLat)/1e7*0.95*math.Sin(a)
		lon := float64(minLon+maxLon)/2e7 + 0.5*float64(maxLon-minLon)/1e7*0.95*math.Cos(a)
		best, bestD := uint32(0), math.Inf(1)
		cosl := math.Cos(lat * rad)
		for n := range g.nodes {
			if reach[n] >= unreachable {
				continue
			}
			dy := float64(g.nodes[n].Lat)*1e-7 - lat
			dx := (float64(g.nodes[n].Lon)*1e-7 - lon) * cosl
			if d := dx*dx + dy*dy; d < bestD {
				best, bestD = uint32(n), d
			}
		}
		marks = append(marks, best)
	}

	rowLen := count
	if up > 0 {
		rowLen = 2 * count
	}
	rows := make([]uint16, g.n*rowLen)
	var wg sync.WaitGroup
	sem := make(chan struct{}, min(runtime.GOMAXPROCS(0), 8))
	for li, m := range marks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			dist := make([]float32, g.n)
			dijkstraAll(g, p, m, dist, up, false)
			for n := 0; n < g.n; n++ {
				rows[n*rowLen+li] = quantize(dist[n])
			}
			if up > 0 {
				dijkstraAll(g, p, m, dist, up, true)
				for n := 0; n < g.n; n++ {
					rows[n*rowLen+count+li] = quantize(dist[n])
				}
			}
		}()
	}
	wg.Wait()
	fmt.Fprintf(os.Stderr, "landmarks: %d, climb %.0f, built in %v (%d MB)\n", count, up, time.Since(t0).Round(time.Second), len(rows)*2>>20)
	return rows
}
