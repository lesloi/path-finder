package server

import (
	"crypto/rand"
	"crypto/sha256"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/lesloi/path-finder/apps/server/contract"
)

// maxTrackedAddresses bounds the memory of a window; addresses beyond it share one counter.
const maxTrackedAddresses = 100_000

var overflowKey = sha256.Sum256([]byte("overflow"))

// rateLimiter counts requests per address in fixed windows. Addresses are kept only as hashes
// salted with a random salt that changes with each window, and all of them are forgotten when it
// ends, on a timer rather than on the next request so an idle server forgets them too.
type rateLimiter struct {
	limit  int
	window time.Duration

	mu          sync.Mutex
	windowStart time.Time
	salt        [16]byte
	counts      map[[sha256.Size]byte]int
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	l := &rateLimiter{limit: limit, window: window}
	l.rotate()
	time.AfterFunc(window, l.tick)
	return l
}

func (l *rateLimiter) tick() {
	l.rotate()
	time.AfterFunc(l.window, l.tick)
}

func (l *rateLimiter) rotate() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.windowStart = time.Now()
	if _, err := rand.Read(l.salt[:]); err != nil {
		panic(err)
	}
	l.counts = make(map[[sha256.Size]byte]int)
}

// admit counts a request from key, and returns the seconds to wait when it is over the limit.
func (l *rateLimiter) admit(key string) (retryAfter int, admitted bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	h := sha256.New()
	h.Write(l.salt[:])
	h.Write([]byte(key))
	var sum [sha256.Size]byte
	h.Sum(sum[:0])
	if _, known := l.counts[sum]; !known && len(l.counts) >= maxTrackedAddresses {
		// A flood of distinct addresses must not grow the table: the newcomers share one counter.
		sum = overflowKey
	}
	l.counts[sum]++
	if l.counts[sum] <= l.limit {
		return 0, true
	}
	wait := time.Until(l.windowStart.Add(l.window))
	return max(1, int((wait+time.Second-1)/time.Second)), false
}

// rateLimit refuses with 429 an address that sends too many requests.
func rateLimit(l *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if retry, ok := l.admit(rateKey(middleware.GetClientIP(r.Context()))); !ok {
				refuseLater(w, http.StatusTooManyRequests, contract.CodeRateLimited, retry)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// throttle caps the searches running at once. Beyond the cap the answer is 429, never a queue:
// a loop costs about 11 CPU-seconds, so waiting would miss the < 5 s p95 target.
func throttle(limit int) func(http.Handler) http.Handler {
	capped := middleware.ThrottleWithOpts(middleware.ThrottleOpts{
		Limit:        limit,
		StatusCode:   http.StatusTooManyRequests,
		RetryAfterFn: func(bool) time.Duration { return busyRetryAfter * time.Second },
	})
	return func(next http.Handler) http.Handler {
		inner := capped(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			inner.ServeHTTP(&overloadedWriter{ResponseWriter: w}, r)
		})
	}
}

// overloadedWriter swaps the plain-text 429 of chi's Throttle for the JSON refusal the web app reads.
type overloadedWriter struct {
	http.ResponseWriter
	refused bool
}

func (w *overloadedWriter) WriteHeader(status int) {
	if status == http.StatusTooManyRequests {
		w.refused = true
		w.Header().Set("Content-Type", "application/json")
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *overloadedWriter) Write(b []byte) (int, error) {
	if w.refused {
		if _, err := w.ResponseWriter.Write([]byte(`{"error":"` + contract.CodeOverloaded + `"}` + "\n")); err != nil {
			return 0, err
		}
		return len(b), nil
	}
	return w.ResponseWriter.Write(b)
}

func (w *overloadedWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
