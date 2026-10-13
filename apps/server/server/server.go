// Package server is the HTTP layer: the API routes, their limits, and the built web app on the
// same origin. It knows nothing of routing; route sets come from a RouteSetGenerator.
package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/lesloi/path-finder/apps/server/contract"
)

// RouteSetGenerator turns a request body into the routes of a route set. It must return once ctx
// ends. It reports a body that is not valid criteria as a *contract.CriteriaError.
type RouteSetGenerator interface {
	Generate(ctx context.Context, body json.RawMessage) (routes any, err error)
}

// CoverageSource lists the cells of the grid of contract.json where the server can route.
type CoverageSource interface {
	Coverage() [][4]float64
}

// Config is what New needs; the zero value of an optional field is its default.
type Config struct {
	// WebRoot holds the built web app, with the `build-id` file its build writes.
	WebRoot   string
	Generator RouteSetGenerator
	// Coverage answers GET /api/v1/coverage; without it the route is not served.
	Coverage CoverageSource
	// POIDir holds the tiles of points of interest, as build-pois writes them. Without it the route is not served;
	// with it, a missing directory or tile answers an empty tile.
	POIDir string
	// Limits turns on the rate limit and the cap on concurrent generations; off in development.
	Limits bool
	// LoopLimit caps the generations running at once (default 1, which main replaces with one that follows
	// the CPUs); beyond it the answer is 429.
	LoopLimit int
	// RateLimit is the requests an address may send per RateWindow (default 60 per 10 minutes).
	RateLimit  int
	RateWindow time.Duration
	// GenerationTimeout is how long a route set may take (default 15 s).
	GenerationTimeout time.Duration
	// TrustedProxies are the reverse proxies whose X-Forwarded-For counts; by default none, and the
	// client's address is the connection's.
	TrustedProxies []netip.Prefix
	// Log, in development only, writes each request with its address and query, and the errors a
	// generation fails with. Production keeps no logs: requests hold the client address and the
	// criteria hold the start point.
	Log *log.Logger
}

// New returns the server's handler.
func New(cfg Config) http.Handler {
	if cfg.LoopLimit <= 0 {
		cfg.LoopLimit = 1
	}
	if cfg.RateLimit <= 0 {
		cfg.RateLimit = 60
	}
	if cfg.RateWindow <= 0 {
		cfg.RateWindow = 10 * time.Minute
	}
	if cfg.GenerationTimeout <= 0 {
		cfg.GenerationTimeout = 15 * time.Second
	}
	a := &app{cfg: cfg, buildID: readBuildID(cfg.WebRoot)}

	r := chi.NewRouter()
	if cfg.Log != nil {
		r.Use(skipPOITiles(middleware.RequestLogger(&middleware.DefaultLogFormatter{Logger: cfg.Log})))
	}
	// A panic answers 500 here, rather than in net/http, which would log the client's address.
	r.Use(middleware.Recoverer, securityHeaders, middleware.Heartbeat("/healthz"), middleware.ClientIPFromRemoteAddr)
	if len(cfg.TrustedProxies) > 0 {
		r.Use(forwardedFor(cfg.TrustedProxies))
	}
	// No logs here: criteria hold the start point, and requests hold the client address.
	routeSets := r.With()
	if cfg.Limits {
		// Generous, since mobile carriers put many users behind one address (CGNAT).
		routeSets = routeSets.With(rateLimit(newRateLimiter(cfg.RateLimit, cfg.RateWindow)))
	}
	// The body is read before a generation slot is taken: a slow upload must not hold one.
	routeSets = routeSets.With(a.checkBuild, readBody)
	if cfg.Limits {
		routeSets = routeSets.With(throttle(cfg.LoopLimit))
	}
	routeSets.Post("/api/v1/route-sets", a.routeSets)
	if cfg.Coverage != nil {
		r.With(a.checkBuild).Get("/api/v1/coverage", a.coverage)
	}
	if cfg.POIDir != "" {
		r.With(a.checkBuild).Get(poiTilesPath+"{x}/{y}", a.poiTile)
	}
	r.NotFound(staticFiles(cfg.WebRoot).ServeHTTP)
	return r
}

type app struct {
	cfg     Config
	buildID string
}

// contentSecurityPolicy is the Content-Security-Policy of every answer. The only third party is the Géoplateforme, for the map: its
// tiles, style, sprite and fonts. It is a header, not a <meta> tag: the tag ignores frame-ancestors, and would break
// the Vite dev server (inline preamble, HMR). Any new external host must be added here, and approved by the owner.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self'; " +
	"img-src 'self' data: blob: https://data.geopf.fr; " +
	"connect-src 'self' https://data.geopf.fr; " +
	"worker-src 'self'; " +
	"font-src 'self'; " +
	"object-src 'none'; " +
	"base-uri 'none'; " +
	"form-action 'self'; " +
	"frame-ancestors 'none'"

