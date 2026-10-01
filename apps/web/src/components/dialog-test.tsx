import { fireEvent, render, screen } from '@testing-library/react';

import { Dialog } from './dialog.tsx';

function setup() {
  const onClose = vi.fn();
  render(
    <Dialog testId="dialog" title="Surface" closeLabel="Close" onClose={onClose}>
      <p data-testid="content">Content</p>
    </Dialog>,
  );
  return onClose;
}

describe('Dialog', () => {
  it('is named by its title and shows its content', () => {
    setup();

    expect(screen.getByTestId('dialog')).toHaveAccessibleName('Surface');
    expect(screen.getByTestId('dialog')).toContainElement(screen.getByTestId('content'));
  });

  it('closes with its cross', () => {
    const onClose = setup();

    fireEvent.click(screen.getByTestId('dialog-close'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes with Escape', () => {
    const onClose = setup();

    fireEvent(screen.getByTestId('dialog'), new Event('cancel', { cancelable: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes with a click on the scrim, not on its content', () => {
    const onClose = setup();

    fireEvent.click(screen.getByTestId('content'));
    // The padding around the content is part of the box, not of the scrim.
    fireEvent.click(screen.getByTestId('content').parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
