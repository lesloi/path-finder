package server

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteJSONWritesTheBodyBytesAndItsNewline(t *testing.T) {
	rec := httptest.NewRecorder()

	writeJSON(rec, http.StatusOK, refusal{Error: "invalid-json"})

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != "{\"error\":\"invalid-json\"}\n" {
		t.Errorf("body %q, want the JSON and its newline", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type %q", got)
	}
}

// An encoding failure used to come after the 200 was sent, which left the client with an empty 200.
func TestWriteJSONAnswers500BeforeWritingWhenTheBodyCannotBeEncoded(t *testing.T) {
	rec := httptest.NewRecorder()

	writeJSON(rec, http.StatusOK, math.Inf(1))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status %d, want 500", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("body %q, want none", rec.Body.String())
	}
}
