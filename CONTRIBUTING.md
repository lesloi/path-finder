# Contributing

Thanks for your interest in Path finder. Issues and pull requests are welcome on
[GitHub](https://github.com/lesloi/path-finder).

## Getting started

- [INSTALL.md](./INSTALL.md) sets up BRouter and the elevation data.
- [CONTEXT.md](./CONTEXT.md) holds the domain vocabulary to use in code, tests, and issues.

| Command                 | What it does                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `pnpm format`           | Format the code with Prettier                                  |
| `pnpm lint`             | ESLint                                                         |
| `pnpm typecheck`        | Type check the apps and the end-to-end tests                   |
| `pnpm test`             | Unit tests                                                     |
| `pnpm test:coverage`    | Unit tests with coverage, failing below 80%                    |
| `pnpm test:integration` | API integration tests, through HTTP                            |
| `pnpm test:e2e`         | End-to-end tests in Chromium, on the built app                 |
| `pnpm dev`              | Web app on port 5173 and API on port 3000; needs `BROUTER_URL` |
| `pnpm build`            | Build the web app                                              |
| `pnpm start`            | Serve the built web app and the API on port 3000               |

## Privacy-first rules (non-negotiable)

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

## Coding conventions

### Files and modules

- File names are kebab-case: `route-set.ts`, `start-point-map.tsx`.
- Tests sit next to the code they test, named `<file>-test.ts` or `<file>-test.tsx`.
- Import local files with their extension (`./settings.ts`), as Node runs the API's
  TypeScript directly.
- Import types with `import type` or an inline `type` (`verbatimModuleSyntax`).
- External imports come first, then a blank line, then local imports.
- Named exports only; no default exports.
- A folder exposes its public API through an `index.ts` that re-exports its modules.
- Use `type` aliases, plain objects, and functions: no `class`, `interface`, or `enum`.
  Factories are named `create*` and return functions or objects that close over their
  state (`createApp`, `createRateLimiter`, `createBRouter`).

### Formatting

Prettier applies the formatting (`pnpm format`), and CI checks it:

- 2-space indentation, single quotes, semicolons, trailing commas.
- Lines up to about 120 characters.

Use numeric separators for large numbers: `15_000`, `2_500`.

### Naming

- Module constants are `SCREAMING_SNAKE_CASE`; functions and variables `camelCase`;
  components and types `PascalCase`.
- Say the unit when the type does not: in the name (`LONG_PRESS_MS`, `windowMs`) or in a
  comment. Internally, distances are in km and paces in minutes per km.

### Types and data

- `strict` TypeScript. Model variants as unions (`'run' | 'hike'`,
  `{ admitted: true } | { admitted: false; retryAfter: number }`).
- Type lookup tables with `Record<Key, …>` or `satisfies`, so a missing activity or
  language fails the typecheck.
- Data from outside (request bodies, `localStorage`, files) is `unknown` until checked by
  small type guards (`isObject`, `isNumber`).
- Stored data is parsed field by field, each falling back to its default, so old or
  damaged data never breaks the app.
- Optional fields are left out rather than set to `undefined`:
  `...(condition && { field })`.

### Errors and logs

- Invalid input throws a `RangeError` whose message names the field, never its value.
- Expected failures (blocked storage, missing file) are caught where they happen and
  fall back to a default.
- Never log locations, criteria, or client addresses. Logs are limited to startup.

### Comments

- Explain why, not what. A comment states a constraint, a unit, or a reason in one
  plain sentence.
- Exported functions and types get a `/** … */` comment that says what they return or
  hold, in domain terms.
- Reference the issue behind a rule or a bound: `within the #7 bounds`.

### React

- The app is multilingual and supports English and French: every user-facing string
  exists in both.
- Function components with inline props types; one exported component per file, with
  small private helpers below it.
- User-facing strings live in a `text` object per file, typed
  `satisfies Record<Language, unknown>`, and read through `const t = text[language]`.
  No i18n library.
- Shared device state goes through `useSyncExternalStore` (see `settings.ts`), not a
  state library.
- Styles follow [DESIGN.md](./DESIGN.md): Tailwind classes limited to its tokens, shared
  class strings in `ui/styles.ts`, and lucide-react icons.

### Tests

- Every change comes with unit tests, which call functions and components directly. An API
  route is tested through HTTP in an integration test, and a UI feature gets an end-to-end
  scenario in `e2e/` for its main path, while its edge cases stay in unit tests.
- Integration tests are named `<file>-integration-test.ts` and run in `pnpm test:integration`,
  never in `pnpm test`.
- Vitest with globals (`describe`, `it`, `expect`, `vi`), no imports needed.
- One `describe` per exported function or component. Each `it` is a present-tense
  sentence about behavior: `it('rejects a target duration too short for …')`.
- Use `it.each` for tables of cases, with a readable label as the first column.
- Separate arrange, act, and assert with blank lines.
- Build test inputs by spreading a valid base: `{ ...valid, pace: 0 }`.
- Components are tested through what the user sees, with Testing Library queries by
  label or role.
- Mock `fetch` and BRouter with `vi.fn`; unit tests never call the network.
- End-to-end tests live in `e2e/`: Playwright drives the built app served by `pnpm start`.
  Import `test` and `expect` from `e2e/test.ts`, which answers the IGN Géoplateforme from
  `e2e/fixtures/` and fails a test whose browser calls any other host. Run
  `pnpm exec playwright install chromium` in `e2e/` once.

## Before opening a pull request

A pull request is ready when:

- new behavior is tested at each level the [Tests](#tests) conventions ask for;
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`,
  and `pnpm test:e2e` pass;
- coverage stays at or above 80% (`pnpm test:coverage`) and `pnpm build` succeeds, as in CI;
- `README.md` and `AGENTS.md` match reality;
- it follows the [project rules](./AGENTS.md#project-rules) and the coding conventions above.

## Licensing of contributions

Path finder is licensed under the [GNU AGPL-3.0-or-later](./LICENSE).

By submitting a contribution, you agree that:

1. Your contribution is licensed under the AGPL-3.0-or-later.
2. You also grant the project maintainer a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable license to use, modify, and redistribute your contribution
   under other terms, including to publish the app on app stores whose terms are not
   compatible with the AGPL.
3. You have the right to submit the contribution under these terms.
