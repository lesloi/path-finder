**Path finder** is a privacy-first web app that generates running and trail routes from a
start point, a distance, and an elevation gain.

## Stack

- pnpm workspace monorepo, **pnpm** only. TypeScript everywhere.
- `apps/web`: Vite + React single-page app, mobile-first, installable as a PWA (manifest,
  no service worker). Maps with MapLibre GL JS and Plan IGN tiles.
- `apps/api`: stateless Hono API on Node, calling a self-hosted BRouter. It also serves the
  built web app on the same origin. Deployed as Docker images.
- Vitest, with `@testing-library/react` for the web app.

## Commands

Run from the repo root. Keep this table in sync with the root `package.json`.

| Task                | Command                                     |
| ------------------- | ------------------------------------------- |
| Install             | `pnpm install`                              |
| Dev servers         | `pnpm dev` (web on 5173, API on 3000)       |
| Build the web app   | `pnpm build`                                |
| Serve the build     | `pnpm start` (API serves `apps/web/dist`)   |
| Unit tests          | `pnpm test`                                 |
| Unit test coverage  | `pnpm test:coverage` (fails below 80 %)     |
| Integration tests   | `pnpm test:integration` (placeholder, #13)  |
| Single test file    | `pnpm test path/to/file-test.tsx`           |
| Single test by name | `pnpm test -t "generates a loop route"`     |
| Watch mode          | `pnpm vitest`                               |
| Lint                | `pnpm lint`                                 |
| Type check          | `pnpm typecheck`                            |

## Privacy-first rules (non-negotiable)

These are product requirements. If a feature seems to need an exception, ask the owner
before implementing it.

- Routes and settings stay on the device. The only backend is our own stateless API
  (#28): it keeps no state and logs no locations or IP addresses. It may hold a
  salted, daily-rotated hash of the client IP in memory for rate limiting.
- The only runtime third party is the IGN Géoplateforme for map tiles (#29). Any other
  runtime network call needs the owner's approval and a French or EU provider.
- Self-host every script, stylesheet, and font. No analytics, crash reporting, advertising,
  or tracking SDKs. No accounts, logins, or device identifiers.
- Serve every page with `Referrer-Policy: no-referrer`.
- Ask for geolocation only when the user asks for their location; fall back to picking the
  start point on the map.

## Code conventions

- Use the vocabulary in `CONTEXT.md` (route, route set, match, suggestion, effort
  distance…) in code, tests, and issues.
- `apps/api/src/route-generation` (criteria → route set) stays plain TypeScript, free of
  browser, Node, and Hono imports, so it is unit tested without a server.
- Elevation gain and profiles come from IGN BD ALTI 25 m, never from BRouter (#30).
- Model activity type (run / hike / ride) as data, not as branches through the UI.
- Tests live in `__tests__/` or as `*-test.ts(x)` next to the code. Unit tests mock
  BRouter; integration tests run against a real BRouter container in CI.
- Keep the in-app credits page accurate: OpenStreetMap (ODbL), IGN Plan IGN and BD ALTI
  (Licence Ouverte), and a link to the source code. Every GPX export carries the OSM
  attribution.

## Commits and done

- Conventional Commits: `<type>(<scope>): <imperative summary>`, under 72 characters.
  Scopes: `routing`, `location`, `elevation`, `ui`, `app`.
- Done means: new behavior is tested (or the commit says why not), `pnpm lint`,
  `pnpm typecheck`, and `pnpm test` pass, and `README.md` and this file match reality.

## Agent skills

- Issue tracker: GitHub Issues on `lesloi/path-finder` via `gh`. External PRs are not a
  triage surface.
- Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
  `wontfix`.
- Domain docs: `CONTEXT.md` at the repo root. Record architecture decisions as closed
  GitHub issues labeled `decision`, never under `docs/`.
