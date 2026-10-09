import { renderHook, waitFor } from '@testing-library/react';

import { requestCoverage, useCoverage } from './coverage.ts';

const cells = [[6, 45.8, 6.1, 45.9]];

function answer(response: Response | Promise<Response>) {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllEnvs());

describe('requestCoverage', () => {
  it('asks the API with the build id, and nothing else', async () => {
    vi.stubEnv('VITE_BUILD_ID', 'build-1');
    const fetchMock = answer(Response.json({ cells }));

    expect(await requestCoverage()).toEqual(cells);

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/coverage', { headers: { 'X-Build-Id': 'build-1' } });
  });

  it('says nothing when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect(await requestCoverage()).toBeUndefined();
  });

  it('says nothing of an error or of an answer that is not one', async () => {
    answer(new Response('', { status: 502 }));
    expect(await requestCoverage()).toBeUndefined();
    answer(Response.json({ cells: 'all' }));
    expect(await requestCoverage()).toBeUndefined();
  });

  it('reloads the page when the API runs a newer build', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    answer(Response.json({ error: 'stale-build' }, { status: 426 }));

    expect(await requestCoverage()).toBeUndefined();

    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('useCoverage', () => {
  it('has the cells once the API has answered', async () => {
    answer(Response.json({ cells }));

    const { result } = renderHook(() => useCoverage());

    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual(cells));
  });

  it('keeps nothing from an answer that comes after the hook is gone', async () => {
    let respond: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (respond = resolve)));
    const { result, unmount } = renderHook(() => useCoverage());

    unmount();
    respond(Response.json({ cells }));

    await Promise.resolve();
    expect(result.current).toBeUndefined();
  });
});
