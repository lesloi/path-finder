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

As a rough guide, measured on Auvergne-Rhône-Alpes:

- Building the graph takes about 15 seconds and 3 GB of RAM. Metropolitan France is estimated at about
  25 GB of RAM (not measured). It runs apart from the server, as a job.
- Serving maps the files read-only: about 650 MB of graph and 1 GB of landmarks for the region (16
  landmarks), which the operating system keeps in its page cache and counts in a container's memory.
  Metropolitan France is estimated at 5 GB and 8 GB.
- A loop route set takes a few CPU-milliseconds to a few CPU-seconds, depending on the criteria, so
  the server follows the CPUs it may use (`GOMAXPROCS` follows a container's CPU limit).

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

Repeat `-pbf` to join several extracts. `-landmarks` sets how many landmarks to compute (16 by
default): more make long searches faster and the file bigger. A way with no BD ALTI elevation under
it is left out, so routes only exist where you downloaded tiles. Landmarks belong to one activity
profile and to one graph: build them again after each graph.

## 4. Run it locally

```sh
export DATA_DIR=$PWD/data   # holds graph.bin, and hike.alt and run.alt if you built them
pnpm dev
```

Open http://localhost:5173. The web app proxies `/api` to the server on port 3000. `pnpm dev` sets
`APP_ENV=development`, which turns off the rate and concurrency limits, and logs each request and the
errors of a generation.

To run it as in production, on one origin:

```sh
pnpm build
pnpm start   # http://localhost:3000
```

### Environment variables

| Variable             | Required | Default       | Description                                                                                    |
| -------------------- | -------- | ------------- | ---------------------------------------------------------------------------------------------- |
| `DATA_DIR`           | no       | `data`        | The directory with `graph.bin`, and the `hike.alt` and `run.alt` landmarks, which are optional |
| `PORT`               | no       | `3000`        | Port the server listens on                                                                     |
| `WEB_ROOT`           | no       | `../web/dist` | The built web app                                                                              |
| `APP_ENV`            | no       |               | `development` turns off the limits and turns on the logs                                       |
| `TRUSTED_PROXIES`    | no       |               | Proxies trusted for `X-Forwarded-For` ([details](#behind-a-reverse-proxy))                     |
| `LOOP_LIMIT`         | no       | by CPUs       | Route sets generated at once; beyond it the answer is `429` ([details](#how-many-at-once))     |
| `RATE_LIMIT`         | no       | `60`          | Requests per client address and `RATE_WINDOW`; beyond it the answer is `429`                   |
| `RATE_WINDOW`        | no       | `10m`         | The window of the rate limit, such as `10m`                                                    |
| `GENERATION_TIMEOUT` | no       | `15s`         | How long a route set may take; the routes found by then are sent, or `504` if none             |

### How many at once

Generating a route set is the one costly request: it searches many loops in parallel, on every CPU the
server may use, up to 8. `LOOP_LIMIT` is how many such requests may run at the same time on one
instance. Beyond it a request is not queued: it is answered `429` at once with `Retry-After: 5`, and the
web app tells the user the service is busy. The server keeps nothing between requests, so another
instance never needs to know about this one's.

By default the server allows 4 at once per 8 CPUs (4 up to 8 CPUs, 8 up to 16). Measured on a real graph
with 30 % of hard requests (a high elevation gain target), with random arrivals:

| Machine | Arrivals | 1 at once    | 2 at once    | 4 at once    |
| ------- | -------- | ------------ | ------------ | ------------ |
| 2 CPU   | 4 / s    | 40 % refused | 26 % refused | 10 % refused |
| 8 CPU   | 10 / s   | 41 % refused | 21 % refused | 5 % refused  |

A slot is cheap to give: searches share the CPUs, so with more at once each takes longer, but a hard
request went from about 0.2 s to 0.35 s on 8 CPUs, and to about 1 s on 2 CPUs. What a slot costs is
memory, a few hundred MB for each on a region as large as Auvergne-Rhône-Alpes.

Lower the limit when a small machine runs short of memory or when users see `504` (nothing found in
time); raise it when they see `429` while the CPUs are idle. To serve more users overall, add
instances: each has its own limit. `RATE_LIMIT` is another matter: it limits one client address, not the
machine.

## 5. Host it

The `Dockerfile` builds one image with the server and the web app, and no data. Build it with
`docker build -t path-finder .`, or use the one CI publishes as `ghcr.io/lesloi/path-finder:latest`.

The data is a volume: mount the directory holding `graph.bin`, `hike.alt` and `run.alt` on `/data`
(the image sets `DATA_DIR=/data`), read-only. On Kubernetes that is a persistent volume, mounted the
same way into every pod, and filled by the job that runs `build-graph` and `build-alt` with the same
`DATA_DIR`. The files are mapped, not copied, so pods that share a volume share its page cache; restart
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
