import { profileScale } from './profile-scale.ts';

const profile = [
  { distance: 0, height: 100 },
  { distance: 1, height: 150 },
  { distance: 2, height: 200 },
];
const box = { width: 200, height: 60, pad: 10 };

describe('profileScale', () => {
  it('gives the lowest and highest heights and the length', () => {
    const { min, max, total } = profileScale(profile, box);

    expect([min, max, total]).toEqual([100, 200, 2]);
  });

  it('places the distances along the width', () => {
    const { x } = profileScale(profile, box);

    expect([x(0), x(1), x(2)]).toEqual([0, 100, 200]);
  });

  it('places the highest height at the top padding and the lowest at the bottom one', () => {
    const { y } = profileScale(profile, box);

    expect([y(200), y(100)]).toEqual([10, 50]);
  });

  it('puts a flat profile in the middle', () => {
    const { y } = profileScale(
      [
        { distance: 0, height: 300 },
        { distance: 1, height: 300 },
      ],
      box,
    );

    expect(y(300)).toBe(30);
  });

  it('puts a single place at the start', () => {
    const { x } = profileScale([{ distance: 0, height: 300 }], box);

    expect(x(0)).toBe(0);
  });
});
