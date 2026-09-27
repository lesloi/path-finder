import { bilinearHeight, elevationGain, elevationProfile, lambert93, resample, type Position } from './index.ts';

const START: Position = [6.1294, 45.8992];

// Metres north of the start point.
function north(y: number): Position {
  return [START[0], START[1] + y / 111_195];
}

// A slope rising 1 m for every 10 m north of the start point.
const slope = (_lon: number, lat: number) => ((lat - START[1]) * 111_195) / 10;

describe('lambert93', () => {
  it('maps the projection origin to its false easting and northing', () => {
    const [x, y] = lambert93(3, 46.5);

    expect(x).toBeCloseTo(700_000, 3);
    expect(y).toBeCloseTo(6_600_000, 3);
  });

  it('keeps distances along the central meridian within the scale factor of Lambert-93', () => {
    const [, y0] = lambert93(3, 46.5);
    const [, y1] = lambert93(3, 46.5 + 1_000 / 111_132);

    // Scale factor at the origin latitude: 0.99905.
    expect(y1 - y0).toBeCloseTo(999, 0);
  });
});

describe('bilinearHeight', () => {
  it('interpolates between the four surrounding cells', () => {
    // A plane on the 25 m grid, which bilinear interpolation reproduces exactly.
    const plane = (x: number, y: number) => 0.01 * x + 0.02 * (y - 6_500_000);
    const [x, y] = lambert93(...START);

    const height = bilinearHeight(...START, (i, j) => plane(25 * i, 25 * j));

    expect(height).toBeCloseTo(plane(x, y), 6);
  });
});

describe('resample', () => {
  it('places a point every step along the geometry, and keeps the last point', () => {
    const points = resample([north(0), north(100)], 30);

    expect(points.map(([, lat]) => (lat - START[1]) * 111_195)).toEqual(
      [0, 30, 60, 90, 100].map((y) => expect.closeTo(y, 1)),
    );
  });

  it('carries the step across the vertices of the geometry', () => {
    const points = resample([north(0), north(45), north(80), north(100)], 30);

    expect(points.map(([, lat]) => (lat - START[1]) * 111_195)).toEqual(
      [0, 30, 60, 90, 100].map((y) => expect.closeTo(y, 1)),
    );
  });
});

describe('elevationGain', () => {
  it('counts the climbs of a loop and not its descents', () => {
    const outAndBack = [north(0), north(600), north(0)];

    expect(elevationGain(outAndBack, slope)).toBeCloseTo(60, 0);
  });

  it('counts every small climb, with no threshold', () => {
    // Up 0.5 m and down again every 30 m point: 20 bumps along 1200 m.
    const bumps = (_lon: number, lat: number) => (Math.round(((lat - START[1]) * 111_195) / 30) % 2) * 0.5;

    expect(elevationGain([north(0), north(1_200)], bumps)).toBeCloseTo(10, 1);
  });
});

describe('elevationProfile', () => {
  it('gives a height every 30 m and at the last point', () => {
    expect(elevationProfile([north(0), north(100)], slope)).toEqual([0, 3, 6, 9, 10].map((z) => expect.closeTo(z, 1)));
  });
});
