# Design

Tailwind classes limited to the tokens of [`components/index.css`](./apps/web/src/components/index.css),
and [lucide-react](https://lucide.dev) icons. No component library.

## Reuse

The components already exist in [`apps/web/src/components`](./apps/web/src/components): look there before
drawing anything. Shared class strings (buttons, list rows, chips, toast…) are in `components/styles.ts`.
Need something slightly different? Extend the existing component or add a variant, rather than a copy.
Behaviour comes from native elements first (`<dialog>`, `popover`, `<input type="range">`).

## Layout

- The map fills the screen and the controls float over it.
- Phones: a bottom sheet holds the content. Desktops: a left column does.
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

- Touch targets are at least 44 px.
- Every control has an accessible name, in both languages; icons are decorative (`aria-hidden`).
- Text and controls keep enough contrast in light and dark mode.
- The whole app works with the keyboard, with a visible focus.
- Sizes follow the user's font size, and animations respect `prefers-reduced-motion`.
- Respect the safe areas of the screen.
- Hide an action that cannot run yet rather than disable it.
