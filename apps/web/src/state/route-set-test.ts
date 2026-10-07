import { act, renderHook, waitFor } from '@testing-library/react';

import type { Route, RouteSetRequest } from '../core/index.ts';
import { requestRouteSet, retryDelay, useRouteSet } from './route-set.ts';

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
  surfaces: [{ surface: 'paved', share: 1 }],
};

function answer(response: Response | Promise<Response>) {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('requestRouteSet', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('posts the criteria to the API and returns the routes', async () => {
    const fetchMock = answer(Response.json({ routes: [route] }));

    const result = await requestRouteSet(request);

    expect(result).toEqual({ routes: [route] });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/route-sets',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    );
  });

  it('sends the build id of the app', async () => {
    vi.stubEnv('VITE_BUILD_ID', 'build-1');
    const fetchMock = answer(Response.json({ routes: [] }));

    await requestRouteSet(request);

    const [, { headers }] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(headers).get('X-Build-Id')).toBe('build-1');
  });

  it('sends no build id outside a build', async () => {
    const fetchMock = answer(Response.json({ routes: [] }));

    await requestRouteSet(request);

    const [, { headers }] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(headers).has('X-Build-Id')).toBe(false);
  });

  it('returns how long the API asks to wait', async () => {
    answer(Response.json({ error: 'overloaded' }, { status: 429, headers: { 'Retry-After': '2' } }));

    expect(await requestRouteSet(request)).toEqual({ error: 'overloaded', retryAfter: 2 });
  });

  it('ignores a wait that is not a number of seconds', async () => {
    answer(Response.json({ error: 'overloaded' }, { status: 429, headers: { 'Retry-After': 'soon' } }));

    expect(await requestRouteSet(request)).toEqual({ error: 'overloaded' });
  });

  it('returns the error code the API answers with', async () => {
    answer(Response.json({ error: 'rate-limited' }, { status: 429 }));

    expect(await requestRouteSet(request)).toEqual({ error: 'rate-limited' });
  });

  it('reloads the page when the app is older than the API', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    answer(Response.json({ error: 'stale-build' }, { status: 426 }));

    expect(await requestRouteSet(request)).toEqual({ error: 'stale-build' });
    expect(reload).toHaveBeenCalled();
  });

  it.each([
    ['cannot be reached', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['sits behind a gateway that fails', () => Promise.resolve(new Response('Bad gateway', { status: 502 }))],
  ])('says the API is unreachable when it %s', async (_, response) => {
    vi.stubGlobal('fetch', vi.fn(response));

    expect(await requestRouteSet(request)).toEqual({ error: 'unreachable' });
  });

  it.each([
    ['fails without an error code', () => Promise.resolve(new Response('Oops', { status: 500 }))],
    ['answers an unknown error code', () => Promise.resolve(Response.json({ error: 'odd' }, { status: 500 }))],
    ['answers something that is not a route set', () => Promise.resolve(Response.json({ routes: 'none' }))],
  ])('says the API failed when it %s', async (_, response) => {
    vi.stubGlobal('fetch', vi.fn(response));

    expect(await requestRouteSet(request)).toEqual({ error: 'failed' });
  });

  it('rejects once the request is cancelled', async () => {
    const cancel = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_, { signal }: RequestInit) =>
          new Promise((__, reject) => signal!.addEventListener('abort', () => reject(signal!.reason))),
      ),
    );

    const result = requestRouteSet(request, cancel.signal);
    cancel.abort();

    await expect(result).rejects.toThrow();
  });
});

