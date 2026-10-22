import { kmBetween } from './distance.ts';
import { gpxExport } from './gpx.ts';
import { importGpx, MAX_IMPORT_FILE_BYTES } from './gpx-import.ts';
import { elevationProfile, reverseRoute } from './route.ts';

const PACE = 6;

const gpx = (body: string, namespace = 'http://www.topografix.com/GPX/1/1') =>
  `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="${namespace}">${body}</gpx>`;

const trkpt = (lon: number, lat: number, ele?: number) =>
  `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`;

describe('importGpx', () => {
  it('reads the points of a track with their heights', () => {
    const text = gpx(`<trk><trkseg>${trkpt(6.1, 45.9, 450)}${trkpt(6.1, 45.91, 470)}</trkseg></trk>`);

    const imported = importGpx(text, PACE);

    expect(imported?.geometry).toEqual([
      [6.1, 45.9, 450],
      [6.1, 45.91, 470],
    ]);
  });

  it('measures the distance along the points', () => {
    const text = gpx(`<trk><trkseg>${trkpt(6.1, 45.9)}${trkpt(6.1, 45.91)}${trkpt(6.1, 45.92)}</trkseg></trk>`);

    const route = importGpx(text, PACE);

    expect(route?.distance).toBeCloseTo(kmBetween([6.1, 45.9], [6.1, 45.92]), 6);
  });

  it('counts the climb and the descent of the profile, not the noise of the heights', () => {
    // 1 m of jitter every point on a 100 m climb then a 40 m descent, about 1 km apart.
    const heights = [0, 1, 0, 1, 50, 51, 50, 100, 60];
    const points = heights.map((height, k) => trkpt(6.1, 45.9 + k * 0.009, height)).join('');

    const route = importGpx(gpx(`<trk><trkseg>${points}</trkseg></trk>`), PACE);

    expect(route?.elevationGain).toBeGreaterThan(95);
    expect(route?.elevationGain).toBeLessThan(110);
    expect(route?.elevationLoss).toBeGreaterThan(35);
    expect(route?.elevationLoss).toBeLessThan(50);
  });

  it('estimates the duration at the pace, climb included', () => {
    const text = gpx(`<trk><trkseg>${trkpt(6.1, 45.9, 0)}${trkpt(6.1, 45.99, 300)}</trkseg></trk>`);

    const route = importGpx(text, PACE)!;

    expect(route.estimatedDuration).toBeGreaterThan(route.distance * PACE);
  });

  it('keeps a track without heights flat, with no climb, no descent and no profile', () => {
    const text = gpx(`<trk><trkseg>${trkpt(6.1, 45.9)}${trkpt(6.1, 45.91)}</trkseg></trk>`);

    const route = importGpx(text, PACE)!;

    expect(route.geometry).toEqual([
      [6.1, 45.9],
      [6.1, 45.91],
    ]);
    expect(route).not.toHaveProperty('elevationGain');
    expect(route).not.toHaveProperty('elevationLoss');
  });

  it('drops the heights of a track that lacks some, rather than invent them', () => {
    const text = gpx(`<trk><trkseg>${trkpt(6.1, 45.9, 450)}${trkpt(6.1, 45.91)}</trkseg></trk>`);

    const route = importGpx(text, PACE)!;

    expect(route.geometry.every((point) => point.length === 2)).toBe(true);
  });

  it('joins the segments of a track in order', () => {
    const text = gpx(
      `<trk><trkseg>${trkpt(6.1, 45.9)}${trkpt(6.1, 45.91)}</trkseg><trkseg>${trkpt(6.1, 45.92)}${trkpt(6.1, 45.93)}</trkseg></trk>`,
    );

    const route = importGpx(text, PACE)!;

    expect(route.geometry.map(([, lat]) => lat)).toEqual([45.9, 45.91, 45.92, 45.93]);
  });

  it('reads the points of a planned route when there is no track', () => {
    const text = gpx(`<rte><rtept lat="45.9" lon="6.1"/><rtept lat="45.91" lon="6.1"/></rte>`);

    expect(importGpx(text, PACE)?.geometry).toHaveLength(2);
  });

  it('reads a GPX 1.0 file', () => {
    const text = gpx(
      `<trk><trkseg>${trkpt(6.1, 45.9)}${trkpt(6.1, 45.91)}</trkseg></trk>`,
      'http://www.topografix.com/GPX/1/0',
    );

    expect(importGpx(text, PACE)?.geometry).toHaveLength(2);
  });

  it('reads back a file this app exported', () => {
    const geometry: [number, number, number][] = [
      [6.1, 45.9, 450],
      [6.1, 45.91, 480],
      [6.11, 45.91, 470],
    ];
    const { content } = gpxExport(
      { geometry, distance: 2, elevationGain: 30, estimatedDuration: 15 },
      new Date(2026, 8, 28),
      { language: 'en', paceUnit: 'min/km' },
      PACE,
    );

    const imported = importGpx(content, PACE);

    expect(imported?.geometry).toEqual(geometry);
  });

  it('keeps at most as many points as a watch takes, over the whole track', () => {
    const points = Array.from({ length: 6_000 }, (_, k) =>
      trkpt(6.1 + 0.01 * Math.sin(k / 300), 45.9 + k * 0.00002, 400),
    );

    const route = importGpx(gpx(`<trk><trkseg>${points.join('')}</trkseg></trk>`), PACE)!;

    expect(route.geometry.length).toBeLessThanOrEqual(2_000);
    expect(route.distance).toBeGreaterThan(0.1);
  });

  it('marks the route as imported, with nothing known of its surfaces', () => {
    const text = gpx(`<trk><trkseg>${trkpt(6.1, 45.9)}${trkpt(6.1, 45.91)}</trkseg></trk>`);

    const route = importGpx(text, PACE)!;

    expect(route).toMatchObject({ imported: {}, technical: false, surfaces: [], technicalStretches: [] });
  });

  describe('name', () => {
    const points = `<trkseg>${trkpt(6.1, 45.9)}${trkpt(6.1, 45.91)}</trkseg>`;

    it('reads them from the track', () => {
      const text = gpx(`<trk><name> Morning
        run </name>${points}</trk>`);

      expect(importGpx(text, PACE)?.imported).toEqual({ name: 'Morning run' });
    });

    it('reads them from the planned route, then from the metadata', () => {
      const planned = gpx(
        `<metadata><name>File</name></metadata><rte><name>Plan</name><rtept lat="45.9" lon="6.1"/><rtept lat="45.91" lon="6.1"/></rte>`,
      );
      const meta = gpx(`<metadata><name>File</name></metadata><trk>${points}</trk>`);

      expect(importGpx(planned, PACE)?.imported).toEqual({ name: 'Plan' });
      expect(importGpx(meta, PACE)?.imported).toEqual({ name: 'File' });
    });

    it('falls back to the name of the file, without its extension', () => {
      const text = gpx(`<trk>${points}</trk>`);

      expect(importGpx(text, PACE, 'Sunday loop.gpx')?.imported).toEqual({ name: 'Sunday loop' });
    });

    it('has none when the file gives none', () => {
      expect(importGpx(gpx(`<trk>${points}</trk>`), PACE)?.imported).toEqual({});
    });

    it('keeps it short', () => {
      const text = gpx(`<trk><name>${'n'.repeat(500)}</name>${points}</trk>`);

      expect(importGpx(text, PACE)!.imported!.name).toHaveLength(100);
    });
  });

  it('counts the climb of a long recording on all its points, and keeps its summit on the profile', () => {
    // 3000 points on a straight line, rising to 200 m then back down: simplified on positions alone, only its ends stay.
    const heights = (k: number) => 200 - Math.abs(200 - (k * 400) / 2999);
    const points = Array.from({ length: 3_000 }, (_, k) => trkpt(6.1, 45.9 + k * 0.00005, heights(k))).join('');

    const route = importGpx(gpx(`<trk><trkseg>${points}</trkseg></trk>`), PACE)!;

    expect(route.elevationGain).toBeGreaterThan(190);
    expect(route.elevationGain).toBeLessThan(210);
    const summit = Math.max(...elevationProfile(route.geometry)!.map(({ height }) => height));
    expect(summit).toBeGreaterThan(190);
  });

  it('keeps its name and swaps climb and descent when run the other way', () => {
    const text = gpx(`<trk><name>Loop</name><trkseg>${trkpt(6.1, 45.9, 100)}${trkpt(6.1, 45.95, 400)}</trkseg></trk>`);
    const route = importGpx(text, PACE)!;

    const turned = reverseRoute(route, PACE);

    expect(turned.imported).toEqual({ name: 'Loop' });
    expect(turned.elevationGain).toBe(route.elevationLoss);
    expect(turned.elevationLoss).toBe(route.elevationGain);
    expect(turned.reversed).toBe(true);
  });

  it.each([
    ['text that is not XML', 'not xml at all'],
    ['XML that is not GPX', '<html><body/></html>'],
    ['a GPX without points', gpx('<trk><trkseg/></trk>')],
    ['a GPX with a single point', gpx(`<trk><trkseg>${trkpt(6.1, 45.9)}</trkseg></trk>`)],
    ['a point out of the globe', gpx(`<trk><trkseg>${trkpt(6.1, 45.9)}${trkpt(6.1, 95)}</trkseg></trk>`)],
    ['a point without a number', gpx(`<trk><trkseg>${trkpt(6.1, 45.9)}<trkpt lat="x" lon="6"/></trkseg></trk>`)],
  ])('refuses %s', (_, text) => {
    expect(importGpx(text, PACE)).toBeUndefined();
  });

  it('refuses a file larger than it is willing to read', () => {
    const text =
      gpx(`<trk><trkseg>${trkpt(6.1, 45.9)}${trkpt(6.1, 45.91)}</trkseg></trk>`) + ' '.repeat(MAX_IMPORT_FILE_BYTES);

    expect(importGpx(text, PACE)).toBeUndefined();
  });
});
