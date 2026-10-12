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

/** Fails on any XML syntax error, so every test below also checks that the file is well-formed. */
function parse(content: string) {
  const document = new DOMParser().parseFromString(content, 'application/xml');
  const error = document.querySelector('parsererror');
  if (error) throw new Error(`Malformed XML: ${error.textContent}`);
  return document;
}

describe('gpxExport', () => {
  it('names the track after the route', () => {
    const { content } = gpxExport(route, DAY, french);

    expect(parse(content).querySelector('trk > name')?.textContent).toBe('28 sept. · 12,3 km · +340 m');
  });

  it('names the file after the distance, the elevation gain, and the day and time', () => {
    expect(gpxExport(route, DAY, french).fileName).toBe('Running-12km_340m-20260928120000.gpx');
  });

  it('follows the language and units of the settings', () => {
    const { fileName, content } = gpxExport(route, DAY, { units: 'imperial', language: 'en' });

    expect(fileName).toBe('Running-8mi_1114ft-20260928120000.gpx');
    expect(parse(content).querySelector('trk > name')?.textContent).toBe('Sep 28 · 7.7 mi · +1114 ft');
  });

  it('writes one GPX 1.1 track with a height on every point and no timestamp on them', () => {
    const gpx = parse(gpxExport(route, DAY, french).content);

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

    const { fileName, content } = gpxExport({ geometry, distance: 12.34, estimatedDuration: 74 }, DAY, french);

    expect(fileName).toBe('Running-12km-20260928120000.gpx');
    const gpx = parse(content);
    expect(gpx.querySelectorAll('trkpt')).toHaveLength(5);
    expect(gpx.querySelector('ele')).toBeNull();
  });

  it('describes the route and its estimated duration, and credits OpenStreetMap', () => {
    const desc = parse(gpxExport(route, DAY, french).content).querySelector('trk > desc')?.textContent;

    expect(desc).toBe('28 sept. · 12,3 km · +340 m · 1 h 25 min. Données © les contributeurs d’OpenStreetMap, ODbL.');
  });

  it('orders the root elements as the GPX 1.1 schema requires', () => {
    const gpx = parse(gpxExport(route, DAY, french).content);

    expect([...gpx.documentElement.children].map((element) => element.localName)).toEqual(['metadata', 'trk']);
  });

  it('describes the route in the metadata, with the copyright, a link, the day of the export and the bounds', () => {
    const gpx = parse(gpxExport(route, DAY, french).content);

    const metadata = gpx.querySelector('metadata')!;
    expect([...metadata.children].map((element) => element.localName)).toEqual([
      'desc',
      'copyright',
      'link',
      'time',
      'bounds',
    ]);
    expect(metadata.querySelector('desc')?.textContent).toBe(gpx.querySelector('trk > desc')?.textContent);
    expect(metadata.querySelector('copyright')?.getAttribute('author')).toBe('OpenStreetMap contributors');
    expect(metadata.querySelector('copyright > license')?.textContent).toBe(
      'https://opendatacommons.org/licenses/odbl/',
    );
    expect(metadata.querySelector('link')?.getAttribute('href')).toBe('https://mypathfinder.fr/');
    expect(metadata.querySelector('link > text')?.textContent).toBe('Path finder');
    expect(metadata.querySelector('time')?.textContent).toBe(DAY.toISOString());
    const bounds = metadata.querySelector('bounds')!;
    expect([...bounds.attributes].map((attribute) => [attribute.name, attribute.value])).toEqual([
      ['minlat', '45.899200'],
      ['minlon', '6.129300'],
      ['maxlat', '45.909200'],
      ['maxlon', '6.129400'],
    ]);
  });

  it('writes a well-formed file in both languages, without heights, and with no point at all', () => {
    const english = { units: 'imperial', language: 'en' } as const;
    const flat = loop(5).map(([lon, lat]): [number, number] => [lon, lat]);

    const files = [
      gpxExport(route, DAY, english),
      gpxExport({ ...route, geometry: flat }, DAY, french),
      gpxExport({ ...route, geometry: [] }, DAY, french),
    ];

    for (const { content } of files) expect(() => parse(content)).not.toThrow();
  });

  it('writes an empty track without bounds for a route with no point', () => {
    const { content } = gpxExport({ ...route, geometry: [] }, DAY, french);

    const gpx = parse(content);
    expect([...gpx.documentElement.children].map((element) => element.localName)).toEqual(['metadata', 'trk']);
    expect(gpx.querySelector('bounds')).toBeNull();
    expect(gpx.querySelectorAll('trkpt')).toHaveLength(0);
  });

  it('types the track as running, after its description and before its points', () => {
    const track = parse(gpxExport(route, DAY, french).content).querySelector('trk')!;

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

    const points = [...parse(gpxExport(long, DAY, french).content).querySelectorAll('trkpt')];

    expect(points.length).toBeLessThanOrEqual(MAX_GPX_POINTS);
    expect(points[0].getAttribute('lat')).toBe(long.geometry[0][1].toFixed(6));
    expect(points.at(-1)?.textContent).toBe((450 + 19_999).toFixed(1));
  });
});
