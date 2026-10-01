import { render, screen } from '@testing-library/react';

import { RouteThumbnail } from './route-thumbnail.tsx';

const geometry: [number, number][] = [
  [6, 45],
  [6.1, 45.1],
  [6, 45],
];

describe('RouteThumbnail', () => {
  it('draws the route in its colour', () => {
    render(<RouteThumbnail testId="thumb" geometry={geometry} index={1} />);

    const lines = [...screen.getByTestId('thumb').querySelectorAll('polyline')];
    expect(lines.map((line) => line.getAttribute('stroke'))).toEqual(['#ffffff', '#2563eb']);
  });

  it('draws the start point', () => {
    render(<RouteThumbnail testId="thumb" geometry={geometry} index={0} />);

    expect(screen.getByTestId('thumb').querySelector('circle')).toBeInTheDocument();
  });

  it('is hidden from screen readers, since the row names the route', () => {
    render(<RouteThumbnail testId="thumb" geometry={geometry} index={0} />);

    expect(screen.getByTestId('thumb')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is wider when asked to', () => {
    render(<RouteThumbnail testId="thumb" geometry={geometry} index={0} wide />);

    expect(screen.getByTestId('thumb')).toHaveAttribute('viewBox', '0 0 250 100');
  });

  it('takes the colour of an index beyond the palette', () => {
    render(<RouteThumbnail testId="thumb" geometry={geometry} index={5} />);

    const lines = [...screen.getByTestId('thumb').querySelectorAll('polyline')];
    expect(lines.at(-1)).toHaveAttribute('stroke', '#e0115f');
  });
});
