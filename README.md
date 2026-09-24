# Path finder

Path finder is a privacy-first mobile app that generates running and trail routes from a
few criteria: where you start, how far you want to go, and how much elevation gain you
want.

Walkers and hikers can use it too, and cycling/MTB support may come later.

## Privacy-first

No accounts, no analytics, no tracking. Your routes and settings stay on your phone.
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
- France only for now; Android first, iOS later

## Tech stack

- [Expo](https://expo.dev) (React Native) with [MapLibre](https://maplibre.org) and Plan IGN tiles
- API in TypeScript with [Hono](https://hono.dev), routing by [BRouter](https://github.com/abrensch/brouter)
  on OpenStreetMap data, elevation from Copernicus DEM
- [pnpm](https://pnpm.io) workspace monorepo
- [jest-expo](https://docs.expo.dev/develop/unit-testing/) for unit tests

## Getting started

The app has not been scaffolded yet, so there is nothing to run. Once the Expo project
exists, the usual commands will be:

```sh
pnpm install
pnpm start
```

## License

[GPL-3.0](./LICENSE)
