import { fireEvent, render, screen } from '@testing-library/react';

import { Dialog } from './dialog.tsx';

function setup() {
  const onClose = vi.fn();
  render(
    <Dialog title="Surface" closeLabel="Close" onClose={onClose}>
      <p>Content</p>
    </Dialog>,
  );
  return onClose;
}

describe('Dialog', () => {
  it('is named by its title and shows its content', () => {
    setup();

    expect(screen.getByRole('dialog', { name: 'Surface' })).toHaveTextContent('Content');
  });

  it('closes with its cross', () => {
    const onClose = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes with Escape', () => {
    const onClose = setup();

    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes with a click on the scrim, not on its content', () => {
    const onClose = setup();

    fireEvent.click(screen.getByText('Content'));
    // The padding around the content is part of the box, not of the scrim.
    fireEvent.click(screen.getByText('Content').parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
