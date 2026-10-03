// Command server is the path-finder server: one binary that serves the web app and the API.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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
		out := fs.String("out", "graph.bin", "graph file to write")
		_ = fs.Parse(args)
		return graphbuild.Build(pbfs, *dem, *out, os.Stderr)
	case "build-alt":
		fs := flag.NewFlagSet(command, flag.ExitOnError)
		graph := fs.String("graph", "graph.bin", "graph file")
		out := fs.String("out", "", "landmark file to write")
		profile := fs.String("profile", "hike", "activity profile: hike or run")
		count := fs.Int("landmarks", 16, "number of landmarks")
		_ = fs.Parse(args)
		if *out == "" {
			return errors.New("build-alt needs -out")
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
	graph := os.Getenv("GRAPH_FILE")
	if graph == "" {
		log.Fatal("GRAPH_FILE is not set")
	}
	engines, err := engine.OpenAll(graph, map[string]string{
		"hike": os.Getenv("LANDMARKS_HIKE"),
		"run":  os.Getenv("LANDMARKS_RUN"),
	})
	if err != nil {
		log.Fatal(err)
	}
	cfg.Generator = &generator.Generator{Engines: map[string]generator.Looper{"hike": engines["hike"], "run": engines["run"]}}
	// Empty, like unset, it takes the default rather than a random port.
	port := envOr("PORT", "3000")

	srv := &http.Server{Addr: ":" + port, Handler: server.New(cfg), ReadHeaderTimeout: 10 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Printf("server listening on port %s", port)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
