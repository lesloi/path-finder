package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"sync/atomic"

	"github.com/lesloi/path-finder/apps/server/contract"
)

// coverageCache keeps the answer of GET /api/v1/coverage for the cells it was built from. The cells
// are compared on every request, which is cheap, and the JSON and its validator are only built when
// they change: a reload that leaves the coverage alone keeps both. A source must return its cells
// read-only: a change made in place would go unseen.
type coverageCache struct {
	answer atomic.Pointer[coverageAnswer]
}

type coverageAnswer struct {
	cells [][4]float64
	body  []byte
	etag  string
}

func (c *coverageCache) get(cells [][4]float64) *coverageAnswer {
	if cells == nil {
		cells = [][4]float64{} // an empty coverage is a list, never null
	}
	if a := c.answer.Load(); a != nil && slices.Equal(a.cells, cells) {
		return a
	}
	body, err := json.Marshal(contract.Coverage{Cells: cells})
	if err != nil {
		panic("server: encoding coverage: " + err.Error()) // cells are numbers: it cannot fail
	}
	body = append(body, '\n')
	sum := sha256.Sum256(body)
	// The same cells always give the same JSON, so the validator survives a restart. Concurrent
	// first requests may each build an answer; either is the same.
	a := &coverageAnswer{
		cells: slices.Clone(cells),
		body:  body,
		etag:  `"` + hex.EncodeToString(sum[:]) + `"`,
	}
	c.answer.Store(a)
	return a
}

// etagMatches reports whether an If-None-Match header accepts etag. The comparison is weak, as
// RFC 7232 asks, and * matches the answer of a resource that exists.
func etagMatches(header, etag string) bool {
	if header == "" {
		return false
	}
	weak := func(tag string) string { return strings.TrimPrefix(tag, "W/") }
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "*" || weak(candidate) == weak(etag) {
			return true
		}
	}
	return false
}

// serve writes the cached answer, or a 304 when the client's validator matches it.
func (a *coverageAnswer) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("ETag", a.etag)
	if etagMatches(r.Header.Get("If-None-Match"), a.etag) {
		w.WriteHeader(http.StatusNotModified) // no body, no Content-Type
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(a.body)
}
