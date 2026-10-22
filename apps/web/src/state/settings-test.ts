import { act, renderHook } from '@testing-library/react';

import { DEFAULT_CRITERIA, useSettings, watchSettings } from './settings.ts';

const KEY = 'path-finder.settings';

const DEFAULTS = {
  pace: 6,
  paceUnit: 'min/km',
  theme: 'system',
  basemap: 'minimal',
  poiLayers: { water: true, viewpoint: false, toilets: false, shelter: false, seasonal: true },
  lastCriteria: {
    shape: 'loop',
    target: 'distance',
    distance: 10,
    duration: 60,
    surface: 'any',
    level: 'any',
    gain: 300,
  },
};

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
      paceUnit: 'km/h',
      theme: 'dark',
      basemap: 'aerial',
      poiLayers: { water: false, viewpoint: true, toilets: false, shelter: false, seasonal: false },
      lastCriteria: {
        shape: 'outAndBack',
        target: 'duration',
        distance: 21.1,
        duration: 95,
        surface: 'unpaved',
        level: 'target',
        gain: 450,
      },
    } as const;
    const first = renderHook(() => useSettings());
    act(() => first.result.current[1](kept));
    first.unmount();

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual({ ...kept, lastCriteria: { ...kept.lastCriteria, shape: 'loop' } });
  });

  it('shares a change with every component', () => {
    const reader = renderHook(() => useSettings());
    const writer = renderHook(() => useSettings());

    act(() => writer.result.current[1]({ paceUnit: 'km/h' }));

    expect(reader.result.current[0].paceUnit).toBe('km/h');
  });

  it.each([
    ['corrupted', '{not json'],
    ['not an object', '42'],
    [
      'wrong types',
      JSON.stringify({
        pace: 'fast',
        language: 'de',
        paceUnit: 'knots',
        theme: 'sepia',
        basemap: 'satellite',
        lastCriteria: { target: 'both', distance: 'far', duration: null, surface: 'ice', level: 'steep', gain: -5 },
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

  it('does not read the last activity or the units of an earlier version', () => {
    localStorage.setItem(KEY, JSON.stringify({ lastActivity: 'hike', units: 'imperial' }));

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual(DEFAULTS);
    expect(result.current[0]).not.toHaveProperty('lastActivity');
    expect(result.current[0]).not.toHaveProperty('units');
  });

  it('keeps the valid fields of partial data', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ pace: 5, paceUnit: 'km/h', lastCriteria: { surface: 'paved', level: 'steep', gain: 600 } }),
    );

    const { result } = renderHook(() => useSettings());

    expect(result.current[0]).toEqual({
      ...DEFAULTS,
      pace: 5,
      paceUnit: 'km/h',
      lastCriteria: { ...DEFAULTS.lastCriteria, surface: 'paved', gain: 600 },
    });
  });

  it.each([
    ['a distance under the bounds', { distance: 0 }],
    ['a distance over the bounds', { distance: 1e6 }],
    ['a duration under the bounds', { duration: 1 }],
    ['a duration over the bounds', { duration: 1e6 }],
    ['a length that is not a number', { distance: '12', duration: '90' }],
  ])('falls back to the default length on %s', (_, stored) => {
    localStorage.setItem(KEY, JSON.stringify({ lastCriteria: stored }));

    const { result } = renderHook(() => useSettings());

    expect(result.current[0].lastCriteria).toEqual(DEFAULTS.lastCriteria);
  });

  it('drops the retired switch of the technical stretches', () => {
    localStorage.setItem(KEY, JSON.stringify({ lastCriteria: { surface: 'unpaved', includeTechnical: true } }));
    expect(renderHook(() => useSettings()).result.current[0].lastCriteria).toEqual({
      ...DEFAULTS.lastCriteria,
      surface: 'unpaved',
    });
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

describe('the points of interest layers', () => {
  it.each([
    ['nothing is stored', '{}', { water: true, viewpoint: false, toilets: false, shelter: false, seasonal: true }],
    [
      'a layer is not a boolean',
      '{"poiLayers":{"water":"no","viewpoint":1}}',
      { water: true, viewpoint: false, toilets: false, shelter: false, seasonal: true },
    ],
    [
      'only one layer is stored',
      '{"poiLayers":{"viewpoint":true}}',
      { water: true, viewpoint: true, toilets: false, shelter: false, seasonal: true },
    ],
    [
      'layers stored before toilets and shelters',
      '{"poiLayers":{"water":false,"viewpoint":true,"seasonal":false}}',
      { water: false, viewpoint: true, toilets: false, shelter: false, seasonal: false },
    ],
    [
      'the layers are not an object',
      '{"poiLayers":"water"}',
      { water: true, viewpoint: false, toilets: false, shelter: false, seasonal: true },
    ],
  ])('start from the defaults, each on its own, when %s', (_, stored, expected) => {
    localStorage.setItem(KEY, stored);

    const { result } = renderHook(() => useSettings());

    expect(result.current[0].poiLayers).toEqual(expected);
  });

  it('keep a choice across reloads', () => {
    const first = renderHook(() => useSettings());
    act(() =>
      first.result.current[1]({
        poiLayers: { water: false, viewpoint: true, toilets: false, shelter: false, seasonal: false },
      }),
    );
    first.unmount();

    const { result } = renderHook(() => useSettings());

    expect(result.current[0].poiLayers).toEqual({
      water: false,
      viewpoint: true,
      toilets: false,
      shelter: false,
      seasonal: false,
    });
  });
});
