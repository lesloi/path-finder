import type { PoiCategory } from '../core/index.ts';
import { POI_COLORS } from './route-colors.ts';

// The badge of a point of interest, drawn pixel by pixel like the distance markers: a disc in the category's colour,
// ringed in white, with a white glyph; a seasonal one is the reverse (a white disc, a coloured ring and glyph).
const SIZE = 40;
const RING = 3;
const SAMPLES = 3;
const WHITE = [255, 255, 255];

/** Pixels per CSS pixel of the image: it is drawn at twice its size for sharp screens. */
export const POI_IMAGE_RATIO = 2;

/** The id of the image of a category's badge in the map's style. */
export const poiImageId = (category: PoiCategory, seasonal: boolean) => `poi-${category}${seasonal ? '-seasonal' : ''}`;

const rgb = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

// Whether a point of the glyph's square, from -1 to 1 with y down, is inside the glyph.
const GLYPHS: Record<PoiCategory, (x: number, y: number) => boolean> = {
  // A drop: a round belly under a tip.
  water: (x, y) => {
    if (y > 0.2) return Math.hypot(x, y - 0.2) <= 0.42;
    return y >= -0.62 && Math.abs(x) <= (0.42 * (y + 0.62)) / 0.82;
  },
  // An eye: a lens with a hollow pupil.
  viewpoint: (x, y) => Math.abs(x) <= 0.8 && Math.abs(y) <= 0.5 * (1 - (x / 0.8) ** 2) && Math.hypot(x, y) > 0.2,
};

/** The image of a point of interest's badge: transparent around, ready for `map.addImage`. */
export function poiImage(category: PoiCategory, seasonal: boolean) {
  const colour = rgb(POI_COLORS[category]);
  const [disc, glyph] = seasonal ? [WHITE, colour] : [colour, WHITE];
  const data = new Uint8Array(SIZE * SIZE * 4);
  const centre = SIZE / 2;
  const reach = centre - 1;
  const inner = reach - RING;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      // Each pixel is the mean of a few samples, which smooths the edges.
      let alpha = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) / SAMPLES - centre;
          const y = py + (sy + 0.5) / SAMPLES - centre;
          const distance = Math.hypot(x, y);
          if (distance > reach) continue;
          const paint =
            distance > inner ? (seasonal ? colour : WHITE) : GLYPHS[category](x / inner, y / inner) ? glyph : disc;
          alpha++;
          paint.forEach((value, k) => (sum[k] = sum[k]! + value));
        }
      }
      if (alpha)
        data.set(
          [...sum.map((value) => Math.round(value / alpha)), Math.round((255 * alpha) / SAMPLES ** 2)],
          (py * SIZE + px) * 4,
        );
    }
  }
  return { width: SIZE, height: SIZE, data };
}
