import { renderHook, waitFor } from '@testing-library/react';

import { useElevation } from './capabilities.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useElevation', () => {
  it('is false until the API answers', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));

    const { result } = renderHook(() => useElevation());

    expect(result.current).toBe(false);
  });

  it('is true when the API has elevation data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ elevation: true })));

    const { result } = renderHook(() => useElevation());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ['says it has none', () => Promise.resolve(Response.json({ elevation: false }))],
    ['answers something else', () => Promise.resolve(Response.json({ other: true }))],
    ['answers with an error', () => Promise.resolve(new Response('', { status: 404 }))],
    ['cannot be reached', () => Promise.reject(new Error('offline'))],
  ])('is false when the API %s', async (_, answer) => {
    const fetchMock = vi.fn(answer);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useElevation());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
