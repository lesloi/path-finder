//go:build harness

package generator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lesloi/path-finder/apps/server/contract"
	"github.com/lesloi/path-finder/apps/server/engine"
)

// This harness measures how many routes a route set holds for criteria, on a real graph, so that an idea to
// find more of them is judged on the same start points and seeds before and after. It goes through
// Generator.Generate, so a match, the early stop and the waypoints are the product's own.
//
// It needs a data directory built by build-graph and build-alt, and a config file (see harnessConfig):
//
//	HARNESS_CONFIG=harness.json go test -tags harness -run TestHarness -v -timeout 0 ./generator
//
// The build tag keeps it out of `pnpm test` and of the coverage. Without HARNESS_CONFIG it is skipped.
// Waypoints must be within 250 m of a way, so the config gives them rather than the harness drawing them.

type harnessConfig struct {
	// DataDir holds the graph and the landmarks, like the server's DATA_DIR.
	DataDir string `json:"dataDir"`
	// Surface is the surface preference to search with (default "any").
	Surface string   `json:"surface"`
	Seeds   []uint64 `json:"seeds"`
	// Candidates is the search budget of a request (default: the server's).
	Candidates int `json:"candidates"`
	// Timeout is what a request is given, as a Go duration (default: the server's 15 s).
	Timeout string         `json:"timeout"`
	Pace    float64        `json:"pace"`
	Starts  []harnessStart `json:"starts"`
	Cases   []harnessCase  `json:"cases"`
}

type harnessStart struct {
	Name string  `json:"name"`
	Lon  float64 `json:"lon"`
	Lat  float64 `json:"lat"`
	// Waypoints, as longitude and latitude, are those of the cases that ask for waypoints.
	Waypoints [][2]float64 `json:"waypoints"`
}

type harnessCase struct {
	DistanceKm float64 `json:"distanceKm"`
	// Ascent is the target elevation gain in metres, 0 for none.
	Ascent float64 `json:"ascent"`
	// Waypoints runs the case from the starts' waypoints instead of without.
	Waypoints bool `json:"waypoints"`
}

func (c harnessCase) label() string {
	s := fmt.Sprintf("%g km", c.DistanceKm)
	if c.Ascent > 0 {
		s += fmt.Sprintf(", +%g m", c.Ascent)
	}
	if c.Waypoints {
		s += ", waypoints"
	}
	return s
}

// countingLooper records how many loops the search had found when it stopped.
type countingLooper struct {
	Looper
	found atomic.Int64
}

func (c *countingLooper) Loops(ctx context.Context, req engine.LoopRequest) ([]*engine.Route, error) {
	c.found.Store(0)
	enough := req.Enough
	req.Enough = func(found []*engine.Route) bool {
		c.found.Store(int64(len(found)))
		return enough != nil && enough(found)
	}
	return c.Looper.Loops(ctx, req)
}

// verbose lists the sets of fewer than three routes, to see where a measure falls short.
var verbose = os.Getenv("HARNESS_VERBOSE") != ""

type sample struct {
	elapsed         time.Duration
	found           int
	matches, routes int
}

func TestHarness(t *testing.T) {
	path := os.Getenv("HARNESS_CONFIG")
	if path == "" {
		t.Skip("HARNESS_CONFIG is not set")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var cfg harnessConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Surface == "" {
		cfg.Surface = "any"
	}
	if cfg.Pace == 0 {
		cfg.Pace = 6
	}
	timeout := 15 * time.Second
	if cfg.Timeout != "" {
		if timeout, err = time.ParseDuration(cfg.Timeout); err != nil {
			t.Fatal(err)
		}
	}
	zones, err := engine.NewReloader(cfg.DataDir, cfg.Surface)
	if err != nil {
		t.Fatal(err)
	}
	looper := &countingLooper{Looper: zones.Profile(cfg.Surface)}

	fmt.Printf("%d start(s), %d seed(s), %d candidates, timeout %s, surface %s\n",
		len(cfg.Starts), len(cfg.Seeds), cfg.Candidates, timeout, cfg.Surface)
	fmt.Printf("%-26s %8s %6s %7s %7s %7s %9s\n", "criteria", "median s", "loops", "5 match", ">=3", "empty", "matches")
	for _, c := range cfg.Cases {
		var samples []sample
		for _, st := range cfg.Starts {
			if c.Waypoints && len(st.Waypoints) == 0 {
				continue
			}
			for _, seed := range cfg.Seeds {
				samples = append(samples, run(t, cfg, looper, st, c, seed, timeout))
			}
		}
		report(c.label(), samples)
	}
}

func run(t *testing.T, cfg harnessConfig, looper *countingLooper, st harnessStart, c harnessCase, seed uint64, timeout time.Duration) sample {
	t.Helper()
	criteria := contract.Criteria{
		Start: [2]float64{st.Lon, st.Lat}, Target: contract.Target{Distance: c.DistanceKm},
		Surface: cfg.Surface, Pace: cfg.Pace,
	}
	if c.Ascent > 0 {
		criteria.ElevationGain = &contract.ElevationGain{Metres: c.Ascent}
	}
	if c.Waypoints {
		criteria.Waypoints = st.Waypoints
	}
	body, err := json.Marshal(criteria)
	if err != nil {
		t.Fatal(err)
	}
	g := &Generator{
		Engines: map[string]Looper{cfg.Surface: looper}, Candidates: cfg.Candidates,
		Seed: func() uint64 { return seed },
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	began := time.Now()
	out, err := g.Generate(ctx, body)
	s := sample{elapsed: time.Since(began), found: int(looper.found.Load())}
	if err != nil {
		var invalid *contract.CriteriaError
		if errors.As(err, &invalid) {
			t.Fatalf("%s at %s: %v", c.label(), st.Name, err)
		}
		// Time ran out with no route at all: it counts as an empty set.
		if verbose {
			fmt.Printf("  %s, %s, seed %d: error %v after %s\n", c.label(), st.Name, seed, err, s.elapsed.Round(time.Millisecond))
		}
		return s
	}
	routes := out.([]contract.Route)
	s.routes = len(routes)
	if len(routes) < minRoutes && verbose {
		fmt.Printf("  %s, %s, seed %d: %d route(s) after %s, %d loops found\n", c.label(), st.Name, seed, len(routes), s.elapsed.Round(time.Millisecond), s.found)
	}
	for _, r := range routes {
		if r.Kind == "match" {
			s.matches++
		}
	}
	return s
}

func report(label string, samples []sample) {
	if len(samples) == 0 {
		fmt.Printf("%-26s no sample\n", label)
		return
	}
	var times []float64
	var founds []int
	var full, atLeast3, empty, matches int
	for _, s := range samples {
		times = append(times, s.elapsed.Seconds())
		founds = append(founds, s.found)
		matches += s.matches
		if s.matches >= maxRoutes {
			full++
		}
		if s.routes >= minRoutes {
			atLeast3++
		}
		if s.routes == 0 {
			empty++
		}
	}
	n := float64(len(samples))
	slices.Sort(times)
	slices.Sort(founds)
	fmt.Printf("%-26s %8.2f %6d %6.0f%% %6.0f%% %6.0f%% %9.2f\n", label, times[len(times)/2], founds[len(founds)/2],
		100*float64(full)/n, 100*float64(atLeast3)/n, 100*float64(empty)/n, float64(matches)/n)
}
