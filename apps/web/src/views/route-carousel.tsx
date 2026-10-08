import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';

import { centredCard } from '../core/index.ts';

// Milliseconds a scroll has to rest before the card it stopped on is selected.
const SETTLE_MS = 90;
// Milliseconds after the carousel moved by itself, during which the cards it passes are not selected.
const MOVE_MS = 1_100;

/**
 * A row of cards that snaps one at a time to the middle, such as the routes of a phone. The card the user settles
 * on is selected (`onSelect`); a selection made elsewhere, such as a tap on the map, moves the carousel to its card.
 */
export function RouteCarousel({
  selected,
  onSelect,
  testId,
  children,
}: {
  selected?: number | undefined;
  onSelect: (index: number) => void;
  testId?: string;
  children: ReactNode[];
}) {
  const list = useRef<HTMLUListElement>(null);
  const settling = useRef<ReturnType<typeof setTimeout>>(undefined);
  const movingUntil = useRef(0);

  const cards = () => [...list.current!.children] as HTMLElement[];
  const centred = () => {
    const box = list.current!.getBoundingClientRect();
    return centredCard(
      { left: box.left, width: box.width },
      cards().map((card) => {
        const { left, width } = card.getBoundingClientRect();
        return { left, width };
      }),
    );
  };

  const follow = useEffectEvent((index: number) => {
    const card = cards()[index];
    if (!card || centred() === index) return;
    movingUntil.current = Date.now() + MOVE_MS;
    list.current!.scrollTo({
      left: card.offsetLeft - (list.current!.clientWidth - card.offsetWidth) / 2,
      behavior: 'smooth',
    });
  });
  useEffect(() => {
    if (selected !== undefined) follow(selected);
  }, [selected]);
  useEffect(() => () => clearTimeout(settling.current), []);

  // What the timer of a scroll reads when it rests: the selection and listener as of then, not as of the scroll.
  const latest = useRef({ selected, onSelect });
  useEffect(() => {
    latest.current = { selected, onSelect };
  });
  const settle = () => {
    if (Date.now() < movingUntil.current) return;
    const index = centred();
    if (index !== undefined && index !== latest.current.selected) latest.current.onSelect(index);
  };

  return (
    <ul
      ref={list}
      data-testid={testId}
      // Vertical moves stay the sheet's own; the next card shows at the edge.
      className={
        'relative m-0 flex list-none snap-x snap-mandatory gap-2 overflow-x-auto p-0 pb-1 ' +
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      }
      onScroll={() => {
        clearTimeout(settling.current);
        settling.current = setTimeout(settle, SETTLE_MS);
      }}
    >
      {children.map((card, index) => (
        <li key={index} className="w-[88%] flex-none snap-center">
          {card}
        </li>
      ))}
    </ul>
  );
}
