#!/bin/sh
# The server's static checks, which are quick: formatting and `go vet`.
set -eu
cd "$(dirname "$0")"
export CGO_ENABLED=0
unformatted="$(gofmt -l .)"
if [ -n "$unformatted" ]; then
  echo "not formatted: $unformatted" >&2
  exit 1
fi
go vet ./...
