#!/bin/sh
# The server's tests: `test.sh unit` (the default) runs those that call functions directly, and
# `test.sh integration` those that go through HTTP on a graph built for the test.
set -eu
cd "$(dirname "$0")"

case "${1:-unit}" in
unit) packages="$(CGO_ENABLED=0 go list ./... | grep -v '/integration$')" ;;
integration) packages="$(CGO_ENABLED=0 go list ./integration)" ;;
*) echo "usage: test.sh [unit|integration]" >&2; exit 2 ;;
esac

# The race detector needs cgo, and the PBF reader needs the zlib headers with cgo: it runs on the packages
# that do not read PBF files. The server itself builds with CGO_ENABLED=0.
raceable="$(CGO_ENABLED=1 go list -f '{{.ImportPath}} {{join .Deps " "}}' ./... | grep -v czlib | cut -d' ' -f1)"
race=""
plain=""
for package in $packages; do
  if echo "$raceable" | grep -qx "$package"; then race="$race $package"; else plain="$plain $package"; fi
done

# shellcheck disable=SC2086
{
  [ -z "$race" ] || CGO_ENABLED=1 go test -race $race
  [ -z "$plain" ] || CGO_ENABLED=0 go test $plain
}
