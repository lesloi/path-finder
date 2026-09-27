# Installing Path finder

How to run Path finder on your own machine, for development or to host it yourself.

Path finder needs these next to its code:

| Piece | What for | Where it comes from |
| --- | --- | --- |
| [BRouter](https://github.com/abrensch/brouter) server | Routing on OpenStreetMap data | Official Docker image or release zip |
| BRouter segments (`.rd5`) | The OpenStreetMap routing graph | [brouter.de/brouter/segments4](https://brouter.de/brouter/segments4/) |
| IGN BD ALTI 25 m | Elevation gain | [IGN Géoplateforme](https://data.geopf.fr/telechargement/resource/BDALTI) |
| IGN ADMIN EXPRESS (optional) | Naming routes after their commune | [IGN Géoplateforme](https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS) |

Map tiles (Plan IGN) are loaded by the browser from the IGN Géoplateforme: there is
nothing to install for them.

## Requirements

- [Node.js 26](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation)
- A BRouter server (see [BRouter](#2-brouter))
- BD ALTI 25 m elevation tiles (see [Elevation: BD ALTI 25 m](#3-elevation-bd-alti-25-m))

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

## 3. Elevation: BD ALTI 25 m

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

## 4. Communes: ADMIN EXPRESS (optional)

Without this file, routes are named without a commune.

1. Download the latest ADMIN EXPRESS `GPKG_LAMB93_FXX` archive (~250 MB) from
   [data.geopf.fr/telechargement/resource/ADMIN-EXPRESS](https://data.geopf.fr/telechargement/resource/ADMIN-EXPRESS).
2. Extract the `.gpkg` file from it.
3. Convert it:

   ```sh
   node apps/api/scripts/convert-admin-express.ts path/to/ADMIN-EXPRESS.gpkg data/communes.json
   ```

## 5. Run it locally

With BRouter running:

```sh
export BDALTI_DIR=$PWD/data/bdalti
export COMMUNES_FILE=$PWD/data/communes.json   # optional
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

| Variable | Default | Description |
| --- | --- | --- |
| `BDALTI_DIR` | none (required) | Tiles written by `convert-bdalti.ts` |
| `BROUTER_URL` | `http://localhost:17777` | The BRouter server |
| `COMMUNES_FILE` | none | File written by `convert-admin-express.ts` |
| `NODE_ENV` | none | `development` turns off the rate and concurrency limits |
| `PORT` | `3000` | Port the API listens on |

## 6. Host it

The `Dockerfile` builds one image with the API and the web app. Build it with
`docker build -t path-finder .`, or use the one CI publishes as
`ghcr.io/lesloi/path-finder:latest`. A `compose.yaml` for BRouter and Path finder:

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
      COMMUNES_FILE: /data/communes.json   # optional
    volumes:
      - ./data/bdalti:/data/bdalti:ro
      - ./data/communes.json:/data/communes.json:ro
    ports:
      - "127.0.0.1:3000:3000"
    restart: unless-stopped
```

The image already sets `BDALTI_DIR=/data/bdalti` and `BROUTER_URL=http://brouter:17777`.
`GET /health` answers `ok` when the API is up.
