# Path finder project guidelines

## Mission

**Nothing about the user leaves the device unless a route needs it.** Path finder is a
privacy-first web app that generates running and trail routes from a start point, a
distance, and an elevation gain.

If a feature seems to need an exception to a privacy-first rule, ask the owner before
implementing it, rather than opening an issue.

## Architecture

- `apps/web`: Vite + React PWA (manifest, no service worker), MapLibre with Plan IGN tiles.
- `apps/api`: stateless Hono API calling a self-hosted BRouter. It also serves the built
  web app on the same origin.
- Use **pnpm**; scripts are in the root `package.json`.

### Project rules

- `apps/api/src/route-generation` stays plain TypeScript (no browser, Node, or Hono
  imports) so it is unit tested without a server.
- Elevation comes from IGN BD ALTI 25 m, never from BRouter (#30). The tile reader takes
  a directory converted by `apps/api/scripts/convert-bdalti.ts`; the API reads it from
  `BDALTI_DIR`, which is optional: without it, routes have no elevation gain and the target
  elevation gain is ignored.
- The web app sends `import.meta.env.VITE_BUILD_ID` in the `X-Build-Id` header; the API
  answers `426` when it differs from `apps/web/dist/build-id`, so stale tabs reload.
- Model activity type (run / hike / ride) as data, not as branches through the UI.
- Keep the in-app credits page accurate (OSM, Plan IGN, BD ALTI, source code link).
  Every GPX export carries the OSM attribution.

## Contributor guidelines

- Run `pnpm install` after a pull, merge or rebase that changes dependencies.
- After a change, run `pnpm format`, `pnpm lint` then `pnpm typecheck`.
- Before committing, run `pnpm test`, `pnpm test:integration` and `pnpm test:e2e`, unless already
  run since the last change.
- Name branches `type/short-description` (Conventional Branch), with a type like `feature`,
  `bugfix`, `hotfix`, `release` or `chore`.
- Write commit messages as Conventional Commits, under 72 characters.
- Do not add `Co-authored-by:` in commit messages.
- The privacy-first rules, coding conventions, and pull request expectations: @CONTRIBUTING.md

## Issues and decisions

- Issues: GitHub Issues on `lesloi/path-finder` via `gh`. Triage labels: `needs-triage`,
  `needs-info`, `ready-for-agent`, `ready-for-human`, `web` (`apps/web`), `api` (`apps/api`), or
  `infra` (deployment, Docker, CI).
- Check the closed issues labeled `decision` before changing the architecture, and record
  new architecture decisions the same way.
