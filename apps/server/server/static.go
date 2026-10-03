package server

import (
	"net/http"
	"strings"
)

// Vite fingerprints the files it emits under /assets, so they never change.
const immutable = "public, max-age=31536000, immutable"

// staticFiles serves the built web app: fingerprinted assets for good, everything else revalidated.
func staticFiles(root string) http.Handler {
	files := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
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
