import { render, screen } from '@testing-library/react';

import { SurfaceStrip } from './surface-strip.tsx';

describe('SurfaceStrip', () => {
  it('paints each stretch where it lies along the route', () => {
    render(
      <SurfaceStrip
        testId="strip"
        surfaces={[
          { surface: 'paved', share: 0.7 },
          { surface: 'unpaved', share: 0.3 },
        ]}
      />,
    );

    const stretches = [...screen.getByTestId('strip').querySelectorAll('i')];
    expect(stretches.map((stretch) => [stretch.dataset.surface, stretch.style.left, stretch.style.width])).toEqual([
      ['paved', '0%', '70%'],
      ['unpaved', '70%', '30%'],
    ]);
  });
});
