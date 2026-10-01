import { projectRelief } from './route-relief.ts';

const box = { width: 340, height: 130, margin: 12 };
const METRES_PER_DEGREE = 111_000;
// A route going north and climbing 30 m every 400 m.
const climb: [number, number, number][] = [0, 1, 2, 3].map((k) => [
  6,
  45 + (k * 400) / METRES_PER_DEGREE,
  450 + 30 * k,
]);

describe('projectRelief', () => {
  it('draws nothing for a route without heights', () => {
    expect(
      projectRelief(
        [
          [6, 45],
          [6.1, 45.1],
        ],
        box,
      ),
    ).toBeUndefined();
  });

  it('keeps every point inside the box, margin included', () => {
    const { ground, path } = projectRelief(climb, box)!;

    for (const [x, y] of [...ground, ...path]) {
      expect(x).toBeGreaterThanOrEqual(box.margin - 1e-6);
      expect(x).toBeLessThanOrEqual(box.width - box.margin + 1e-6);
      expect(y).toBeGreaterThanOrEqual(box.margin - 1e-6);
      expect(y).toBeLessThanOrEqual(box.height - box.margin + 1e-6);
    }
  });

  it('lifts the path above its ground by its height over the lowest point', () => {
    const { ground, path } = projectRelief(climb, box)!;

    expect(path[0][1]).toBeCloseTo(ground[0][1]);
    expect(path[3][1]).toBeLessThan(ground[3][1]);
  });

  it('keeps at most as many points as a drawing can show', () => {
    const long = Array.from({ length: 2_000 }, (_, k): [number, number, number] => [6 + k * 1e-5, 45, 400 + (k % 50)]);

    const { path } = projectRelief(long, box)!;

    expect(path.length).toBeLessThanOrEqual(151);
  });

  it('draws a single place', () => {
    const { path } = projectRelief([[6, 45, 400]], box)!;

    expect(path).toHaveLength(1);
  });
});
