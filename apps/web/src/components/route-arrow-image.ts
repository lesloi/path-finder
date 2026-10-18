// The white chevron drawn along the selected route, pointing right: a symbol placed along a line has its
// x axis on the line's direction, so right is the way the route goes. Drawn pixel by pixel, as the map
// takes raw RGBA data and a canvas would need a browser.
const SIZE = 24;
const THICKNESS = 3.4;

/** Pixels per CSS pixel of the image: it is drawn at twice its size for sharp screens. */
export const ROUTE_ARROW_RATIO = 2;

// How much of a pixel at this distance from a stroke's axis lies inside it, from 0 to 1.
const coverage = (distance: number) => Math.min(1, Math.max(0, THICKNESS / 2 - distance + 0.5));

// Distance from a point to a segment.
function distanceToSegment(px: number, py: number, [ax, ay]: number[], [bx, by]: number[]) {
  const t = Math.min(
    1,
    Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
  );
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/** The image of a route's direction arrow: a white chevron, transparent around. */
export function routeArrowImage() {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const tip = [SIZE - 5, SIZE / 2];
  const upper = [6, 5];
  const lower = [6, SIZE - 5];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.min(
        distanceToSegment(x + 0.5, y + 0.5, upper, tip),
        distanceToSegment(x + 0.5, y + 0.5, lower, tip),
      );
      data.set([255, 255, 255, 255 * coverage(distance)], (y * SIZE + x) * 4);
    }
  }
  return { width: SIZE, height: SIZE, data };
}
