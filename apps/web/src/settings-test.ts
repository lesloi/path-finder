import { act, renderHook } from '@testing-library/react';

import { paceFor, useSettings } from './settings.ts';

const KEY = 'path-finder.settings';

describe('useSettings', () => {
  it('starts from the defaults', () => {
    const { result } = renderHook(() => useSettings());
    const [settings] = result.current;

    expect(settings).toEqual({ pace: {}, units: 'metric', lastActivity: 'run' });
    expect(paceFor(settings, 'run')).toBe(6);
    expect(60 / paceFor(settings, 'hike')).toBeCloseTo(4.5);
  });

  it('keeps the settings across reloads', () => {
    const first = renderHook(() => useSettings());
    act(() => first.result.current[1]({ pace: { hike: 12 }, language: 'fr', units: 'imperial', lastActivity: 'hike' }));
    first.unmount();

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual({ pace: { hike: 12 }, language: 'fr', units: 'imperial', lastActivity: 'hike' });
    expect(paceFor(result.current[0], 'hike')).toBe(12);
  });

  it('shares a change with every component', () => {
    const reader = renderHook(() => useSettings());
    const writer = renderHook(() => useSettings());

    act(() => writer.result.current[1]({ units: 'imperial' }));

    expect(reader.result.current[0].units).toBe('imperial');
  });

  it.each([
    ['corrupted', '{not json'],
    ['not an object', '42'],
    ['wrong types', JSON.stringify({ pace: { run: -1, hike: 'fast' }, language: 'de', units: 'nautical', lastActivity: 'swim' })],
  ])('falls back to the defaults on %s data', (_, raw) => {
    localStorage.setItem(KEY, raw);

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual({ pace: {}, units: 'metric', lastActivity: 'run' });
  });

  it('keeps the valid fields of partial data', () => {
    localStorage.setItem(KEY, JSON.stringify({ pace: { run: 5, hike: 0 }, units: 'imperial' }));

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual({ pace: { run: 5 }, units: 'imperial', lastActivity: 'run' });
  });
});
