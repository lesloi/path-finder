import { fireEvent, render, screen } from '@testing-library/react';

import type { Route } from '../core/index.ts';
import { ElevationProfile } from './elevation-profile.tsx';

// 1.1 km north, 450 m then up to 500 m (flat first, then steep).
const METRES_PER_DEGREE = 111_195;
const heights = [450, 450, 450, 500];
const route: Route = {
  geometry: heights.map((height, k) => [6.1294, 45.8992 + (k * 400) / METRES_PER_DEGREE, height]),
  distance: 1.2,
  elevationGain: 50,
  estimatedDuration: 15,
  kind: 'match',
  misses: [],
  unpavedShare: 0,
  surfaces: [{ surface: 'paved', share: 1 }],
};

function plot(onHover = vi.fn(), props: Partial<Route> = {}, language: 'en' | 'fr' = 'en') {
  render(
    <ElevationProfile
      testId="profile"
      route={{ ...route, ...props }}
      units="metric"
      language={language}
      onHover={onHover}
    />,
  );
  const element = screen.getByTestId('profile-plot');
  // jsdom has no layout: the plot is 200 px wide, from the left of the screen.
  element.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;
  return { element, onHover };
}

describe('ElevationProfile', () => {
  it('gives the lowest and the highest altitudes', () => {
    plot();

    expect(screen.getByTestId('profile-min')).toHaveTextContent('450 m');
    expect(screen.getByTestId('profile-max')).toHaveTextContent('500 m');
    expect(screen.getByTestId('profile')).toHaveAccessibleName('Elevation profile, from 450 m to 500 m');
  });

  it('shows the altitudes in the units and the language of the settings', () => {
    render(<ElevationProfile testId="profile" route={route} units="imperial" language="fr" onHover={vi.fn()} />);

    expect(screen.getByTestId('profile-max')).toHaveTextContent('1640 ft');
    expect(screen.getByTestId('profile')).toHaveAccessibleName('Profil altimétrique, de 1476 ft à 1640 ft');
  });

  it('colours each stretch by its uphill grade', () => {
    const { container } = render(<ElevationProfile route={route} units="metric" language="en" onHover={vi.fn()} />);

    const slopes = [...container.querySelectorAll('g')].map((group) => group.dataset.slope);
    // 50 m climbed over the last 400 m is 12.5 %: the steepest class, after flat stretches.
    expect(slopes.at(0)).toBe('1');
    expect(slopes.at(-1)).toBe('4');
  });

  it('shows the distance and the altitude where the pointer is, and the place on the map', () => {
    const { element, onHover } = plot();

    fireEvent.pointerMove(element, { clientX: 200 });

    expect(screen.getByTestId('profile-tip')).toHaveTextContent('1.2 km · 500 m');
    const [lon, lat] = onHover.mock.calls.at(-1)![0];
    expect(lon).toBeCloseTo(6.1294);
    expect(lat).toBeCloseTo(45.8992 + 1_200 / METRES_PER_DEGREE, 4);
  });

  it('keeps the pointer within the profile', () => {
    const { element } = plot();

    fireEvent.pointerMove(element, { clientX: -50 });

    expect(screen.getByTestId('profile-tip')).toHaveTextContent('0.0 km · 450 m');
  });

  it('starts on a press, so a touch drags along the profile', () => {
    const { element } = plot();

    fireEvent.pointerDown(element, { clientX: 100 });

    expect(screen.getByTestId('profile-tip')).toBeInTheDocument();
  });

  it('does not let a drag along the profile swipe to another route', () => {
    const swipe = vi.fn();
    render(
      <div onPointerDown={swipe}>
        <ElevationProfile testId="profile" route={route} units="metric" language="en" onHover={vi.fn()} />
      </div>,
    );

    fireEvent.pointerDown(screen.getByTestId('profile-plot'), { clientX: 100 });

    expect(swipe).not.toHaveBeenCalled();
  });

  it.each(['pointerUp', 'pointerLeave', 'pointerCancel'] as const)('forgets the place on %s', (event) => {
    const { element, onHover } = plot();
    fireEvent.pointerMove(element, { clientX: 100 });

    fireEvent[event](element);

    expect(screen.queryByTestId('profile-tip')).not.toBeInTheDocument();
    expect(onHover).toHaveBeenLastCalledWith(undefined);
  });

  it('shows nothing for a route without heights', () => {
    const geometry = route.geometry.map(([lon, lat]) => [lon, lat]) as [number, number][];

    const { container } = render(
      <ElevationProfile route={{ ...route, geometry }} units="metric" language="en" onHover={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
