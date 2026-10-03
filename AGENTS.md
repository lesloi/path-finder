# Path finder

Path finder is a web app that generates running and trail routes from a start point, a distance
and an elevation gain. Vocabulary: [CONTEXT.md](./CONTEXT.md).

## Architecture

- `apps/web`: Vite + React PWA, MapLibre with Plan IGN tiles.
- `apps/server`: one stateless Go binary (chi). It generates routes and loops in process on a graph
  built ahead of serving, and it serves the built web app on the same origin. No BRouter, no second service.
- The graph is built from OSM PBF files and BD ALTI by the binary's own `build-graph` and `build-alt`
  commands, never while serving. The server maps the files read-only.
- pnpm for the web app, Go for the server (`CGO_ENABLED=0`); the scripts are in the root `package.json`.

By default:

- `apps/server/engine` stays plain Go (no `net/http` or chi imports), so it is tested without a server.
- A search watches its `context.Context`: a client that leaves, or a timeout, stops the work.
- The number of concurrent searches is capped (chi `Throttle`, one cap for loops, one for routes);
  beyond it the answer is `429`, never a queue.
- Activity type (run / hike / ride) is data, not branches through the UI or the engine.
- The web app sends `VITE_BUILD_ID` in `X-Build-Id`; the server answers `426` on a mismatch so stale tabs reload.
- The credits page stays accurate, and every GPX export carries the OSM attribution.
- Elevation comes from BD ALTI and is stored on every graph node at build time; the server never reads
  BD ALTI tiles while serving.

## Decisions

[DECISIONS.md](./DECISIONS.md) holds the lasting choices and their reasons, by theme. Read the section
of the subject you touch. A decision can be questioned: if it no longer holds, say so, propose an
alternative with your arguments, and rewrite its entry once the owner agrees. Add an entry only for a
choice that is costly to reverse and whose reason the code does not show.

## Working

- After a change: `pnpm format`. Before committing: `pnpm check:web` and `pnpm check:server` for what you touched
  (lint, types and tests with coverage, end-to-end for the web; `gofmt`, `go vet`, the race detector and tests with
  coverage for the server), and `pnpm check:format` for the docs and config, unless already run since the last
  change. `pnpm check` runs all three; CI runs one workflow each.
- Run `pnpm install` after a pull, merge or rebase that changes dependencies.
- A benchmark or a long build is never started without the owner's go-ahead.
- Branches: `type/short-description` (`feature`, `bugfix`, `hotfix`, `release`, `chore`). Commits:
  Conventional Commits under 72 characters, without `Co-authored-by:`.
- Update the docs only when a rule, a convention or a command changes, not for a new feature or component.

## Privacy

**Nothing about the user leaves the device unless a route needs it.** The rules are in
[CONTRIBUTING.md](./CONTRIBUTING.md#privacy-first-rules). If a feature seems to need an
exception, ask the owner before implementing it.

## Issues

- GitHub Issues on `lesloi/path-finder`. Labels: `needs-triage`, `needs-info`,
  `ready-for-agent`, `ready-for-human`, `web`, `api` (the server), `infra`.
- To change an issue, edit its description rather than adding a comment; keep comments for a discussion.
- Declare a dependency with GitHub's relations (`--blocked-by`, `--blocking`, `--parent`), not in the text.
