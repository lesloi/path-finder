import { fireEvent, render, screen } from '@testing-library/react';

import { expectNamedControls } from '../accessible-names.ts';
import type { Route } from '../core/index.ts';
import { routesText } from '../i18n/index.ts';
import { RouteDock } from './route-dock.tsx';

const METRES_PER_DEGREE = 111_195;

const route: Route = {
  geometry: [0, 1, 2, 3].map((k) => [6.1294, 45.8992 + (k * 400) / METRES_PER_DEGREE, 450 + 30 * k]),
  distance: 12.34,
  elevationGain: 340,
  elevationLoss: 352,
  estimatedDuration: 85,
  kind: 'suggestion',
  misses: [{ criterion: 'elevationGain', gap: 120 }],
  unpavedShare: 0.3,
  surfaces: [
    { surface: 'paved', from: 0, to: 7 },
    { surface: 'unpaved', from: 7, to: 10 },
  ],
  technical: false,
};

function dock(language: 'en' | 'fr' = 'en', props: Partial<Parameters<typeof RouteDock>[0]> = {}) {
  return render(
    <RouteDock
      language={language}
      paceUnit="min/km"
      pace={5.5}
      route={route}
      index={1}
      count={3}
      onClose={() => {}}
      onReverse={() => {}}
      onHover={() => {}}
      {...props}
    />,
  );
}

describe('RouteDock', () => {
  it('names the route, with its figures and the criteria it misses', () => {
    dock();

    expect(screen.getByTestId('route-dock')).toHaveAccessibleName(routesText.en.route(2, 3));
    expect(screen.getByTestId('route-distance')).toHaveTextContent('12.3 km');
    expect(screen.getByTestId('route-climb')).toHaveTextContent('340 m');
    expect(screen.getByTestId('route-miss-elevationGain')).toHaveTextContent(`${routesText.en.misses.elevationGain}`);
    expect(screen.getByTestId('route-surface')).toHaveTextContent('70%');
    expect(screen.getByTestId('route-profile')).toBeInTheDocument();
  });

  it('mentions the technical stretches of the route, and only those', () => {
    const { unmount } = dock('en', { route: { ...route, technical: true } });
    expect(screen.getByTestId('route-technical')).toHaveTextContent(routesText.en.technical);
    unmount();

    dock('en', { route: { ...route, misses: [] } });
    expect(screen.queryByTestId('route-technical')).not.toBeInTheDocument();
  });

  it('lays the stops of the route under its profile', () => {
    dock();

    const steps = screen.getAllByTestId('route-step');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('route-profile')).toContainElement(steps[0]!);
  });

  it('still lays the stops out for a route without heights, which has no profile to join them to', () => {
    dock('en', { route: { ...route, geometry: route.geometry.map(([lon, lat]) => [lon, lat]) } });

    expect(screen.queryByTestId('route-profile')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('route-step').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('route-step-links')).not.toBeInTheDocument();
  });

  it('closes from its button', () => {
    const onClose = vi.fn();
    dock('en', { onClose });

    fireEvent.click(screen.getByTestId('route-close'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('runs the route the other way from its button', () => {
    const onReverse = vi.fn();
    dock('en', { onReverse });

    fireEvent.click(screen.getByTestId('route-reverse'));

    expect(onReverse).toHaveBeenCalledOnce();
  });

  it('hands the place hovered on the profile on', () => {
    const onHover = vi.fn();
    dock('en', { onHover });
    const plot = screen.getByTestId('route-profile-plot');
    plot.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

    fireEvent.pointerMove(plot, { clientX: 50 });

    expect(onHover).toHaveBeenCalledWith([expect.closeTo(6.1294), expect.any(Number)]);
  });

  it('shares the route as a GPX file', async () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    dock();

    fireEvent.click(screen.getByTestId('route-export'));

    const [{ files }] = share.mock.calls[0] as unknown as [ShareData];
    expect(files![0].name).toMatch(/^Running-12km_340m-\d{14}\.gpx$/);
  });

  it('numbers the waypoints on the profile, and exports them in the GPX file', async () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
    dock('en', { waypoints: [[route.geometry[2][0], route.geometry[2][1]]] });

    expect(screen.getByTestId('route-profile-waypoint-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('route-export'));

    const [{ files }] = share.mock.calls[0] as unknown as [ShareData];
    expect(await files![0].text()).toContain('<name>Waypoint 1</name>');
  });

  it.each(['en', 'fr'] as const)('names every control in %s', (language) => {
    const { container } = dock(language);

    expectNamedControls(container);
    expect(screen.getByTestId('route-close')).toHaveAccessibleName(routesText[language].closeRoute);
  });
});
