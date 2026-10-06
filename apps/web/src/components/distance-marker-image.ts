// The dark disc with a white ring behind each figure of the distance markers, drawn pixel by pixel:
// the map takes raw RGBA data, and a canvas would need a browser.
const SIZE = 52;
const RING = 4;
const INK = [28, 29, 27];
const WHITE = [255, 255, 255];

/** Pixels per CSS pixel of the image: it is drawn at twice its size for sharp screens. */
export const DISTANCE_MARKER_RATIO = 2;

// How much of a pixel at this distance from the centre lies inside a circle of this radius, from 0 to 1.
const coverage = (distance: number, radius: number) => Math.min(1, Math.max(0, radius - distance + 0.5));

/** The image of a distance marker's disc: ink, ringed in white, transparent around. */
export function distanceMarkerImage() {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const centre = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const outer = coverage(distance, centre - 1);
      const inner = coverage(distance, centre - 1 - RING);
      const colour = WHITE.map((white, k) => white * (1 - inner) + INK[k] * inner);
      data.set([...colour, 255 * outer], (y * SIZE + x) * 4);
    }
  }
  return { width: SIZE, height: SIZE, data };
}
