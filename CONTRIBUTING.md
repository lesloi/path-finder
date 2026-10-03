# Contributing

Thanks for your interest in Path finder. Issues and pull requests are welcome on
[GitHub](https://github.com/lesloi/path-finder).

## Getting started

- [INSTALL.md](./INSTALL.md) builds the routing graph from OSM and the elevation data.
- [CONTEXT.md](./CONTEXT.md) holds the domain vocabulary to use.
- [DECISIONS.md](./DECISIONS.md) explains the lasting choices; you can question one with an issue.
- [DESIGN.md](./DESIGN.md) guides the interface.

From the root (the server needs Go, built with `CGO_ENABLED=0`):

| Command             | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `pnpm dev`          | Web app on port 5173 and server on port 3000; needs a graph                   |
| `pnpm build`        | Build the web app                                                             |
| `pnpm start`        | Serve the built web app and the routes on port 3000                           |
| `pnpm format`       | Format every file with Prettier                                               |
| `pnpm test`         | Web unit tests                                                                |
| `pnpm test:e2e`     | End-to-end tests in Chromium, on the built app and the Go binary              |
| `pnpm check:format` | Prettier on every file (workflow `check`)                                     |
| `pnpm check:web`    | ESLint, types, unit tests with 90% coverage, end-to-end (workflow `web`)      |
| `pnpm check:server` | `gofmt`, `go vet`, race detector, tests with 90% coverage (workflow `server`) |
| `pnpm check`        | The three `check:*` above                                                     |

One tool, one file: run a single test with `pnpm vitest run path/to/file-test.ts`, or from `apps/server`
with `go test ./engine -run TestName`.

## Privacy-first rules

A pull request that breaks these rules is not merged. If a feature seems to need an
exception, open an issue before implementing it.

- Routes and settings stay on the device. The server keeps no state and logs no locations or
  IP addresses (chi's `Logger` is for development only); it may hold a salted IP hash, rotated at
  least daily, in memory for rate limiting.
- The only runtime third party is the IGN Géoplateforme for map tiles. Any other runtime
  network call needs the maintainer's approval.
- Self-host every script, stylesheet, and font; only the map style and its fonts and icons
  come from the IGN Géoplateforme. No analytics, tracking, or accounts.
- Serve every page with `Referrer-Policy: no-referrer`.
- Ask for geolocation only when the user asks for their location; otherwise the start
  point is picked on the map.

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Conventions

Prettier, ESLint and TypeScript enforce the style of the web app; `gofmt` and `go vet` that of the
server. Follow the neighbouring code for the rest. What they cannot check:

- Never log locations, criteria, or client addresses. Logs are limited to startup.
- Web: data from outside (`localStorage`, files) is `unknown` until checked by small type guards.
  Stored data is parsed field by field, each falling back to its default.
- Server: a request body is decoded into a typed struct and validated before use. Invalid input is
  refused with an error code that names the field, never its value. Expected failures (blocked
  storage, missing file) are caught where they happen and fall back to a default.
- Every user-facing string exists in each lang, in `i18n/`. The server answers with error
  codes, never with a message.
- Web: distances are in km and paces in minutes per km. Server engine: metres, and elevation in
  decimetres in the graph files. Say any other unit in the name.
- Go: wrap errors with `%w` and add context, pass a `context.Context` first to anything that can run
  long, and keep `CGO_ENABLED=0`.
- Comments explain why. A lasting choice points to its section of [DECISIONS.md](./DECISIONS.md).
- Styles follow [DESIGN.md](./DESIGN.md).

## Tests

- Every change comes with unit tests that call functions and components directly. A server route is
  tested through HTTP (`httptest` in Go), and a UI feature gets an end-to-end scenario in `e2e/` for
  its main path; edge cases stay in unit tests.
- Find an element by its `data-testid` in kebab-case, never by the text it shows (ESLint enforces it).
- Assert what an element shows against the dictionary (`criteriaText.en.findRoutes`), not a literal.
- Go tests are table-driven, with a readable name per case. The engine's tests build a graph of a few
  dozen nodes in a temporary directory; none needs a downloaded file, and none calls the network.
- A change to a search comes with a test that cancelling its context stops it.
- Web unit tests never call the network: mock `fetch` with `vi.fn`.

## Licensing of contributions

Path finder is licensed under the [GNU AGPL-3.0-or-later](./LICENSE).

By submitting a contribution, you agree that:

1. Your contribution is licensed under the AGPL-3.0-or-later.
2. You also grant the project maintainer a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable license to use, modify, and redistribute your contribution
   under other terms, including to publish the app on app stores whose terms are not
   compatible with the AGPL.
3. You have the right to submit the contribution under these terms.
