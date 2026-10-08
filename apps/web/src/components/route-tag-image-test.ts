import { routeTagImage } from './route-tag-image.ts';

describe('routeTagImage', () => {
  const { width, height, data } = routeTagImage('#e0115f', '#ffffff');
  const pixel = (x: number, y: number) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

  it('is a square', () => {
    expect(width).toBe(height);
    expect(data).toHaveLength(width * height * 4);
  });

  it('is filled at its centre', () => {
    expect(pixel(width / 2, height / 2)).toEqual([224, 17, 95, 255]);
  });

  it('has a border around the fill, along its edge', () => {
    expect(pixel(width / 2, 0)).toEqual([255, 255, 255, 255]);
  });

  it('is rounded: transparent in the corners', () => {
    expect(pixel(0, 0)[3]).toBe(0);
  });
});
