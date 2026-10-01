import { render } from '@testing-library/react';

import { expectNamedControls } from './accessible-names.ts';

describe('expectNamedControls', () => {
  it('accepts controls named by a label, a text, or an aria-label', () => {
    const { container } = render(
      <>
        <label>
          Pace <input />
        </label>
        <button type="button">Save</button>
        <a href="#/" aria-label="Back" />
      </>,
    );

    expect(() => expectNamedControls(container)).not.toThrow();
  });

  it('rejects a control without an accessible name', () => {
    const { container } = render(<button type="button" />);

    expect(() => expectNamedControls(container)).toThrow();
  });

  it('rejects a container without any control', () => {
    const { container } = render(<p>Text</p>);

    expect(() => expectNamedControls(container)).toThrow();
  });
});
