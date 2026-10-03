#!/bin/sh
# Coverage of the whole server by its unit tests (`-coverpkg`, so a test counts for the packages it goes
# through): it fails under 90% like `pnpm coverage:web` does for the web app, and lists the functions that
# are poorly covered. The integration tests are not counted: they check that the parts fit together.
set -eu
cd "$(dirname "$0")"
export CGO_ENABLED=0
profile="$(mktemp)"
trap 'rm -f "$profile" "$profile.kept"' EXIT

packages="$(go list ./... | grep -v '/integration$')"
# The output of the tests is shown only when they fail: a passing run prints a line per package, which hides the summary.
log="$(mktemp)"
trap 'rm -f "$profile" "$profile.kept" "$log"' EXIT
# shellcheck disable=SC2086
if ! go test -coverpkg=./... -coverprofile="$profile" $packages > "$log" 2>&1; then
  cat "$log" >&2
  exit 1
fi
# Leave out what only starts the server or writes the stand-in graph.
grep -v -e '/main\.go:' -e '/cmd/' -e '/internal/standin/' "$profile" > "$profile.kept"
echo "Functions under 80%:"
go tool cover -func="$profile.kept" | awk '$1 != "total:" && $3 + 0 < 80 { print "  " $1 " " $2 " " $3 }'
total="$(go tool cover -func="$profile.kept" | awk '/^total:/ { sub("%", "", $3); print $3 }')"
echo "server coverage: ${total}%"
awk -v total="$total" 'BEGIN { exit !(total + 0 >= 90) }' || { echo "under 90%" >&2; exit 1; }
