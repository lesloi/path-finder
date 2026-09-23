# Path finder

Path finder is a privacy-first mobile app that generates running and trail routes from a
few criteria: where you start, how far you want to go, and how much elevation gain you
want.

Walkers and hikers can use it too, and cycling/MTB support may come later.

## Privacy-first

Your location, your routes, and your activity data stay on your device. Path finder is
built with no accounts, no analytics, no tracking, and no third-party services in the
loop.

## Planned features

- Generate a route from a starting point, a target distance, and a target elevation gain
- Activity profiles: running/trail first, hiking next, cycling/MTB later
- Route shapes (loops, out-and-back, point-to-point)

## Tech stack

- [Expo](https://expo.dev) (React Native) for iOS and Android
- [pnpm](https://pnpm.io) as the package manager
- TypeScript
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
