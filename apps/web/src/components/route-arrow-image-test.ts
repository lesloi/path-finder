import { routeArrowImage } from './route-arrow-image.ts';

describe('routeArrowImage', () => {
  const { width, height, data } = routeArrowImage();
  const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3];

  it('is a square of RGBA pixels', () => {
    expect(width).toBe(height);
    expect(data).toHaveLength(width * height * 4);
  });

  it('is white and opaque on the tip', () => {
    const tip = (Math.floor(height / 2) * width + width - 6) * 4;
    expect([...data.slice(tip, tip + 4)]).toEqual([255, 255, 255, 255]);
  });

  it('is transparent in the corners', () => {
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(width - 1, height - 1)).toBe(0);
  });

  it('points right: the tip is solid where the tail ends are empty', () => {
    expect(alpha(width - 6, height / 2)).toBe(255);
    expect(alpha(4, 2)).toBe(0);
    expect(alpha(4, height - 3)).toBe(0);
  });
});
