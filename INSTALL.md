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
`DATA_DIR` (`data` by default): `graph.bin`, then `hike.alt` and `run.alt`.

```sh
cd apps/server
CGO_ENABLED=0 go build -o path-finder .

export DATA_DIR=$PWD/../../data
./path-finder build-graph -pbf $DATA_DIR/osm/rhone-alpes-latest.osm.pbf -dem $DATA_DIR/bdalti-asc
./path-finder build-alt -profile hike
./path-finder build-alt -profile run
```

A file appears in its place only once it is complete, so a directory that is being rebuilt never holds
a half-written one. The server maps the files when it starts: restart it after a rebuild.

To build one zone of a large extract, such as a department from the France extract, add
`-bbox minLon,minLat,maxLon,maxLat` (one sorted `-pbf`, as Geofabrik's are, and only the BD ALTI tiles of the
zone in `-dem`): the build reads the extract once and its memory follows the zone, not the extract. A way that
leaves the box is cut there, so give the box a margin around the zone. Without `-bbox`, the build keeps every
walkable way of the extracts in memory, which is fine for a region and far too much for a country. In a job
with a memory limit, set `GOMEMLIMIT` to about 80 % of it (`1600MiB` for 2 GiB): the Go runtime then collects
garbage harder as it nears the limit, at the price of a slower build.

### A country, by zones

The graph of a country does not build in the memory of a job, so build it by zone, one after the other or
in parallel, each into its own subdirectory of the data directory. `plan-zones` cuts a country into zones from
its extract, in one pass (about two minutes for France): it counts the nodes of each cell of a grid and splits
the area where the nodes are shared in half, until the box of a part, with its margin, holds at most
`-max-nodes` nodes of the extract. A build keeps the nodes of its box in memory: 37 million of them held 0.9 GB
live, and the build peaked at 1.62 GB under `GOMEMLIMIT=1600MiB`, so 40 million is the budget of a 2 GB job. Dense places get small zones, empty
ones none. `-margin-km` is how far a zone reaches beyond its part, so that loops near the edge close (loops
of 50 km, the longest, went up to 16 km from their start in a test: keep 20); the boxes of neighbours overlap
by twice it.

```sh
./path-finder plan-zones -pbf france.osm.pbf -max-nodes 40000000 -margin-km 20 > zones.txt
```

`apps/server/zones-france.txt` is that list for the France extract of 6 October 2026 (31 zones): a job that
updates the data uses it as it is, since a new plan renumbers the zones. Each line is a name and a box. `$dem` holds the BD ALTI tiles of the country: a build reads
only those that meet its box.

```sh
while read -r name box _; do
  zone=$DATA_DIR/$name && mkdir -p "$zone"
  GOMEMLIMIT=1600MiB ./path-finder build-graph -pbf france.osm.pbf -dem "$dem" -bbox "$box" -out "$zone/graph.bin"
  for profile in hike run; do
    ./path-finder build-alt -graph "$zone/graph.bin" -out "$zone/$profile.alt" -profile "$profile"
  done
done < zones.txt
```

The log of `build-graph` gives the candidate nodes and the nodes kept: a zone built without the BD ALTI tiles
of a neighbouring département keeps far fewer, and so would have holes.

A zone with two million nodes in its graph is about 215 MB of files. The server maps every zone when it starts, which costs no
memory, and answers a request from the zone whose box holds the start point with the most room round it;
when that zone has no way near the start, the next one whose box holds it answers. A data
directory that holds a `graph.bin` itself is one zone. Every zone of a directory of zones needs its `hike.alt`
and `run.alt`, and a subdirectory that holds landmarks or a temporary file but no `graph.bin` (a build that
failed) stops the server at startup.

Repeat `-pbf` to join several extracts. `-landmarks` sets how many landmarks to compute (8 by
default): more make long searches faster and the file bigger. A way with no BD ALTI elevation under
it is left out, so routes only exist where you downloaded tiles. Landmarks belong to one activity
profile and to one graph: build them again after each graph. The server refuses landmarks built for another
graph, even one with as many nodes.

## 4. Run it locally

```sh
export DATA_DIR=$PWD/data   # holds graph.bin, and hike.alt and run.alt if you built them
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

| Variable             | Required | Default       | Description                                                                                                 |
| -------------------- | -------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `APP_ENV`            | no       |               | `development` turns off the limits and turns on the logs                                                    |
| `PORT`               | no       | `3000`        | Port the server listens on                                                                                  |
| `WEB_ROOT`           | no       | `../web/dist` | The built web app                                                                                           |
| `DATA_DIR`           | no       | `data`        | The directory with `graph.bin` and the optional `hike.alt` and `run.alt`, or one such subdirectory per zone |
| `TRUSTED_PROXIES`    | no       |               | Proxies trusted for `X-Forwarded-For` ([details](#behind-a-reverse-proxy))                                  |
| `LOOP_LIMIT`         | no       | by CPUs       | Route sets generated at once; beyond it the answer is `429` ([details](#how-many-at-once))                  |
| `GENERATION_TIMEOUT` | no       | `15s`         | How long a route set may take; the routes found by then are sent, or `504` if none                          |
| `RATE_LIMIT`         | no       | `60`          | Requests per client address and `RATE_WINDOW`; beyond it the answer is `429`                                |
| `RATE_WINDOW`        | no       | `10m`         | The window of the rate limit, such as `10m`                                                                 |

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

## 5. Host it

The `Dockerfile` builds one image with the server and the web app, and no data. Build it with
`docker build -t path-finder .`, or use the one CI publishes as `ghcr.io/lesloi/path-finder:latest`.

To update the data from a job, build into a new directory beside the live one, not into it, then point the
volume's `current` link at it and restart the pods: a pod restarting in the middle of a build in place would
find a new `graph.bin` with old landmarks, which it refuses, and a zone dropped from the plan would still be
served.

The data is a volume: mount the directory holding `graph.bin`, `hike.alt` and `run.alt`, or one such
subdirectory per zone, on `/data` (the image sets `DATA_DIR=/data`), read-only. On Kubernetes that is a persistent volume, mounted the
same way into every pod, and filled by the job that runs `build-graph` and `build-alt` with the same
`DATA_DIR`. The files are mapped, not copied, so pods that share a volume share its page cache; restart
them after a rebuild. The server only opens the files for reading and writes nothing into the directory.

The server does not read the files ahead: a search faults in the pages it needs, the first time it touches
them. Before it listens, the server maps the files and checks their headers, which reads
almost nothing (the index that finds the nearest node to a point is in `graph.bin`), and `/healthz` does not
answer until then. The server logs how long opening took.

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
