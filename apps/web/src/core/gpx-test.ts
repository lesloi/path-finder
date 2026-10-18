import { gpxExport, MAX_GPX_POINTS, MAX_WATER_POINTS, WATER_POINT_MAX_METRES, type GpxRoute } from './gpx.ts';
import { waypointPoiKey, type Poi } from './poi.ts';

const DAY = new Date(2026, 8, 28, 12);
/** Minutes per km. */
const PACE = 5.5;

// A loop north then back, heights rising 1 m per point.
function loop(points: number): [number, number, number][] {
  return Array.from({ length: points }, (_, k) => {
    const lat = 45.8992 + 0.01 * Math.sin((Math.PI * k) / (points - 1));
    return [6.1294 + 0.0001 * Math.sin((7 * Math.PI * k) / (points - 1)), lat, 450 + k];
  });
}

const route: GpxRoute = { geometry: loop(5), distance: 12.34, elevationGain: 339.6, estimatedDuration: 85 };
const french = { paceUnit: 'min/km', language: 'fr' } as const;

/** Fails on any XML syntax error, so every test below also checks that the file is well-formed. */
function parse(content: string) {
  const document = new DOMParser().parseFromString(content, 'application/xml');
  const error = document.querySelector('parsererror');
  if (error) throw new Error(`Malformed XML: ${error.textContent}`);
  return document;
}

