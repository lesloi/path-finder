// Command go-router is a throwaway proof of concept: it builds a pedestrian routing graph from
// an OSM PBF and BD ALTI tiles, then routes and generates loops on it, to judge route quality,
// speed and memory before choosing an architecture.
package main

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type stringList []string

func (l *stringList) String() string     { return strings.Join(*l, ",") }
func (l *stringList) Set(v string) error { *l = append(*l, v); return nil }

func fail(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func parsePoint(s string) (lat, lon float64, err error) {
	parts := strings.Split(s, ",")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("point %q must be lat,lon", s)
	}
	if lat, err = strconv.ParseFloat(parts[0], 64); err != nil {
		return
	}
	lon, err = strconv.ParseFloat(parts[1], 64)
	return
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: go-router build-graph|build-alt|route|table|loop|bench|cancel ...")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "build-graph":
		fs := flag.NewFlagSet("build-graph", flag.ExitOnError)
		var pbfs stringList
		fs.Var(&pbfs, "pbf", "OSM PBF file (repeatable)")
		dem := fs.String("dem", "", "directory holding BD ALTI .asc tiles")
		out := fs.String("out", "graph.bin", "graph file to write")
		fs.Parse(os.Args[2:])
		if err := buildGraph(pbfs, *dem, *out); err != nil {
			fail(err)
		}
	case "build-alt":
		fs := flag.NewFlagSet("build-alt", flag.ExitOnError)
		graph := fs.String("graph", "graph.bin", "graph file")
		out := fs.String("out", "graph.alt", "landmark file to write")
		n := fs.Int("landmarks", 16, "number of landmarks")
		up := fs.Float64("climb", 8, "climb penalty of the metric (0 for a symmetric, climb-free one)")
		prof := fs.String("profile", "hike", "hike or run")
		fs.Parse(os.Args[2:])
		g, err := openG2(*graph)
		if err != nil {
			fail(err)
		}
		p := profiles[*prof]
		if p == nil {
			fail(fmt.Errorf("unknown profile %q", *prof))
		}
		rows := buildALT(g, newSpatial2(g), p, *n, float32(*up))
		if err := writeALTV2(*out, *n, uint32(g.n), float32(*up), rows); err != nil {
			fail(err)
		}
	case "route", "table", "loop", "bench", "cancel":
		engineCmd(os.Args[1], os.Args[2:])
	default:
		fail(fmt.Errorf("unknown command %q", os.Args[1]))
	}
}
