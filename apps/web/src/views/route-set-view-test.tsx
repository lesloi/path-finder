import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';

import { expectNamedControls } from '../accessible-names.ts';
import type { Route } from '../core/index.ts';
import { criteriaText, routesText } from '../i18n/index.ts';
import { RouteSetView } from './route-set-view.tsx';

const METRES_PER_DEGREE = 111_195;

function route(overrides: Partial<Route> = {}): Route {
  return {
    geometry: [0, 1, 2, 3].map((k) => [6.1294, 45.8992 + (k * 400) / METRES_PER_DEGREE, 450 + 30 * k]),
    distance: 12.34,
    elevationGain: 340,
    elevationLoss: 352,
    estimatedDuration: 85,
    kind: 'match',
    misses: [],
    unpavedShare: 0.3,
    surfaces: [
      { surface: 'paved', from: 0, to: 7 },
      { surface: 'unpaved', from: 7, to: 10 },
    ],
    technical: false,
    ...overrides,
  };
}

// What the API sends without BD ALTI: no heights, and no elevation gain.
function withoutElevation(): Route {
  const { elevationGain, elevationLoss, ...rest } = route();
  expect([elevationGain, elevationLoss]).not.toContain(undefined);
  return { ...rest, geometry: rest.geometry.map(([lon, lat]) => [lon, lat]) as [number, number][] };
}

const suggestion = route({
  distance: 9,
  elevationGain: 520,
  kind: 'suggestion',
  misses: [{ criterion: 'elevationGain', gap: 120 }],
});
const routes = [route(), suggestion, route({ distance: 10.5, elevationGain: 80 })];
const onDesktop = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query) => ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as never,
    );

