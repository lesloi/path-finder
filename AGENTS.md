# Path finder

Path finder is a web app that generates running and trail routes from a start point, a distance
and an elevation gain. Vocabulary: [CONTEXT.md](./CONTEXT.md).

## Architecture

- `apps/web`: Vite + React PWA, MapLibre with Plan IGN tiles.
- `apps/api`: stateless Hono API calling a self-hosted BRouter; it also serves the built web app.
- pnpm; the scripts are in the root `package.json`.

By default:

- `apps/api/src/route-generation` stays plain TypeScript (no browser, Node or Hono imports), so it is
  tested without a server.
- Activity type (run / hike / ride) is data, not branches through the UI.
- The web app sends `VITE_BUILD_ID` in `X-Build-Id`; the API answers `426` on a mismatch so stale tabs reload.
- The credits page stays accurate, and every GPX export carries the OSM attribution.
- Elevation comes from BD ALTI through `BDALTI_DIR`, which is optional: without it routes have no elevation gain.

## Decisions

[DECISIONS.md](./DECISIONS.md) holds the lasting choices and their reasons, by theme. Read the section
of the subject you touch. A decision can be questioned: if it no longer holds, say so, propose an
alternative with your arguments, and rewrite its entry once the owner agrees. Add an entry only for a
choice that is costly to reverse and whose reason the code does not show.

## Working

- After a change: `pnpm format`, `pnpm lint`, `pnpm typecheck`. Before committing: the tests
  (`pnpm test`, `pnpm test:integration`, `pnpm test:e2e`), unless already run since the last change.
- Run `pnpm install` after a pull, merge or rebase that changes dependencies.
- Branches: `type/short-description` (`feature`, `bugfix`, `hotfix`, `release`, `chore`). Commits:
  Conventional Commits under 72 characters, without `Co-authored-by:`.
- Update the docs only when a rule, a convention or a command changes, not for a new feature or component.

## Privacy

**Nothing about the user leaves the device unless a route needs it.** The rules are in
[CONTRIBUTING.md](./CONTRIBUTING.md#privacy-first-rules). If a feature seems to need an
exception, ask the owner before implementing it.

## Issues

- GitHub Issues on `lesloi/path-finder`. Labels: `needs-triage`, `needs-info`,
  `ready-for-agent`, `ready-for-human`, `web`, `api`, `infra`.
- To change an issue, edit its description rather than adding a comment; keep comments for a discussion.
- Declare a dependency with GitHub's relations (`--blocked-by`, `--blocking`, `--parent`), not in the text.
