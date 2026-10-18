import { act, renderHook, waitFor } from '@testing-library/react';

import type { MapSnapshot, Route, RouteSetRequest } from '../core/index.ts';
import { TOAST_MS } from '../components/index.ts';
import { useRouteBrowser } from './use-route-browser.ts';

const request: RouteSetRequest = {
  start: [6.1294, 45.8992],
  target: { distance: 10 },
  surface: 'any',
  pace: 6,
};

const route: Route = {
  geometry: [
    [6.1294, 45.8992],
    [6.13, 45.9],
  ],
  distance: 10,
  estimatedDuration: 60,
  kind: 'match',
  misses: [],
  unpavedShare: 0,
  surfaces: [{ surface: 'paved', from: 0, to: 10 }],
  technical: false,
};

const answer = (response: Response) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(response)),
  );

async function browse() {
  answer(Response.json({ routes: [route, route] }));
  const view = renderHook(() => useRouteBrowser());
  act(() => view.result.current.ask(request));
  await waitFor(() => expect(view.result.current.routeSet).toBeDefined());
  return view;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useRouteBrowser', () => {
  it('shows the routes it asked for, none of them selected', async () => {
    const { result } = await browse();

    expect(result.current.routeSet).toBeDefined();
    expect(result.current.selected).toBeUndefined();
    expect(result.current.preview).toBeUndefined();
    expect(result.current.detail).toBe(false);
    expect(result.current.geometries).toHaveLength(2);
  });

  it('forgets the routes when dropped, and the selection with them', async () => {
    const { result } = await browse();
    act(() => result.current.select(1));

    act(() => result.current.drop());

    expect(result.current.routeSet).toBeUndefined();
    expect(result.current.selected).toBeUndefined();
  });

  it('selects and deselects a route, and previews another without selecting it', async () => {
    const { result } = await browse();

    act(() => result.current.select(1));
    act(() => result.current.setPreview(0));
    expect(result.current).toMatchObject({ selected: 1, preview: 0 });

    act(() => result.current.select(undefined));
    expect(result.current.selected).toBeUndefined();
  });

  it('starts from no selection again with a new request', async () => {
    const { result } = await browse();
    act(() => result.current.select(1));

    act(() => result.current.ask(request));

    expect(result.current.selected).toBeUndefined();
  });

  it('forgets the place pointed at when the detail opens or closes', async () => {
    const { result } = await browse();
    act(() => result.current.setHover([6, 45]));

    act(() => result.current.openDetail(true));

    expect(result.current.detail).toBe(true);
    expect(result.current.hover).toBeUndefined();
  });

  it.each([
    ['a new request', (r: ReturnType<typeof useRouteBrowser>) => r.ask(request)],
    ['the routes being dropped', (r: ReturnType<typeof useRouteBrowser>) => r.drop()],
  ])('puts the sheet back to collapsed with %s', async (_, change) => {
    const { result } = await browse();
    act(() => result.current.changeSheet('folded'));
    expect(result.current.sheet).toBe('folded');

    act(() => change(result.current));

    expect(result.current.sheet).toBe('collapsed');
    expect(result.current.detail).toBe(false);
  });

  it('opens the detail by expanding the sheet, and closes it by collapsing', async () => {
    const { result } = await browse();

    act(() => result.current.openDetail(true));
    expect(result.current).toMatchObject({ sheet: 'expanded', detail: true });

    act(() => result.current.openDetail(false));
    expect(result.current).toMatchObject({ sheet: 'collapsed', detail: false });
  });

  it('forgets the place pointed at when the sheet changes state', async () => {
    const { result } = await browse();
    act(() => result.current.setHover([6, 45]));

    act(() => result.current.changeSheet('folded'));

    expect(result.current.hover).toBeUndefined();
  });

  it('reports why a request gave no routes, and drops it after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(Response.json({ routes: [] }));
    const { result } = renderHook(() => useRouteBrowser());

    act(() => result.current.ask(request));
    await waitFor(() => expect(result.current.refusal).toEqual({ error: 'no-routes' }));
    act(() => void vi.advanceTimersByTime(TOAST_MS));

    expect(result.current.refusal).toBeUndefined();
  });

  it('keeps the notice of a newer version until it is dropped, as the user has to reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(Response.json({ error: 'stale-build' }, { status: 426 }));
    const { result } = renderHook(() => useRouteBrowser());

    act(() => result.current.ask(request));
    await waitFor(() => expect(result.current.refusal).toEqual({ error: 'stale-build' }));
    act(() => void vi.advanceTimersByTime(TOAST_MS * 10));

    expect(result.current.refusal).toEqual({ error: 'stale-build' });
  });

  it('drops the notice of a newer version on request', async () => {
    answer(Response.json({ error: 'stale-build' }, { status: 426 }));
    const { result } = renderHook(() => useRouteBrowser());
    act(() => result.current.ask(request));
    await waitFor(() => expect(result.current.refusal).toEqual({ error: 'stale-build' }));

    act(() => result.current.dismissError());

    expect(result.current.refusal).toBeUndefined();
  });

  it('drops an error on request', async () => {
    answer(new Response('', { status: 500 }));
    const { result } = renderHook(() => useRouteBrowser());
    act(() => result.current.ask(request));
    await waitFor(() => expect(result.current.refusal).toEqual({ error: 'failed' }));

    act(() => result.current.dismissError());

    expect(result.current.refusal).toBeUndefined();
  });

  it('keeps the map snapshot of the current routes only', async () => {
    const { result } = await browse();
    const snapshot = { of: result.current.geometries } as MapSnapshot;

    act(() => result.current.setSnapshot(snapshot));
    expect(result.current.snapshot).toBe(snapshot);

    act(() => result.current.setSnapshot({ of: [] } as unknown as MapSnapshot));
    expect(result.current.snapshot).toBeUndefined();
  });

  it('turns round the geometry of a reversed route only, and keeps the one that frames the map', async () => {
    const { result } = await browse();
    const framing = result.current.geometries;

    act(() => result.current.toggleReversed(0));

    expect(result.current.directedGeometries).toEqual([route.geometry.toReversed(), route.geometry]);
    expect(result.current.geometries).toBe(framing);
  });
});
