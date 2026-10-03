package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// generatorFunc adapts a function to a RouteSetGenerator.
type generatorFunc func(ctx context.Context, body json.RawMessage) (any, error)

func (f generatorFunc) Generate(ctx context.Context, body json.RawMessage) (any, error) {
	return f(ctx, body)
}

func okGenerator(context.Context, json.RawMessage) (any, error) { return []string{"route"}, nil }

func webRoot(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	write := func(name, content string) {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", "<html>app</html>")
	write("build-id", "build-2\n")
	write("assets/app-abc123.js", "console.log(1)")
	return dir
}

func newServer(t *testing.T, mutate func(*Config)) http.Handler {
	t.Helper()
	cfg := Config{WebRoot: webRoot(t), Generator: generatorFunc(okGenerator), Elevation: true}
	if mutate != nil {
		mutate(&cfg)
	}
	return New(cfg)
}

type reply struct {
	*httptest.ResponseRecorder
}

func (r reply) errorCode(t *testing.T) string {
	t.Helper()
	var body refusal
	if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not a JSON refusal: %v", r.Body.String(), err)
	}
	return body.Error
}

func do(h http.Handler, method, path, body, remote string, headers map[string]string) reply {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if remote != "" {
		req.RemoteAddr = remote
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return reply{rec}
}

func post(h http.Handler, body string) reply {
	return do(h, http.MethodPost, "/api/v1/route-sets", body, "", nil)
}

func TestEveryAnswerSendsNoReferrer(t *testing.T) {
	h := newServer(t, nil)
	for _, path := range []string{"/", "/healthz", "/api/v1/capabilities", "/missing"} {
		if got := do(h, http.MethodGet, path, "", "", nil).Header().Get("Referrer-Policy"); got != "no-referrer" {
			t.Errorf("%s: Referrer-Policy = %q", path, got)
		}
	}
}

func TestCapabilities(t *testing.T) {
	for _, elevation := range []bool{true, false} {
		h := newServer(t, func(c *Config) { c.Elevation = elevation })
		r := do(h, http.MethodGet, "/api/v1/capabilities", "", "", nil)
		want := `{"elevation":` + map[bool]string{true: "true", false: "false"}[elevation] + `}`
		if got := strings.TrimSpace(r.Body.String()); got != want {
			t.Errorf("capabilities = %s, want %s", got, want)
		}
	}
}

func TestRouteSetsAnswerTheRoutes(t *testing.T) {
	r := post(newServer(t, nil), `{"start":[2,48]}`)
	if r.Code != http.StatusOK || strings.TrimSpace(r.Body.String()) != `{"routes":["route"]}` {
		t.Errorf("got %d %s", r.Code, r.Body.String())
	}
}

func TestRouteSetsRefusals(t *testing.T) {
	failing := func(err error) func(*Config) {
		return func(c *Config) {
			c.Generator = generatorFunc(func(context.Context, json.RawMessage) (any, error) { return nil, err })
		}
	}
	t.Run("invalid JSON never echoes the body", func(t *testing.T) {
		r := post(newServer(t, nil), `{"start":[2.35,48.85`)
		if r.Code != 400 || r.errorCode(t) != "invalid-json" || strings.Contains(r.Body.String(), "2.35") {
			t.Errorf("got %d %s", r.Code, r.Body.String())
		}
	})
	t.Run("invalid criteria names the field", func(t *testing.T) {
		r := post(newServer(t, failing(&CriteriaError{Field: "pace"})), `{}`)
		if r.Code != 400 || strings.TrimSpace(r.Body.String()) != `{"error":"invalid-criteria","field":"pace"}` {
			t.Errorf("got %d %s", r.Code, r.Body.String())
		}
	})
	t.Run("a bug is a 500 without its message", func(t *testing.T) {
		r := post(newServer(t, failing(os.ErrPermission)), `{}`)
		if r.Code != 500 || r.Body.Len() != 0 {
			t.Errorf("got %d %q", r.Code, r.Body.String())
		}
	})
	t.Run("a slow generation is a 504", func(t *testing.T) {
		h := newServer(t, func(c *Config) {
			c.GenerationTimeout = 20 * time.Millisecond
			c.Generator = generatorFunc(func(ctx context.Context, _ json.RawMessage) (any, error) {
				<-ctx.Done()
				return nil, ctx.Err()
			})
		})
		if r := post(h, `{}`); r.Code != 504 || r.errorCode(t) != "generation-timeout" {
			t.Errorf("got %d %s", r.Code, r.Body.String())
		}
	})
}

func TestStaleBuildMustReload(t *testing.T) {
	h := newServer(t, nil)
	stale := do(h, http.MethodPost, "/api/v1/route-sets", `{}`, "", map[string]string{"X-Build-Id": "build-1"})
	if stale.Code != 426 || stale.errorCode(t) != "stale-build" {
		t.Errorf("stale build: got %d %s", stale.Code, stale.Body.String())
	}
	for name, headers := range map[string]map[string]string{"current": {"X-Build-Id": "build-2"}, "none": nil} {
		if r := do(h, http.MethodPost, "/api/v1/route-sets", `{}`, "", headers); r.Code != 200 {
			t.Errorf("%s build: got %d", name, r.Code)
		}
	}
}

func TestRateLimitCountsPerAddress(t *testing.T) {
	h := newServer(t, func(c *Config) { c.Limits = true })
	from := func(remote string) reply { return do(h, http.MethodPost, "/api/v1/route-sets", `{}`, remote, nil) }
	for i := 0; i < 60; i++ {
		if r := from("198.51.100.1:1000"); r.Code != 200 {
			t.Fatalf("request %d: got %d", i+1, r.Code)
		}
	}
	r := from("198.51.100.1:1000")
	if r.Code != 429 || r.errorCode(t) != "rate-limited" || r.Header().Get("Retry-After") == "" {
		t.Errorf("61st request: got %d %s, Retry-After %q", r.Code, r.Body.String(), r.Header().Get("Retry-After"))
	}
	if r := from("198.51.100.2:1000"); r.Code != 200 {
		t.Errorf("another address: got %d", r.Code)
	}
}

func TestRateLimitIsForgottenWhenTheWindowEnds(t *testing.T) {
	l := newRateLimiter(1, time.Hour)
	if _, ok := l.admit("a"); !ok {
		t.Fatal("first request refused")
	}
	if retry, ok := l.admit("a"); ok || retry < 1 {
		t.Errorf("second request: admitted %v, retry after %d", ok, retry)
	}
	l.rotate()
	if _, ok := l.admit("a"); !ok {
		t.Error("request refused after the window ended")
	}
}

func TestRateKeyCountsAnIPv6HostAsOne(t *testing.T) {
	if rateKey("2001:db8:1:2:aaaa::1") != rateKey("2001:db8:1:2:bbbb::2") {
		t.Error("two addresses of one /64 count apart")
	}
	if rateKey("2001:db8:1:3::1") == rateKey("2001:db8:1:2::1") {
		t.Error("two /64 count together")
	}
	if rateKey("::ffff:198.51.100.1") != "198.51.100.1" {
		t.Errorf("mapped IPv4 key = %s", rateKey("::ffff:198.51.100.1"))
	}
}

func TestConcurrentGenerationsAreCappedNotQueued(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	h := newServer(t, func(c *Config) {
		c.Limits = true
		c.Generator = generatorFunc(func(context.Context, json.RawMessage) (any, error) {
			started <- struct{}{}
			<-release
			return []string{}, nil
		})
	})
	first := make(chan reply)
	go func() { first <- post(h, `{}`) }()
	<-started

	r := post(h, `{}`)
	if r.Code != 429 || r.errorCode(t) != "overloaded" || r.Header().Get("Retry-After") != "5" {
		t.Errorf("second request: got %d %s, Retry-After %q", r.Code, r.Body.String(), r.Header().Get("Retry-After"))
	}
	if got := r.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q", got)
	}
	close(release)
	if r := <-first; r.Code != 200 {
		t.Errorf("running request: got %d", r.Code)
	}
}

