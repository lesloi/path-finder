#!/bin/sh
# Runs every Go test, counting what the whole server runs (`-coverpkg`, so the integration tests
# cover the packages they go through), and fails under 90% like `pnpm test:coverage` does for the web app.
set -eu
cd "$(dirname "$0")"
export CGO_ENABLED=0
profile="$(mktemp)"
trap 'rm -f "$profile" "$profile.kept"' EXIT

go test -coverpkg=./... -coverprofile="$profile" ./...
# Leave out what only starts the server or writes the stand-in graph.
grep -v -e '/main\.go:' -e '/cmd/' -e '/internal/standin/' "$profile" > "$profile.kept"
total="$(go tool cover -func="$profile.kept" | awk '/^total:/ { sub("%", "", $3); print $3 }')"
echo "server coverage: ${total}%"
awk -v total="$total" 'BEGIN { exit !(total + 0 >= 90) }' || { echo "under 90%" >&2; exit 1; }
