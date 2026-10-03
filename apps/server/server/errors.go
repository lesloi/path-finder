package server

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// Error codes the web app words in the user's language: the server sends no text.
const (
	codeInvalidJSON       = "invalid-json"
	codeInvalidCriteria   = "invalid-criteria"
	codeStaleBuild        = "stale-build"
	codeRateLimited       = "rate-limited"
	codeOverloaded        = "overloaded"
	codeGenerationTimeout = "generation-timeout"
)

// busyRetryAfter is a wait in seconds: about one generation, given the < 5 s p95 target.
const busyRetryAfter = 5

// CriteriaError is a request body that is not valid criteria, with the field that failed.
// The field is never a value: the server keeps no location.
type CriteriaError struct{ Field string }

func (e *CriteriaError) Error() string { return "invalid criteria: " + e.Field }

type refusal struct {
	Error string `json:"error"`
	Field string `json:"field,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func refuse(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, refusal{Error: code})
}

func refuseLater(w http.ResponseWriter, status int, code string, seconds int) {
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	refuse(w, status, code)
}
