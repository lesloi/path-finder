import { act, renderHook, waitFor } from '@testing-library/react';

import type { MapSnapshot, Route, RouteSetRequest } from '../core/index.ts';
import { TOAST_MS } from '../components/index.ts';
import { useRouteBrowser } from './use-route-browser.ts';

const request: RouteSetRequest = {
  start: [6.1294, 45.8992],
  activity: 'run',
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
  surfaces: [{ surface: 'paved', share: 1 }],
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
  it('shows the routes it asked for, the first one selected', async () => {
    const { result } = await browse();

    expect(result.current.showing).toBe(true);
    expect(result.current.selected).toBe(0);
    expect(result.current.detail).toBe(false);
    expect(result.current.geometries).toHaveLength(2);
  });

  it('keeps the routes when leaving for the criteria, and shows them again', async () => {
    const { result } = await browse();

    act(() => result.current.leave());
    expect(result.current.showing).toBe(false);
    expect(result.current.routeSet).toBeDefined();

    act(() => result.current.show());
    expect(result.current.showing).toBe(true);
  });

  it('forgets the routes when dropped', async () => {
    const { result } = await browse();

    act(() => result.current.drop());

    expect(result.current.routeSet).toBeUndefined();
    expect(result.current.showing).toBe(false);
  });

  it('forgets the place pointed at when the detail opens or closes', async () => {
    const { result } = await browse();
    act(() => result.current.setHover([6, 45]));

    act(() => result.current.openDetail(true));

    expect(result.current.detail).toBe(true);
    expect(result.current.hover).toBeUndefined();
  });

  it('reports why a request gave no routes, and drops it after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(Response.json({ routes: [] }));
    const { result } = renderHook(() => useRouteBrowser());

    act(() => result.current.ask(request));
    await waitFor(() => expect(result.current.error).toBe('no-routes'));
    act(() => void vi.advanceTimersByTime(TOAST_MS));

    expect(result.current.error).toBeUndefined();
  });

  it('drops an error on request', async () => {
    answer(new Response('', { status: 500 }));
    const { result } = renderHook(() => useRouteBrowser());
    act(() => result.current.ask(request));
    await waitFor(() => expect(result.current.error).toBe('failed'));

    act(() => result.current.dismissError());

    expect(result.current.error).toBeUndefined();
  });

  it('keeps the map snapshot of the current routes only', async () => {
    const { result } = await browse();
    const snapshot = { of: result.current.geometries } as MapSnapshot;

    act(() => result.current.setSnapshot(snapshot));
    expect(result.current.snapshot).toBe(snapshot);

    act(() => result.current.setSnapshot({ of: [] } as unknown as MapSnapshot));
    expect(result.current.snapshot).toBeUndefined();
  });
});
