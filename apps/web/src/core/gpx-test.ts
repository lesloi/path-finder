import { gpxExport, MAX_GPX_POINTS, type GpxRoute } from './gpx.ts';
import { waypointPoiKey } from './poi.ts';

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
