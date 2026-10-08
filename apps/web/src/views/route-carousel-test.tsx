import { act, fireEvent, render, screen } from '@testing-library/react';

import { RouteCarousel } from './route-carousel.tsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// jsdom has no layout: the carousel is 400 px wide, its cards 350 px, `scrolled` px along.
function layout(scrolled: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.tagName === 'UL') return { left: 0, width: 400 } as DOMRect;
    const index = [...this.parentElement!.children].indexOf(this);
    return { left: 25 + index * 360 - scrolled, width: 350 } as DOMRect;
  });
}

function setup(selected: number | undefined, onSelect = vi.fn()) {
  const cards = [0, 1, 2].map((index) => <button key={index}>{`card ${index}`}</button>);
  const view = render(
    <RouteCarousel testId="carousel" selected={selected} onSelect={onSelect}>
      {cards}
    </RouteCarousel>,
  );
  return { ...view, onSelect, list: screen.getByTestId('carousel') };
}

const settle = () => act(() => void vi.advanceTimersByTime(100));

describe('RouteCarousel', () => {
  it('shows a card for each child', () => {
    setup(0);

    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('selects the card the user settles on', () => {
    layout(0);
    const { list, onSelect } = setup(0);

    layout(360);
    fireEvent.scroll(list);
    settle();

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('waits for the scroll to rest, and does not select the card it started on', () => {
    layout(0);
    const { list, onSelect } = setup(0);

    layout(200);
    fireEvent.scroll(list);
    act(() => void vi.advanceTimersByTime(50));
    expect(onSelect).not.toHaveBeenCalled();

    layout(10);
    fireEvent.scroll(list);
    settle();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('moves to the card of a selection made elsewhere, without selecting the cards it passes', () => {
    layout(0);
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const { list, onSelect, rerender } = setup(0);

    rerender(
      <RouteCarousel testId="carousel" selected={2} onSelect={onSelect}>
        {[0, 1, 2].map((index) => (
          <button key={index}>{`card ${index}`}</button>
        ))}
      </RouteCarousel>,
    );
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ behavior: 'smooth' }));

    layout(360);
    fireEvent.scroll(list);
    settle();

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stays where it is when the card selected is the one in the middle already', () => {
    layout(0);
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');

    setup(0);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not move while none is selected', () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');

    setup(undefined);

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
