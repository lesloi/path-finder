import { centredCard } from './carousel.ts';

const viewport = { left: 0, width: 400 };
// Cards 350 px wide with 10 px between them, the first one centred.
const cards = [0, 1, 2].map((i) => ({ left: 25 + i * 360, width: 350 }));

describe('centredCard', () => {
  it('is the card whose centre is the closest to the centre of the viewport', () => {
    expect(centredCard(viewport, cards)).toBe(0);
    expect(
      centredCard(
        viewport,
        cards.map((card) => ({ ...card, left: card.left - 360 })),
      ),
    ).toBe(1);
    expect(
      centredCard(
        viewport,
        cards.map((card) => ({ ...card, left: card.left - 720 })),
      ),
    ).toBe(2);
  });

  it('takes the card the scroll passed half of, not the one it left', () => {
    expect(
      centredCard(
        viewport,
        cards.map((card) => ({ ...card, left: card.left - 170 })),
      ),
    ).toBe(0);
    expect(
      centredCard(
        viewport,
        cards.map((card) => ({ ...card, left: card.left - 190 })),
      ),
    ).toBe(1);
  });

  it('is none without cards', () => {
    expect(centredCard(viewport, [])).toBeUndefined();
  });
});
