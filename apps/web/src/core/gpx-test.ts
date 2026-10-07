import { gpxExport, MAX_GPX_POINTS, type GpxRoute } from './gpx.ts';

const DAY = new Date(2026, 8, 28, 12);

// A loop north then back, heights rising 1 m per point.
function loop(points: number): [number, number, number][] {
  return Array.from({ length: points }, (_, k) => {
    const lat = 45.8992 + 0.01 * Math.sin((Math.PI * k) / (points - 1));
    return [6.1294 + 0.0001 * Math.sin((7 * Math.PI * k) / (points - 1)), lat, 450 + k];
  });
}

const route: GpxRoute = { geometry: loop(5), distance: 12.34, elevationGain: 339.6, estimatedDuration: 85 };
const french = { units: 'metric', language: 'fr' } as const;

function parse(content: string) {
  return new DOMParser().parseFromString(content, 'application/xml');
}

describe('gpxExport', () => {
  it('names the track after the route', () => {
    const { content } = gpxExport(route, DAY, french);

    expect(parse(content).querySelector('trk > name')?.textContent).toBe('28 sept. · 12,3 km · +340 m');
  });

  it('names the file after the day, the distance, and the elevation gain', () => {
    expect(gpxExport(route, DAY, french).fileName).toBe('2809-12km_340m.gpx');
  });

  it('follows the language and units of the settings', () => {
    const { fileName, content } = gpxExport(route, DAY, { units: 'imperial', language: 'en' });

    expect(fileName).toBe('2809-8mi_1114ft.gpx');
    expect(parse(content).querySelector('trk > name')?.textContent).toBe('Sep 28 · 7.7 mi · +1114 ft');
  });

  it('writes one GPX 1.1 track with a height on every point and no timestamps', () => {
    const gpx = parse(gpxExport(route, DAY, french).content);

    expect(gpx.querySelector('parsererror')).toBeNull();
    expect(gpx.documentElement.getAttribute('version')).toBe('1.1');
    expect(gpx.documentElement.namespaceURI).toBe('http://www.topografix.com/GPX/1/1');
    expect(gpx.querySelectorAll('trk')).toHaveLength(1);
    const points = [...gpx.querySelectorAll('trkpt')];
    expect(points.map((point) => [point.getAttribute('lon'), point.getAttribute('lat'), point.textContent])).toEqual(
      loop(5).map(([lon, lat, ele]) => [lon.toFixed(6), lat.toFixed(6), ele.toFixed(1)]),
    );
    expect(gpx.querySelector('time')).toBeNull();
  });

  it('writes no heights and no elevation gain for a route without them', () => {
    const geometry = loop(5).map(([lon, lat]): [number, number] => [lon, lat]);

    const { fileName, content } = gpxExport({ geometry, distance: 12.34, estimatedDuration: 74 }, DAY, french);

    expect(fileName).toBe('2809-12km.gpx');
    const gpx = parse(content);
    expect(gpx.querySelectorAll('trkpt')).toHaveLength(5);
    expect(gpx.querySelector('ele')).toBeNull();
  });

  it('describes the route and its estimated duration, and credits OpenStreetMap', () => {
    const desc = parse(gpxExport(route, DAY, french).content).querySelector('trk > desc')?.textContent;

    expect(desc).toBe('28 sept. · 12,3 km · +340 m · 1 h 25 min. Données © les contributeurs d’OpenStreetMap, ODbL.');
  });

  it(`keeps at most ${MAX_GPX_POINTS} points, with the start and end of the loop`, () => {
    // A zigzag of about 4 m on every point, which a 1 m tolerance keeps whole.
    const zigzag = loop(20_000).map(([lon, lat, ele], k): [number, number, number] => [
      lon + (k % 2) * 0.00005,
      lat,
      ele,
    ]);
    const long = { ...route, geometry: zigzag };

    const points = [...parse(gpxExport(long, DAY, french).content).querySelectorAll('trkpt')];

    expect(points.length).toBeLessThanOrEqual(MAX_GPX_POINTS);
    expect(points[0].getAttribute('lat')).toBe(long.geometry[0][1].toFixed(6));
    expect(points.at(-1)?.textContent).toBe((450 + 19_999).toFixed(1));
  });
});
