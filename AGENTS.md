**Path finder** is a privacy-first web app that generates running and trail routes from a
start point, a distance, and an elevation gain.

- `apps/web`: Vite + React PWA (manifest, no service worker), MapLibre with Plan IGN tiles.
- `apps/api`: stateless Hono API calling a self-hosted BRouter. It also serves the built
  web app on the same origin.
- Use **pnpm**; scripts are in the root `package.json`.

Without `BDALTI_DIR`, routes have no elevation gain and the target elevation gain is ignored.

## Privacy-first rules (non-negotiable)

If a feature seems to need an exception, ask the owner before implementing it.

- Routes and settings stay on the device. The API keeps no state and logs no locations or
  IP addresses; it may hold a salted IP hash, rotated at least daily, in memory for rate limiting.
- The only runtime third party is the IGN Géoplateforme for map tiles. Any other runtime
  network call needs the owner's approval and a French or EU provider.
- Self-host every script, stylesheet, and font. No analytics, tracking, or accounts.
- Serve every page with `Referrer-Policy: no-referrer`.
- Ask for geolocation only when the user asks for their location; otherwise the start
  point is picked on the map.

## Code conventions

- Use the vocabulary in `CONTEXT.md` in code, tests, and issues.
- `apps/api/src/route-generation` stays plain TypeScript (no browser, Node, or Hono
  imports) so it is unit tested without a server.
- Elevation comes from IGN BD ALTI 25 m, never from BRouter (#30). The tile reader takes
  a directory converted by `apps/api/scripts/convert-bdalti.ts`; the API reads it from
  `BDALTI_DIR`, which is optional.
- The web app sends `import.meta.env.VITE_BUILD_ID` in the `X-Build-Id` header; the API
  answers `426` when it differs from `apps/web/dist/build-id`, so stale tabs reload.
- Model activity type (run / hike / ride) as data, not as branches through the UI.
- Unit tests mock BRouter.
- Keep the in-app credits page accurate (OSM, Plan IGN, BD ALTI, source code link).
  Every GPX export carries the OSM attribution.

## Commits and done

- Conventional Commits under 72 characters. Scopes: `routing`, `location`, `elevation`,
  `ui`, `app`.
- Done means: new behavior is tested, `pnpm lint`, `pnpm typecheck`, and `pnpm test`
  pass, and `README.md` and this file match reality.

## Agent skills

- Issues: GitHub Issues on `lesloi/path-finder` via `gh`. Triage labels: `needs-triage`,
  `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- Record architecture decisions as closed issues labeled `decision`.
