# Design system

The web app's look, in plain CSS: one tokens file of custom properties and one stylesheet
per component, in [`apps/web/src/ui`](./apps/web/src/ui). No Tailwind, no component
library. Icons come from [lucide-react](https://lucide.dev) only, bundled with the app.

## Layout

- The Plan IGN map fills the screen. The controls float over it.
- **Phones** (below 768 px): a bottom sheet holds the view's content. The floating buttons
  and the map attribution stay above it, whatever its height (`--sheet-height`).
- **Desktops** (768 px and up): a left column, 380 px wide, holds it instead.
- Settings and legal pages are full-screen sub-pages, at most 560 px wide on desktops.

The 768 px breakpoint is in the stylesheets and in `useDesktop` (`ui/use-desktop.ts`): change
both together.

## Tokens

All in [`ui/tokens.css`](./apps/web/src/ui/tokens.css). Colours, spacing, radii, the
shadow, and type sizes come from tokens; only the map's own colours (white under the start
point) and a component's own dimensions (a 52 px row, a 560 px page) are written raw.

| Tokens                                                | Values                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `--accent`, `--accent-hover`, `--accent-soft`         | `#2b6f9e`; dark mode `#6fb0dd`                      |
| `--on-accent`                                         | Text on the accent: white; dark text in dark mode   |
| `--surface`, `--surface-2`, `--text`, `--text-2`, `--border`, `--scrim` | UI surfaces, text, and borders, light and dark |
| `--route-1`, `--route-2`, `--route-3`                 | `#e0115f`, `#1d2433`, `#7a3fc4`                     |
| `--slope-1` … `--slope-4`                             | Uphill grade < 3 %, 3–6 %, 6–10 %, > 10 %           |
| `--paved`, `--unpaved`                                | Road surfaces                                       |
| `--start`                                             | The start point's brown ring, as in the logo        |
| `--space-1` … `--space-5`                             | 4, 8, 12, 16, 24 px                                 |
| `--radius-s`, `--radius-m`, `--radius-l`, `--radius-full` | 8, 14, 22 px, and a full pill                   |
| `--shadow`                                            | The one shadow, for everything that floats          |
| `--text-s`, `--text-m`, `--text-l`, `--text-xl`       | 13, 15, 18, 24 px                                   |
| `--font`                                              | The system font stack                               |
| `--touch`                                             | 44 px, the smallest touch target                    |
| `--column-width`                                      | 380 px, the desktop left column                     |

**Dark mode** follows `prefers-color-scheme` for the UI only. The Plan IGN map stays light,
so the colours drawn on it (routes, start point) do not change.

## Components

| Component          | Stylesheet               | Markup                                                             |
| ------------------ | ------------------------ | ------------------------------------------------------------------ |
| Round floating button | `floating-button.css` | `.floating-button`, `aria-pressed` when it toggles                 |
| Bottom sheet       | `bottom-sheet.css`       | `<BottomSheet label>`: collapsed or expanded; its handle is a button with `aria-expanded`, tapped or swiped |
| Left column        | `side-column.css`        | `aside.side-column` with `.side-column-brand` and `.side-column-body` |
| Chip               | `chip.css`               | `button.chip` in `.chips`; `.set` when it is not the default       |
| Buttons            | `button.css`             | `.button` with `.button-primary`, `.button-secondary`, or `.button-ghost`; `.icon-button` for an icon alone |
| Segmented control  | `segmented-control.css`  | `.segmented-control` of buttons with `aria-pressed`                |
| Slider             | `slider.css`             | `.slider`: an `<output>` in large type, the range input, `.slider-scale` |
| List row           | `list-row.css`           | `.group-title`, then `.list` of `.list-row`; `.list-row-chevron` for a link |
| Dropdown           | `dropdown.css`           | `<Dropdown label value options onChange>`: a listbox whose options may have icons |
| Sub-page header    | `sub-page.css`           | `<SubPage title back language>`: a back arrow and the title        |
| Toast              | `toast.css`              | `p.toast` with `role="alert"`; the view that shows it hides it after a few seconds |
| Popover            | `popover.css`            | `.popover` next to the floating button that opened it              |

React components exist only where markup alone is not enough (`BottomSheet`, `Dropdown`,
`SubPage`); the others are class names. Chip, segmented control, slider, and popover are
styles only until a screen uses them: the criteria form (#70), the route set view (#9), and
the layers button (#58) add their behaviour, and the chip dialog with its scrim (`--scrim`).

## Rules

- One primary button per view.
- Touch targets are at least 44 px (`--touch`).
- Respect safe areas: the page sets `viewport-fit=cover`, and anything at a screen edge
  pads with `env(safe-area-inset-*)`.
- Hide an action that cannot run yet rather than disable it.
- A dialog opened from a chip applies changes as they are made and closes with its cross or
  its scrim.
- Icons are decorative (`aria-hidden`); the button or link around them carries the name.
- Every user-facing string exists in English and French.
