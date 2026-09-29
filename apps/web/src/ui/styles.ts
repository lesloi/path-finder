// The design system's components that are markup only: each is the Tailwind classes of one
// element, so every screen draws it the same way (DESIGN.md).

/** A round button floating over the map; `aria-pressed` when it toggles. */
export const FLOATING_BUTTON =
  'grid size-touch place-items-center rounded-full bg-surface text-ink shadow-float hover:bg-surface-2 ' +
  'aria-pressed:text-accent';

/** A round button with an icon alone, on a surface. */
export const ICON_BUTTON = 'grid size-touch flex-none place-items-center rounded-full text-ink hover:bg-surface-2';

const BUTTON =
  'flex min-h-touch w-full items-center justify-center gap-2 rounded-full px-4 font-semibold no-underline';

/** The one main action of a view. */
export const PRIMARY_BUTTON = `${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`;
/** Any other action. */
export const SECONDARY_BUTTON = `${BUTTON} bg-surface-2 text-ink`;
/** A discreet action, such as going back to a list. */
export const GHOST_BUTTON = 'inline-flex min-h-touch items-center gap-2 px-2 font-semibold text-accent';

/** The desktop panel floating over the left of the map. */
export const SIDE_COLUMN =
  // As tall as its content, within the screen.
  'fixed top-safe-3 left-safe-3 z-4 flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-' +
  'var(--spacing)*6)] w-column flex-col overflow-hidden rounded-md bg-surface shadow-float';

/** A row of chips that scrolls sideways. */
export const CHIPS = 'flex gap-2 overflow-x-auto [scrollbar-width:none]';
/** A pill that shows one criterion and opens its dialog; `data-set` when it is not the default. */
export const CHIP =
  // A 36 px pill with a padded hit area keeps the 44 px touch target.
  'my-1 inline-flex h-9 flex-none items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm ' +
  'whitespace-nowrap hover:bg-surface-2 data-set:border-accent data-set:bg-accent-soft data-set:font-semibold ' +
  'data-set:text-accent';

/** Two to four exclusive choices side by side. */
export const SEGMENTED_CONTROL = 'flex gap-1 rounded-md bg-surface-2 p-1';
/** One choice of a segmented control, with `aria-pressed`: the pressed one stands out as a card. */
export const SEGMENT =
  'min-h-touch flex-1 rounded-sm text-sm aria-pressed:bg-surface aria-pressed:font-semibold ' +
  'aria-pressed:text-accent aria-pressed:ring-1 aria-pressed:ring-border';

/** The value of a slider, in large type above it. */
export const SLIDER_VALUE = 'mb-2 block text-center text-xl font-semibold';
/** The range input of a slider. */
export const SLIDER_INPUT = 'h-touch w-full accent-accent';
/** The bounds under a slider. */
export const SLIDER_SCALE = 'flex justify-between text-sm text-ink-2';

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
  'text-ink shadow-float desktop:left-(--map-centre) desktop:max-w-[calc(100vw-var(--spacing-column)-3*--spacing(4))]';

/** A small card next to the floating button that opened it. */
export const POPOVER =
  'fixed z-6 w-60 rounded-md bg-surface px-4 py-3 shadow-float [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold';

/** Long text: headings, paragraphs, lists, and links, as on the legal pages. */
export const PROSE =
  '[&_a]:text-accent [&_a]:underline [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_li]:my-1 ' +
  '[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 ' +
  // The same room above and below as a page of list rows.
  '[&>:first-child]:mt-2 [&>:last-child]:mb-0';
