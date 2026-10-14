import {
  POI_MIN_ZOOM,
  parsePoiTile,
  poiTileOf,
  poiTilesCovering,
  shownPoiCategories,
  waypointPoiAt,
  waypointPoiKey,
} from './poi.ts';

describe('poiTileOf', () => {
  // The same cases as the server's `TestPOITileOfCutsTheWorldOnAGridOfPoiTileZoom`.
  it.each([
    [0.1, 0.1, 512, 511],
    [-0.1, -0.1, 511, 512],
    [0, 180, 1023, 512],
    [89.99, -180, 0, 0],
  ])('puts (%d, %d) in tile %d/%d, as the server does', (lat, lon, x, y) => {
    expect(poiTileOf([lon, lat])).toEqual([x, y]);
  });
});

describe('poiTilesCovering', () => {
  it('lists every tile a view touches', () => {
    const tiles = poiTilesCovering([-0.1, -0.1, 0.1, 0.1]);

    expect(tiles).toEqual([
      [511, 511],
      [512, 511],
      [511, 512],
      [512, 512],
    ]);
  });

  it('lists one tile for a view inside it', () => {
    expect(poiTilesCovering([0.01, 0.01, 0.02, 0.02])).toEqual([[512, 511]]);
  });
});

describe('parsePoiTile', () => {
  it('reads water points and viewpoints', () => {
    const body = {
      pois: [
        { category: 'water', position: [2.1, 48.8], seasonal: true },
        { category: 'viewpoint', position: [2.2, 48.9] },
      ],
    };

    expect(parsePoiTile(body)).toEqual([
      { category: 'water', position: [2.1, 48.8], seasonal: true },
      { category: 'viewpoint', position: [2.2, 48.9], seasonal: false },
    ]);
  });

  it('keeps the name of a point that has one, and only a real one', () => {
    const body = {
      pois: [
        { category: 'viewpoint', position: [2.2, 48.9], name: 'Tour Eiffel' },
        { category: 'viewpoint', position: [2.3, 48.9], name: '' },
        { category: 'viewpoint', position: [2.4, 48.9], name: 12 },
      ],
    };

    expect(parsePoiTile(body)).toEqual([
      { category: 'viewpoint', position: [2.2, 48.9], seasonal: false, name: 'Tour Eiffel' },
      { category: 'viewpoint', position: [2.3, 48.9], seasonal: false },
      { category: 'viewpoint', position: [2.4, 48.9], seasonal: false },
    ]);
  });

  it('drops what it does not know, and keeps the rest', () => {
    const body = {
      pois: [
        { category: 'toilet', position: [2, 48] },
        { category: 'water', position: [2, 'x'] },
        { category: 'water', position: [2] },
        null,
        { category: 'water', position: [2.3, 48.7], seasonal: 'yes' },
      ],
    };

    expect(parsePoiTile(body)).toEqual([{ category: 'water', position: [2.3, 48.7], seasonal: false }]);
  });

  it.each([[null], [{}], [{ pois: 'x' }], ['<html>']])('reads %j as an empty tile', (body) => {
    expect(parsePoiTile(body)).toEqual([]);
  });
});

describe('shownPoiCategories', () => {
  it('lists the categories that are on', () => {
    expect(shownPoiCategories({ water: true, viewpoint: false, seasonal: true })).toEqual(['water']);
  });

  it('lists none when all are off', () => {
    expect(shownPoiCategories({ water: false, viewpoint: false, seasonal: true })).toEqual([]);
  });
});

it('shows points of interest from zoom 11', () => {
  expect(POI_MIN_ZOOM).toBe(11);
});

describe('waypointPoiAt', () => {
  it('finds the point of interest a waypoint was made from, by its exact position', () => {
    const fountain = { category: 'water', seasonal: false, name: 'Fontaine' } as const;
    const pois = { [waypointPoiKey([6.1, 45.9])]: fountain };

    expect(waypointPoiAt(pois, [6.1, 45.9])).toBe(fountain);
    expect(waypointPoiAt(pois, [6.1, 45.90001])).toBeUndefined();
  });
});
