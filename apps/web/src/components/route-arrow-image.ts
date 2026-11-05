// The white chevron drawn along the selected route, pointing right: a symbol placed along a line has its x axis on
// the line's direction, so right is the way the route goes. Drawn pixel by pixel, as the map takes raw RGBA data and a
// canvas would need a browser.
const WIDTH = 26;
const HEIGHT = 24;
const THICKNESS = 4.8;
// Where the two legs start and meet, in image pixels: no shaft behind them, so that the mark reads as a direction
// rather than as one more dash on the line.
const TIP = [22, 12];
const WINGS = [
  [3, 4],
  [3, 20],
];

/** Pixels per CSS pixel of the image: it is drawn at twice its size for sharp screens. */
export const ROUTE_ARROW_RATIO = 2;

/** Pixels between two chevrons along the route: the mark is 13 px wide, and three of them fit in the gap. */
export const ROUTE_ARROW_SPACING = 64;

// How much of a pixel at this distance from a stroke's axis lies inside it, from 0 to 1.
const coverage = (distance: number) => Math.min(1, Math.max(0, THICKNESS / 2 - distance + 0.5));

function distanceToSegment(px: number, py: number, [ax, ay]: number[], [bx, by]: number[]) {
  const t = Math.min(
    1,
    Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
  );
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
}

/** The image of a route's direction arrow: a white chevron, transparent around. */
export function routeArrowImage() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const distance = Math.min(...WINGS.map((wing) => distanceToSegment(x + 0.5, y + 0.5, wing, TIP)));
      data.set([255, 255, 255, 255 * coverage(distance)], (y * WIDTH + x) * 4);
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}
