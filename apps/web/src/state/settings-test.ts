import { act, renderHook } from '@testing-library/react';

import { DEFAULT_CRITERIA, unitsOf, useSettings, watchSettings } from './settings.ts';

const KEY = 'path-finder.settings';

const DEFAULTS = {
  pace: 6,
  theme: 'system',
  basemap: 'plan',
  lastCriteria: { target: 'distance', surface: 'any', level: 'any', gain: 300, includeTechnical: false },
};

describe('unitsOf', () => {
  const settings = (units?: 'metric' | 'imperial') =>
    renderHook(() => (localStorage.setItem(KEY, JSON.stringify({ units })), useSettings())).result.current[0];

  it.each([
    ['fr', 'metric'],
    ['en', 'imperial'],
  ] as const)('follows the %s language when the user picked no units: %s', (language, units) => {
    expect(unitsOf(settings(), language)).toBe(units);
  });

  it.each(['fr', 'en'] as const)('keeps the units the user picked, in %s', (language) => {
    expect(unitsOf(settings('metric'), language)).toBe('metric');
    expect(unitsOf(settings('imperial'), language)).toBe('imperial');
  });
});

describe('useSettings', () => {
  it('starts from the defaults', () => {
    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual(DEFAULTS);
    expect(DEFAULT_CRITERIA).toEqual(DEFAULTS.lastCriteria);
  });

  it('keeps the settings across reloads', () => {
    const kept = {
      pace: 7.5,
      language: 'fr',
      units: 'imperial',
      theme: 'dark',
      basemap: 'aerial',
      lastCriteria: { target: 'duration', surface: 'unpaved', level: 'target', gain: 450, includeTechnical: true },
    } as const;
    const first = renderHook(() => useSettings());
    act(() => first.result.current[1](kept));
    first.unmount();

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual(kept);
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
    [
      'wrong types',
      JSON.stringify({
        pace: 'fast',
        language: 'de',
        units: 'nautical',
        theme: 'sepia',
        basemap: 'satellite',
        lastCriteria: { target: 'both', surface: 'ice', level: 'steep', gain: -5 },
      }),
    ],
    ['criteria that are not an object', JSON.stringify({ lastCriteria: 'any' })],
  ])('falls back to the defaults on %s data', (_, raw) => {
    localStorage.setItem(KEY, raw);

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual(DEFAULTS);
  });

  it.each([
    ['a pace per activity', { run: 5.5, hike: 12 }],
    ['a pace that is not positive', 0],
    ['a pace that is not finite', null],
  ])('falls back to the default pace on %s', (_, pace) => {
    localStorage.setItem(KEY, JSON.stringify({ pace }));

    const { result } = renderHook(() => useSettings());

    expect(result.current[0].pace).toBe(6);
  });

  it('does not read the last activity of an earlier version', () => {
    localStorage.setItem(KEY, JSON.stringify({ lastActivity: 'hike', units: 'imperial' }));

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual({ ...DEFAULTS, units: 'imperial' });
    expect(result.current[0]).not.toHaveProperty('lastActivity');
  });

  it('keeps the valid fields of partial data', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ pace: 5, units: 'imperial', lastCriteria: { surface: 'paved', level: 'steep', gain: 600 } }),
    );

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual({
      ...DEFAULTS,
      pace: 5,
      units: 'imperial',
      lastCriteria: { target: 'distance', surface: 'paved', level: 'any', gain: 600, includeTechnical: false },
    });
  });

  it('keeps the switch of the technical stretches, off unless it was stored as true', () => {
    localStorage.setItem(KEY, JSON.stringify({ lastCriteria: { includeTechnical: true } }));
    expect(renderHook(() => useSettings()).result.current[0].lastCriteria.includeTechnical).toBe(true);

    for (const stored of ['true', 1, null, 'yes']) {
      localStorage.setItem(KEY, JSON.stringify({ lastCriteria: { includeTechnical: stored } }));
      expect(renderHook(() => useSettings()).result.current[0].lastCriteria.includeTechnical).toBe(false);
    }
  });
});

describe('watchSettings', () => {
  it('reports the settings now and after each change, until stopped', () => {
    const listener = vi.fn();
    const writer = renderHook(() => useSettings());

    const stop = watchSettings(listener);
    act(() => writer.result.current[1]({ theme: 'dark' }));
    stop();
    act(() => writer.result.current[1]({ theme: 'light' }));

    expect(listener.mock.calls.map(([settings]) => settings.theme)).toEqual(['system', 'dark']);
  });
});
