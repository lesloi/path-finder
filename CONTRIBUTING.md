# Contributing

Thanks for your interest in Path finder. Issues and pull requests are welcome on
[GitHub](https://github.com/lesloi/path-finder).

## Getting started

- [INSTALL.md](./INSTALL.md) sets up BRouter and the elevation data.
- [CONTEXT.md](./CONTEXT.md) holds the domain vocabulary to use.
- [DECISIONS.md](./DECISIONS.md) explains the lasting choices; you can question one with an issue.
- [DESIGN.md](./DESIGN.md) guides the interface.

| Command                 | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `pnpm format`           | Format the code with Prettier                                  |
| `pnpm lint`             | ESLint                                                         |
| `pnpm typecheck`        | Type check the apps and the end-to-end tests                   |
| `pnpm test`             | Unit tests                                                     |
| `pnpm test:coverage`    | Unit tests with coverage, failing below 90%                    |
| `pnpm test:integration` | API integration tests, through HTTP                            |
| `pnpm test:e2e`         | End-to-end tests in Chromium, on the built app                 |
| `pnpm dev`              | Web app on port 5173 and API on port 3000; needs `BROUTER_URL` |
| `pnpm build`            | Build the web app                                              |
| `pnpm start`            | Serve the built web app and the API on port 3000               |

## Privacy-first rules

A pull request that breaks these rules is not merged. If a feature seems to need an
exception, open an issue before implementing it.

- Routes and settings stay on the device. The API keeps no state and logs no locations or
  IP addresses; it may hold a salted IP hash, rotated at least daily, in memory for rate limiting.
- The only runtime third party is the IGN Géoplateforme for map tiles. Any other runtime
  network call needs the maintainer's approval.
- Self-host every script, stylesheet, and font; only the map style and its fonts and icons
  come from the IGN Géoplateforme. No analytics, tracking, or accounts.
- Serve every page with `Referrer-Policy: no-referrer`.
- Ask for geolocation only when the user asks for their location; otherwise the start
  point is picked on the map.

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Conventions

Prettier, ESLint and TypeScript enforce the style. Follow the neighbouring code for the rest. What
they cannot check:

- Never log locations, criteria, or client addresses. Logs are limited to startup.
- Data from outside (request bodies, `localStorage`, files) is `unknown` until checked by small
  type guards. Stored data is parsed field by field, each falling back to its default.
- Invalid input throws a `RangeError` whose message names the field, never its value. Expected
  failures (blocked storage, missing file) are caught where they happen and fall back to a default.
- Every user-facing string exists in each lang, in `i18n/`. The API answers with error
  codes, never with a message.
- Internally, distances are in km and paces in minutes per km; say any other unit in the name.
- Comments explain why. A lasting choice points to its section of [DECISIONS.md](./DECISIONS.md).
- Styles follow [DESIGN.md](./DESIGN.md).

## Tests

- Every change comes with unit tests that call functions and components directly. An API route is
  tested through HTTP in an integration test (`<file>-integration-test.ts`), and a UI feature gets an
  end-to-end scenario in `e2e/` for its main path; edge cases stay in unit tests.
- Find an element by its `data-testid` in kebab-case, never by the text it shows (ESLint enforces it).
- Assert what an element shows against the dictionary (`criteriaText.en.findRoutes`), not a literal.
- Unit tests never call the network: mock `fetch` and BRouter with `vi.fn`.

## Licensing of contributions

Path finder is licensed under the [GNU AGPL-3.0-or-later](./LICENSE).

By submitting a contribution, you agree that:

1. Your contribution is licensed under the AGPL-3.0-or-later.
2. You also grant the project maintainer a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable license to use, modify, and redistribute your contribution
   under other terms, including to publish the app on app stores whose terms are not
   compatible with the AGPL.
3. You have the right to submit the contribution under these terms.