describe('gpxExport', () => {
  describe('waypoints', () => {
    const waypoints: [number, number][] = [
      [route.geometry[1][0], route.geometry[1][1]],
      [route.geometry[3][0], route.geometry[3][1]],
    ];

    it('adds each as a named point where the route passes it, before the track as the schema orders', () => {
      const { content } = gpxExport(route, DAY, { ...french, waypoints }, PACE);

      const document = parse(content);
      const points = [...document.querySelectorAll('gpx > wpt')];
      expect(points.map((point) => point.querySelector('name')?.textContent)).toEqual([
        'Point de passage 1',
        'Point de passage 2',
      ]);
      expect(points[0]!.getAttribute('lat')).toBe(route.geometry[1][1].toFixed(6));
      expect(points[0]!.querySelector('ele')?.textContent).toBe('451.0');
      expect(document.documentElement.children[1]!.tagName).toBe('wpt');
      expect(document.documentElement.lastElementChild!.tagName).toBe('trk');
    });

    it('names them in the language of the export', () => {
      const { content } = gpxExport(route, DAY, { paceUnit: 'min/km', language: 'en', waypoints }, PACE);

      expect(parse(content).querySelector('wpt > name')?.textContent).toBe('Waypoint 1');
    });

    describe('made from a point of interest', () => {
      // The loop passes its second and fourth points at the same place.
      const distinct: [number, number][] = [
        [route.geometry[1][0], route.geometry[1][1]],
        [route.geometry[2][0], route.geometry[2][1]],
      ];
      const poi = (name?: string) =>
        ({ [waypointPoiKey(distinct[0]!)]: { category: 'water', seasonal: false, ...(name && { name }) } }) as const;
      const names = (content: string) =>
        [...parse(content).querySelectorAll('wpt > name')].map((element) => element.textContent);

      it('is named after the point of interest', () => {
        const { content } = gpxExport(
          route,
          DAY,
          { ...french, waypoints: distinct, waypointPois: poi('Fontaine') },
          PACE,
        );

        expect(names(content)).toEqual(['Fontaine', 'Point de passage 2']);
      });

      it('is named after its category when the point has no name', () => {
        const { content } = gpxExport(route, DAY, { ...french, waypoints: distinct, waypointPois: poi() }, PACE);

        expect(names(content)[0]).toBe('Eau potable');
      });

      it('escapes a name, which comes from anyone', () => {
        const { content } = gpxExport(
          route,
          DAY,
          { ...french, waypoints: distinct, waypointPois: poi('<b>&Co') },
          PACE,
        );

        expect(names(content)[0]).toBe('<b>&Co');
      });
    });

    it('adds none when the route has none', () => {
      expect(parse(gpxExport(route, DAY, french, PACE).content).querySelector('wpt')).toBeNull();
    });
  });

  it('names the track after the route', () => {
    const { content } = gpxExport(route, DAY, french, PACE);

    expect(parse(content).querySelector('trk > name')?.textContent).toBe('Itinéraire · 12,3 km');
  });

  it('names the file after the distance, the elevation gain, and the day and time', () => {
    expect(gpxExport(route, DAY, french, PACE).fileName).toBe('Running-12km_340m-20260928120000.gpx');
  });

  it('follows the language of the settings', () => {
    const { content } = gpxExport(route, DAY, { paceUnit: 'min/km', language: 'en' }, PACE);

    expect(parse(content).querySelector('trk > name')?.textContent).toBe('Route · 12.3 km');
  });

  it('writes one GPX 1.1 track with a height on every point and no timestamp on them', () => {
    const gpx = parse(gpxExport(route, DAY, french, PACE).content);

    expect(gpx.documentElement.getAttribute('version')).toBe('1.1');
    expect(gpx.documentElement.namespaceURI).toBe('http://www.topografix.com/GPX/1/1');
    expect(gpx.querySelectorAll('trk')).toHaveLength(1);
    const points = [...gpx.querySelectorAll('trkpt')];
    expect(points.map((point) => [point.getAttribute('lon'), point.getAttribute('lat'), point.textContent])).toEqual(
      loop(5).map(([lon, lat, ele]) => [lon.toFixed(6), lat.toFixed(6), ele.toFixed(1)]),
    );
    expect(gpx.querySelector('trkpt time')).toBeNull();
  });

  it('writes no heights and no elevation gain for a route without them', () => {
    const geometry = loop(5).map(([lon, lat]): [number, number] => [lon, lat]);

    const { fileName, content } = gpxExport({ geometry, distance: 12.34, estimatedDuration: 74 }, DAY, french, PACE);

    expect(fileName).toBe('Running-12km-20260928120000.gpx');
    const gpx = parse(content);
    expect(gpx.querySelectorAll('trkpt')).toHaveLength(5);
    expect(gpx.querySelector('ele')).toBeNull();
  });

  it('describes the climb, the estimated duration and the pace, in the settings', () => {
    const desc = (settings: Parameters<typeof gpxExport>[2], geometry = route) =>
      parse(gpxExport(geometry, DAY, settings, PACE).content).querySelector('trk > desc')?.textContent;

    expect(desc(french)).toBe('+340 m · 1 h 25 min (5:30 min/km)');
    expect(desc({ paceUnit: 'km/h', language: 'en' })).toBe('+340 m · 1 h 25 min (10.9 km/h)');
    expect(desc(french, { ...route, elevationGain: undefined })).toBe('1 h 25 min (5:30 min/km)');
  });

  it('orders the root elements as the GPX 1.1 schema requires', () => {
    const gpx = parse(gpxExport(route, DAY, french, PACE).content);

    expect([...gpx.documentElement.children].map((element) => element.localName)).toEqual(['metadata', 'trk']);
  });

  it('credits OpenStreetMap in the metadata, with a link, and the day of the export', () => {
    const gpx = parse(gpxExport(route, DAY, french, PACE).content);

    const metadata = gpx.querySelector('metadata')!;
    expect([...metadata.children].map((element) => element.localName)).toEqual(['copyright', 'link', 'time']);
    expect(metadata.querySelector('copyright')?.getAttribute('author')).toBe('OpenStreetMap contributors');
    expect(metadata.querySelector('copyright > license')?.textContent).toBe(
      'https://opendatacommons.org/licenses/odbl/',
    );
    expect(metadata.querySelector('link')?.getAttribute('href')).toBe('https://mypathfinder.fr/');
    expect(metadata.querySelector('link > text')?.textContent).toBe('Path finder');
    expect(metadata.querySelector('time')?.textContent).toBe(DAY.toISOString());
  });

  it('writes an empty track for a route with no point', () => {
    const { content } = gpxExport({ ...route, geometry: [] }, DAY, french, PACE);

    const gpx = parse(content);
    expect(gpx.querySelectorAll('trkpt')).toHaveLength(0);
  });

  it('types the track as running, after its description and before its points', () => {
    const track = parse(gpxExport(route, DAY, french, PACE).content).querySelector('trk')!;

    expect([...track.children].map((element) => element.localName)).toEqual(['name', 'desc', 'type', 'trkseg']);
    expect(track.querySelector('type')?.textContent).toBe('running');
  });

  it(`keeps at most ${MAX_GPX_POINTS} points, with the start and end of the loop`, () => {
    // A zigzag of about 4 m on every point, which a 1 m tolerance keeps whole.
    const zigzag = loop(20_000).map(([lon, lat, ele], k): [number, number, number] => [
      lon + (k % 2) * 0.00005,
      lat,
      ele,
    ]);
    const long = { ...route, geometry: zigzag };

    const points = [...parse(gpxExport(long, DAY, french, PACE).content).querySelectorAll('trkpt')];

    expect(points.length).toBeLessThanOrEqual(MAX_GPX_POINTS);
    expect(points[0].getAttribute('lat')).toBe(long.geometry[0][1].toFixed(6));
    expect(points.at(-1)?.textContent).toBe((450 + 19_999).toFixed(1));
  });
});

