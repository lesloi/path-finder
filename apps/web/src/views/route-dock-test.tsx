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
      display={{ units: 'metric', language }}
      route={route}
      index={1}
      count={3}
      onClose={() => {}}
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
    expect(screen.getByTestId('route-miss')).toHaveTextContent(`${routesText.en.misses.elevationGain}`);
    expect(screen.getByTestId('route-surface')).toHaveTextContent('70%');
    expect(screen.getByTestId('route-profile')).toBeInTheDocument();
  });

  it('closes from its button', () => {
    const onClose = vi.fn();
    dock('en', { onClose });

    fireEvent.click(screen.getByTestId('route-close'));

    expect(onClose).toHaveBeenCalledOnce();
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
    expect(files![0].name).toMatch(/^\d{4}-12km_340m\.gpx$/);
  });

  it.each(['en', 'fr'] as const)('names every control in %s', (language) => {
    const { container } = dock(language);

    expectNamedControls(container);
    expect(screen.getByTestId('route-close')).toHaveAccessibleName(routesText[language].closeRoute);
  });
});
