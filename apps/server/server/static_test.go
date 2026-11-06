package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeStaticFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestStaticFilesServeTheWebAppAndRefuseDirectories(t *testing.T) {
	// Arrange
	root := t.TempDir()
	writeStaticFile(t, root, "index.html", "<html>app</html>")
	writeStaticFile(t, root, "build-id", "build-2\n")
	writeStaticFile(t, root, "assets/app-abc123.js", "console.log(1)")
	h := staticFiles(root)

	for name, tc := range map[string]struct {
		path     string
		status   int
		body     string
		cache    string
		location string
	}{
		"a directory with a trailing slash":    {path: "/assets/", status: http.StatusNotFound},
		"a directory without a trailing slash": {path: "/assets", status: http.StatusNotFound},
		"the index":                            {path: "/", status: http.StatusOK, body: "app", cache: "no-cache"},
		"the build id":                         {path: "/build-id", status: http.StatusOK, body: "build-2", cache: "no-cache"},
		"a fingerprinted asset":                {path: "/assets/app-abc123.js", status: http.StatusOK, body: "console.log", cache: immutable},
		"the index redirect":                   {path: "/index.html", status: http.StatusMovedPermanently, location: "./"},
	} {
		t.Run(name, func(t *testing.T) {
			// Act
			r := do(h, http.MethodGet, tc.path, "", "", nil)
			// Assert
			if r.Code != tc.status {
				t.Fatalf("status = %d, want %d (body %q)", r.Code, tc.status, r.Body.String())
			}
			if tc.body != "" && !strings.Contains(r.Body.String(), tc.body) {
				t.Errorf("body = %q, want it to contain %q", r.Body.String(), tc.body)
			}
			if got := r.Header().Get("Cache-Control"); got != tc.cache {
				t.Errorf("Cache-Control = %q, want %q", got, tc.cache)
			}
			if got := r.Header().Get("Location"); got != tc.location {
				t.Errorf("Location = %q, want %q", got, tc.location)
			}
		})
	}
}

func TestStaticFilesRefuseSymlinksEscapingTheRoot(t *testing.T) {
	// Arrange
	root := t.TempDir()
	writeStaticFile(t, root, "real.txt", "inside")
	outside := t.TempDir()
	writeStaticFile(t, outside, "secret.txt", "outside")
	writeStaticFile(t, outside, "nested/secret.txt", "outside")
	link := func(oldname, newname string) {
		t.Helper()
		if err := os.Symlink(oldname, filepath.Join(root, newname)); err != nil {
			t.Fatal(err)
		}
	}
	link(filepath.Join(outside, "secret.txt"), "escape.txt")
	link(filepath.Join(outside, "nested"), "escape-dir")
	link(filepath.Join(root, "real.txt"), "inside.txt")
	h := staticFiles(root)

	for name, tc := range map[string]struct {
		path   string
		status int
		body   string
	}{
		"a file symlink escaping the root":     {path: "/escape.txt", status: http.StatusNotFound},
		"a file behind a directory symlink":    {path: "/escape-dir/secret.txt", status: http.StatusNotFound},
		"a symlink that stays inside the root": {path: "/inside.txt", status: http.StatusOK, body: "inside"},
	} {
		t.Run(name, func(t *testing.T) {
			// Act
			r := do(h, http.MethodGet, tc.path, "", "", nil)
			// Assert
			if r.Code != tc.status {
				t.Fatalf("status = %d, want %d (body %q)", r.Code, tc.status, r.Body.String())
			}
			if tc.body != "" && !strings.Contains(r.Body.String(), tc.body) {
				t.Errorf("body = %q, want it to contain %q", r.Body.String(), tc.body)
			}
		})
	}
}

func TestStaticFilesCheckTheRootTheyServe(t *testing.T) {
	// Arrange: a deployment that swaps the link of the root, as `mv -T` does.
	parent := t.TempDir()
	first := filepath.Join(parent, "build-1")
	if err := os.Mkdir(first, 0o755); err != nil {
		t.Fatal(err)
	}
	writeStaticFile(t, first, "index.html", "<html>app</html>")
	current := filepath.Join(parent, "current")
	if err := os.Symlink(first, current); err != nil {
		t.Fatal(err)
	}
	h := staticFiles(current)

	second := filepath.Join(parent, "build-2")
	if err := os.Mkdir(second, 0o755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	writeStaticFile(t, outside, "secret.txt", "outside")
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(second, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	replacement := filepath.Join(parent, "current-new")
	if err := os.Symlink(second, replacement); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, current); err != nil {
		t.Fatal(err)
	}

	// Act
	r := do(h, http.MethodGet, "/escape.txt", "", "", nil)

	// Assert
	if r.Code != http.StatusNotFound {
		t.Errorf("a symlink of the swapped root: status = %d, want 404 (body %q)", r.Code, r.Body.String())
	}
}

func TestStaticFilesNeverListADirectory(t *testing.T) {
	// Arrange: no index.html, so the root would be listed.
	root := t.TempDir()
	writeStaticFile(t, root, "assets/app-abc123.js", "console.log(1)")
	h := staticFiles(root)

	for name, path := range map[string]string{
		"the root without an index":            "/",
		"a directory with a trailing slash":    "/assets/",
		"a directory without a trailing slash": "/assets",
	} {
		t.Run(name, func(t *testing.T) {
			// Act
			r := do(h, http.MethodGet, path, "", "", nil)
			// Assert
			if r.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404 (body %q)", r.Code, r.Body.String())
			}
		})
	}
}

func TestStaticFilesAnswerNotFoundWithoutAWebRoot(t *testing.T) {
	// Arrange: a root that is not there, as before the web app is deployed.
	h := staticFiles(filepath.Join(t.TempDir(), "missing"))

	// Act
	r := do(h, http.MethodGet, "/", "", "", nil)

	// Assert
	if r.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (body %q)", r.Code, r.Body.String())
	}
}