func TestHealthzAnswersEveryone(t *testing.T) {
	h := newServer(t, func(c *Config) { c.Limits = true })
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		if r := do(h, method, "/healthz", "", "203.0.113.9:1", nil); r.Code != 200 {
			t.Errorf("%s /healthz: got %d", method, r.Code)
		}
	}
	if r := do(h, http.MethodGet, "/healthz", "", "", nil); r.Body.String() != "." {
		t.Errorf("body = %q", r.Body.String())
	}
}

func TestClientAddressIsTheConnectionUnlessAProxyIsTrusted(t *testing.T) {
	proxies, _ := ParseAddressRanges("10.0.0.0/8", "TRUSTED_PROXIES")
	// The address the server takes the client for, as a generation sees it.
	clientSeenBy := func(trusted []netip.Prefix) func(remote, forwarded string) string {
		var seen string
		h := newServer(t, func(c *Config) {
			c.TrustedProxies = trusted
			c.Generator = generatorFunc(func(ctx context.Context, _ json.RawMessage) (any, error) {
				seen = middleware.GetClientIP(ctx)
				return nil, nil
			})
		})
		return func(remote, forwarded string) string {
			headers := map[string]string{}
			if forwarded != "" {
				headers["X-Forwarded-For"] = forwarded
			}
			do(h, http.MethodPost, "/api/v1/route-sets", `{}`, remote, headers)
			return seen
		}
	}

	t.Run("without trusted proxies the header is ignored", func(t *testing.T) {
		client := clientSeenBy(nil)
		if got := client("10.1.2.3:1", "192.0.2.5"); got != "10.1.2.3" {
			t.Errorf("client = %s, want the connection's 10.1.2.3", got)
		}
	})
	t.Run("a trusted proxy names the client", func(t *testing.T) {
		client := clientSeenBy(proxies)
		for forwarded, want := range map[string]string{
			"192.0.2.5":               "192.0.2.5",
			"192.0.2.5, 10.9.9.9":     "192.0.2.5", // two proxies
			"198.51.100.1, 192.0.2.5": "192.0.2.5", // an entry forged by the client comes first
			"192.0.2.5, 198.51.100.1": "198.51.100.1",
			"not-an-address":          "10.1.2.3", // fails closed, the connection stays
		} {
			if got := client("10.1.2.3:1", forwarded); got != want {
				t.Errorf("X-Forwarded-For %q: client = %s, want %s", forwarded, got, want)
			}
		}
	})
	t.Run("a trusted proxy without the header stays the client", func(t *testing.T) {
		if got := clientSeenBy(proxies)("10.1.2.3:1", ""); got != "10.1.2.3" {
			t.Errorf("client = %s", got)
		}
	})
}

