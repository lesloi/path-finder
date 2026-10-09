# Design

Tailwind classes limited to the tokens of [`components/index.css`](../apps/web/src/components/index.css),
and [lucide-react](https://lucide.dev) icons. No component library.

## Reuse

The components already exist in [`apps/web/src/components`](../apps/web/src/components): look there before
drawing anything. Shared class strings (buttons, list rows, chips, toast…) are in `components/styles.ts`.
Need something slightly different? Extend the existing component or add a variant, rather than a copy.
Behaviour comes from native elements first (`<dialog>`, `popover`, `<input type="range">`).

## Layout

- The map fills the screen and the controls float over it.
- Phones: a bar over the top of the map sums up the criteria and opens them in a full-screen layer. A bottom sheet
  holds the routes found: a carousel, whose card in the middle is the selected route, then the detail of that route
  once it is opened. Desktops: the criteria are in a left column, the routes found in a right column, and the
  selected route in a dock along the bottom. The column and the dock are only there when there is something to
  show, and nothing is selected by default.
- The selected route stays in the free part of the map: the framing keeps clear of the bar and the sheet on phones,
  and of the columns and the dock on desktops. The map does not move when the right column or the dock come and
  go: the framing always keeps their room clear.
- Settings and legal pages are dialogs over the map: full screen on phones, centred on desktops.

## Consistency

- One page margin per kind of container (sheet, column, dialog), the same on every side, taken from the
  spacing scale.
- The content of a container shares the same left and right edges; nothing sticks out or is offset.
- The same element is aligned the same way in every view (titles, main button, lists).
- Centre empty states and the label of a button; titles and content are left-aligned.
- No ad hoc margin, size or colour: use a token or an existing component.
- One primary button per view.

## Accessibility

The target is [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. In practice:

- Touch targets are at least 44 px.
- Every control has an accessible name, in both languages; icons are decorative (`aria-hidden`).
- Text and controls keep enough contrast in light and dark mode.
- The whole app works with the keyboard, with a visible focus.
- What a control shows of its state is also exposed to assistive technology (`aria-pressed`, `aria-expanded`,
  `aria-current`), never by a class or a `data-*` alone.
- What appears after an action is announced by a live region that is already there, empty until then; an error is an
  alert.
- Sizes follow the user's font size, and animations respect `prefers-reduced-motion`.
- Respect the safe areas of the screen.
- Hide an action that cannot run yet rather than disable it.
