import { render, screen } from '@testing-library/react';

import { ProfileSparkline } from './profile-sparkline.tsx';

const METRES_PER_DEGREE = 111_195;
const loop = (heights: number[]): [number, number, number][] =>
  heights.map((height, k) => [6.1294, 45.8992 + (k * 400) / METRES_PER_DEGREE, height]);

describe('ProfileSparkline', () => {
  it('draws the elevation in the colour of the route', () => {
    render(<ProfileSparkline testId="spark" geometry={loop([450, 480, 450])} index={2} />);

    const line = screen.getByTestId('spark').querySelector('polyline')!;
    expect(line).toHaveAttribute('stroke', '#7a3fc4');
    expect(line.getAttribute('points')!.split(' ').length).toBeGreaterThan(2);
  });

  it('draws a higher place higher up', () => {
    render(<ProfileSparkline testId="spark" geometry={loop([450, 500])} index={0} />);

    const [[, first], [, last]] = [0, -1].map((k) =>
      screen
        .getByTestId('spark')
        .querySelector('polyline')!
        .getAttribute('points')!
        .split(' ')
        .at(k)!
        .split(',')
        .map(Number),
    );
    expect(last).toBeLessThan(first);
  });

  it('puts a flat route in the middle', () => {
    render(<ProfileSparkline testId="spark" geometry={loop([450, 450, 450])} index={0} />);

    const points = screen.getByTestId('spark').querySelector('polyline')!.getAttribute('points')!;
    expect(new Set(points.split(' ').map((point) => point.split(',')[1]))).toEqual(new Set(['15.0']));
  });

  it('takes the colour of an index beyond the palette', () => {
    render(<ProfileSparkline testId="spark" geometry={loop([450, 480])} index={5} />);

    expect(screen.getByTestId('spark').querySelector('polyline')).toHaveAttribute('stroke', '#e0115f');
  });

  it('is hidden from screen readers, since the row names the route', () => {
    render(<ProfileSparkline testId="spark" geometry={loop([450, 480])} index={0} />);

    expect(screen.getByTestId('spark')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows nothing for a route without heights', () => {
    const { container } = render(
      <ProfileSparkline
        geometry={[
          [6.1, 45.9],
          [6.2, 45.9],
        ]}
        index={0}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
