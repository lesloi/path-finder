**Path finder** is a privacy-first mobile app that generates running and trail routes from a
few criteria: where you start, how far you want to go, and how much elevation gain you
want.

Walkers and hikers can use it too, and cycling/MTB support may come later.

## Stack

- Package manager: **pnpm** only — never npm or yarn. The lockfile is `pnpm-lock.yaml`.
- Framework: **Expo** (React Native), current stable SDK. **Android first**; iOS comes
  later, so don't block on iOS-only work.
- Language: **TypeScript**, everywhere (app, API, route generation).
- API: **Hono** on Node, stateless, calling a self-hosted **BRouter** engine. Shipped as
  Docker images on GitHub Container Registry and run with `docker compose` on a Scaleway
  Instance (`fr-par`). See `docs/adr/0001-self-hosted-routing-backend.md`.
- Maps: MapLibre React Native with Plan IGN tiles. See `docs/adr/0002-ign-basemap-from-device.md`.
- Tests: **jest-expo** with `@testing-library/react-native`.
- Lint/format: whatever the Expo scaffold configures (ESLint via `eslint-config-expo`).
- Android builds: GitHub Actions with `expo prebuild` + Gradle, published to Google Play
  and GitHub Releases. No EAS dependency.

### Repository layout

pnpm workspace monorepo:

- `apps/mobile`: the Expo app.
- `apps/api`: the Hono API.
- `packages/route-generation`: criteria → route set, plain TypeScript, used by the API.

### pnpm specifics

- Expo supports pnpm's isolated `node_modules` from SDK 54 onward. If a native build or
  Metro resolution fails, the documented fallback is `nodeLinker: hoisted` in
  `pnpm-workspace.yaml` — try that before restructuring dependencies.
- Under pnpm, Jest needs `transformIgnorePatterns` that includes `.pnpm`; see the
  [Expo unit testing guide](https://docs.expo.dev/develop/unit-testing/) for the exact
  pattern.

## Commands

Placeholders — confirm each one against `package.json` once the scaffold exists and fix
this table if it drifts.

| Task                | Command                                     |
| ------------------- | ------------------------------------------- |
| Install             | `pnpm install`                              |
| Dev server          | `pnpm start`                                |
| Android / iOS / web | `pnpm android` / `pnpm ios` / `pnpm web`    |
| Unit tests          | `pnpm test`                                 |
| Integration tests   | `pnpm test:integration` (API + BRouter)     |
| Single test file    | `pnpm jest path/to/file-test.tsx`           |
| Single test by name | `pnpm jest -t "generates a loop route"`     |
| Non-watch test run  | `pnpm jest --ci --watchAll=false`           |
| Lint                | `pnpm lint`                                 |
| Type check          | `pnpm typecheck` (`tsc --noEmit`)           |
| Dependency health   | `pnpm expo-doctor`                          |

## Privacy-first rules (non-negotiable)

These are product requirements, not preferences:

- Routes and settings stay on the device; nothing is saved server-side. The only backend
  is our own stateless API (ADR 0001): it receives criteria, keeps no state, and writes no
  logs containing locations or IP addresses.
- The only approved third party at runtime is the IGN Géoplateforme for map tiles
  (ADR 0002). Any other runtime network call needs the owner's explicit approval and, if
  approved, a French or EU provider.
- No analytics, crash reporting, advertising, or tracking SDKs.
- No new dependency on Google Play Services beyond what Expo already requires (F-Droid /
  IzzyOnDroid is a later target).
- Request the narrowest OS permission that works (foreground location only) and degrade
  gracefully when permission is denied.
- No accounts, no logins, no device identifiers.

If a feature seems to need an exception, ask the owner before implementing it.

## Code conventions

- Use the vocabulary in `CONTEXT.md` (route, route set, match, suggestion, effort
  distance…) in code, tests, and issues.
- Keep route generation (criteria → route set) in `packages/route-generation`, plain
  TypeScript free of React Native and Node-specific imports, so it can be unit tested
  without a simulator or a server. It runs in the API.
- Elevation gain and profiles come from Copernicus DEM, never from BRouter
  (`docs/adr/0003-elevation-from-copernicus-not-routing-engine.md`).
- Model activity type (run / hike / ride) as data, not as branches scattered through the UI.
- Prefer small modules with focused tests over large screens.
- Tests live in `__tests__/` directories or as `*-test.ts(x)` files next to the code.
- Unit tests (`pnpm test`) are what runs locally: fast, no Docker, BRouter mocked.
  Integration tests (`pnpm test:integration`) run the API against a real BRouter container
  on one cached segment tile, mainly in CI.
- Keep the in-app credits screen accurate: OpenStreetMap (ODbL), IGN (Licence Ouverte),
  Copernicus DEM, and a link to the source code. Every GPX export carries the OSM
  attribution.
- Do not commit generated artifacts: `node_modules/`, `.expo/`, `coverage/`, and the
  native `ios/` / `android/` directories if continuous native generation is used.

## Commits

- **Conventional Commits**:

  ```
  <type>(<scope>): <imperative summary in English>
  ```

  Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, `ci`.
  Example scopes: `routing`, `location`, `elevation`, `ui`, `app`.
- Imperative mood, no trailing period, summary under 72 characters.
- Add a body when the reason is not obvious; use `BREAKING CHANGE:` for breaking changes.
- Run the relevant checks (lint, types, tests) before committing.

## Definition of done

- New behavior is covered by tests, or the commit message says why not.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass (and `pnpm test:integration` in CI).
- `README.md` and this file still match reality.
- No new dependency that conflicts with the privacy-first rules.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `lesloi/path-finder`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default label names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
