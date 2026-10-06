#!/bin/sh
# `pnpm dev`: the Go server with its logs and no limits, and the web app on Vite, which proxies /api to it.
# The server is started from its own binary and stopped with the script: a job started with `&` in a
# non-interactive shell ignores Ctrl-C, and would keep port 3000 after the web app is gone.
set -eu
cd "$(dirname "$0")/.."
# The server runs from apps/server: a relative default would look there, not in the repository's data/.
export DATA_DIR="${DATA_DIR:-$PWD/data}"

# PORT is the web app's (a preview tool hands one out); the server takes API_PORT, which the Vite proxy also reads.
(cd apps/server && CGO_ENABLED=0 go build -o path-finder . && PORT="${API_PORT:-3000}" APP_ENV=development exec ./path-finder) &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT INT TERM

pnpm --filter @path-finder/web dev
