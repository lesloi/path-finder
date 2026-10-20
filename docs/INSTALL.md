# Installing Path finder

How to run Path finder on your own machine, for development or to host it yourself.

Path finder is one Go server that also serves the web app. It routes on a graph built ahead of
serving from these data, next to the code:

| Piece                               | What for                                  | Where it comes from                                                                      |
| ----------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| OpenStreetMap extracts (`.osm.pbf`) | The ways routes follow, and their surface | [download.geofabrik.de](https://download.geofabrik.de/europe/france.html)                |
| IGN BD ALTI 25 m (`.asc`)           | Elevation of every node of the graph      | [IGN, cartes.gouv.fr](https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_BD-ALTI) |

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
2. Download the BD ALTI 25 m **ASC** archive (`.7z`) of each department you need (about 30 MB each, about
   3 GB for metropolitan France) from
   [cartes.gouv.fr](https://cartes.gouv.fr/rechercher-une-donnee/dataset/IGNF_BD-ALTI),
   and extract them all below `data/bdalti-asc`. Tiles on a department border are merged. The build reads tiles gzipped too (`.asc.gz`, about 3.4 times smaller); keep the copies on a border, they complete each other.

## 3. Build the graph

The server binary builds its own graph, and the landmarks that speed up searches, with two commands.
Run them ahead of serving, never while it serves. They write into the **data directory**, set by
`DATA_DIR` (`data` by default): `graph.bin`, then `any.alt`, `paved.alt` and `unpaved.alt`, one per surface preference.

The area where routes can start is that of the extracts you build the graph from, and of the BD ALTI tiles under them. The server
finds it by itself from the graph (and from each territory of `DATA_DIR`), with nothing to configure: the web app greys out the rest
of the map, and disables the search from a start point there.

```sh
cd apps/server
CGO_ENABLED=0 go build -o path-finder .

export DATA_DIR=$PWD/../../data
./path-finder build-graph -pbf $DATA_DIR/osm/rhone-alpes-latest.osm.pbf -dem $DATA_DIR/bdalti-asc
./path-finder build-alt -profile any
./path-finder build-alt -profile paved
./path-finder build-alt -profile unpaved
```

A graph of a format before `PFGRAPH8` (the current one), or built with other parameters, is refused when the server starts, and the log says to run
`build-graph` again, then `build-alt` for each profile. A server that is running keeps the graphs it serves when
replaced files cannot be served, and says why in its log.

A file appears in its place only once it is complete, so a directory that is being rebuilt never holds
a half-written one. A running server looks at the directory every 30 seconds and serves the files that replace
the ones it maps, with no restart. Replace a file by renaming a new one over it, never by writing into it.

`-landmarks` sets how many landmarks to compute (8 by
default): more make long searches faster and the file bigger. A way with no BD ALTI elevation under
it is left out, so routes only exist where you downloaded tiles. Landmarks belong to one surface-preference
profile and to one graph: build them again after each graph; the server refuses those of another graph.

### Metropolitan France

Metropolitan France is one `build-graph` from the France extract and three `build-alt`, as above, with `-pbf` the
Geofabrik `france-latest.osm.pbf` and `-dem` the BD ALTI of every department. The build works on disk, and its memory does
not grow with the extract (it needs a sorted one, as Geofabrik's are). Its temporary files go beside the graph, or to `-tmp`:
never a memory-backed `/tmp`, they are as big as the extract. Count about 9 GB of temporary disk beside the 4.2 GB graph, and
about 9 GB of landmark files. `-chunk` and `-cache` size the sorts and the BD ALTI tiles kept in memory. `build-alt` also works
on disk, `-workers` landmarks at a time (2 by default, each worker holds one distance per node), with `-tmp` for its files.

Several `-pbf` are joined in memory, which suits a territory made of two extracts, not a country.

### Overseas France

`france-latest.osm.pbf` holds metropolitan France only. Each overseas territory has its own BD ALTI archive,
in UTM: name its projection with `-dem-crs`.

| Territory                | BD ALTI | `-dem-crs` | OSM extract                                                                                        |
| ------------------------ | ------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Guadeloupe               | `D971`  | `utm20n`   | Geofabrik `guadeloupe`                                                                             |
| Martinique               | `D972`  | `utm20n`   | Geofabrik `martinique`                                                                             |
| French Guiana            | `D973`  | `utm22n`   | Geofabrik `guyane`                                                                                 |
| Réunion                  | `D974`  | `utm40s`   | Geofabrik `reunion`                                                                                |
| Saint-Pierre-et-Miquelon | `D975`  | `utm21n`   | [OSM France](https://download.openstreetmap.fr/extracts/north-america/) `saint_pierre_et_miquelon` |
| Mayotte                  | `D976`  | `utm38s`   | Geofabrik `mayotte`                                                                                |
| Saint-Barthélemy         | `D977`  | `utm20n`   | [OSM France](https://download.openstreetmap.fr/extracts/central-america/) `saint_barthelemy`       |
| Saint-Martin             | `D978`  | `utm20n`   | [OSM France](https://download.openstreetmap.fr/extracts/central-america/) `saint_martin`           |

A territory is a graph of its own, in its own subdirectory of `DATA_DIR`: its tiles come in another projection and
its extract is far from the others. From two graphs on, every graph lives in a subdirectory (the server refuses a
`graph.bin` with other graphs beside it): move one built at the root into one first. The build reads every tile below
`-dem`, so keep the archive of each territory in a directory of its own. A territory made of two extracts takes both
as `-pbf`; they are joined in memory.

```sh
dir=$DATA_DIR/guadeloupe && mkdir -p "$dir"
./path-finder build-graph -pbf $DATA_DIR/osm/guadeloupe-latest.osm.pbf -dem $DATA_DIR/bdalti-d971 -dem-crs utm20n -out "$dir/graph.bin"
for profile in any paved unpaved; do
  ./path-finder build-alt -graph "$dir/graph.bin" -out "$dir/$profile.alt" -profile "$profile"
done
```

The default `-dem-crs` is `lambert93`. Tiles read in the wrong projection give no elevation, and the build fails.

### Points of interest

`build-pois` reads the same extracts and writes the tiles of the water points (`amenity=drinking_water`, or
`drinking_water=yes` on any node or way, never `drinking_water=no`; `seasonal` and the `name` are kept) and of the viewpoints
(`tourism=viewpoint`). A tile is a JSON file `pois/{x}/{y}.json` of the zoom-10 grid, about 27 km wide, written only
when it holds any point. A way stands for the mean of its nodes; relations are left out. Several extracts can
overlap.

```sh
./path-finder build-pois -pbf $DATA_DIR/osm/france.osm.pbf -out $DATA_DIR/pois
```

The server reads the tiles on each request, so a new build needs no restart. It only writes into an empty or new
directory: build into `pois.<stamp>` and put it in service by renaming a link `pois` over the previous one, the way the
graphs are, rather than writing into the directory that is served. Without `pois/`, or for a tile with no point, the
answer is an empty tile and the map shows no point of interest. The tile requests are never logged, not even in
development.

### Serving several graphs

The server maps every graph when it starts and answers from the one that holds the start point with the most
room round it, or from the next one if that has no way near it. A directory that holds a `graph.bin` is one
graph, and the server refuses one that also has graphs beside it. In a directory of graphs each needs its `any.alt`, `paved.alt` and `unpaved.alt`, and a subdirectory with landmarks or a
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

| Variable             | Required | Default       | Description                                                                                                                                                |
| -------------------- | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`            | no       |               | `development` turns off the limits and turns on the logs                                                                                                   |
| `PORT`               | no       | `3000`        | Port the server listens on                                                                                                                                 |
| `WEB_ROOT`           | no       | `../web/dist` | The built web app                                                                                                                                          |
| `DATA_DIR`           | no       | `data`        | The directory with `graph.bin` and the optional `any.alt`, `paved.alt` and `unpaved.alt`, or one such subdirectory per territory, and the optional `pois/` |
| `TRUSTED_PROXIES`    | no       |               | Proxies trusted for `X-Forwarded-For` ([details](#behind-a-reverse-proxy))                                                                                 |
| `LOOP_LIMIT`         | no       | by CPUs       | Route sets generated at once; beyond it the answer is `429` ([details](#how-many-at-once))                                                                 |
| `SEARCH_SEED`        | no       | random        | A whole number that fixes the seed of every search, so that the same criteria bring the same loops (for tests)                                             |
| `GENERATION_TIMEOUT` | no       | `15s`         | How long a route set may take; the routes found by then are sent, or `504` if none                                                                         |
| `RATE_LIMIT`         | no       | `60`          | Requests per client address and `RATE_WINDOW`; beyond it the answer is `429`                                                                               |
| `RATE_WINDOW`        | no       | `10m`         | The window of the rate limit, such as `10m`                                                                                                                |

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

To update the data from a job, build the new files beside the served ones and put them in service by renaming: a
graph and its landmarks change together, and the pods follow within 30 seconds. Metropolitan France is one graph, so
a rebuild needs room for both copies at once, about 13 GB each (a 4.2 GB graph and about 9 GB of landmarks), on top of the
temporary disk of the build (about 9 GB, freed afterwards). Serve a directory of links, one per graph, and build each
graph in a directory outside it. Then replace the graph's link by renaming a new link over it, made beside the served
directory at the same depth (`mv -T ../swap/guadeloupe guadeloupe`): none sees a new `graph.bin` with old landmarks.
Remove the old graph afterwards. Territories are small, and are replaced one at a time.

The data is a volume: mount the directory holding `graph.bin`, `any.alt`, `paved.alt` and `unpaved.alt`, or one such
subdirectory per territory, on `/data` (the image sets `DATA_DIR=/data`), read-only. The server only reads it, and
maps the files rather than copying them, so servers that share the directory share its page cache. They pick
up a rebuild by themselves.

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

The image has a shell and `wget`, but no `curl`: check its health with an HTTP probe on `/healthz` (see [Health](#health)).

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
