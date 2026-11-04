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

// forbidden is what one request leaves out of its searches: the ways that touch an avoided area and those flagged
// with skip, and, to snap points, the nodes inside an area or in a pocket the skipped ways close off. A nil
// *forbidden forbids nothing, so a request that avoids nothing pays no more than a nil check. It is read only once
// built.
type forbidden struct {
	g       *graph
	circles []Circle
	cosLat  []float64 // of each circle's centre, which a node test would otherwise compute again for every node
	edges   *avoidSet
	mode    Mode // the ways are those the mode may use: an area off a bike's ways does not forbid a foot's
	// skip is the edge flags the request leaves out: a way holding one is not used, and a point on one snaps to the
	// nearest way it may use. The zero value leaves out no way.
	skip uint8
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

// skips tells whether the way of an edge holds a flag the request leaves out.
func (f *forbidden) skips(ed *edge) bool {
	return f != nil && f.skip != 0 && ed.Flags&f.skip != 0
}

// hasRoom tells whether a node is a place a search may start from: outside the areas, and with room to loop once
// the skipped ways are left out. It is what snapping asks, so that a start point on a skipped way moves to the
// nearest way it may use.
func (f *forbidden) hasRoom(n uint32) bool {
	if f == nil {
		return true
	}
	if f.has(n) {
		return false
	}
	return f.skip == 0 || f.g.hasRoom(n, f.skip, f.mode)
}

// blocks tells whether a node is out of a wide scan of candidate anchors: inside an area, or with no way the skipped
// flags leave open. It is hasRoom without the pocket test, which a scan of thousands of nodes cannot afford, and the
// few nodes it lets through are dropped when a leg to them finds no way.
func (f *forbidden) blocks(n uint32) bool {
	if f == nil {
		return false
	}
	if f.has(n) {
		return true
	}
	return f.skip != 0 && !f.g.hasEdgeWithout(n, f.skip, f.mode)
}

// longEdgeMeters is the length from which a way is looked for by itself and not through the nodes around an
// area: a longer way can cross an area far from both of its ends, and searching so far around every area would
// read a large part of the graph for the few ways that long.
const longEdgeMeters = 500

// longEdgeList is the ways longer than longEdgeMeters, as their two end nodes (the lower number first) and the
// modes that may use them, in the order of the graph. A graph file stores them: a build finds them when it writes
// the edges. Two parallel ways between the same nodes are two records, each with its own modes, so that a way only
// one mode may use does not forbid the other mode's way.
func longEdgeList(off []uint32, edges []edge, n int) []longWay {
	var long []longWay
	for u := uint32(0); int(u) < n; u++ {
		for _, e := range edges[off[u]:off[u+1]] {
			if e.To > u && e.Len > longEdgeMeters {
				long = append(long, longWay{A: u, B: e.To, Modes: e.Modes & EdgeAllModes})
			}
		}
	}
	return long
}

// forbiddenFor is newForbidden, kept for the next call with the same areas: a request asks for its direct loop
// and for its loops one after the other. The mode is part of what is kept: two requests of one graph may avoid the
// same area on ways only one of them can use.
func (g *graph) forbiddenFor(circles []Circle, mode Mode, skip uint8) *forbidden {
	if len(circles) == 0 && skip == 0 {
		return nil
	}
	g.forbiddenMu.Lock()
	last := g.lastForbidden
	g.forbiddenMu.Unlock()
	if last != nil && last.mode == mode && last.skip == skip && slices.Equal(last.circles, circles) {
		return last
	}
	f := newForbidden(g, circles, mode, skip)
	g.forbiddenMu.Lock()
	g.lastForbidden = f
	g.forbiddenMu.Unlock()
	return f
}

// newForbidden finds the ways that touch an area, by their straight line between nodes (a way has no other
// geometry in the graph), or returns nil when the request avoids nothing. It only keeps the ways the mode may use.
func newForbidden(g *graph, circles []Circle, mode Mode, skip uint8) *forbidden {
	if len(circles) == 0 && skip == 0 {
		return nil
	}
	f := &forbidden{g: g, circles: slices.Clone(circles), cosLat: make([]float64, len(circles)), edges: newAvoidSet(), mode: mode, skip: skip}
	bit := mode.Bit()
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
				if ed := &g.edges[e]; ed.Modes&bit != 0 {
					touch(u, ed.To)
				}
			}
		})
		for _, way := range long {
			if way.Modes&bit != 0 {
				touch(way.A, way.B)
			}
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
