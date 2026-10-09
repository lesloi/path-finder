<p align="center">
  <img src="apps/web/public/favicon.svg" alt="Path finder logo" width="128" height="128">
</p>

<h1 align="center">Path finder</h1>

<h3 align="center">Your next run or hike, without being tracked</h3>

<p align="center">
  A privacy-first web app that generates running and trail routes in France from where you
  start, how far or how long you want to go, and how much elevation gain you want.
</p>

<p align="center">
  <a href="./docs/INSTALL.md">Install</a> ·
  <a href="./CONTRIBUTING.md">Contribute</a> ·
  <a href="https://github.com/lesloi/path-finder/issues">Issues</a>
</p>

## Features

- **Three to five loops** from a start point, a target distance or duration, an optional
  target elevation gain, and a surface preference (paved or trails)
- **Routes on a map**, with elevation profile and estimated duration from your pace
  (from IGN BD ALTI elevation stored in the server's graph)
- **GPX export** for your watch (Garmin, Coros, Polar…)
- **Supported languages**: English and French
- **Running and hiking** first (road and trail), cycling/MTB later

## Privacy-first

- **No accounts, no analytics, no tracking.**
- **Your routes and settings stay in your browser.**
- **Only what a route needs is sent** to the app's own server: start point,
  target distance or duration, elevation gain, surface preference, and pace. It generates
  the routes and keeps nothing.
- **Map tiles**, with their fonts and icons, come from the French national mapping agency
  (IGN).

## Getting started

**Requirements:** [Go 1.27](https://go.dev/dl/), [Node.js 26](https://nodejs.org/) and
[pnpm](https://pnpm.io/installation), plus the routing graph, which you build once from OpenStreetMap
and BD ALTI data (see [INSTALL.md](./docs/INSTALL.md)).

```sh
git clone https://github.com/lesloi/path-finder.git
cd path-finder
pnpm install
DATA_DIR=$PWD/data pnpm dev
```

Then open **http://localhost:5173**.

To build the graph, tune the server, or host the app, see [INSTALL.md](./docs/INSTALL.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Data and credits

- Routing data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
  under the ODbL
- Map tiles (Plan IGN) and elevation (BD ALTI) from
  [IGN](https://www.ign.fr), under the Licence Ouverte

## License

[AGPL-3.0-or-later](./LICENSE). The server is covered too: if you run a modified version as a
network service, you must offer its source code to its users.

The license covers the code, not the name. If you distribute a fork, give it a different
name and icon so users can't mistake it for Path finder.