describe('useRouteSet', () => {
  it('is loading while the API works, then holds the routes and their criteria', async () => {
    let resolve!: (response: Response) => void;
    answer(new Promise<Response>((done) => (resolve = done)));
    const { result } = renderHook(() => useRouteSet(vi.fn()));

    act(() => result.current.find(request));

    expect(result.current.loading).toBe(true);
    await act(async () => resolve(Response.json({ routes: [route] })));
    expect(result.current).toMatchObject({ loading: false, routeSet: { request, routes: [route] } });
  });

  it('reports an error and keeps no route set', async () => {
    answer(Response.json({ error: 'rate-limited' }, { status: 429 }));
    const onError = vi.fn();
    const { result } = renderHook(() => useRouteSet(onError));

    act(() => result.current.find(request));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('rate-limited'));
    expect(result.current).toMatchObject({ loading: false, routeSet: undefined });
  });

  it('reports an empty route set as no routes', async () => {
    answer(Response.json({ routes: [] }));
    const onError = vi.fn();
    const { result } = renderHook(() => useRouteSet(onError));

    act(() => result.current.find(request));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('no-routes'));
    expect(result.current.routeSet).toBeUndefined();
  });

  it('forgets the route set when cleared', async () => {
    answer(Response.json({ routes: [route] }));
    const { result } = renderHook(() => useRouteSet(vi.fn()));
    act(() => result.current.find(request));
    await waitFor(() => expect(result.current.routeSet).toBeDefined());

    act(() => result.current.clear());

    expect(result.current.routeSet).toBeUndefined();
  });

  it('drops a request still running when cleared', async () => {
    let resolve!: (response: Response) => void;
    answer(new Promise<Response>((done) => (resolve = done)));
    const onError = vi.fn();
    const { result } = renderHook(() => useRouteSet(onError));
    act(() => result.current.find(request));

    act(() => result.current.clear());
    await act(async () => resolve(Response.json({ routes: [route] })));

    expect(result.current).toMatchObject({ loading: false, routeSet: undefined });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('retrying while the server is busy', () => {
  const busy = () => Response.json({ error: 'overloaded' }, { status: 429, headers: { 'Retry-After': '1' } });
  const routes = () => Response.json({ routes: [route] });
  const answers = (...responses: (() => Response)[]) => {
    const queue = [...responses];
    const fetchMock = vi.fn(() => Promise.resolve(queue.shift()!()));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const wait = (milliseconds: number) => act(() => vi.advanceTimersByTimeAsync(milliseconds));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // a wait of exactly what the server asked for
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits what the server asks plus up to a second, and never asks for more than five seconds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(retryDelay(1)).toBe(1000);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(retryDelay(1)).toBe(2000);
    expect(retryDelay(undefined)).toBe(2000);
    expect(retryDelay(60)).toBe(6000);
  });

  it('asks again after the wait, and the user only sees the routes', async () => {
    const fetchMock = answers(busy, routes);
    const onError = vi.fn();
    const { result } = renderHook(() => useRouteSet(onError));

    act(() => result.current.find(request));
    await wait(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    await wait(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ loading: false, routeSet: { routes: [route] } });
    expect(onError).not.toHaveBeenCalled();
  });

  it('gives up after two more tries and says the service is busy', async () => {
    const fetchMock = answers(busy, busy, busy);
    const onError = vi.fn();
    const { result } = renderHook(() => useRouteSet(onError));

    act(() => result.current.find(request));
    await wait(5000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledExactlyOnceWith('overloaded');
    expect(result.current.loading).toBe(false);
  });

  it.each([
    [
      'rate-limited',
      () => Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'Retry-After': '300' } }),
    ],
    ['invalid-criteria', () => Response.json({ error: 'invalid-criteria', field: 'pace' }, { status: 400 })],
    ['generation-timeout', () => Response.json({ error: 'generation-timeout' }, { status: 504 })],
  ])('does not ask again after %s', async (code, refusal) => {
    const fetchMock = answers(refusal, routes);
    const onError = vi.fn();
    const { result } = renderHook(() => useRouteSet(onError));

    act(() => result.current.find(request));
    await wait(10_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(code);
  });

  it('stops waiting when cleared, or when a newer request replaces it', async () => {
    const fetchMock = answers(busy, routes, routes);
    const { result } = renderHook(() => useRouteSet(vi.fn()));
    act(() => result.current.find(request));
    await wait(0);

    act(() => result.current.clear());
    await wait(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => result.current.find(request));
    await wait(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.routeSet).toBeDefined();
  });

  it('gives back the routes shown before when the new request gets none', async () => {
    answers(routes, () => Response.json({ error: 'rate-limited' }, { status: 429 }));
    const onError = vi.fn();
    const { result } = renderHook(() => useRouteSet(onError));
    act(() => result.current.find(request));
    await wait(0);
    const shown = result.current.routeSet;
    expect(shown).toBeDefined();

    act(() => result.current.find({ ...request, target: { distance: 20 } }));
    expect(result.current.routeSet).toBeUndefined(); // the search panel shows while it runs
    await wait(0);

    expect(result.current.routeSet).toBe(shown);
    expect(onError).toHaveBeenCalledWith('rate-limited');
  });

  it('does not give back old routes when the new request found none at all', async () => {
    answers(routes, () => Response.json({ routes: [] }));
    const { result } = renderHook(() => useRouteSet(vi.fn()));
    act(() => result.current.find(request));
    await wait(0);

    act(() => result.current.find({ ...request, target: { distance: 20 } }));
    await wait(0);

    expect(result.current.routeSet).toBeUndefined();
  });
});
