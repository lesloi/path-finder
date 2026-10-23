package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

// ReadTimeout is how long a request may take to arrive: its body is a few hundred bytes, so a slow one is cut.
const ReadTimeout = 15 * time.Second

// defaultGenerationTimeout is the budget New gives a generation that has none.
const defaultGenerationTimeout = 15 * time.Second

// writeMargin is what the answer gets after the read and the generation: its writing, and the 504 of a generation that ran out.
const writeMargin = 10 * time.Second

// WriteTimeout is the deadline for answering, which net/http counts from the end of the request headers: it spans
// the body, the generation and the answer. It must outlast the generation (given as the GENERATION_TIMEOUT, or 0 for
// its default), or a slow generation would lose its connection instead of answering 504.
func WriteTimeout(generation time.Duration) time.Duration {
	if generation <= 0 {
		generation = defaultGenerationTimeout
	}
	return ReadTimeout + generation + writeMargin
}

// Serve runs srv on ln until ctx ends, then stops accepting and gives the requests in progress up to
// grace to finish before it returns: a generation can take seconds, and a deploy must not cut it.
func Serve(ctx context.Context, srv *http.Server, ln net.Listener, grace time.Duration) error {
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()
	select {
	case err := <-served:
		return err // the listener failed before anyone asked to stop
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	err := srv.Shutdown(shutdown)
	// Serve returns http.ErrServerClosed as soon as Shutdown starts, before the requests are done.
	if serveErr := <-served; !errors.Is(serveErr, http.ErrServerClosed) {
		return serveErr
	}
	return err
}
