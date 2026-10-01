import { render, screen } from '@testing-library/react';

import { RouteSketch } from './route-sketch.tsx';

const geometry: [number, number, number][] = [
  [6, 45, 400],
  [6.01, 45.01, 450],
  [6, 45, 400],
];

describe('RouteSketch', () => {
  it('draws the path over its ground, in the route colour', () => {
    render(<RouteSketch testId="sketch" geometry={geometry} index={1} />);

    const lines = [...screen.getByTestId('sketch').querySelectorAll('polyline')];
    expect(lines).toHaveLength(3);
    expect(lines[2]).toHaveAttribute('stroke', '#2563eb');
  });

  it('shows nothing for a route without heights', () => {
    render(
      <RouteSketch
        testId="sketch"
        geometry={[
          [6, 45],
          [6.1, 45.1],
        ]}
        index={0}
      />,
    );

    expect(screen.queryByTestId('sketch')).not.toBeInTheDocument();
  });

  it('is hidden from assistive technology', () => {
    render(<RouteSketch testId="sketch" geometry={geometry} index={0} />);

    expect(screen.getByTestId('sketch')).toHaveAttribute('aria-hidden', 'true');
  });
});
