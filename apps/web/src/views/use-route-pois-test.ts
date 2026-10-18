import { act, renderHook, waitFor } from '@testing-library/react';

import type { Poi } from '../core/index.ts';
import { requestPoiTile } from '../state/index.ts';
import { useRoutePois } from './use-route-pois.ts';

vi.mock('../state/index.ts', () => ({ requestPoiTile: vi.fn() }));

const geometry: [number, number][] = [
  [6.1294, 45.8992],
  [6.13, 45.9],
];
const other: [number, number][] = [
  [6.2, 45.9],
  [6.21, 45.91],
];
const water: Poi = { category: 'water', position: [6.13, 45.9], seasonal: false };
const viewpoint: Poi = { category: 'viewpoint', position: [6.13, 45.9], seasonal: false };

describe('useRoutePois', () => {
  beforeEach(() => vi.mocked(requestPoiTile).mockReset());

  it('asks for no tile until the user reaches for the export', async () => {
    vi.mocked(requestPoiTile).mockResolvedValue([water]);

    const { result } = renderHook(() => useRoutePois(geometry));
    await act(async () => {});

    expect(requestPoiTile).not.toHaveBeenCalled();
    expect(result.current.pois).toEqual([]);
  });

  it('gives the points of the tiles around the route once loaded, whatever categories the map shows', async () => {
    vi.mocked(requestPoiTile).mockResolvedValue([water, viewpoint]);
    const { result } = renderHook(() => useRoutePois(geometry));

    act(() => result.current.load());

    await waitFor(() => expect(result.current.pois).toEqual([water, viewpoint]));
    expect(requestPoiTile).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  });

  it('gives none for another route, and asks nothing for it until the user reaches for its export', async () => {
    vi.mocked(requestPoiTile).mockResolvedValue([water]);
    const { result, rerender } = renderHook(({ route }) => useRoutePois(route), { initialProps: { route: geometry } });
    act(() => result.current.load());
    await waitFor(() => expect(result.current.pois).toEqual([water]));
    vi.mocked(requestPoiTile).mockClear();

    rerender({ route: other });
    await act(async () => {});

    expect(result.current.pois).toEqual([]);
    expect(requestPoiTile).not.toHaveBeenCalled();
  });
});
