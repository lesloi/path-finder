import { ROUTE_COLORS } from './route-colors.ts';

// The rounded box behind a route's tag, drawn pixel by pixel like the distance markers' disc: the
// map takes raw RGBA data, and a canvas would need a browser.
const SIZE = 36;
const RADIUS = 12;
const BORDER = 2;

/** Pixels per CSS pixel of the image: it is drawn at twice its size for sharp screens. */
export const ROUTE_TAG_RATIO = 2;

/** Where the box stretches to fit its text: the middle, so that the rounded corners keep their shape. */
export const ROUTE_TAG_STRETCH = {
  stretchX: [[RADIUS, SIZE - RADIUS]] satisfies [number, number][],
  stretchY: [[RADIUS, SIZE - RADIUS]] satisfies [number, number][],
  content: [RADIUS / 2, RADIUS / 2, SIZE - RADIUS / 2, SIZE - RADIUS / 2] satisfies [number, number, number, number],
};

/** Pixels around the text, on top of the box's own border: top, right, bottom, left. */
export const ROUTE_TAG_PADDING: [number, number, number, number] = [3, 8, 3, 8];

/** The image of the white tag of a route that is not selected. */
export const ROUTE_TAG_MUTED = 'route-tag';

/** The image of the tag of the selected route at this position, filled in the route's colour. */
export const routeTagId = (index: number) => `route-tag-${index % ROUTE_COLORS.length}`;

// The red, green and blue of a `#rrggbb` colour.
const rgb = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

// How much of a pixel lies inside a shape whose signed distance to the pixel's centre is this, from 0 to 1.
const coverage = (signedDistance: number) => Math.min(1, Math.max(0, 0.5 - signedDistance));

/** The image of a route tag's box: filled, ringed in a border colour, transparent around. */
export function routeTagImage(fill: string, border: string) {
  const [fillRgb, borderRgb] = [rgb(fill), rgb(border)];
  const data = new Uint8Array(SIZE * SIZE * 4);
  const half = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // The signed distance to a rounded square: negative inside.
      const [dx, dy] = [Math.abs(x + 0.5 - half) - (half - RADIUS), Math.abs(y + 0.5 - half) - (half - RADIUS)];
      const distance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - RADIUS;
      const outer = coverage(distance);
      const inner = coverage(distance + BORDER);
      const colour = fillRgb.map((channel, k) => channel * inner + borderRgb[k] * (1 - inner));
      data.set([...colour, 255 * outer], (y * SIZE + x) * 4);
    }
  }
  return { width: SIZE, height: SIZE, data };
}
