// Package integration tests the server as a whole: HTTP, criteria, route sets and the real engine,
// on the stand-in graph around Annecy.
package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lesloi/path-finder/apps/server/contract"
	"github.com/lesloi/path-finder/apps/server/engine"
	"github.com/lesloi/path-finder/apps/server/generator"
	"github.com/lesloi/path-finder/apps/server/internal/standin"
	"github.com/lesloi/path-finder/apps/server/server"
)

func newServer(t *testing.T) http.Handler {
	t.Helper()
	dir := t.TempDir()
	if _, err := standin.Write(dir); err != nil {
		t.Fatal(err)
	}
	return serverOn(t, dir)
}

func serverOn(t *testing.T, dir string) http.Handler {
	t.Helper()
	zones, err := engine.OpenZones(dir, "hike", "run")
	if err != nil {
		t.Fatal(err)
	}
	web := t.TempDir()
	if err := os.WriteFile(filepath.Join(web, "build-id"), []byte("build-1"), 0o644); err != nil {
		t.Fatal(err)
	}
	return server.New(server.Config{
		WebRoot:   web,
		Generator: &generator.Generator{Engines: map[string]generator.Looper{"hike": zones.Activity("hike"), "run": zones.Activity("run")}},
	})
}

func routeSets(t *testing.T, h http.Handler, body string) (int, []contract.Route, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/route-sets", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var answer struct {
		Routes []contract.Route `json:"routes"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &answer)
	return rec.Code, answer.Routes, rec.Body.String()
}

func criteria(activity, target, rest string) string {
	return `{"start":[6.1294,45.8992],"activity":"` + activity + `","target":` + target + `,"surface":"any","pace":6` + rest + `}`
}

func TestRouteSetOfTheDefaultCriteria(t *testing.T) {
	h := newServer(t)
	start := time.Now()
	code, routes, body := routeSets(t, h, criteria("run", `{"distance":10}`, ""))
	t.Logf("route set in %v", time.Since(start))

	if code != 200 {
		t.Fatalf("status %d: %s", code, body)
	}
	if len(routes) < 3 {
		t.Fatalf("%d routes, the web app lists at least three: %s", len(routes), body[:min(len(body), 300)])
	}
	var unpaved, paved bool
	for i, r := range routes {
		if r.Distance < 7.5 || r.Distance > 12.5 {
			t.Errorf("route %d is %.1f km for a 10 km target", i, r.Distance)
		}
		if r.ElevationGain == nil || r.ElevationLoss == nil {
			t.Errorf("route %d has no elevation gain or loss", i)
		}
		first, last := r.Geometry[0], r.Geometry[len(r.Geometry)-1]
		if len(first) != 3 || first[0] != last[0] || first[1] != last[1] {
			t.Errorf("route %d: first %v, last %v: a loop with heights on every point", i, first, last)
		}
		var sum float64
		for _, s := range r.Surfaces {
			sum += s.Share
			paved, unpaved = paved || s.Surface == "paved", unpaved || s.Surface == "unpaved"
		}
		if sum < 0.999 || sum > 1.001 {
			t.Errorf("route %d: surface shares add up to %v", i, sum)
		}
	}
	if !paved || !unpaved {
		t.Errorf("the stand-in graph has both surfaces: paved %v, unpaved %v", paved, unpaved)
	}
}

func TestRouteSetsForBothActivitiesAndTargets(t *testing.T) {
	h := newServer(t)
	for name, body := range map[string]string{
		"a hike":                  criteria("hike", `{"distance":8}`, ""),
		"a target duration":       criteria("run", `{"duration":60}`, ""),
		"a target elevation gain": criteria("run", `{"distance":10}`, `,"elevationGain":200`),
		"the hilly shortcut":      criteria("run", `{"distance":10}`, `,"elevationGain":"hilly"`),
	} {
		t.Run(name, func(t *testing.T) {
			code, routes, out := routeSets(t, h, body)
			if code != 200 || len(routes) == 0 {
				t.Errorf("status %d, %d routes: %s", code, len(routes), out[:min(len(out), 200)])
			}
		})
	}
}

func TestAStartFarFromAnyWayHasNoRoutes(t *testing.T) {
	h := newServer(t)
	body := strings.Replace(criteria("run", `{"distance":10}`, ""), "[6.1294,45.8992]", "[2.35,48.85]", 1)
	code, routes, out := routeSets(t, h, body)
	if code != 200 || routes == nil || len(routes) != 0 {
		t.Errorf("status %d, routes %v: %s", code, routes, out)
	}
}

func TestRefusals(t *testing.T) {
	h := newServer(t)
	if code, _, out := routeSets(t, h, `{"start":[6.1294,45.8992],"activity":"ride"}`); code != 400 || !strings.Contains(out, `"field":"activity"`) {
		t.Errorf("unknown activity: %d %s", code, out)
	}
	if code, _, out := routeSets(t, h, `{"start":`); code != 400 || !strings.Contains(out, "invalid-json") {
		t.Errorf("broken JSON: %d %s", code, out)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/route-sets", strings.NewReader(criteria("run", `{"distance":10}`, "")))
	req.Header.Set("X-Build-Id", "build-0")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 426 {
		t.Errorf("stale build: %d", rec.Code)
	}
}

func TestHealth(t *testing.T) {
	h := newServer(t)
	for path, want := range map[string]string{"/healthz": "."} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != want {
			t.Errorf("%s: %d %q", path, rec.Code, rec.Body.String())
		}
	}
}

// A pod mounts the data volume read-only: it must start and answer from it.
func TestServesFromAReadOnlyDataDirectory(t *testing.T) {
	dir := t.TempDir()
	if _, err := standin.Write(dir); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*"))
	for _, f := range files {
		if err := os.Chmod(f, 0o444); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	if f, err := os.OpenFile(filepath.Join(dir, "probe"), os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
		f.Close()
		t.Skip("the directory is writable anyway (running as root?)")
	}

	code, routes, body := routeSets(t, serverOn(t, dir), criteria("run", `{"distance":10}`, ""))
	if code != 200 || len(routes) == 0 {
		t.Errorf("status %d, %d routes: %s", code, len(routes), body[:min(len(body), 200)])
	}
	if now, _ := filepath.Glob(filepath.Join(dir, "*")); len(now) != len(files) {
		t.Errorf("serving wrote into the data directory: %v", now)
	}
}

// A data directory can hold one subdirectory per zone, each with its graph and landmarks.
func TestServesFromADirectoryOfZones(t *testing.T) {
	dir := t.TempDir()
	for _, zone := range []string{"zone-a", "zone-b"} {
		if err := os.MkdirAll(filepath.Join(dir, zone), 0o755); err != nil {
			t.Fatal(err)
		}
		if _, err := standin.Write(filepath.Join(dir, zone)); err != nil {
			t.Fatal(err)
		}
	}
	code, routes, body := routeSets(t, serverOn(t, dir), criteria("run", `{"distance":10}`, ""))
	if code != 200 || len(routes) == 0 {
		t.Errorf("status %d, %d routes: %s", code, len(routes), body[:min(len(body), 200)])
	}
}
