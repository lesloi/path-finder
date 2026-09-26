<p align="center">
  <img src="apps/web/public/favicon.svg" alt="Path finder logo" width="128" height="128">
</p>

# Path finder

Path finder is a privacy-first web app that generates running and trail routes from a
few criteria: where you start, how far you want to go, and how much elevation gain you
want.

Walkers and hikers can use it too, and cycling/MTB support may come later.

## Privacy-first

No accounts, no analytics, no tracking. Your routes and settings stay in your browser.
Your criteria (start point, distance, elevation gain) are sent to our own server in
France, which generates the routes and keeps nothing. Map tiles come from the French
national mapping agency (IGN).

## Planned features

- Generate three to five loops from a start point, a target distance or duration, an
  optional target elevation gain, and a surface preference (paved or trails)
- Browse the routes on a map, with elevation profile and estimated duration from your pace
- Export a route as GPX for your watch (Garmin, Coros, Polar…)
- Running (road and trail) and hiking first, cycling/MTB later
- French and English, metric and imperial units
- France only for now; works in any current mobile or desktop browser, installable on the
  home screen

## Tech stack

- [Vite](https://vite.dev) + [React](https://react.dev) web app with [MapLibre](https://maplibre.org) and Plan IGN tiles
- API in TypeScript with [Hono](https://hono.dev), routing by [BRouter](https://github.com/abrensch/brouter)
  on OpenStreetMap data, elevation from IGN BD ALTI
- [pnpm](https://pnpm.io) workspace monorepo
- [Vitest](https://vitest.dev) for unit tests

## Getting started

Requires Node.js 26 (LTS) and pnpm. The API runs its TypeScript directly with Node.

```sh
pnpm install
pnpm dev          # web app on http://localhost:5173, API on port 3000
pnpm build        # build the web app
pnpm start        # serve the built web app and the API on port 3000
pnpm test         # unit tests
pnpm test:coverage  # unit tests with coverage (fails below 80 %)
```

The repository is a pnpm workspace: `apps/web` (web app), `apps/api` (Hono API), and
`packages/route-generation` (criteria → route set).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](./LICENSE). The API is covered too: if you run a modified version as a
network service, you must offer its source code to its users.

The license covers the code, not the name. If you distribute a fork, give it a different
name and icon so users can't mistake it for Path finder.
