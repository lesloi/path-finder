import type { PoiCategory } from '../core/index.ts';
import { hexToRgb, POI_COLORS } from './route-colors.ts';

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

// A camera: a body under a small bump, with a hollow lens. It is drawn full size, then shrunk, to stay clear of the ring.
const CAMERA_SCALE = 0.8;
const camera = (x: number, y: number) =>
  ((Math.abs(x) <= 0.8 && y >= -0.4 && y <= 0.62) || (Math.abs(x) <= 0.36 && y >= -0.62 && y < -0.4)) &&
  Math.hypot(x, y - 0.12) > 0.3;

// Whether a point of the glyph's square, from -1 to 1 with y down, is inside the glyph.
const GLYPHS: Record<PoiCategory, (x: number, y: number) => boolean> = {
  // A drop: a round belly under a tip.
  water: (x, y) => {
    if (y > 0.2) return Math.hypot(x, y - 0.2) <= 0.42;
    return y >= -0.62 && Math.abs(x) <= (0.42 * (y + 0.62)) / 0.82;
  },
  viewpoint: (x, y) => camera(x / CAMERA_SCALE, y / CAMERA_SCALE),
  // Two standing figures: a head over a body each.
  toilets: (x, y) => {
    const side = Math.abs(x) - 0.42;
    return Math.hypot(side, y + 0.45) <= 0.2 || (Math.abs(side) <= 0.2 && y >= -0.15 && y <= 0.6);
  },
  // A hut: a roof over a box with a door.
  shelter: (x, y) => {
    if (y >= -0.7 && y < -0.05) return Math.abs(x) <= (0.8 * (y + 0.7)) / 0.65;
    return y >= -0.05 && y <= 0.65 && Math.abs(x) <= 0.55 && !(Math.abs(x) < 0.17 && y > 0.2);
  },
};

const images = new Map<string, ReturnType<typeof drawPoiImage>>();

/** The image of a point of interest's badge: transparent around, ready for `map.addImage`. Drawn once, as each style change adds it again. */
export function poiImage(category: PoiCategory, seasonal: boolean) {
  const id = poiImageId(category, seasonal);
  let image = images.get(id);
  if (!image) images.set(id, (image = drawPoiImage(category, seasonal)));
  return image;
}

function drawPoiImage(category: PoiCategory, seasonal: boolean) {
  const colour = hexToRgb(POI_COLORS[category]);
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
