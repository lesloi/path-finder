import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, renderHook } from '@testing-library/react';

import { DESKTOP_QUERY, useDesktop } from './use-desktop.ts';

const css = readFileSync(join(import.meta.dirname, 'index.css'), 'utf8');

type Screen = { width: number; height: number };

const PHONE: Screen = { width: 390, height: 844 };
const PHONE_LANDSCAPE: Screen = { width: 844, height: 390 };
const DESKTOP: Screen = { width: 1280, height: 720 };

// Whether a screen satisfies the `min-width` and `min-height` conditions of a query, as a browser would say.
function matches(query: string, { width, height }: Screen) {
  const sizes = { width, height };
  return [...query.matchAll(/\(min-(width|height): (\d+)px\)/g)].every(
    ([, side, min]) => sizes[side as keyof Screen] >= Number(min),
  );
}

// A stand-in media query that answers for a screen the test sets, notifying its listeners like a browser.
function stubScreen(screen: Screen) {
  const listeners = new Set<() => void>();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        get matches() {
          return matches(query, screen);
        },
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  const resize = (next: Screen) => {
    screen = next;
    for (const listener of listeners) listener();
  };
  return { resize, listeners };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDesktop', () => {
  it.each([
    ['a desktop', DESKTOP, true],
    ['an upright phone', PHONE, false],
    ['a phone in landscape', PHONE_LANDSCAPE, false],
  ])('tells whether the screen is %s', (_, screen, desktop) => {
    stubScreen(screen);

    const { result } = renderHook(() => useDesktop());

    expect(result.current).toBe(desktop);
  });

  it('is the same query as the `desktop` variant of the stylesheet', () => {
    expect(css).toContain(`@custom-variant desktop (@media ${DESKTOP_QUERY});`);
  });

  it('follows the screen as it changes width', () => {
    const { resize } = stubScreen(PHONE);
    const { result } = renderHook(() => useDesktop());

    act(() => resize(DESKTOP));

    expect(result.current).toBe(true);
  });

  it('stops listening once unmounted', () => {
    const { listeners } = stubScreen(PHONE);
    const { unmount } = renderHook(() => useDesktop());

    unmount();

    expect(listeners.size).toBe(0);
  });
});
