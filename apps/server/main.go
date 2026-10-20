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
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/lesloi/path-finder/apps/server/elevation"
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
		dem := fs.String("dem", "", "directory holding the BD ALTI .asc tiles, plain or gzipped (.asc.gz)")
		out := fs.String("out", filepath.Join(dataDir(), engine.GraphFileName), "graph file to write")
		crs := fs.String("dem-crs", "lambert93", "projection of the BD ALTI tiles: lambert93 (metropolitan France), or utmZZn / utmZZs for an overseas territory, see docs/INSTALL.md")
		bbox := fs.String("bbox", "", "keep only this zone, as minLon,minLat,maxLon,maxLat: the memory then follows the zone, not the extract (one sorted -pbf)")
		tmp := fs.String("tmp", "", "directory for the temporary files of a build from one extract (default: the directory of -out, never a memory-backed /tmp)")
		chunk := fs.Int("chunk", graphbuild.DefaultChunk, "records one sort holds in memory, for a build from one extract")
		cache := fs.Int("cache", graphbuild.DefaultCache, "BD ALTI tiles kept in memory, for a build from one extract")
		_ = fs.Parse(args)
		proj, err := elevation.ParseProjection(*crs)
		if err != nil {
			return err
		}
		if *bbox == "" {
			// One extract is built on disk, whose memory does not grow with the country; several are joined in memory.
			return graphbuild.BuildGraph(pbfs, *dem, proj, *out, graphbuild.Options{Tmp: *tmp, Chunk: *chunk, Cache: *cache}, os.Stderr)
		}
		box, err := graphbuild.ParseBox(*bbox)
		if err != nil {
			return err
		}
		if len(pbfs) != 1 {
			return fmt.Errorf("build-graph -bbox reads exactly one -pbf, got %d", len(pbfs))
		}
		return graphbuild.BuildClipped(pbfs[0], *dem, proj, *out, box, os.Stderr)
	case "plan-zones":
		fs := flag.NewFlagSet(command, flag.ExitOnError)
		pbf := fs.String("pbf", "", "sorted OSM PBF file of the country")
		extent := fs.String("extent", "-5.3,41.3,9.7,51.2", "area to cover, as minLon,minLat,maxLon,maxLat (default: metropolitan France)")
		maxNodes := fs.Int("max-nodes", 40_000_000, "most nodes of the extract a zone should hold, margin included")
		margin := fs.Float64("margin-km", 20, "how far a zone reaches beyond its part (at least the radius of the longest loop)")
		cell := fs.Float64("cell", 0.02, "size in degrees of the cells that nodes are counted in")
		_ = fs.Parse(args)
		// The list of zones goes to the standard output, what is said of each to the standard error.
		box, err := graphbuild.ParseBox(*extent)
		if err != nil {
			return err
		}
		zones, err := graphbuild.PlanZones(*pbf, graphbuild.PlanOptions{Extent: box, MaxNodes: *maxNodes, MarginKm: *margin, CellDeg: *cell}, os.Stderr)
		if err != nil {
			return err
		}
		for _, z := range zones {
			fmt.Println(z.Line())
			fmt.Fprintf(os.Stderr, "%s: %d nodes\n", z.Name, z.Nodes)
		}
		return nil
	case "build-pois":
		fs := flag.NewFlagSet(command, flag.ExitOnError)
		var pbfs stringList
		fs.Var(&pbfs, "pbf", "OSM PBF file (repeatable)")
		out := fs.String("out", filepath.Join(dataDir(), poiDirName), "directory to write the tiles in (empty or new)")
		_ = fs.Parse(args)
		return graphbuild.BuildPOIs(pbfs, *out, os.Stderr)
	case "build-alt":
		fs := flag.NewFlagSet(command, flag.ExitOnError)
		graph := fs.String("graph", filepath.Join(dataDir(), engine.GraphFileName), "graph file")
		out := fs.String("out", "", "landmark file to write (default: the profile's file in the data directory)")
		profile := fs.String("profile", "any", "surface-preference profile: any, paved or unpaved")
		count := fs.Int("landmarks", 8, "number of landmarks")
		tmp := fs.String("tmp", "", "directory for the files of the build (default: the directory of -out, never a memory-backed /tmp)")
		workers := fs.Int("workers", 2, "landmarks computed at a time, each worker holding one distance per node")
		_ = fs.Parse(args)
		if *out == "" {
			*out = filepath.Join(dataDir(), engine.LandmarksFileName(*profile))
		}
		if *tmp == "" {
			*tmp = filepath.Dir(*out)
		}
		// The distances go to disk as they are made, so that the memory follows the workers, not the number of nodes.
		return engine.WriteLandmarksOnDisk(*graph, *out, *profile, *count, *tmp, *workers)
	}
	return fmt.Errorf("unknown command %q: use build-graph, build-alt, build-pois, plan-zones, or none to serve", command)
}

type stringList []string

func (l *stringList) String() string     { return strings.Join(*l, ",") }
func (l *stringList) Set(v string) error { *l = append(*l, v); return nil }

// reloadEvery is how often the data directory is looked at for files that replace the ones served.
const reloadEvery = 30 * time.Second // polling needs no signal and no step in a deployment, for 30 s of delay

func serve() {
	cfg, err := server.ConfigFromEnv(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	// The graph and the landmarks of each profile are built ahead of serving, by build-graph and build-alt.
	// The port opens once the files are mapped and their headers checked.
	opened := time.Now()
	zones, err := engine.NewReloader(dataDir(), engine.ProfileNames...)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("%d zone(s) opened in %s", zones.Len(), time.Since(opened).Round(time.Millisecond))
	engines := make(map[string]generator.Looper, len(engine.ProfileNames))
	for _, name := range engine.ProfileNames {
		z := zones.Profile(name)
		if z == nil { // a nil pointer in an interface is not a nil interface: fail here, not in a request
			log.Fatalf("the data holds no zone for the %s profile", name)
		}
		engines[name] = z
	}
	if cfg.LoopLimit == 0 {
		cfg.LoopLimit = engine.DefaultConcurrentSearches() // LOOP_LIMIT forces another
	}
	gen := &generator.Generator{Engines: engines}
	// SEARCH_SEED fixes the seed of every search, so that the end-to-end tests ask for the same loops each time.
	// Without it each request has its own, and asking again can bring other loops.
	if raw := os.Getenv("SEARCH_SEED"); raw != "" {
		seed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			log.Fatalf("SEARCH_SEED must be a whole number: %v", err)
		}
		gen.Seed = func() uint64 { return seed }
	}
	cfg.Generator = gen
	cfg.Coverage = zones
	cfg.POIDir = filepath.Join(dataDir(), poiDirName)
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
	go zones.Watch(ctx, reloadEvery, log.Printf)
	log.Printf("server listening on port %s", port)
	if err := server.Serve(ctx, srv, ln, 20*time.Second); err != nil {
		log.Fatal(err)
	}
}

// poiDirName is the directory of the data directory that holds the tiles of points of interest; the map shows none without it.
const poiDirName = "pois"

// dataDir is the directory holding the graph and the landmarks: a volume, when hosted.
func dataDir() string { return envOr("DATA_DIR", "data") }

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