// securityHeaders sends the hardening headers with every answer. Only geolocation is left to the page (the
// "My location" button); the camera and microphone are never used.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
		next.ServeHTTP(w, r)
	})
}

// checkBuild answers 426 to a tab left open across a deploy, which sends the ID of the previous build.
func (a *app) checkBuild(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := r.Header.Get("X-Build-Id"); a.buildID != "" && id != "" && id != a.buildID {
			refuse(w, http.StatusUpgradeRequired, contract.CodeStaleBuild)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// readBody reads the request body, whole, and refuses what is not JSON. The handler then reads it from memory.
func readBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<16))
		// Never the error's message: a JSON syntax error quotes the body, which holds the start point.
		if err != nil || !json.Valid(body) {
			refuse(w, http.StatusBadRequest, contract.CodeInvalidJSON)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		next.ServeHTTP(w, r)
	})
}

// forwardedFor takes the client's address from X-Forwarded-For when the connection comes from one of the
// trusted proxies: skipping those from the right, the first other address is the client. From any other
// connection the header can be forged, so the connection's address stays. Without the header it stays too.
func forwardedFor(trusted []netip.Prefix) func(http.Handler) http.Handler {
	prefixes := make([]string, len(trusted))
	for i, p := range trusted {
		prefixes[i] = p.String()
	}
	fromHeader := middleware.ClientIPFromXFF(prefixes...)
	return func(next http.Handler) http.Handler {
		viaProxy := fromHeader(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if addr, err := netip.ParseAddr(middleware.GetClientIP(r.Context())); err == nil && inRanges(trusted, addr) {
				viaProxy.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func inRanges(ranges []netip.Prefix, addr netip.Addr) bool {
	addr = addr.Unmap()
	for _, p := range ranges {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

func (a *app) routeSets(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body) // already read, and checked, by readBody
	if err != nil {
		refuse(w, http.StatusBadRequest, contract.CodeInvalidJSON)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), a.cfg.GenerationTimeout)
	defer cancel()
	routes, err := a.cfg.Generator.Generate(ctx, body)
	var criteria *contract.CriteriaError
	switch {
	case errors.As(err, &criteria):
		writeJSON(w, http.StatusBadRequest, refusal{Error: contract.CodeInvalidCriteria, Field: criteria.Field})
	case errors.Is(err, context.DeadlineExceeded):
		refuse(w, http.StatusGatewayTimeout, contract.CodeGenerationTimeout)
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

// coverage answers the cells where the graph served has a way. Nothing in it is about the user.
func (a *app) coverage(w http.ResponseWriter, _ *http.Request) {
	cells := a.cfg.Coverage.Coverage()
	if cells == nil {
		cells = [][4]float64{}
	}
	w.Header().Set("Cache-Control", "no-cache") // the data can be reloaded: ask again, the answer is small
	writeJSON(w, http.StatusOK, contract.Coverage{Cells: cells})
}

// readBuildID returns the ID written by each web app build, or none when the web app is not built.
func readBuildID(webRoot string) string {
	data, err := os.ReadFile(filepath.Join(webRoot, "build-id"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// poiTilesPath is where tiles are served. A tile request says which ~27 km of the map the user looks at, so it is
// the one request kept out of the development log.
const poiTilesPath = "/api/v1/poi-tiles/"

func skipPOITiles(logger func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		logged := logger(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, poiTilesPath) {
				next.ServeHTTP(w, r)
				return
			}
			logged.ServeHTTP(w, r)
		})
	}
}

// poiTile answers GET /api/v1/poi-tiles/{x}/{y}. The file is named from the two numbers parsed, never from the
// path of the request.
func (a *app) poiTile(w http.ResponseWriter, r *http.Request) {
	x, okX := tileIndex(chi.URLParam(r, "x"))
	y, okY := tileIndex(chi.URLParam(r, "y"))
	if !okX || !okY {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=86400") // the tiles change with a monthly rebuild
	f, err := os.Open(filepath.Join(a.cfg.POIDir, strconv.Itoa(x), strconv.Itoa(y)+".json"))
	if err != nil {
		_, _ = io.WriteString(w, `{"pois":[]}`+"\n")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		_, _ = io.WriteString(w, `{"pois":[]}`+"\n")
		return
	}
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// tileIndex reads a column or row of the grid in its canonical form: digits only, no sign and no leading zero.
func tileIndex(s string) (int, bool) {
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 || n >= 1<<contract.POITileZoom() || strconv.Itoa(n) != s {
		return 0, false
	}
	return n, true
}
