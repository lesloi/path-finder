// The white dash with an arrowhead drawn along the selected route, pointing right: a symbol placed along a line has its
// x axis on the line's direction, so right is the way the route goes. Drawn pixel by pixel, as the map
// takes raw RGBA data and a canvas would need a browser.
const WIDTH = 36;
const HEIGHT = 24;
const THICKNESS = 3.4;
// The arrow's margins to the image's edges, then the length of its head and how far its wings are from the edges, in image pixels.
const TIP_MARGIN = 4;
const TAIL_MARGIN = 3;
const HEAD_LENGTH = 9;
const HEAD_MARGIN = 5;

/** Pixels per CSS pixel of the image: it is drawn at twice its size for sharp screens. */
export const ROUTE_ARROW_RATIO = 2;

// How much of a pixel at this distance from a stroke's axis lies inside it, from 0 to 1.
const coverage = (distance: number) => Math.min(1, Math.max(0, THICKNESS / 2 - distance + 0.5));

function distanceToSegment(px: number, py: number, [ax, ay]: number[], [bx, by]: number[]) {
  const t = Math.min(
    1,
    Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
  );
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/** The image of a route's direction arrow: a white dash ending in an arrowhead, transparent around. */
export function routeArrowImage() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  const tip = [WIDTH - TIP_MARGIN, HEIGHT / 2];
  const tail = [TAIL_MARGIN, HEIGHT / 2];
  const upper = [tip[0] - HEAD_LENGTH, HEAD_MARGIN];
  const lower = [tip[0] - HEAD_LENGTH, HEIGHT - HEAD_MARGIN];
  const strokes = [tail, upper, lower];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const distance = Math.min(...strokes.map((from) => distanceToSegment(x + 0.5, y + 0.5, from, tip)));
      data.set([255, 255, 255, 255 * coverage(distance)], (y * WIDTH + x) * 4);
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}
