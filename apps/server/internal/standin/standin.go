// Package standin writes a small graph with rolling hills around Annecy, for the end-to-end and
// integration tests: routes there have an elevation gain and a mix of surfaces without OSM or IGN data.
package standin

import (
	"math"
	"path/filepath"

	"github.com/lesloi/path-finder/apps/server/engine"
)

// Start is the point the route scenarios start from, as longitude and latitude.
var Start = [2]float64{6.1294, 45.8992}

const (
	side       = 61  // nodes per side of the lattice
	stepMetres = 150 // between two neighbours: a lattice of about 9 km
	baseHeight = 600
	hillHeight = 80
	wavelength = 2500
)

// Files are what Write produced.
type Files struct{ Graph, LandmarksHike, LandmarksRun string }

// Write writes the graph and the landmarks of both activities into dir. Ways west of the start
// are paved residential streets, those east of it rough tracks, so loops cover both surfaces.
func Write(dir string) (Files, error) {
	var b engine.Builder
	const metresPerDegree = 111194.9
	cosLat := math.Cos(Start[1] * math.Pi / 180)
	at := func(x, y int) int { return y*side + x }
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			east, north := float64(x-side/2)*stepMetres, float64(y-side/2)*stepMetres
			height := baseHeight + hillHeight*math.Sin(east*2*math.Pi/wavelength)*math.Cos(north*2*math.Pi/wavelength)
			b.AddNode(Start[1]+north/metresPerDegree, Start[0]+east/(metresPerDegree*cosLat), height)
		}
	}
	way := func(a, c, x int) {
		if x < side/2 {
			b.Connect(a, c, engine.KindResidential, engine.SurfacePaved)
		} else {
			b.Connect(a, c, engine.KindTrack, engine.SurfaceRough)
		}
	}
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			if x+1 < side {
				way(at(x, y), at(x+1, y), x)
			}
			if y+1 < side {
				way(at(x, y), at(x, y+1), x)
			}
		}
	}
	f := Files{
		Graph:         filepath.Join(dir, "graph.bin"),
		LandmarksHike: filepath.Join(dir, "hike.alt"),
		LandmarksRun:  filepath.Join(dir, "run.alt"),
	}
	if err := b.WriteGraph(f.Graph); err != nil {
		return Files{}, err
	}
	if err := engine.WriteLandmarks(f.Graph, f.LandmarksHike, "hike", 8); err != nil {
		return Files{}, err
	}
	return f, engine.WriteLandmarks(f.Graph, f.LandmarksRun, "run", 8)
}
