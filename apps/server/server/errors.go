package server

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// busyRetryAfter is the wait in seconds asked of a user who found every generation slot taken: a generation
// lasts well under a second, so a slot frees almost at once. The web app spreads its retries around it.
const busyRetryAfter = 1

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
