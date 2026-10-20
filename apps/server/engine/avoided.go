package engine

import (
	"math"
	"slices"
)

// Circle is an area routes must keep out of: Center and the radius in metres.
type Circle struct {
	Center  Point
	RadiusM float64
}

// forbidden is what a set of avoided areas leaves out of one request's searches: the ways that touch an area,
// and, to snap points, the nodes inside one. A nil *forbidden forbids nothing, so a request without areas
// pays no more than a nil check. It is read only once built.
type forbidden struct {
	g       *graph
	circles []Circle
	cosLat  []float64 // of each circle's centre, which a node test would otherwise compute again for every node
	edges   *avoidSet
}

// has tells whether node n lies inside an area.
func (f *forbidden) has(n uint32) bool {
	if f == nil {
		return false
	}
	nd := f.g.nodes[n]
	for i, c := range f.circles {
		dy := (float64(nd.Lat)*1e-7 - c.Center.Lat) * metersPerDegree
		dx := (float64(nd.Lon)*1e-7 - c.Center.Lon) * metersPerDegree * f.cosLat[i]
		if dx*dx+dy*dy <= c.RadiusM*c.RadiusM {
			return true
		}
	}
	return false
}

// holds tells whether the way between nodes a and b is forbidden.
func (f *forbidden) holds(a, b uint32) bool {
	return f != nil && f.edges.contains(pairKey(a, b))
}

// skip is the filter that keeps a nearest-node search off the nodes inside an area, or nil for none.
func (f *forbidden) skip() func(uint32) bool {
	if f == nil {
		return nil
	}
	return f.has
}

// longEdgeMeters is the length from which a way is looked for by itself and not through the nodes around an
// area: a longer way can cross an area far from both of its ends, and searching so far around every area would
// read a large part of the graph for the few ways that long.
const longEdgeMeters = 500

// longEdgeList is the ways longer than longEdgeMeters, once each, as their two end nodes (the lower number first), in
// the order of the graph. A graph file stores them: a build finds them when it writes the edges.
func longEdgeList(off []uint32, edges []edge, n int) [][2]uint32 {
	var long [][2]uint32
	for u := uint32(0); int(u) < n; u++ {
		for _, e := range edges[off[u]:off[u+1]] {
			if e.To > u && e.Len > longEdgeMeters {
				long = append(long, [2]uint32{u, e.To})
			}
		}
	}
	return long
}

// forbiddenFor is newForbidden, kept for the next call with the same areas: a request asks for its direct loop
// and for its loops one after the other.
func (g *graph) forbiddenFor(circles []Circle) *forbidden {
	if len(circles) == 0 {
		return nil
	}
	g.forbiddenMu.Lock()
	last := g.lastForbidden
	g.forbiddenMu.Unlock()
	if last != nil && slices.Equal(last.circles, circles) {
		return last
	}
	f := newForbidden(g, circles)
	g.forbiddenMu.Lock()
	g.lastForbidden = f
	g.forbiddenMu.Unlock()
	return f
}

// newForbidden finds the ways that touch an area, by their straight line between nodes (a way has no other
// geometry in the graph), or returns nil for no area.
func newForbidden(g *graph, circles []Circle) *forbidden {
	if len(circles) == 0 {
		return nil
	}
	f := &forbidden{g: g, circles: slices.Clone(circles), cosLat: make([]float64, len(circles)), edges: newAvoidSet()}
	long := g.long
	for i, c := range circles {
		cosl := math.Cos(c.Center.Lat * rad)
		f.cosLat[i] = cosl
		touch := func(u, v uint32) {
			if segmentWithin(c.Center, cosl, g.nodes[u], g.nodes[v], c.RadiusM) {
				f.edges.insert(pairKey(u, v))
			}
		}
		// A way no longer than longEdgeMeters that touches the area has an end within that of it.
		g.sp.eachNodeWithin(g, c.Center, cosl, c.RadiusM+longEdgeMeters, func(u uint32) {
			for e := g.off[u]; e < g.off[u+1]; e++ {
				touch(u, g.edges[e].To)
			}
		})
		for _, way := range long {
			touch(way[0], way[1])
		}
	}
	return f
}

// segmentWithin tells whether the segment between two nodes comes within radiusM of the centre.
func segmentWithin(center Point, cosl float64, a, b node, radiusM float64) bool {
	ax := (float64(a.Lon)*1e-7 - center.Lon) * metersPerDegree * cosl
	ay := (float64(a.Lat)*1e-7 - center.Lat) * metersPerDegree
	bx := (float64(b.Lon)*1e-7 - center.Lon) * metersPerDegree * cosl
	by := (float64(b.Lat)*1e-7 - center.Lat) * metersPerDegree
	dx, dy := bx-ax, by-ay
	t := 0.0
	if l := dx*dx + dy*dy; l > 0 {
		t = math.Max(0, math.Min(1, -(ax*dx+ay*dy)/l))
	}
	return math.Hypot(ax+t*dx, ay+t*dy) <= radiusM
}

// eachNodeWithin calls visit for the nodes within reachM of p, whose longitude degrees are cosl as long as a
// latitude degree.
func (s *spatial) eachNodeWithin(g *graph, p Point, cosl, reachM float64, visit func(uint32)) {
	dLat := int32(reachM / metersPerDegree * 1e7)
	dLon := int32(reachM / (metersPerDegree * cosl) * 1e7)
	lat, lon := int32(p.Lat*1e7), int32(p.Lon*1e7)
	if lat+dLat < s.minLat || lon+dLon < s.minLon {
		return
	}
	y0 := max(0, int(lat-dLat-s.minLat)/cellLat)
	y1 := min(s.ny-1, int(lat+dLat-s.minLat)/cellLat)
	x0 := max(0, int(lon-dLon-s.minLon)/cellLon)
	x1 := min(s.nx-1, int(lon+dLon-s.minLon)/cellLon)
	reach2 := reachM * reachM
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			c := y*s.nx + x
			for _, n := range s.nodes[s.start[c]:s.start[c+1]] {
				dy := (float64(g.nodes[n].Lat)*1e-7 - p.Lat) * metersPerDegree
				dx := (float64(g.nodes[n].Lon)*1e-7 - p.Lon) * metersPerDegree * cosl
				if dx*dx+dy*dy <= reach2 {
					visit(n)
				}
			}
		}
	}
}
