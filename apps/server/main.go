// Command server is the path-finder server: one binary that serves the web app and the API.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/lesloi/path-finder/apps/server/server"
)

// unported stands in until the route-set generation moves to Go.
type unported struct{}

func (unported) Generate(context.Context, json.RawMessage) (any, error) {
	return nil, errors.New("route sets are not generated yet")
}

func main() {
	// Empty, like unset, it takes the default rather than a random port.
	port := envOr("PORT", "3000")
	cfg := server.Config{
		WebRoot:   envOr("WEB_ROOT", "../web/dist"),
		Generator: unported{},
		Elevation: true,
		// On unless explicitly in development, so forgetting APP_ENV keeps them on.
		Limits: os.Getenv("APP_ENV") != "development",
	}
	if os.Getenv("APP_ENV") == "development" {
		cfg.Log = log.New(os.Stdout, "", log.LstdFlags)
	}
	var err error
	// Unset or empty, X-Forwarded-For is ignored and the client is the connection.
	if list := os.Getenv("TRUSTED_PROXIES"); strings.TrimSpace(list) != "" {
		if cfg.TrustedProxies, err = server.ParseAddressRanges(list, "TRUSTED_PROXIES"); err != nil {
			log.Fatal(err)
		}
	}

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
