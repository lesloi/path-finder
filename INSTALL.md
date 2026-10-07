# Installing Path finder

How to run Path finder on your own machine, for development or to host it yourself.

Path finder is one Go server that also serves the web app. It routes on a graph built ahead of
serving from these data, next to the code:

| Piece                               | What for                                  | Where it comes from                                                       |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| OpenStreetMap extracts (`.osm.pbf`) | The ways routes follow, and their surface | [download.geofabrik.de](https://download.geofabrik.de/europe/france.html) |
| IGN BD ALTI 25 m (`.asc`)           | Elevation of every node of the graph      | [IGN Géoplateforme](https://data.geopf.fr/telechargement/resource/BDALTI) |

Map tiles (Plan IGN) are loaded by the browser from the IGN Géoplateforme: there is
nothing to install for them.

## Requirements

- [Go 1.27](https://go.dev/dl/) (the server is built with `CGO_ENABLED=0`)
- [Node.js 26](https://nodejs.org/) and [pnpm](https://pnpm.io/installation), for the web app

## 1. Get the code

```sh
git clone https://github.com/lesloi/path-finder.git
cd path-finder
pnpm install
```

The steps below put the data under `data/` in the repository. Any other directory works.

## 2. Get the data

1. Download the OpenStreetMap extracts covering your area, such as `rhone-alpes-latest.osm.pbf`
   from [Geofabrik](https://download.geofabrik.de/europe/france.html), into `data/osm`. Extracts
   are rebuilt daily; download them again to update the map.
2. Download the BD ALTI 25 m **ASC** archive of each department you need (about 30 MB each, about
   3 GB for metropolitan France) from
   [data.geopf.fr/telechargement/resource/BDALTI](https://data.geopf.fr/telechargement/resource/BDALTI),
   and extract them all below `data/bdalti-asc`. Tiles on a department border are merged.

## 3. Build the graph

The server binary builds its own graph, and the landmarks that speed up searches, with two commands.
Run them ahead of serving, never while it serves. They write into the **data directory**, set by
`DATA_DIR` (`data` by default): `graph.bin`, then `any.alt`, `paved.alt` and `unpaved.alt`, one per surface preference.

```sh
cd apps/server
CGO_ENABLED=0 go build -o path-finder .

export DATA_DIR=$PWD/../../data
./path-finder build-graph -pbf $DATA_DIR/osm/rhone-alpes-latest.osm.pbf -dem $DATA_DIR/bdalti-asc
./path-finder build-alt -profile any
./path-finder build-alt -profile paved
./path-finder build-alt -profile unpaved
```

A file appears in its place only once it is complete, so a directory that is being rebuilt never holds
a half-written one. The server maps the files when it starts: restart it after a rebuild.

Repeat `-pbf` to join several extracts. `-landmarks` sets how many landmarks to compute (8 by
default): more make long searches faster and the file bigger. A way with no BD ALTI elevation under
it is left out, so routes only exist where you downloaded tiles. Landmarks belong to one surface-preference
profile and to one graph: build them again after each graph; the server refuses those of another graph.

### A country, by zones

The graph of a country does not build in a couple of gigabytes of memory, so build it by zone, each into its
own subdirectory of the data directory. `build-graph -bbox minLon,minLat,maxLon,maxLat` reads one sorted
extract (Geofabrik's are) once and keeps the ways inside the box: its memory follows the zone, not the
extract. A way that leaves the box is cut there, so give each zone a margin and overlap its neighbours.
Without `-bbox` the build keeps every walkable way in memory: fine for a region, not for a country. `-dem`
can hold the tiles of the whole country: a build reads only those that meet its box. Under a memory limit set
`GOMEMLIMIT` to about 80 % of it (`1600MiB` for 2 GiB).

`plan-zones` cuts a country into zones from its extract, in one pass (two minutes for France). It splits the
area where the nodes are shared in half until the box of a part, margin included, holds at most `-max-nodes`
nodes of the extract, which a build keeps in memory: 37 million held 0.9 GB live and peaked at 1.62 GB, so 40
million is the budget of a 2 GB job. `-margin-km` is how far a zone reaches beyond its part, so that loops near
its edge close: those of 50 km, the longest, went up to 16 km from their start in a test, so keep 20. Plan
again with each extract, since the zones follow the nodes:

```sh
./path-finder plan-zones -pbf france.osm.pbf -max-nodes 40000000 -margin-km 20 > zones.txt
```

Each line is a name and a box (31 zones for the France extract of 6 October 2026):

```sh
set -e # stop at the first zone that fails: a zone left out is a hole in the map
while read -r name box _; do
  zone=$DATA_DIR/$name && mkdir -p "$zone"
  GOMEMLIMIT=1600MiB ./path-finder build-graph -pbf france.osm.pbf -dem "$dem" -bbox "$box" -out "$zone/graph.bin"
  for profile in any paved unpaved; do
    ./path-finder build-alt -graph "$zone/graph.bin" -out "$zone/$profile.alt" -profile "$profile"
  done
done < zones.txt
```

The log of `build-graph` gives the candidate nodes and the nodes kept: a zone built without the tiles of a
neighbouring département keeps far fewer, and has holes.

The server maps every zone when it starts and answers from the zone that holds the start point with the most
room round it, or from the next one if that has no way near it. A directory that holds a `graph.bin` is one
zone, and the server refuses one that also has zones beside that graph. In a directory of zones each needs its `any.alt`, `paved.alt` and `unpaved.alt`, and a subdirectory with landmarks or a
temporary file but no `graph.bin` (a build that failed) stops the server.

## 4. Run it locally

```sh
export DATA_DIR=$PWD/data   # holds graph.bin, and any.alt, paved.alt and unpaved.alt if you built them
pnpm dev
```

Without `DATA_DIR`, `pnpm dev` and `pnpm start` use the repository's `data/`.

Open http://localhost:5173. The web app proxies `/api` to the server on port 3000. `PORT` (5173) and
`API_PORT` (3000) set the two ports, so that two `pnpm dev` can run side by side. `pnpm dev` sets
`APP_ENV=development`, which turns off the rate and concurrency limits, and logs each request and the
errors of a generation.

To run it as in production, on one origin:

```sh
pnpm build
pnpm start   # http://localhost:3000
```

### Environment variables

| Variable             | Required | Default       | Description                                                                                                                 |
| -------------------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`            | no       |               | `development` turns off the limits and turns on the logs                                                                    |
| `PORT`               | no       | `3000`        | Port the server listens on                                                                                                  |
| `WEB_ROOT`           | no       | `../web/dist` | The built web app                                                                                                           |
| `DATA_DIR`           | no       | `data`        | The directory with `graph.bin` and the optional `any.alt`, `paved.alt` and `unpaved.alt`, or one such subdirectory per zone |
| `TRUSTED_PROXIES`    | no       |               | Proxies trusted for `X-Forwarded-For` ([details](#behind-a-reverse-proxy))                                                  |
| `LOOP_LIMIT`         | no       | by CPUs       | Route sets generated at once; beyond it the answer is `429` ([details](#how-many-at-once))                                  |
| `GENERATION_TIMEOUT` | no       | `15s`         | How long a route set may take; the routes found by then are sent, or `504` if none                                          |
| `RATE_LIMIT`         | no       | `60`          | Requests per client address and `RATE_WINDOW`; beyond it the answer is `429`                                                |
| `RATE_WINDOW`        | no       | `10m`         | The window of the rate limit, such as `10m`                                                                                 |

### How many at once

Generating a route set is the one costly request: it searches many loops in parallel, on every CPU the
server may use, up to 8. `LOOP_LIMIT` is how many such requests may run at the same time on one
instance. Beyond it a request is not queued: it is answered `429` at once with `Retry-After: 1`. The web
app then asks again by itself, twice at most, after that long plus up to a second at random (so refused users do
not return together), and tells the user the service is busy only if it still is. Other refusals, such as
`rate-limited`, are shown at once. The server keeps nothing between requests, so another instance never
needs to know about this one's.

Lower the limit when a small machine runs short of memory or when users see `504` (nothing found in
time); raise it when they see `429` while the CPUs are idle.

By default as many route sets run at once as the server has CPUs: more at once do not raise the throughput, they
only make each one wait longer. Go counts at least 2 CPUs in a container, so on a single CPU set `LOOP_LIMIT=1`.
Set `GOMEMLIMIT` to about 70 % of the memory limit (`350MiB` for 500 MB), so that the garbage collector keeps
the heap under it. A search holds about 50 MB per worker, with as many workers as CPUs (8 at most): the memory
is about `LOOP_LIMIT × CPUs × 50 MB`.

## 5. Host it

The `Dockerfile` builds one image with the server and the web app, and no data. Build it with
`docker build -t path-finder .`, or use the one CI publishes as `ghcr.io/lesloi/path-finder:latest`.

To update the data from a job, build into a new directory beside the live one, not into it (the job plans the
zones, then builds them, so a newer extract needs no new image), then point the volume's `current` link at it
and restart the pods. A pod restarting in the middle of a build in place would find a new `graph.bin` with old
landmarks, which it refuses, and a zone dropped from the plan would still be served.

The data is a volume: mount the directory holding `graph.bin`, `any.alt`, `paved.alt` and `unpaved.alt`, or one such
subdirectory per zone, on `/data` (the image sets `DATA_DIR=/data`), read-only. The server only reads it, and
maps the files rather than copying them, so servers that share the directory share its page cache; restart
them after a rebuild.

A `compose.yaml`:

```yaml
services:
  path-finder:
    image: ghcr.io/lesloi/path-finder:latest
    volumes:
      - ./data:/data:ro
    ports:
      - '127.0.0.1:3000:3000'
    restart: unless-stopped
```

The image has no shell: check its health with an HTTP probe on `/healthz` (see [Health](#health)).

### Behind a reverse proxy

The rate limit counts each client by its address. Behind a reverse proxy, that address is the proxy's
unless you list the proxy in `TRUSTED_PROXIES`: the server then reads the client's address from
`X-Forwarded-For`, skipping the listed proxies from the right. Unset or empty, the header is ignored,
so one proxy makes every user count as one client.

| `TRUSTED_PROXIES`        | Trusted proxies                                               |
| ------------------------ | ------------------------------------------------------------- |
| unset                    | None: the client is the connection, and the header is ignored |
| `172.18.0.3, 10.0.0.0/8` | These IP addresses and CIDR ranges, such as a Docker subnet   |

Only proxies can reach the server in that setup: a client that connects to it directly can forge the
header.

### Health

`GET /healthz` answers `.` to every caller while the server is up.
