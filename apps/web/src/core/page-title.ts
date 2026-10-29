/**
 * The title of the home page in the browser tab and the history, and the one a search engine reads in `index.html`.
 * A test keeps the two equal.
 */
export const HOME_TITLE = 'Path finder — Générateur de parcours de course et de trail';

/** Names the page in the browser tab and the history, which would otherwise all say "Path finder". */
export function applyTitle(page: string | undefined, doc: Document = document) {
  doc.title = page ? `${page} · Path finder` : HOME_TITLE;
}