describe('gpxExport water points', () => {
  // Straight north for 1.1 km, two points only: a water point beside its middle is far from both vertices.
  const straight: GpxRoute = {
    geometry: [
      [6, 45],
      [6, 45.01],
    ],
    distance: 1.1,
    estimatedDuration: 6,
  };
  /** Degrees of longitude that make `metres` at this latitude. */
  const east = (metres: number) => metres / (111_195 * Math.cos((45 * Math.PI) / 180));
  const water = (metres: number, lat = 45.005, extra: Partial<Poi> = {}): Poi => ({
    category: 'water',
    position: [6 + east(metres), lat],
    seasonal: false,
    ...extra,
  });
  const waterPoints = (content: string) => [...parse(content).querySelectorAll('gpx > wpt')];

  it('adds a point within the limit as a named drinking water point, beside the middle of a long leg', () => {
    const { content } = gpxExport(straight, DAY, { ...french, pois: [water(WATER_POINT_MAX_METRES - 10)] }, PACE);

    const [point] = waterPoints(content);
    expect(point.querySelector('name')?.textContent).toBe('Eau potable');
    expect(point.querySelector('sym')?.textContent).toBe('Drinking Water');
    expect(point.getAttribute('lat')).toBe('45.005000');
  });

  it('writes them before the track and their children in the order the schema fixes', () => {
    const { content } = gpxExport(
      straight,
      DAY,
      { ...french, pois: [water(10, 45.005, { seasonal: true, name: 'Source' })] },
      PACE,
    );

    const document = parse(content);
    const order = [...document.documentElement.children].map((element) => element.tagName);
    expect(order.indexOf('wpt')).toBeLessThan(order.indexOf('trk'));
    expect([...waterPoints(content)[0].children].map((element) => element.tagName)).toEqual(['name', 'desc', 'sym']);
  });

  it('leaves out a point beyond the limit', () => {
    const { content } = gpxExport(straight, DAY, { ...french, pois: [water(WATER_POINT_MAX_METRES + 20)] }, PACE);

    expect(waterPoints(content)).toHaveLength(0);
  });

  it('leaves out a point beyond the end of the route even when it is within the limit of the line', () => {
    const { content } = gpxExport(straight, DAY, { ...french, pois: [water(0, 45.01 + 0.0013)] }, PACE);

    expect(waterPoints(content)).toHaveLength(0);
  });

  it('measures against the whole route, not the points kept of a long one', () => {
    // 20 000 points, so the track is simplified; the point is 50 m from a vertex that is not kept.
    const long: GpxRoute = { ...route, geometry: loop(20_000) };
    const [lon, lat] = long.geometry[9_999];
    const near: Poi = { category: 'water', position: [lon + east(50), lat], seasonal: false };

    const { content } = gpxExport(long, DAY, { ...french, pois: [near] }, PACE);

    expect(waterPoints(content)).toHaveLength(1);
  });

  it('marks a seasonal one, named or not', () => {
    const { content } = gpxExport(
      straight,
      DAY,
      {
        ...french,
        pois: [water(10, 45.002, { seasonal: true }), water(10, 45.006, { seasonal: true, name: 'Source des Pins' })],
      },
      PACE,
    );

    const [unnamed, named] = waterPoints(content);
    expect(unnamed.querySelector('name')?.textContent).toBe('Eau potable saisonnière');
    expect(unnamed.querySelector('desc')).toBeNull();
    expect(named.querySelector('name')?.textContent).toBe('Source des Pins');
    expect(named.querySelector('desc')?.textContent).toBe('Eau potable saisonnière');
  });

  it('names them in the language of the settings, and escapes an OSM name', () => {
    const { content } = gpxExport(
      straight,
      DAY,
      { language: 'en', paceUnit: 'min/km', pois: [water(10, 45.002), water(10, 45.006, { name: '<b>&Co' })] },
      PACE,
    );

    expect(waterPoints(content).map((point) => point.querySelector('name')?.textContent)).toEqual([
      'Drinking water',
      '<b>&Co',
    ]);
  });

  it('lists them in the order the route meets them', () => {
    const { content } = gpxExport(
      straight,
      DAY,
      { ...french, pois: [water(10, 45.008, { name: 'B' }), water(10, 45.002, { name: 'A' })] },
      PACE,
    );

    expect(waterPoints(content).map((point) => point.querySelector('name')?.textContent)).toEqual(['A', 'B']);
  });

  it('does not write twice a water point the user made a waypoint, but writes one they removed from the waypoints', () => {
    const point = water(10);
    const waypointPois = { [waypointPoiKey(point.position)]: { category: 'water', seasonal: false } } as const;

    const kept = gpxExport(
      straight,
      DAY,
      { ...french, waypoints: [point.position], waypointPois, pois: [point] },
      PACE,
    );
    const removed = gpxExport(straight, DAY, { ...french, waypoints: [], waypointPois, pois: [point] }, PACE);

    expect(waterPoints(kept.content)).toHaveLength(1);
    expect(waterPoints(kept.content)[0].querySelector('sym')).toBeNull();
    expect(waterPoints(removed.content)[0].querySelector('sym')?.textContent).toBe('Drinking Water');
  });

  it('ignores any other category', () => {
    const { content } = gpxExport(straight, DAY, { ...french, pois: [{ ...water(10), category: 'viewpoint' }] }, PACE);

    expect(waterPoints(content)).toHaveLength(0);
  });

  it('keeps the nearest ones when there are more than watches take, still in the order of the route', () => {
    const many = Array.from({ length: MAX_WATER_POINTS + 5 }, (_, k) =>
      water(k < MAX_WATER_POINTS ? 5 : 90, 45 + 0.0001 * (k + 1), { name: `P${k}` }),
    );

    const { content } = gpxExport(straight, DAY, { ...french, pois: many }, PACE);

    const names = waterPoints(content).map((point) => point.querySelector('name')?.textContent);
    expect(names).toEqual(many.slice(0, MAX_WATER_POINTS).map(({ name }) => name));
  });

  it('is the same file without any, or with none near', () => {
    const plain = gpxExport(straight, DAY, french, PACE).content;

    expect(gpxExport(straight, DAY, { ...french, pois: [] }, PACE).content).toBe(plain);
    expect(gpxExport(straight, DAY, { ...french, pois: [water(1_000)] }, PACE).content).toBe(plain);
  });

  it('keeps the OSM attribution', () => {
    const { content } = gpxExport(straight, DAY, { ...french, pois: [water(10)] }, PACE);

    expect(parse(content).querySelector('metadata > copyright')?.getAttribute('author')).toBe(
      'OpenStreetMap contributors',
    );
  });
});
