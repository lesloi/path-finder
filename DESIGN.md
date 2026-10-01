# Design system

The web app's look, in [Tailwind CSS](https://tailwindcss.com) restricted to the project's
tokens, in [`apps/web/src/components`](./apps/web/src/components). Tailwind compiles at build time: nothing
loads at runtime. No component library. Icons come from [lucide-react](https://lucide.dev)
only, bundled with the app.

## Layout

- The Plan IGN map fills the screen. The controls float over it.
- **Phones** (below 768 px): a bottom sheet holds the view's content. The floating buttons
  and the map attribution stay above it, whatever its height (`--sheet-height`); a floating
  button near the sheet hides while it is expanded, so it never covers the ones at the top.
- **Desktops** (768 px and up, the `desktop:` variant): a left column, 380 px wide and as tall
  as its content, holds it instead.
- Settings and legal pages are sub-pages, modal dialogs over the map:
  - on phones, full screen, with a back arrow at the leading edge (Android's top app bar;
    close to iOS's back button), so the page reads as a step in the app;
  - on desktops, centred on a scrim, as tall as their content: 480 px wide, 640 px for the
    legal pages, with a cross at the right that closes every page.
  - Leaving a page goes back through the browser history when the tab came from where it
    leads (`goTo` in `navigation.ts`), so the system's back gesture never reopens it.

The 768 px breakpoint is `--breakpoint-desktop` in [`components/index.css`](./apps/web/src/components/index.css)
and the query in `useDesktop` (`ui/use-desktop.ts`): change both together.

## Tokens

All in [`components/index.css`](./apps/web/src/components/index.css), as Tailwind theme variables. The theme
drops Tailwind's default colours, radii, shadows, fonts, type sizes, and breakpoints, so a
colour or a radius outside the tokens does not exist. Spacing is Tailwind's own scale, in
`rem` so it follows the user's font size, and any multiple compiles: gaps, paddings, and
margins use the steps below, and other multiples (`min-h-13`) only give a component its own
dimensions (a 52 px row). Only the map's own colours (white under the start point) are
written raw.

| Utilities                                                 | Values                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `accent`, `accent-hover`, `accent-soft`                   | `#2b6f9e`; dark mode `#6fb0dd`                                |
| `on-accent`                                               | Text on the accent: white; dark text in dark mode             |
| `surface`, `surface-2`, `ink`, `ink-2`, `border`, `scrim` | UI surfaces, text, and borders, light and dark                |
| `route-1`, `route-2`, `route-3`                           | `#e0115f`, `#1d2433`, `#7a3fc4`                               |
| `slope-1` … `slope-4`                                     | Uphill grade < 3 %, 3–6 %, 6–10 %, > 10 %                     |
| `paved`, `unpaved`                                        | Road surfaces                                                 |
| `start`                                                   | The start point's brown ring, as in the logo                  |
| spacing `1`, `2`, `3`, `4`, `6`                           | 4, 8, 12, 16, 24 px (Tailwind's 4 px steps)                   |
| `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-full`  | 8, 14, 22 px, and a full pill                                 |
| `shadow-float`                                            | The one shadow, for everything that floats                    |
| `text-sm`, `text-base`, `text-lg`, `text-xl`              | 13, 15, 18, 24 px, in `rem` like the spacing                  |
| `font-sans`                                               | The system font stack                                         |
| `touch` (`size-touch`, `min-h-touch`)                     | 44 px, the smallest touch target                              |
| `column` (`w-column`)                                     | 380 px, the desktop left column                               |
| `top-safe-*`, `pb-safe-*`, and the other sides            | An offset or a padding from a screen edge, plus its safe area |

**Stacking** (`z-*`): 4 for the sheet and the column, 5 for the floating buttons, 9 for a
toast, 11 and 12 for an open dropdown and its scrim. Sub-pages are in the top
layer, above them all.

**Dark mode** follows the Theme setting (System, Light or Dark) for the UI only. System follows
`prefers-color-scheme`; a forced theme sets `data-theme` on `<html>`, which `main.tsx` applies before
the first render. UI colours are variables declared once with `light-dark()` and resolved by
`color-scheme`, so markup names a role (`bg-surface`) and never uses `dark:`. The Plan IGN
map stays light, so the colours drawn on it (routes, start point) do not change.

MapLibre's stylesheet sits outside Tailwind's layers and beats any utility: the map's own
elements (attribution, cursor) are styled in plain CSS at the end of `ui/index.css`.

## Components

React components exist where markup alone is not enough. The others are Tailwind class
strings in [`components/styles.ts`](./apps/web/src/components/styles.ts), one per element, so every screen
draws them the same way.

| Component             | Where                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round floating button | `FLOATING_BUTTON`, `aria-pressed` when it toggles                                                                                                                     |
| Bottom sheet          | `<BottomSheet label expanded onExpandedChange>`: collapsed or expanded; its handle is a button with `aria-expanded`, tapped or swiped                                 |
| Left column           | `SIDE_COLUMN`                                                                                                                                                         |
| Buttons               | `ICON_BUTTON` for an icon alone                                                                                                                                       |
| List row              | `GROUP_TITLE`, then `LIST` of `LIST_ROW`; `LIST_ROW_CHEVRON` for a link                                                                                               |
| Dropdown              | `<Dropdown label value options onChange>`: a listbox whose options may have icons                                                                                     |
| Sub-page              | `<SubPage title back wide language navigate>`: a `<dialog>` with its title, a back arrow, and a cross on desktops                                                     |
| Chips                 | `CHIP_ROW` of `CHIP`, a row that scrolls sideways; `data-set` highlights a criterion that is not the default                                                          |
| Segmented control     | `<SegmentedControl label value options onChange>`: native radio buttons, side by side                                                                                 |
| Slider                | `<Slider label value shown min max step onChange>`: a native range input with its value in large type                                                                 |
| Dialog                | `<Dialog title closeLabel onClose>`: a native `<dialog>` that applies changes as they are made, closed by its cross, Escape, or its scrim                             |
| Primary button        | `PRIMARY_BUTTON`: the view's one main action                                                                                                                          |
| Toast                 | `TOAST` with `role="alert"`, in the floating buttons' colours: what went wrong, then on a second line what to do; the view hides it after a few seconds or on a click |
| Long text             | `PROSE`, for the legal pages                                                                                                                                          |

A component comes with the first screen that uses it, as the prototype on the
`prototype/ui-redesign` branch draws it:

- the route set view (#9): a ghost button to go back to the list;
- the layers button (#58): a popover next to the floating button that opened it.

Behaviour comes from native elements first: `<dialog>` for a dialog, the `popover` attribute
for a popover, `<input type="range">` for a slider. Add a headless library (Base UI) only for
a component that no native element covers, such as a search with suggestions.

## Rules

- One primary button per view.
- Touch targets are at least 44 px (`touch`).
- Respect safe areas: the page sets `viewport-fit=cover`, and anything at a screen edge
  uses the `*-safe-*` utilities.
- Hide an action that cannot run yet rather than disable it.
- A dialog opened from a chip applies changes as they are made and closes with its cross or
  its scrim.
- Icons are decorative (`aria-hidden`); the button or link around them carries the name.
- Every user-facing string exists in English and French.
