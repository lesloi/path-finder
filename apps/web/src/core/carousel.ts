/** A span along the scrolling axis, in px. */
type Span = { left: number; width: number };

/** The index of the card closest to the middle of the viewport, such as the one a swipe settled on. */
export function centredCard(viewport: Span, cards: Span[]): number | undefined {
  const middle = viewport.left + viewport.width / 2;
  let closest: number | undefined;
  let distance = Infinity;
  cards.forEach((card, index) => {
    const away = Math.abs(card.left + card.width / 2 - middle);
    if (away < distance) {
      closest = index;
      distance = away;
    }
  });
  return closest;
}
