import { distanceMarkerImage } from './distance-marker-image.ts';

describe('distanceMarkerImage', () => {
  const { width, height, data } = distanceMarkerImage();
  const pixel = (x: number, y: number) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

  it('is a square with room for two figures', () => {
    expect(width).toBe(height);
    expect(data).toHaveLength(width * height * 4);
  });

  it('is dark at its centre', () => {
    expect(pixel(width / 2, height / 2)).toEqual([28, 29, 27, 255]);
  });

  it('has a white ring around the dark', () => {
    expect(pixel(width / 2, 3)).toEqual([255, 255, 255, 255]);
  });

  it('is transparent in the corners', () => {
    expect(pixel(0, 0)[3]).toBe(0);
  });
});
