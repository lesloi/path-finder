package server

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestServeLetsRequestsInProgressFinishBeforeReturning(t *testing.T) {
	started := make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		time.Sleep(300 * time.Millisecond) // a generation under way
		_, _ = io.WriteString(w, "done")
	})}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, stop := context.WithCancel(context.Background())
	returned := make(chan error, 1)
	go func() { returned <- Serve(ctx, srv, ln, 5*time.Second) }()

	body := make(chan string, 1)
	go func() {
		resp, err := http.Get("http://" + ln.Addr().String())
		if err != nil {
			body <- err.Error()
			return
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		body <- string(b)
	}()
	<-started
	stop() // SIGTERM, while the request is still being served

	select {
	case err := <-returned:
		if err != nil {
			t.Fatal(err)
		}
		select {
		case got := <-body:
			if got != "done" {
				t.Errorf("the request in progress got %q, want its answer", got)
			}
		case <-time.After(time.Second):
			t.Error("Serve returned before the request in progress was answered")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve never returned")
	}
}

func TestServeReportsAListenerThatFails(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ln.Close() // serving on a closed listener fails at once
	if err := Serve(context.Background(), &http.Server{}, ln, time.Second); err == nil {
		t.Error("err = nil")
	}
}

func TestServeGivesUpOnRequestsThatOutlastTheGrace(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	srv := &http.Server{Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		close(started)
		<-release
	})}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, stop := context.WithCancel(context.Background())
	returned := make(chan error, 1)
	go func() { returned <- Serve(ctx, srv, ln, 100*time.Millisecond) }()
	go func() { _, _ = http.Get("http://" + ln.Addr().String()) }()
	<-started
	stop()
	select {
	case err := <-returned:
		if err == nil {
			t.Error("a request that outlasts the grace period: err = nil, want the deadline")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Serve waited past its grace period")
	}
	close(release)
}
