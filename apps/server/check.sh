#!/bin/sh
# Everything CI checks of the server: formatting, static checks, the race detector, then coverage of the
# whole server, failing under 90% like `pnpm check:web` does for the web app.
set -eu
cd "$(dirname "$0")"
export CGO_ENABLED=0
test -z "$(gofmt -l .)" || { echo "not formatted: $(gofmt -l .)" >&2; exit 1; }
go vet ./...

profile="$(mktemp)"
trap 'rm -f "$profile" "$profile.kept"' EXIT

# The race detector needs cgo, and the PBF reader needs the zlib headers with cgo: leave out the packages
# that read PBF files. The server itself builds with CGO_ENABLED=0.
raceable="$(CGO_ENABLED=1 go list -f '{{.ImportPath}} {{join .Deps " "}}' ./... | grep -v czlib | cut -d' ' -f1)"
# shellcheck disable=SC2086
CGO_ENABLED=1 go test -race $raceable

# Coverage counts what the whole server runs (`-coverpkg`), so the integration tests cover the packages they go through.
go test -coverpkg=./... -coverprofile="$profile" ./...
# Leave out what only starts the server or writes the stand-in graph.
grep -v -e '/main\.go:' -e '/cmd/' -e '/internal/standin/' "$profile" > "$profile.kept"
total="$(go tool cover -func="$profile.kept" | awk '/^total:/ { sub("%", "", $3); print $3 }')"
echo "server coverage: ${total}%"
awk -v total="$total" 'BEGIN { exit !(total + 0 >= 90) }' || { echo "under 90%" >&2; exit 1; }
