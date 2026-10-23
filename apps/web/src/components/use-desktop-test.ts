import { act, renderHook } from '@testing-library/react';

import { useDesktop, useHover } from './use-desktop.ts';

// A stand-in media query whose width the test sets, notifying its listeners like a browser.
function stubScreen(desktop: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return desktop;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
  const resize = (wide: boolean) => {
    desktop = wide;
    for (const listener of listeners) listener();
  };
  return { matchMedia, resize, listeners };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDesktop', () => {
  it.each([
    ['a desktop', true],
    ['a phone', false],
  ])('tells whether the screen is %s', (_, desktop) => {
    const { matchMedia } = stubScreen(desktop);

    const { result } = renderHook(() => useDesktop());

    expect(result.current).toBe(desktop);
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 768px)');
  });

  it('follows the screen as it changes width', () => {
    const { resize } = stubScreen(false);
    const { result } = renderHook(() => useDesktop());

    act(() => resize(true));

    expect(result.current).toBe(true);
  });

  it('stops listening once unmounted', () => {
    const { listeners } = stubScreen(false);
    const { unmount } = renderHook(() => useDesktop());

    unmount();

    expect(listeners.size).toBe(0);
  });
});

describe('useHover', () => {
  it.each([
    ['a screen that can hover', true],
    ['a touch screen', false],
  ])('is %s', (_, matches) => {
    const { matchMedia } = stubScreen(matches);

    const { result } = renderHook(() => useHover());

    expect(result.current).toBe(matches);
    expect(matchMedia).toHaveBeenCalledWith('(hover: hover)');
  });

  it('follows the screen as it changes', () => {
    const { resize } = stubScreen(false);
    const { result } = renderHook(() => useHover());

    act(() => resize(true));

    expect(result.current).toBe(true);
  });
});
