#!/bin/sh
# Coverage of the whole server, which unit and integration tests share (`-coverpkg`): it fails under 90%
# like `pnpm coverage:web` does for the web app, and lists the functions that are poorly covered.
set -eu
cd "$(dirname "$0")"
export CGO_ENABLED=0
profile="$(mktemp)"
trap 'rm -f "$profile" "$profile.kept"' EXIT

go test -coverpkg=./... -coverprofile="$profile" ./... > /dev/null
# Leave out what only starts the server or writes the stand-in graph.
grep -v -e '/main\.go:' -e '/cmd/' -e '/internal/standin/' "$profile" > "$profile.kept"
echo "Functions under 80%:"
go tool cover -func="$profile.kept" | awk '$1 != "total:" && $3 + 0 < 80 { print "  " $1 " " $2 " " $3 }'
total="$(go tool cover -func="$profile.kept" | awk '/^total:/ { sub("%", "", $3); print $3 }')"
echo "server coverage: ${total}%"
awk -v total="$total" 'BEGIN { exit !(total + 0 >= 90) }' || { echo "under 90%" >&2; exit 1; }