func TestDevelopmentLogShowsRequestsAndFailures(t *testing.T) {
	var out strings.Builder
	h := newServer(t, func(c *Config) {
		c.Log = log.New(&out, "", 0)
		c.Generator = generatorFunc(func(context.Context, json.RawMessage) (any, error) { return nil, errors.New("graph is corrupt") })
	})
	post(h, `{}`)
	do(h, http.MethodGet, "/api/v1/capabilities?x=1", "", "", nil)

	for _, want := range []string{"POST http://example.com/api/v1/route-sets", "500", "route-sets: generation failed: graph is corrupt", "capabilities?x=1"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("log lacks %q:\n%s", want, out.String())
		}
	}
}

func TestNoLogByDefault(t *testing.T) {
	var out strings.Builder
	log.SetOutput(&out)
	defer log.SetOutput(os.Stderr)
	h := newServer(t, func(c *Config) {
		c.Generator = generatorFunc(func(context.Context, json.RawMessage) (any, error) { return nil, errors.New("boom") })
	})
	post(h, `{}`)
	if out.Len() != 0 {
		t.Errorf("production wrote a log: %s", out.String())
	}
}

func TestParseAddressRanges(t *testing.T) {
	ranges, err := ParseAddressRanges(" 10.0.0.0/8, 2001:db8::/32 ,198.51.100.1,", "X")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"10.0.0.0/8", "2001:db8::/32", "198.51.100.1/32"}
	if len(ranges) != len(want) {
		t.Fatalf("ranges = %v", ranges)
	}
	for i, r := range ranges {
		if r.String() != want[i] {
			t.Errorf("range %d = %s, want %s", i, r, want[i])
		}
	}
	for _, bad := range []string{"10.0.0.0/33", "not-an-ip", "10.0.0.0/8/1"} {
		if _, err := ParseAddressRanges(bad, "TRUSTED_PROXIES"); err == nil || !strings.Contains(err.Error(), "TRUSTED_PROXIES") {
			t.Errorf("%q: err = %v", bad, err)
		}
	}
}

func TestStaticFilesAreCachedByKind(t *testing.T) {
	h := newServer(t, nil)
	for path, want := range map[string]string{
		"/":                     "no-cache",
		"/assets/app-abc123.js": immutable,
		"/build-id":             "no-cache",
		"/assets/missing.js":    "",
	} {
		r := do(h, http.MethodGet, path, "", "", nil)
		if got := r.Header().Get("Cache-Control"); got != want {
			t.Errorf("%s: Cache-Control = %q (status %d), want %q", path, got, r.Code, want)
		}
	}
	if r := do(h, http.MethodGet, "/", "", "", nil); !strings.Contains(r.Body.String(), "app") {
		t.Errorf("index not served: %q", r.Body.String())
	}
	if r := do(h, http.MethodGet, "/assets/missing.js", "", "", nil); r.Code != 404 {
		t.Errorf("missing file: got %d", r.Code)
	}
	if r := do(h, http.MethodPost, "/", "", "", nil); r.Code != 404 {
		t.Errorf("POST to a static path: got %d", r.Code)
	}
}
