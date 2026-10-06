// Command server is the path-finder server: one binary that serves the web app and the API.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/lesloi/path-finder/apps/server/engine"
	"github.com/lesloi/path-finder/apps/server/generator"
	"github.com/lesloi/path-finder/apps/server/graphbuild"
	"github.com/lesloi/path-finder/apps/server/server"
)

func main() {
	if len(os.Args) > 1 {
		if err := run(os.Args[1], os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	serve()
}

// run is a job to run ahead of serving: it builds the files the server maps.
func run(command string, args []string) error {
	switch command {
	case "build-graph":
		fs := flag.NewFlagSet(command, flag.ExitOnError)
		var pbfs stringList
		fs.Var(&pbfs, "pbf", "OSM PBF file (repeatable)")
		dem := fs.String("dem", "", "directory holding the BD ALTI .asc tiles")
		out := fs.String("out", filepath.Join(dataDir(), engine.GraphFileName), "graph file to write")
		bbox := fs.String("bbox", "", "keep only this zone, as minLon,minLat,maxLon,maxLat: the memory then follows the zone, not the extract (one sorted -pbf)")
		_ = fs.Parse(args)
		if *bbox == "" {
			return graphbuild.Build(pbfs, *dem, *out, os.Stderr)
		}
		box, err := graphbuild.ParseBox(*bbox)
		if err != nil {
			return err
		}
		if len(pbfs) != 1 {
			return fmt.Errorf("build-graph -bbox reads exactly one -pbf, got %d", len(pbfs))
		}
		return graphbuild.BuildClipped(pbfs[0], *dem, *out, box, os.Stderr)
	case "build-alt":
		fs := flag.NewFlagSet(command, flag.ExitOnError)
		graph := fs.String("graph", filepath.Join(dataDir(), engine.GraphFileName), "graph file")
		out := fs.String("out", "", "landmark file to write (default: the profile's file in the data directory)")
		profile := fs.String("profile", "hike", "activity profile: hike or run")
		count := fs.Int("landmarks", 8, "number of landmarks")
		_ = fs.Parse(args)
		if *out == "" {
			*out = filepath.Join(dataDir(), engine.LandmarksFileName(*profile))
		}
		return engine.WriteLandmarks(*graph, *out, *profile, *count)
	}
	return fmt.Errorf("unknown command %q: use build-graph, build-alt, or none to serve", command)
}

type stringList []string

func (l *stringList) String() string     { return strings.Join(*l, ",") }
func (l *stringList) Set(v string) error { *l = append(*l, v); return nil }

func serve() {
	cfg, err := server.ConfigFromEnv(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	// The graph and the landmarks of each activity are built ahead of serving, by build-graph and build-alt.
	// The port opens once the files are mapped and their headers checked.
	opened := time.Now()
	zones, err := engine.OpenZones(dataDir(), "hike", "run")
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("%d zone(s) opened in %s", zones.Len(), time.Since(opened).Round(time.Millisecond))
	hike, run := zones.Activity("hike"), zones.Activity("run")
	if hike == nil || run == nil { // a nil pointer in an interface is not a nil interface: fail here, not in a request
		log.Fatal("the data holds no zone for an activity")
	}
	if cfg.LoopLimit == 0 {
		cfg.LoopLimit = engine.DefaultConcurrentSearches() // LOOP_LIMIT forces another
	}
	cfg.Generator = &generator.Generator{Engines: map[string]generator.Looper{"hike": hike, "run": run}}
	// Empty, like unset, it takes the default rather than a random port.
	port := envOr("PORT", "3000")

	// A request is read in seconds (its body is a few hundred bytes), so a slow one is cut rather than kept.
	srv := &http.Server{
		Handler:           server.New(cfg),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 2 * time.Minute,
	}
	ln, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("server listening on port %s", port)
	if err := server.Serve(ctx, srv, ln, 20*time.Second); err != nil {
		log.Fatal(err)
	}
}

// dataDir is the directory holding the graph and the landmarks: a volume, when hosted.
func dataDir() string { return envOr("DATA_DIR", "data") }

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
