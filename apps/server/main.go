// Command server is the path-finder server: one binary that serves the web app and the API.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/lesloi/path-finder/apps/server/engine"
	"github.com/lesloi/path-finder/apps/server/generator"
	"github.com/lesloi/path-finder/apps/server/server"
)

func main() {
	cfg, err := server.ConfigFromEnv(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	// The graph and the landmarks of each activity are built ahead of serving (see ../../poc/go-router).
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
