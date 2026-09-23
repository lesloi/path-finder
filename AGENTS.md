Path finder** is a privacy-first mobile app that generates running and trail routes from a
few criteria: where you start, how far you want to go, and how much elevation gain you
want.

Walkers and hikers can use it too, and cycling/MTB support may come later.

## Stack

- Package manager: **pnpm** only — never npm or yarn. The lockfile is `pnpm-lock.yaml`.
- Framework: **Expo** (React Native), current stable SDK, for iOS and Android.
- Language: **TypeScript**.
- Tests: **jest-expo** with `@testing-library/react-native`.
- Lint/format: whatever the Expo scaffold configures (ESLint via `eslint-config-expo`).

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
| Tests               | `pnpm test`                                 |
| Single test file    | `pnpm jest path/to/file-test.tsx`           |
| Single test by name | `pnpm jest -t "generates a loop route"`     |
| Non-watch test run  | `pnpm jest --ci --watchAll=false`           |
| Lint                | `pnpm lint`                                 |
| Type check          | `pnpm typecheck` (`tsc --noEmit`)           |
| Dependency health   | `pnpm expo-doctor`                          |

## Privacy-first rules (non-negotiable)

These are product requirements, not preferences:

- Location, routes, and activity data stay on the device. Do not add a backend that
  receives them without an explicit decision from the owner.
- No analytics, crash reporting, advertising, or tracking SDKs, and no third-party
  network calls at runtime, unless the owner explicitly approves them.
- Request the narrowest OS permission that works (foreground location only) and degrade
  gracefully when permission is denied.
- No accounts, no logins, no device identifiers.

If a feature seems to need an exception, ask the owner before implementing it.

## Code conventions

- Keep route generation (criteria → route) in plain TypeScript, free of React Native
  imports, so it can be unit tested without a simulator and reused across activity types.
- Model activity type (run / hike / ride) as data, not as branches scattered through the UI.
- Prefer small modules with focused tests over large screens.
- Tests live in `__tests__/` directories or as `*-test.ts(x)` files next to the code.
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
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
- `README.md` and this file still match reality.
- No new dependency that conflicts with the privacy-first rules.
