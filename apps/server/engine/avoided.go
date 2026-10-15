package engine

import "math"

// Circle is an area routes must keep out of: Center and the radius in metres.
type Circle struct {
	Center  Point
	RadiusM float64
}

// forbidden is what a set of avoided areas leaves out of one request's searches: the ways that touch an area,
// and, to snap points, the nodes inside one. A nil *forbidden forbids nothing, so a request without areas
// pays no more than a nil check.
type forbidden struct {
	g       *graph
	circles []Circle
	edges   *avoidSet
}

// has tells whether node n lies inside an area.
func (f *forbidden) has(n uint32) bool {
	if f == nil {
		return false
	}
	nd := f.g.nodes[n]
	for _, c := range f.circles {
		if distanceM(float64(nd.Lat)*1e-7, float64(nd.Lon)*1e-7, c.Center) <= c.RadiusM {
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

func distanceM(lat, lon float64, p Point) float64 {
	return math.Hypot((lat-p.Lat)*metersPerDegree, (lon-p.Lon)*metersPerDegree*math.Cos(p.Lat*rad))
}

// newForbidden finds the ways that touch an area, by their straight line between nodes (a way has no other
// geometry in the graph), or returns nil for no area. A way with both ends outside can still cross an area, so
// the nodes searched reach the longest way beyond its edge.
func newForbidden(g *graph, circles []Circle) *forbidden {
	if len(circles) == 0 {
		return nil
	}
	f := &forbidden{g: g, circles: circles, edges: newAvoidSet()}
	reach := g.longestEdge()
	for _, c := range circles {
		cosl := math.Cos(c.Center.Lat * rad)
		r := c.RadiusM + reach
		g.sp.eachNodeWithin(g, c.Center, r, func(u uint32) {
			nu := g.nodes[u]
			for e := g.off[u]; e < g.off[u+1]; e++ {
				v := g.edges[e].To
				nv := g.nodes[v]
				if segmentWithin(c.Center, cosl, nu, nv, c.RadiusM) {
					f.edges.insert(pairKey(u, v))
				}
			}
		})
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

// eachNodeWithin calls visit for the nodes within reachM of p.
func (s *spatial) eachNodeWithin(g *graph, p Point, reachM float64, visit func(uint32)) {
	dLat := int32(reachM / metersPerDegree * 1e7)
	dLon := int32(reachM / (metersPerDegree * math.Cos(p.Lat*rad)) * 1e7)
	lat, lon := int32(p.Lat*1e7), int32(p.Lon*1e7)
	y0 := max(0, int(lat-dLat-s.minLat)/cellLat)
	y1 := min(s.ny-1, int(lat+dLat-s.minLat)/cellLat)
	x0 := max(0, int(lon-dLon-s.minLon)/cellLon)
	x1 := min(s.nx-1, int(lon+dLon-s.minLon)/cellLon)
	if lat+dLat < s.minLat || lon+dLon < s.minLon {
		return
	}
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			c := y*s.nx + x
			for _, n := range s.nodes[s.start[c]:s.start[c+1]] {
				if nd := g.nodes[n]; distanceM(float64(nd.Lat)*1e-7, float64(nd.Lon)*1e-7, p) <= reachM {
					visit(n)
				}
			}
		}
	}
}

// longestEdge is the length of the longest way of the graph, in metres. It reads every edge once, on the
// first request that has areas, and is kept for the life of the graph.
func (g *graph) longestEdge() float64 {
	g.longestOnce.Do(func() {
		var longest float32
		for i := range g.edges {
			longest = max(longest, g.edges[i].Len)
		}
		g.longest = float64(longest)
	})
	return g.longest
}
