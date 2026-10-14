// The design system's components that are markup only: each is the Tailwind classes of one
// element, so every screen draws it the same way (DESIGN.md).

/** A round button floating over the map; `aria-pressed` when it toggles. */
export const FLOATING_BUTTON =
  'grid size-touch place-items-center rounded-full bg-surface text-ink shadow-float hover:bg-surface-2 ' +
  'aria-pressed:text-accent';

/** A round button with an icon alone, on a surface. */
export const ICON_BUTTON = 'grid size-touch flex-none place-items-center rounded-full text-ink hover:bg-surface-2';

// A desktop panel floats over the map inside a frame that only places it: the frame is as tall as the panel, within the
// screen, and carries the tab that folds it, in the middle of its outer edge. Folded, the frame slides out of the screen
// up to its tab, which keeps its height. One string for each height: Tailwind finds a class only when it is written
// whole.
const FRAME =
  'pointer-events-none fixed z-4 flex flex-col transition-transform duration-250 ease-[ease] motion-reduce:transition-none ';

/** What a panel in its frame is: the frame does not take the clicks, the panel does. */
export const PANEL = 'pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-md bg-surface shadow-float';

/** The panel, once its frame has slid away: out of the page, after the slide. */
export const PANEL_FOLDED = 'invisible transition-[visibility] delay-250';

/** The frame of the panel over the left of the map. */
export const SIDE_FRAME = `${FRAME}top-safe-3 left-safe-3 w-column max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-(--spacing(6)))]`;
export const SIDE_FRAME_FOLDED = `${SIDE_FRAME} -translate-x-[calc(100%+env(safe-area-inset-left)+--spacing(3))]`;

/** The frame of the panel over the right of the map, above the dock: the routes found. */
export const LIST_FRAME =
  // Under the settings button, and over the row of buttons at the bottom right.
  `${FRAME}top-[calc(env(safe-area-inset-top)+--spacing(6)+var(--spacing-touch))] right-safe-3 w-list ` +
  'max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-var(--dock-inset)-(--spacing(6))-var(--spacing-touch)-(--spacing(3))-(--spacing(6))-var(--spacing-touch)-(--spacing(3)))]';
export const LIST_FRAME_FOLDED = `${LIST_FRAME} translate-x-[calc(100%+env(safe-area-inset-right)+--spacing(3))]`;

/** The desktop panel along the bottom of the map, from the left column to the edge: the route selected. */
export const DOCK =
  'fixed right-safe-3 bottom-safe-3 left-[calc(var(--column-reserved)+--spacing(3))] z-4 flex h-dock rounded-md ' +
  'bg-surface shadow-float';

/** The title of a group of list rows. */
export const GROUP_TITLE = 'mt-6 mb-2 text-sm font-semibold text-ink-2 first:mt-2';
/** A group of list rows. */
export const LIST = 'rounded-md border border-border';
/** A label on the left, a value, a field, or a chevron on the right. Rows round their own corners. */
export const LIST_ROW =
  'flex min-h-13 items-center justify-between gap-3 border-b border-border px-4 text-ink no-underline ' +
  'first:rounded-t-md last:rounded-b-md last:border-b-0 [a&]:hover:bg-surface-2';
/** The chevron at the end of a list row that links to a page. */
export const LIST_ROW_CHEVRON = 'flex-none text-ink-2';

/**
 * A short message at the top of the screen, below the floating buttons, centred on the map, in their
 * colours; a click drops it.
 */
export const TOAST =
  'fixed top-[calc(env(safe-area-inset-top)+--spacing(3)+var(--spacing-touch)+--spacing(2))] left-1/2 z-9 ' +
  'w-max max-w-[calc(100vw-2*--spacing(4))] -translate-x-1/2 cursor-pointer rounded-md bg-surface px-4 py-2 text-sm ' +
  'text-ink shadow-float desktop:left-(--map-centre) desktop:max-w-[calc(100vw-var(--spacing-column)-var(--list-inset)-3*--spacing(4))]';

/** Long text: headings, paragraphs, lists, and links, as on the legal pages. */
export const PROSE =
  '[&_a]:font-semibold [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-6 [&_h2]:mb-2 ' +
  '[&_h2]:text-lg [&_h2]:font-semibold [&_li]:my-1 ' +
  '[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 ' +
  // The same room above and below as a page of list rows.
  '[&>:first-child]:mt-2 [&>:last-child]:mb-0';

/** The opening paragraph of a long text, boxed. */
export const LEAD = 'rounded-md border border-ink bg-surface-2 px-4 py-3 font-semibold';
/** A small line of long text, such as its date. */
export const NOTE = 'text-sm text-ink-2';

/** The view's main action: one per view. */
export const PRIMARY_BUTTON =
  'flex min-h-touch w-full items-center justify-center gap-2 rounded-full bg-accent px-4 font-semibold ' +
  'text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent';

type TipSide = 'stack' | 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

/**
 * A tooltip for an icon that sits beside a figure: the accessible name of the element around it already says what
 * the icon means (see `data-tip` in index.css). `side` is where the tooltip opens, chosen so that it stays on the
 * screen.
 */
export const hint = (label: string, side: TipSide) => ({ 'data-tip': label, 'data-tip-side': side });

/** The name of a control that shows an icon alone, and the tooltip that says it. */
export const tip = (label: string, side: TipSide) => ({ 'aria-label': label, ...hint(label, side) });