// The view as its parent holds it: which route is selected, and whether its detail is open.
function View({
  language = 'en',
  units = 'metric',
  list = routes,
  onSelect = () => {},
  onPreview,
  onHover = () => {},
  onPaceChange,
  pace = 6,
  open = false,
}: {
  language?: 'en' | 'fr';
  units?: 'metric' | 'imperial';
  list?: Route[];
  onSelect?: (index: number) => void;
  onPreview?: (index: number | undefined) => void;
  onHover?: (position: unknown) => void;
  onPaceChange?: (pace: number) => void;
  pace?: number;
  open?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState(open);
  return (
    <RouteSetView
      display={{ units, language }}
      routes={list}
      pace={pace}
      selected={selected}
      detail={detail}
      onSelect={(index) => {
        setSelected(index);
        onSelect(index);
      }}
      onPreview={onPreview}
      onDetailChange={setDetail}
      onPaceChange={onPaceChange}
      onHover={onHover}
    />
  );
}

const en = routesText.en;
const swipe = (from: [number, number], to: [number, number]) => {
  const detail = screen.getByTestId('route-detail');
  fireEvent.pointerDown(detail, { clientX: from[0], clientY: from[1], pointerType: 'touch' });
  fireEvent.pointerUp(detail, { clientX: to[0], clientY: to[1] });
};

afterEach(() => vi.restoreAllMocks());

describe('RouteSetView', () => {
  describe('the list', () => {
    it('counts the routes and shows a row for each', () => {
      render(<View />);

      expect(screen.getByTestId('routes-count')).toHaveTextContent('3 routes');
      expect(within(screen.getByTestId('routes-list')).getAllByRole('button')).toHaveLength(3);
    });

    it('shows the distance, the elevation gain and the estimated duration of a route', () => {
      render(<View />);

      const row = screen.getByTestId('routes-row-0');
      expect(row).toHaveTextContent('12.3 km');
      expect(row).toHaveTextContent('340 m');
      expect(row).toHaveTextContent('1 h 25');
      expect(row).toHaveAccessibleName(
        'Route 1 of 3, 12.3 km, Elevation gain 340 m, Estimated duration 1 h 25, Paved 70% · Unpaved 30%',
      );
    });

    it('leaves out the elevation gain of a route that has none', () => {
      render(<View list={[withoutElevation()]} />);

      expect(screen.queryByTestId('routes-row-0-gain')).not.toBeInTheDocument();
    });

    it('draws the elevation of a route in the width the row leaves, and nothing without elevation', () => {
      render(<View list={[route(), withoutElevation()]} />);

      expect(screen.getByTestId('routes-row-0-profile')).toBeInTheDocument();
      expect(screen.queryByTestId('routes-row-1-profile')).not.toBeInTheDocument();
    });

    it('draws the surface of a route as a bar of its paved and unpaved shares', () => {
      render(<View />);

      const bar = screen.getByTestId('routes-row-0-surface');
      expect(bar).toHaveAccessibleName('Paved 70% · Unpaved 30%');
      expect(screen.getByTestId('routes-row-0-surface-paved')).toHaveStyle({ width: '70%' });
      expect(screen.getByTestId('routes-row-0-surface-unpaved')).toHaveStyle({ width: '30%' });
    });

    it('leaves out the empty segment of a route all on one surface', () => {
      render(<View list={[route({ unpavedShare: 0 })]} />);

      expect(screen.getByTestId('routes-row-0-surface')).toHaveAccessibleName('Paved 100% · Unpaved 0%');
      expect(screen.queryByTestId('routes-row-0-surface-unpaved')).not.toBeInTheDocument();
    });

    it('keeps the shares of the surface bar within 0 and 100%', () => {
      render(<View list={[route({ unpavedShare: 1.2 })]} />);

      expect(screen.getByTestId('routes-row-0-surface')).toHaveAccessibleName('Paved 0% · Unpaved 100%');
    });

    it('marks a missed criterion on the suggestion, with its gap', () => {
      render(<View />);

      const marker = screen.getByTestId('routes-row-1-miss-elevationGain');
      expect(marker).toHaveTextContent(`+30% ${routesText.en.misses.elevationGain}`);
      expect(screen.getByTestId('routes-row-1')).toHaveAccessibleName(
        expect.stringContaining(`+30% ${routesText.en.misses.elevationGain}`),
      );
    });

    it('badges the routes that hold a technical stretch, and only those', () => {
      render(<View list={[route({ technical: true }), route()]} />);

      expect(screen.getByTestId('routes-row-0-technical')).toHaveTextContent(en.technical);
      expect(screen.getByTestId('routes-row-0')).toHaveAccessibleName(expect.stringContaining(en.technical));
      expect(screen.queryByTestId('routes-row-1-technical')).not.toBeInTheDocument();
      expect(screen.getByTestId('routes-row-1')).not.toHaveAccessibleName(expect.stringContaining(en.technical));
    });

    it('marks no criterion on a match', () => {
      render(<View />);

      expect(screen.getByTestId('routes-row-0').querySelector('[data-testid*="-miss-"]')).toBeNull();
    });

    it('marks every criterion a suggestion misses', () => {
      const both = route({
        distance: 11.5,
        kind: 'suggestion',
        misses: [
          { criterion: 'distance', gap: 1.5 },
          { criterion: 'elevationGain', gap: 120 },
        ],
      });
      render(<View list={[both]} />);

      expect(screen.getByTestId('routes-row-0-miss-distance')).toHaveTextContent(
        `+15% ${routesText.en.misses.distance}`,
      );
      expect(screen.getByTestId('routes-row-0-miss-elevationGain')).toBeInTheDocument();
    });

    it('previews the route of a row the pointer or the focus reaches on desktops, without selecting it', () => {
      onDesktop();
      const [onSelect, onPreview] = [vi.fn(), vi.fn()];
      render(<View onSelect={onSelect} onPreview={onPreview} />);

      fireEvent.mouseEnter(screen.getByTestId('routes-row-1'));
      fireEvent.mouseLeave(screen.getByTestId('routes-row-1'));
      fireEvent.focus(screen.getByTestId('routes-row-2'));
      fireEvent.blur(screen.getByTestId('routes-row-2'));

      expect(onPreview.mock.calls).toEqual([[1], [undefined], [2], [undefined]]);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('selects the route of a row that is clicked on desktops, and keeps the list', () => {
      onDesktop();
      const onSelect = vi.fn();
      render(<View onSelect={onSelect} />);

      fireEvent.click(screen.getByTestId('routes-row-1'));

      expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
      expect(screen.getByTestId('routes-row-1')).toHaveAttribute('data-selected');
      expect(screen.getByTestId('routes-row-0')).not.toHaveAttribute('data-selected');
      expect(screen.getByTestId('routes-list')).toBeInTheDocument();
    });

    it('selects the route of a row the focus reaches on phones, where the pointer is a finger', () => {
      const onSelect = vi.fn();
      render(<View onSelect={onSelect} />);

      fireEvent.mouseEnter(screen.getByTestId('routes-row-1'));
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.focus(screen.getByTestId('routes-row-2'));

      expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
    });

    it('says which route is in the middle of the carousel on phones, and not in the list of a desktop', () => {
      const { unmount } = render(<View />);
      expect(screen.getByTestId('routes-position')).toHaveTextContent('1/3');
      expect(screen.getByTestId('routes-position')).toHaveAccessibleName('Route 1 of 3');

      fireEvent.focus(screen.getByTestId('routes-row-2'));
      expect(screen.getByTestId('routes-position')).toHaveTextContent('3/3');

      unmount();
      onDesktop();
      render(<View />);
      expect(screen.queryByTestId('routes-position')).not.toBeInTheDocument();
    });

    it('brings the card of a route to the middle on a tap, and opens its detail on a tap once it is there', () => {
      const onSelect = vi.fn();
      render(<View onSelect={onSelect} />);

      fireEvent.click(screen.getByTestId('routes-row-1'));
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
      expect(screen.queryByTestId('route-detail')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('routes-row-1'));
      expect(screen.getByTestId('route-detail')).toBeInTheDocument();
    });

    it('keeps to the list on desktops whatever the detail, which the dock shows', () => {
      onDesktop();
      render(<View open />);

      expect(screen.getByTestId('routes-list')).toBeInTheDocument();
      expect(screen.queryByTestId('route-detail')).not.toBeInTheDocument();
    });

    it('says the pace the durations are estimated at, and changes it where it shows', () => {
      const onPaceChange = vi.fn();
      render(<View onPaceChange={onPaceChange} />);

      expect(screen.getByTestId('routes-pace')).toHaveTextContent(en.estimatedPace('6:00 min/km'));
      fireEvent.click(screen.getByTestId('routes-pace-edit'));
      const slider = screen.getByTestId('routes-pace-input');
      expect(slider).toHaveValue('360');
      fireEvent.change(slider, { target: { value: '330' } });
      expect(onPaceChange).toHaveBeenCalledExactlyOnceWith(5.5);

      expect(screen.getByTestId('routes-pace-edit')).toHaveAttribute('aria-pressed', 'true');
    });

    it('goes back to the pace line with the same pencil', () => {
      render(<View onPaceChange={vi.fn()} />);
      fireEvent.click(screen.getByTestId('routes-pace-edit'));
      expect(screen.getByTestId('routes-pace-input')).toHaveFocus();

      fireEvent.click(screen.getByTestId('routes-pace-edit'));

      expect(screen.queryByTestId('routes-pace-input')).not.toBeInTheDocument();
      expect(screen.getByTestId('routes-pace')).toHaveTextContent(en.estimatedPace('6:00 min/km'));
      expect(screen.getByTestId('routes-pace-edit')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId('routes-pace-edit')).toHaveFocus();
    });

    it('only says the pace when it cannot be changed here', () => {
      render(<View onPaceChange={undefined} />);

      expect(screen.getByTestId('routes-pace')).toHaveTextContent(en.estimatedPace('6:00 min/km'));
      expect(screen.queryByTestId('routes-pace-edit')).not.toBeInTheDocument();
    });

    it('says the pace in min/mi with imperial units, in French', () => {
      render(<View units="imperial" language="fr" />);

      expect(screen.getByTestId('routes-pace')).toHaveTextContent(routesText.fr.estimatedPace('9:39 min/mi'));
    });

    it('shows the figures in the units and the language of the settings', () => {
      render(<View units="imperial" language="fr" />);

      expect(screen.getByTestId('routes-count')).toHaveTextContent('3 parcours');
      expect(screen.getByTestId('routes-row-0')).toHaveTextContent('7,7 mi');
      expect(screen.getByTestId('routes-row-0')).toHaveTextContent('1115 ft');
    });
  });

  describe('the detail', () => {
    const open = (index = 0) => {
      render(<View open />);
      for (let k = 0; k < index; k++) swipe([200, 100], [100, 100]);
    };

    it('opens from the card in the middle, for that route', () => {
      render(<View />);

      fireEvent.click(screen.getByTestId('routes-row-1'));
      fireEvent.click(screen.getByTestId('routes-row-1'));

      expect(screen.getByTestId('route-position')).toHaveTextContent('2/3');
      expect(screen.getByTestId('route-distance')).toHaveTextContent('9.0 km');
    });

    it('goes back to the list', () => {
      render(<View open />);

      fireEvent.click(screen.getByTestId('route-back'));

      expect(screen.getByTestId('routes-list')).toBeInTheDocument();
    });

    it('shows the distance, the climb, the descent and the duration', () => {
      open();

      expect(screen.getByTestId('route-distance')).toHaveTextContent('12.3 km');
      expect(screen.getByTestId('route-climb')).toHaveTextContent('340 m');
      expect(screen.getByTestId('route-descent')).toHaveTextContent('352 m');
      expect(screen.getByTestId('route-duration')).toHaveTextContent('1 h 25');
    });

    it('shows no climb or descent for a route without elevation gain', () => {
      render(<View list={[withoutElevation()]} open />);

      expect(screen.queryByTestId('route-climb')).not.toBeInTheDocument();
      expect(screen.queryByTestId('route-descent')).not.toBeInTheDocument();
      expect(screen.queryByTestId('route-profile')).not.toBeInTheDocument();
    });

    it('marks the missed criterion of a suggestion', () => {
      render(<View open />);
      swipe([200, 100], [100, 100]);

      expect(screen.getByTestId('route-miss-elevationGain')).toHaveTextContent(
        `+30% ${routesText.en.misses.elevationGain}`,
      );
    });

    it('puts the distance and the estimated duration side by side, then the climb and the descent', () => {
      open();

      const figures = within(screen.getByTestId('route-figures'));
      expect(figures.getAllByRole('definition').map((value) => value.dataset.testid)).toEqual([
        'route-distance',
        'route-duration',
        'route-climb',
        'route-descent',
      ]);
      expect(screen.getByTestId('route-figures')).toHaveTextContent(en.estimatedDuration);
    });

    it('shows the elevation profile, and the surface breakdown that colours it', () => {
      open();

      expect(screen.getByTestId('route-profile')).toBeInTheDocument();
      expect(screen.getByTestId('route-surface')).toHaveTextContent(
        `${criteriaText.en.paved} 70% · ${criteriaText.en.unpaved} 30%`,
      );
    });

    it('hands the place hovered on the profile to the map', () => {
      const onHover = vi.fn();
      render(<View open onHover={onHover} />);
      const plot = screen.getByTestId('route-profile-plot');
      plot.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

      fireEvent.pointerMove(plot, { clientX: 50 });

      expect(onHover).toHaveBeenCalledWith([expect.closeTo(6.1294), expect.any(Number)]);
    });

    describe('moving between routes', () => {
      it('goes to the next route on a swipe to the left', () => {
        open();

        swipe([200, 100], [100, 100]);

        expect(screen.getByTestId('route-position')).toHaveTextContent('2/3');
      });

      it('goes back to the previous route on a swipe to the right', () => {
        open(2);

        swipe([100, 100], [200, 100]);

        expect(screen.getByTestId('route-position')).toHaveTextContent('2/3');
      });

      it('stays on the first route on a swipe to the right', () => {
        open();

        swipe([100, 100], [200, 100]);

        expect(screen.getByTestId('route-position')).toHaveTextContent('1/3');
      });

      it('stays on the last route on a swipe to the left', () => {
        open(2);

        swipe([200, 100], [100, 100]);

        expect(screen.getByTestId('route-position')).toHaveTextContent('3/3');
      });

      it.each([
        ['a short move', [200, 100], [170, 100]],
        ['a mostly vertical move, which scrolls the panel', [200, 100], [120, 300]],
      ] as const)('ignores %s', (_, from, to) => {
        open();

        swipe([...from], [...to]);

        expect(screen.getByTestId('route-position')).toHaveTextContent('1/3');
      });

      it('ignores a drag of the mouse', () => {
        open();
        const detail = screen.getByTestId('route-detail');

        fireEvent.pointerDown(detail, { clientX: 200, clientY: 100, pointerType: 'mouse' });
        fireEvent.pointerUp(detail, { clientX: 100, clientY: 100, pointerType: 'mouse' });

        expect(screen.getByTestId('route-position')).toHaveTextContent('1/3');
      });

      it('ignores a swipe that was cancelled', () => {
        open();
        const detail = screen.getByTestId('route-detail');

        fireEvent.pointerDown(detail, { clientX: 200, clientY: 100, pointerType: 'touch' });
        fireEvent.pointerCancel(detail);
        fireEvent.pointerUp(detail, { clientX: 100, clientY: 100 });

        expect(screen.getByTestId('route-position')).toHaveTextContent('1/3');
      });

      it('shows no arrow buttons on phones, where a swipe moves between routes', () => {
        open();

        expect(screen.queryByTestId('route-next')).not.toBeInTheDocument();
      });

      it('tells the selected route to the map', () => {
        const onSelect = vi.fn();
        render(<View open onSelect={onSelect} />);

        swipe([200, 100], [100, 100]);

        expect(onSelect).toHaveBeenCalledWith(1);
      });
    });

    describe('the GPX export', () => {
      it('shares the route as a GPX file named after it', async () => {
        const share = vi.fn(() => Promise.resolve());
        vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });
        render(<View open />);

        fireEvent.click(screen.getByTestId('route-export'));

        const [{ files }] = share.mock.calls[0] as unknown as [ShareData];
        expect(files![0].name).toMatch(/^\d{4}-12km_340m\.gpx$/);
        const gpx = await files![0].text();
        expect(gpx).toContain('<trkpt');
        expect(gpx).toContain('OpenStreetMap');
      });
    });
  });

  describe('accessibility', () => {
    it.each(['en', 'fr'] as const)('names every control of the list and the detail in %s', (language) => {
      const { container } = render(<View language={language} />);
      expectNamedControls(container);

      fireEvent.click(screen.getByTestId('routes-row-1'));

      expectNamedControls(container);
    });

    it.each(['en', 'fr'] as const)('names every control on desktops in %s', (language) => {
      onDesktop();
      const { container } = render(<View language={language} />);
      expectNamedControls(container);

      fireEvent.click(screen.getByTestId('routes-row-1'));

      expectNamedControls(container);
    });
  });
});
