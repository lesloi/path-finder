// Package server is the HTTP layer: the API routes, their limits, and the built web app on the
// same origin. It knows nothing of routing; route sets come from a RouteSetGenerator.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// RouteSetGenerator turns a request body into the routes of a route set. It must return once ctx
// ends. It reports a body that is not valid criteria as a *CriteriaError.
type RouteSetGenerator interface {
	Generate(ctx context.Context, body json.RawMessage) (routes any, err error)
}

// Config is what New needs; the zero value of an optional field is its default.
type Config struct {
	// WebRoot holds the built web app, with the `build-id` file its build writes.
	WebRoot   string
	Generator RouteSetGenerator
	// Elevation tells the web app that routes have an elevation gain.
	Elevation bool
	// Limits turns on the rate limit and the cap on concurrent generations; off in development.
	Limits bool
	// LoopLimit caps the generations running at once (default 1); beyond it the answer is 429.
	LoopLimit int
	// GenerationTimeout is how long a route set may take (default 15 s).
	GenerationTimeout time.Duration
	// TrustedProxies are the reverse proxies whose X-Forwarded-For counts; by default none, and the
	// client's address is the connection's.
	TrustedProxies []netip.Prefix
	// Log, in development only, writes each request with its address and query, and the errors a
	// generation fails with. Production keeps no logs: requests hold the client address and the
	// criteria hold the start point.
	Log *log.Logger
	// HealthAllowlist lists the callers allowed to check /health besides the loopback; by default every caller.
	HealthAllowlist []netip.Prefix
}

// New returns the server's handler.
func New(cfg Config) http.Handler {
	if cfg.LoopLimit <= 0 {
		cfg.LoopLimit = 1
	}
	if cfg.GenerationTimeout <= 0 {
		cfg.GenerationTimeout = 15 * time.Second
	}
	a := &app{cfg: cfg, buildID: readBuildID(cfg.WebRoot)}

	r := chi.NewRouter()
	if cfg.Log != nil {
		r.Use(middleware.RequestLogger(&middleware.DefaultLogFormatter{Logger: cfg.Log}))
	}
	r.Use(referrerPolicy, middleware.ClientIPFromRemoteAddr)
	if len(cfg.TrustedProxies) > 0 {
		// Skips the trusted proxies from the right of X-Forwarded-For: the first other address is the
		// client. Without the header, the connection's address stays.
		trusted := make([]string, len(cfg.TrustedProxies))
		for i, p := range cfg.TrustedProxies {
			trusted[i] = p.String()
		}
		r.Use(middleware.ClientIPFromXFF(trusted...))
	}
	r.Get("/health", a.health)
	// What the server can do, for the web app to offer only that. Nothing about the caller.
	r.Get("/api/v1/capabilities", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"elevation": cfg.Elevation})
	})
	// No logs here: criteria hold the start point, and requests hold the client address.
	routeSets := r.With()
	if cfg.Limits {
		// Generous, since mobile carriers put many users behind one address (CGNAT).
		routeSets = routeSets.With(rateLimit(newRateLimiter(60, 10*time.Minute)))
	}
	routeSets = routeSets.With(a.checkBuild)
	if cfg.Limits {
		routeSets = routeSets.With(throttle(cfg.LoopLimit))
	}
	routeSets.Post("/api/v1/route-sets", a.routeSets)
	r.NotFound(staticFiles(cfg.WebRoot).ServeHTTP)
	return r
}

type app struct {
	cfg     Config
	buildID string
}

func referrerPolicy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// health answers a healthcheck. The loopback stays allowed for one run inside the container. Other
// callers get 404, as if the route did not exist, and are not logged.
func (a *app) health(w http.ResponseWriter, r *http.Request) {
	if a.cfg.HealthAllowlist != nil {
		addr, err := netip.ParseAddr(middleware.GetClientIP(r.Context()))
		if err != nil || !(inRanges(loopbacks, addr) || inRanges(a.cfg.HealthAllowlist, addr)) {
			http.NotFound(w, r)
			return
		}
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "ok")
}

// checkBuild answers 426 to a tab left open across a deploy, which sends the ID of the previous build.
func (a *app) checkBuild(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := r.Header.Get("X-Build-Id"); a.buildID != "" && id != "" && id != a.buildID {
			refuse(w, http.StatusUpgradeRequired, codeStaleBuild)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *app) routeSets(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
	// Never the error's message: a JSON syntax error quotes the body, which holds the start point.
	if err != nil || !json.Valid(body) {
		refuse(w, http.StatusBadRequest, codeInvalidJSON)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), a.cfg.GenerationTimeout)
	defer cancel()
	routes, err := a.cfg.Generator.Generate(ctx, body)
	var criteria *CriteriaError
	switch {
	case errors.As(err, &criteria):
		writeJSON(w, http.StatusBadRequest, refusal{Error: codeInvalidCriteria, Field: criteria.Field})
	case errors.Is(err, context.DeadlineExceeded):
		refuse(w, http.StatusGatewayTimeout, codeGenerationTimeout)
	case r.Context().Err() != nil:
		// The client left: nobody reads an answer.
	case err != nil:
		// Any other error is a bug, not a slow generation, and its message could hold the start point.
		if a.cfg.Log != nil {
			a.cfg.Log.Printf("route-sets: generation failed: %v", err)
		}
		w.WriteHeader(http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"routes": routes})
	}
}

// readBuildID returns the ID written by each web app build, or none when the web app is not built.
func readBuildID(webRoot string) string {
	data, err := os.ReadFile(filepath.Join(webRoot, "build-id"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
