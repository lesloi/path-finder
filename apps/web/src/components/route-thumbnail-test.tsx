import { render, screen } from '@testing-library/react';

import type { MapSnapshot } from '../core/index.ts';
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

  it('draws a plain background until the map has a snapshot', () => {
    render(<RouteThumbnail testId="thumb" geometry={geometry} index={0} />);

    expect(screen.queryByTestId('thumb-map')).not.toBeInTheDocument();
  });

  it('draws the route over the part of the snapshot it runs through', () => {
    // One pixel per metre, with the origin at the top left of a 1000 px square: Web Mercator metres.
    const snapshot: MapSnapshot = {
      url: 'blob:map',
      width: 1_000,
      height: 1_000,
      toPixel: ([x, y]) => [x / 1_000 + 500, 500 - y / 1_000],
      of: [geometry],
    };
    render(<RouteThumbnail testId="thumb" geometry={geometry} index={0} snapshot={snapshot} />);

    const image = screen.getByTestId('thumb-map');
    expect(image).toHaveAttribute('href', 'blob:map');
    // The snapshot is scaled to fill the 100-unit box with the route, and offset to the part it shows.
    expect(Number(image.getAttribute('width'))).toBeGreaterThan(100);
    expect(Number(image.getAttribute('width')) / Number(image.getAttribute('height'))).toBeCloseTo(1);
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
