import { fireEvent, render, screen } from '@testing-library/react';

import { useTipDismiss } from './use-tip-dismiss.ts';

function Tips({ onKey }: { onKey: () => void }) {
  useTipDismiss();
  return (
    <div onKeyDown={onKey}>
      <button type="button" data-testid="tip" data-tip="Close">
        <svg data-testid="icon" />
      </button>
      <button type="button" data-testid="plain">
        Plain
      </button>
    </div>
  );
}

const escape = (target: Element) => fireEvent.keyDown(target, { key: 'Escape' });

describe('useTipDismiss', () => {
  it('dismisses the tooltip the focus holds open on Escape, and keeps the other handlers from seeing it', () => {
    const onKey = vi.fn();
    render(<Tips onKey={onKey} />);
    screen.getByTestId('tip').focus();

    escape(screen.getByTestId('tip'));

    expect(screen.getByTestId('tip')).toHaveAttribute('data-tip-dismissed');
    expect(onKey).not.toHaveBeenCalled();
  });

  it('leaves Escape to the other handlers once the tooltip is dismissed', () => {
    const onKey = vi.fn();
    render(<Tips onKey={onKey} />);
    screen.getByTestId('tip').focus();
    escape(screen.getByTestId('tip'));

    escape(screen.getByTestId('tip'));

    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to the other handlers when no tooltip is open', () => {
    const onKey = vi.fn();
    render(<Tips onKey={onKey} />);
    screen.getByTestId('plain').focus();

    escape(screen.getByTestId('plain'));

    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('shows the tooltip again once the focus leaves the element', () => {
    render(<Tips onKey={vi.fn()} />);
    screen.getByTestId('tip').focus();
    escape(screen.getByTestId('tip'));

    screen.getByTestId('plain').focus();

    expect(screen.getByTestId('tip')).not.toHaveAttribute('data-tip-dismissed');
  });

  it('keeps the tooltip dismissed while the pointer moves within the element', () => {
    render(<Tips onKey={vi.fn()} />);
    screen.getByTestId('tip').focus();
    escape(screen.getByTestId('tip'));

    fireEvent.pointerLeave(screen.getByTestId('icon'));

    expect(screen.getByTestId('tip')).toHaveAttribute('data-tip-dismissed');
  });

  it('shows the tooltip again once the pointer leaves the element', () => {
    render(<Tips onKey={vi.fn()} />);
    screen.getByTestId('tip').focus();
    escape(screen.getByTestId('tip'));

    fireEvent.pointerLeave(screen.getByTestId('tip'));

    expect(screen.getByTestId('tip')).not.toHaveAttribute('data-tip-dismissed');
  });
});
