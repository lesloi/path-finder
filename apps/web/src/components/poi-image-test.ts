import { poiImage, poiImageId } from './poi-image.ts';
import { hexToRgb as hex, POI_COLORS } from './route-colors.ts';

function pixel(image: ReturnType<typeof poiImage>, x: number, y: number) {
  const at = (y * image.width + x) * 4;
  return [...image.data.slice(at, at + 4)];
}

describe('poiImage', () => {
  it('is a square, transparent in the corners', () => {
    const image = poiImage('water', false);

    expect(image.width).toBe(image.height);
    expect(image.data).toHaveLength(image.width * image.height * 4);
    expect(pixel(image, 0, 0)[3]).toBe(0);
  });

  it('is a disc in the colour of its category, with a white ring', () => {
    const image = poiImage('viewpoint', false);

    expect(pixel(image, image.width / 2, 8)).toEqual([...hex(POI_COLORS.viewpoint), 255]);
    expect(pixel(image, 2, image.height / 2).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('draws the glyph in white at the centre of a water point', () => {
    const image = poiImage('water', false);

    expect(pixel(image, image.width / 2, image.height / 2 + 3)).toEqual([255, 255, 255, 255]);
  });

  it('is the reverse for a seasonal point: white disc, coloured ring and glyph', () => {
    const image = poiImage('water', true);

    expect(pixel(image, image.width / 2, 8)).toEqual([255, 255, 255, 255]);
    expect(pixel(image, 2, image.height / 2).slice(0, 3)).toEqual(hex(POI_COLORS.water));
    expect(pixel(image, image.width / 2, image.height / 2 + 3).slice(0, 3)).toEqual(hex(POI_COLORS.water));
  });

  it('names each badge by category and season', () => {
    expect(poiImageId('water', false)).toBe('poi-water');
    expect(poiImageId('viewpoint', true)).toBe('poi-viewpoint-seasonal');
  });
});
