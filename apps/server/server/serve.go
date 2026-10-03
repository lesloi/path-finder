package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

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
