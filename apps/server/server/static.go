package server

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Vite fingerprints the files it emits under /assets, so they never change.
const immutable = "public, max-age=31536000, immutable"

// staticFiles serves the built web app: fingerprinted assets for good, everything else revalidated.
// It serves files under the root, but no directory listing and no symlink leaving the root.
func staticFiles(root string) http.Handler {
	// FileServer must serve from the same root the checks validate, or a swapped root link would let it
	// open what the checks never saw.
	rootPath := absoluteRoot(root)
	files := http.FileServer(http.Dir(rootPath))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}
		if !servable(rootPath, r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		cache := "no-cache"
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			cache = immutable
		}
		files.ServeHTTP(&cacheWriter{ResponseWriter: w, cache: cache}, r)
	})
}

// absoluteRoot resolves the configured web root once, so a root that is itself a symlink still counts
// as the boundary. A root that cannot be resolved yet stays absolute but unresolved: a missing web app
// answers 404, and a file reached through an unresolved symlink is refused rather than exposed.
func absoluteRoot(root string) string {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return filepath.Clean(root)
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		return resolved
	}
	return absolute
}

// servable keeps http.FileServer from listing a directory or following a symlink out of the web root.
func servable(root, urlPath string) bool {
	target := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(path.Clean("/"+urlPath), "/")))
	info, err := os.Stat(target)
	if err != nil {
		return true // leave a target that cannot be stat'ed to FileServer's own answer
	}
	if info.IsDir() {
		if path.Clean("/"+urlPath) != "/" {
			return false
		}
		index := filepath.Join(target, "index.html")
		indexInfo, err := os.Stat(index)
		return err == nil && indexInfo.Mode().IsRegular() && insideRoot(root, index)
	}
	return insideRoot(root, target)
}

// insideRoot reports whether target, with every symlink resolved, is still under root.
func insideRoot(root, target string) bool {
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

// cacheWriter sets Cache-Control on successful answers only.
type cacheWriter struct {
	http.ResponseWriter
	cache string
}

func (w *cacheWriter) WriteHeader(status int) {
	if status >= 200 && status < 300 {
		w.Header().Set("Cache-Control", w.cache)
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *cacheWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
