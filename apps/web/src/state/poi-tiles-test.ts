import { POI_RETRY_MS, requestPoiTile } from './poi-tiles.ts';

const tile = { pois: [{ category: 'water', position: [2, 48] }] };

describe('requestPoiTile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks our own server for the tile and reads its points', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(tile)));
    vi.stubGlobal('fetch', fetchMock);

    const pois = await requestPoiTile(1, 2);

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/poi-tiles/1/2');
    expect(pois).toEqual([{ category: 'water', position: [2, 48], seasonal: false }]);
  });

  it('reads an answer that is not the tile as none, and tries again only after a while', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(tile)));
    vi.stubGlobal('fetch', fetchMock);

    const first = await requestPoiTile(3, 4);
    const soon = await requestPoiTile(3, 4);
    vi.advanceTimersByTime(POI_RETRY_MS);
    const later = await requestPoiTile(3, 4);

    expect(first).toEqual([]);
    expect(soon).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(later).toHaveLength(1);
    vi.useRealTimers();
  });

  it.each([404, 426, 500])('reads a %d as none', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));

    expect(await requestPoiTile(5, 6)).toEqual([]);
  });

  it('reads a network failure as none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    expect(await requestPoiTile(7, 8)).toEqual([]);
  });

  it('keeps a tile it has, instead of asking again', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(tile)));
    vi.stubGlobal('fetch', fetchMock);

    await requestPoiTile(9, 9);
    await requestPoiTile(9, 9);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
