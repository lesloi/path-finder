# Installing Path finder

How to run Path finder on your own machine, for development or to host it yourself.

Path finder needs these next to its code:

| Piece                                                 | What for                        | Where it comes from                                                       |
| ----------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| [BRouter](https://github.com/abrensch/brouter) server | Routing on OpenStreetMap data   | Official Docker image or release zip                                      |
| BRouter segments (`.rd5`)                             | The OpenStreetMap routing graph | [brouter.de/brouter/segments4](https://brouter.de/brouter/segments4/)     |
| IGN BD ALTI 25 m (optional)                           | Elevation gain                  | [IGN Géoplateforme](https://data.geopf.fr/telechargement/resource/BDALTI) |

Map tiles (Plan IGN) are loaded by the browser from the IGN Géoplateforme: there is
nothing to install for them.

## Requirements

- [Node.js 26](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation)
- A BRouter server (see [BRouter](#2-brouter))

As a rough guide:

- Path finder: about 512 MB of RAM (it keeps up to 64 elevation tiles of 2 MB in memory),
  and ~2 MB of disk per converted 25 km elevation tile, about 2 GB for metropolitan France
- BRouter: about 2 GB of RAM, and up to ~200 MB of disk per segment

## 1. Get the code

```sh
git clone https://github.com/lesloi/path-finder.git
cd path-finder
pnpm install
```

The steps below put the data under `data/` in the repository. Any other directory works.

## 2. BRouter

### Segments

BRouter reads its graph from 5° × 5° segment files named after their south-west corner
(`E5_N45.rd5` covers 5–10° E, 45–50° N). Download the ones covering your area from
[brouter.de/brouter/segments4](https://brouter.de/brouter/segments4/) (the page has a map).
Metropolitan France takes `W5_N40`, `W5_N45`, `E0_N40`, `E0_N45`, `E0_N50`, `E5_N40`, and
`E5_N45`.

```sh
mkdir -p data/segments4
curl -o data/segments4/E0_N45.rd5 https://brouter.de/brouter/segments4/E0_N45.rd5
```

Segments are rebuilt from OpenStreetMap regularly; download them again to update the map data.

### Server

Run a BRouter server with these segments by following the
[BRouter documentation](https://github.com/abrensch/brouter#readme) (official Docker image
or release zip). Path finder uses the stock `hiking-mountain` profile, which ships with
BRouter. The default port is 17777.

To run it with Java 17 or later, without Docker, get the
[latest release](https://github.com/abrensch/brouter/releases) zip, which holds the server
jar and the profiles:

```sh
curl -LO https://github.com/abrensch/brouter/releases/download/v1.7.10/brouter-1.7.10.zip
unzip brouter-1.7.10.zip -d data
java -Xmx1g -DmaxRunningTime=300 -cp data/brouter-1.7.10/brouter-1.7.10-all.jar \
  btools.server.RouteServer data/segments4 data/brouter-1.7.10/profiles2 \
  data/brouter-1.7.10/customprofiles 17777 4 127.0.0.1
```

The arguments after the class are the segments, the profiles, a directory for custom
profiles (unused), the port, the number of threads (the API makes up to 4 calls at once),
and the address to listen on. BRouter prints each request, start point included: don't keep
its output where you host it.

## 3. Elevation: BD ALTI 25 m (optional)

Without these tiles, routes have no elevation gain: a target elevation gain is ignored, and
the estimated duration comes from the distance alone.

1. Download the BD ALTI 25 m **ASC** archive of each department you need (~30 MB each,
   ~3 GB for metropolitan France) from
   [data.geopf.fr/telechargement/resource/BDALTI](https://data.geopf.fr/telechargement/resource/BDALTI).
2. Extract them all into one directory, for example `data/bdalti-asc`.
3. Convert them:

   ```sh
   node apps/api/scripts/convert-bdalti.ts data/bdalti-asc data/bdalti
   ```

Tiles on a department border are merged, so run the conversion again after adding
departments. Routes outside the converted departments get no elevation.

## 4. Run it locally

Point `BROUTER_URL` at the BRouter server from [2. BRouter](#2-brouter), or, for quick
tests, at the public [brouter.de](https://brouter.de) server. brouter.de receives every
start point, so don't use it in production.

```sh
export BROUTER_URL=http://localhost:17777   # or https://brouter.de
export BDALTI_DIR=$PWD/data/bdalti   # optional
pnpm dev
```

Open http://localhost:5173. The web app proxies `/api` to the API on port 3000. `pnpm dev`
sets `NODE_ENV=development`, which turns off the rate and concurrency limits.

To run it as in production, on one origin:

```sh
pnpm build
pnpm start   # http://localhost:3000
```

### Environment variables

| Variable           | Default        | Description                                                                |
| ------------------ | -------------- | -------------------------------------------------------------------------- |
| `NODE_ENV`         | none           | `development` turns off the rate and concurrency limits                    |
| `BDALTI_DIR`       | none           | Tiles written by `convert-bdalti.ts`                                       |
| `BROUTER_URL`      | none, required | The BRouter server, such as `http://localhost:17777`                       |
| `HEALTH_ALLOWLIST` | every caller   | Callers allowed on the healthcheck ([details](#health))                    |
| `PORT`             | `3000`         | Port the API listens on                                                    |
| `TRUSTED_PROXIES`  | loopback       | Proxies trusted for `X-Forwarded-For` ([details](#behind-a-reverse-proxy)) |

## 5. Host it

The `Dockerfile` builds one image with the API and the web app. Build it with
`docker build -t path-finder .`, or use the one CI publishes as
`ghcr.io/lesloi/path-finder:latest`.

To try the image without hosting BRouter, point it at the public
[brouter.de](https://brouter.de) server. It receives every start point, so don't use it in
production:

```sh
docker run --rm -p 127.0.0.1:3000:3000 -e BROUTER_URL=https://brouter.de \
  ghcr.io/lesloi/path-finder:latest
```

A `compose.yaml` for Path finder with a self-hosted BRouter:

```yaml
services:
  brouter:
    image: ghcr.io/abrensch/brouter:latest
    volumes:
      - ./data/segments4:/segments4:ro
    restart: unless-stopped

  path-finder:
    image: ghcr.io/lesloi/path-finder:latest
    depends_on: [brouter]
    environment:
      BROUTER_URL: http://brouter:17777
      BDALTI_DIR: /data/bdalti # optional
    volumes:
      - ./data/bdalti:/data/bdalti:ro
    ports:
      - '127.0.0.1:3000:3000'
    restart: unless-stopped
```

### Behind a reverse proxy

The rate limit counts each client by the address the proxy appends to `X-Forwarded-For`.
Clients can forge that header, so the API reads it only from the addresses listed in
`TRUSTED_PROXIES`, and otherwise counts the connection's address.

| `TRUSTED_PROXIES`        | Trusted proxies                                             |
| ------------------------ | ----------------------------------------------------------- |
| unset                    | Loopback only (`127.0.0.0/8`, `::1`): a proxy on the host   |
| `172.18.0.3, 10.0.0.0/8` | These IP addresses and CIDR ranges, such as a Docker subnet |
| empty                    | None                                                        |
| `0.0.0.0/0, ::/0`        | Every connection: for development only                      |

### Health

`GET /health` answers `ok` when the API is up.

By default, it answers every caller. To restrict it, list IP addresses and CIDR ranges in
`HEALTH_ALLOWLIST`, such as `198.51.100.7, 10.0.0.0/8`:

- listed callers and the loopback get `ok`, so a healthcheck inside the container still works;
- other callers get `404`.

Behind a [trusted proxy](#behind-a-reverse-proxy), the client's address is checked, not the
proxy's.
