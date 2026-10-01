/** The colour scheme the user picks: `system` follows the browser. */
export type Theme = 'system' | 'light' | 'dark';

/** The theme before the user picks one. */
export const DEFAULT_THEME: Theme = 'system';

/** Sets `data-theme` on `root` for a forced theme, and removes it for `system`. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
