import { render, screen } from '@testing-library/react';

import { useLayoutEffect, type ReactNode } from 'react';

import { SubPage } from './sub-page.tsx';

// Runs after the page's own layout effects, in the commit that opens it.
function FocusProbe({ onCommit, children }: { onCommit: (focused: Element | null) => void; children: ReactNode }) {
  useLayoutEffect(() => onCommit(document.activeElement));
  return children;
}

describe('SubPage', () => {
  it('has focused its title when the commit that opens it ends', () => {
    // Arrange
    const onCommit = vi.fn();

    // Act
    render(
      <FocusProbe onCommit={onCommit}>
        <SubPage title="Settings" back="#/" language="en" navigate={() => {}}>
          <button type="button" />
        </SubPage>
      </FocusProbe>,
    );

    // Assert: a click or a key can come right after the commit, before any later effect.
    expect(onCommit).toHaveBeenCalledWith(screen.getByTestId('sub-page-title'));
  });
});
