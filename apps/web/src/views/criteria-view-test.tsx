import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

import { CriteriaView } from './criteria-view.tsx';
import { expectNamedControls } from '../accessible-names.ts';
import { criteriaText, errorText, routesText } from '../i18n/index.ts';
import { maps, markers } from '../maplibre-mock.ts';
import { useSettings } from '../state/index.ts';

vi.mock('maplibre-gl', () => import('../maplibre-mock.ts'));

const en = criteriaText.en;
const fr = criteriaText.fr;

const map = () => maps.at(-1)!;
const field = () => screen.getByTestId('criteria-start');
const onDesktop = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query) => ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as never,
    );

beforeEach(() => {
  // The tests read metric figures, whatever the language.
  localStorage.setItem('path-finder.settings', JSON.stringify({ units: 'metric' }));
  maps.length = 0;
  markers.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CriteriaView', () => {
  it('links to the settings', () => {
    render(<CriteriaView language="en" />);

    expect(screen.getByTestId('criteria-settings')).toHaveAttribute('href', '#/settings');
  });

  describe('the north button', () => {
    it('shows once the map is turned, and turns it back', () => {
      render(<CriteriaView language="en" />);
      expect(screen.queryByTestId('criteria-north')).not.toBeInTheDocument();

      act(() => map().rotateTo(30));
      const button = screen.getByTestId('criteria-north');
      expect(button).toHaveAccessibleName(en.resetNorth);
      // The arrow turns against the map.
      expect(button.querySelector('svg')).toHaveStyle({ transform: 'rotate(-30deg)' });
      fireEvent.click(button);

      expect(map().bearing).toBe(0);
      expect(screen.queryByTestId('criteria-north')).not.toBeInTheDocument();
      expect(screen.getByTestId('criteria-settings')).toHaveFocus();
    });

    it('is named in French', () => {
      render(<CriteriaView language="fr" />);

      act(() => map().rotateTo(30));

      expect(screen.getByTestId('criteria-north')).toHaveAccessibleName(fr.resetNorth);
    });
  });

  describe('the map background', () => {
    const saved = () => renderHook(() => useSettings()).result.current[0].basemap;

    it('is picked from a button over the map, and saved', () => {
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getByTestId('criteria-basemap'));
      fireEvent.click(screen.getByTestId('criteria-basemap-aerial'));

      expect(saved()).toBe('aerial');
      expect(screen.queryByTestId('criteria-basemap-menu')).not.toBeInTheDocument();
    });
  });

  it('goes back to the saved basemap that failed to load', () => {
    render(<CriteriaView language="en" />);
    act(() => maps.at(-1)!.fire('style.load'));
    fireEvent.click(screen.getByTestId('criteria-basemap'));
    fireEvent.click(screen.getByTestId('criteria-basemap-minimal'));

    act(() => maps.at(-1)!.fire('error'));

    expect(renderHook(() => useSettings()).result.current[0].basemap).toBe('plan');
  });

  describe('accessibility', () => {
    it.each(['en', 'fr'] as const)('names every control on phones in %s, sheet collapsed then expanded', (language) => {
      const { container } = render(<CriteriaView language={language} />);
      expectNamedControls(container);

      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));

      expectNamedControls(container);
    });

    it.each(['en', 'fr'] as const)('names every control on desktops in %s', (language) => {
      onDesktop();
      const { container } = render(<CriteriaView language={language} />);

      expectNamedControls(container);
    });
  });

  describe('on phones', () => {
    it('hides the floating My location button while the sheet is expanded', () => {
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));

      // The floating one would cover the settings button.
      expect(screen.queryByTestId('criteria-locate')).not.toBeInTheDocument();
    });

    it('invites a long press in the sheet until the start point is set', () => {
      vi.useFakeTimers();
      render(<CriteriaView language="en" />);
      expect(screen.getByTestId('criteria-sheet-handle')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTestId('criteria-long-press')).toBeInTheDocument();
      expect(screen.getByTestId('criteria-locate')).toBeInTheDocument();
      expect(screen.queryByTestId('criteria-start-locate')).not.toBeInTheDocument();

      act(() => {
        map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: { touches: [{}] } });
        vi.advanceTimersByTime(600);
      });
      vi.useRealTimers();

      expect(screen.queryByTestId('criteria-long-press')).not.toBeInTheDocument();
      expect(markers.at(-1)).toMatchObject({ position: [6.2, 45.8], shown: true });
    });

    it('sets the start point from coordinates typed in the sheet', () => {
      render(<CriteriaView language="en" />);

      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(markers.at(-1)).toMatchObject({ position: [6.2, 45.8], shown: true });
    });
  });

  describe('criteria', () => {
    it('shows chips in the collapsed sheet, and the full form once it is expanded', () => {
      render(<CriteriaView language="en" />);
      expect(screen.getByTestId('criteria-chip-surface')).toHaveAccessibleName(`${en.surface}: ${en.anySurface}`);
      expect(screen.queryByTestId('criteria-distance')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));

      expect(screen.getByTestId('criteria-sheet-handle')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('criteria-distance')).toHaveAccessibleName(en.distance);
    });

    it('shows the full form in the desktop column and passes the criteria on', () => {
      onDesktop();
      const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise(() => {}));
      vi.stubGlobal('fetch', fetchMock);
      render(<CriteriaView language="en" />);
      expect(screen.queryByTestId('criteria-submit')).not.toBeInTheDocument();

      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('criteria-submit'));

      const [, { body }] = fetchMock.mock.calls.find(([url]) => url === '/api/v1/route-sets')! as unknown as [
        string,
        RequestInit,
      ];
      expect(JSON.parse(body as string)).toMatchObject({ start: [6.2, 45.8], pace: 6 });
    });
  });

  it('keeps the criteria when the screen changes from a phone to a desktop', () => {
    const { rerender } = render(<CriteriaView language="en" />);
    fireEvent.click(screen.getByTestId('criteria-sheet-handle'));
    fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));

    onDesktop();
    rerender(<CriteriaView language="en" />);

    expect(screen.getByTestId('criteria-surface-unpaved')).toBeChecked();
  });

  describe('on desktops', () => {
    it('stops picking the start point when the settings open', () => {
      onDesktop();
      render(<CriteriaView language="en" />);
      const crosshair = screen.getByTestId('criteria-start-pick');
      fireEvent.click(crosshair);

      fireEvent.click(screen.getByTestId('criteria-settings'));

      expect(crosshair).toHaveAttribute('aria-pressed', 'false');
    });

    it('picks the start point with a click on the map once the crosshair is pressed', () => {
      onDesktop();
      render(<CriteriaView language="en" />);
      const crosshair = screen.getByTestId('criteria-start-pick');

      act(() => map().fire('click', { lngLat: { lng: 6.2, lat: 45.8 } }));
      expect(markers).toEqual([]);

      fireEvent.click(crosshair);
      expect(crosshair).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('criteria-pick-note')).toBeInTheDocument();

      act(() => map().fire('click', { lngLat: { lng: 6.2, lat: -45.8 } }));

      expect(crosshair).toHaveAttribute('aria-pressed', 'false');
      expect(field()).toHaveValue('45.8000° S · 6.2000° E');
      expect(markers.at(-1)).toMatchObject({ position: [6.2, -45.8], shown: true });
    });

    it('shows the start point coordinates in French', () => {
      onDesktop();
      render(<CriteriaView language="fr" />);

      fireEvent.click(screen.getByTestId('criteria-start-pick'));
      act(() => map().fire('click', { lngLat: { lng: -1.5, lat: 47.2 } }));

      expect(screen.getByTestId('criteria-start')).toHaveValue('47,2000° N · 1,5000° O');
    });

    it('sets the start point on a long press too', () => {
      vi.useFakeTimers();
      onDesktop();
      render(<CriteriaView language="en" />);

      act(() => {
        map().fire('mousedown', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: { button: 0 } });
        vi.advanceTimersByTime(600);
      });
      vi.useRealTimers();

      expect(field()).toHaveValue('45.8000° N · 6.2000° E');
      expect(markers.at(-1)).toMatchObject({ position: [6.2, 45.8], shown: true });
    });

    it('sets the start point from typed coordinates and moves the map there', () => {
      onDesktop();
      render(<CriteriaView language="en" />);

      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(markers.at(-1)).toMatchObject({ position: [6.2, 45.8], shown: true });
      expect(map().easedTo).toMatchObject({ center: [6.2, 45.8] });
      expect(field()).toHaveValue('45.8000° N · 6.2000° E');
    });

    it('says in a toast when typed coordinates cannot be read, and keeps the start point', () => {
      onDesktop();
      render(<CriteriaView language="en" />);

      fireEvent.change(field(), { target: { value: 'Paris' } });
      fireEvent.blur(field());

      expect(field()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByTestId('criteria-toast')).toHaveTextContent(`${en.unreadable}${en.coordinatesHint}`);
      expect(markers).toEqual([]);
    });

    it('says once that coordinates cannot be read, when Enter comes before a blur', () => {
      vi.useFakeTimers();
      onDesktop();
      render(<CriteriaView language="en" />);
      fireEvent.change(field(), { target: { value: 'Paris' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      act(() => vi.advanceTimersByTime(5_000));

      fireEvent.blur(field());
      act(() => vi.advanceTimersByTime(1_000));
      vi.useRealTimers();

      expect(screen.queryByTestId('criteria-toast')).not.toBeInTheDocument();
      expect(field()).toHaveAttribute('aria-invalid', 'true');
    });

    it('drops what is typed on Escape', () => {
      onDesktop();
      render(<CriteriaView language="en" />);

      fireEvent.change(field(), { target: { value: 'Paris' } });
      fireEvent.keyDown(field(), { key: 'Escape' });

      expect(field()).toHaveValue('');
    });

    it('shows the logo and no sheet', () => {
      onDesktop();
      render(<CriteriaView language="en" />);

      expect(screen.getByTestId('criteria-title')).toHaveTextContent('Path finder');
      expect(screen.queryByTestId('criteria-sheet')).not.toBeInTheDocument();
    });
  });

  describe('my location', () => {
    const getCurrentPosition = vi.fn();
    const refuse = () =>
      getCurrentPosition.mockImplementation((_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
      );

    beforeEach(() => {
      getCurrentPosition.mockReset();
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    });

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'geolocation');
      vi.useRealTimers();
    });

    it('is not asked for on load', () => {
      render(<CriteriaView language="en" />);

      expect(getCurrentPosition).not.toHaveBeenCalled();
    });

    it('sets the start point to the device location and moves the map there', () => {
      getCurrentPosition.mockImplementation((success: PositionCallback) =>
        success({ coords: { longitude: 5.7, latitude: 45.2 } } as GeolocationPosition),
      );
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getByTestId('criteria-locate'));

      expect(markers.at(-1)).toMatchObject({ position: [5.7, 45.2], shown: true });
      expect(map().easedTo).toEqual({ center: [5.7, 45.2], zoom: 14 });
    });

    it('shows a toast inviting a long press when the location is refused', () => {
      refuse();
      render(<CriteriaView language="fr" />);

      fireEvent.click(screen.getByTestId('criteria-locate'));

      expect(screen.getByTestId('criteria-toast')).toHaveTextContent(`${fr.unavailable}${fr.pickHint}`);
      expect(markers).toEqual([]);
    });

    it('shows a toast inviting a pick on the map on desktops', () => {
      onDesktop();
      refuse();
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getByTestId('criteria-locate'));

      expect(screen.getByTestId('criteria-toast')).toHaveTextContent(`${en.unavailable}${en.pickHintDesktop}`);
    });

    it('shows a toast when the browser has no geolocation', () => {
      Reflect.deleteProperty(navigator, 'geolocation');
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getByTestId('criteria-locate'));

      expect(screen.getByTestId('criteria-toast')).toHaveTextContent(`${en.unavailable}${en.pickHint}`);
    });

    it('drops the toast once the start point is set', () => {
      vi.useFakeTimers();
      refuse();
      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getByTestId('criteria-locate'));

      act(() => {
        map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: { touches: [{}] } });
        vi.advanceTimersByTime(600);
      });

      expect(screen.queryByTestId('criteria-toast')).not.toBeInTheDocument();
    });

    it('drops the toast on a click', () => {
      refuse();
      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getByTestId('criteria-locate'));

      fireEvent.click(screen.getByTestId('criteria-toast'));

      expect(screen.queryByTestId('criteria-toast')).not.toBeInTheDocument();
    });

    it('puts the toast on two lines: what went wrong, then what to do', () => {
      refuse();
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getByTestId('criteria-locate'));

      expect(screen.getByTestId('criteria-toast').querySelectorAll('br')).toHaveLength(1);
    });

    it('drops the toast after a few seconds', () => {
      vi.useFakeTimers();
      refuse();
      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getByTestId('criteria-locate'));

      act(() => vi.advanceTimersByTime(6_000));

      expect(screen.queryByTestId('criteria-toast')).not.toBeInTheDocument();
    });
  });

  describe('asking for routes', () => {
    const METRES_PER_DEGREE = 111_195;
    const route = (offset: number, overrides = {}) => ({
      geometry: [0, 1, 2, 3].map((k) => [6.2 + offset, 45.8 + (k * 400) / METRES_PER_DEGREE, 450 + 30 * k]),
      distance: 10 + offset,
      elevationGain: 300,
      estimatedDuration: 70,
      kind: 'match',
      misses: [],
      unpavedShare: 0.3,
      surfaces: [{ surface: 'paved', from: 0, to: 10 }],
      technical: false,
      ...overrides,
    });
    const answer = (...routes: object[]) => Response.json({ routes });

    function ask(response: Promise<Response> | Response) {
      const routeSets = vi.fn(() => Promise.resolve(response));
      vi.stubGlobal('fetch', () => routeSets());
      return routeSets;
    }
    async function submit() {
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('criteria-submit'));
    }
    // The map settles on the routes it frames: it then draws them and takes its snapshot. The effects that listen
    // for it run first: a route set that has just been found may not have committed them yet, on a busy machine.
    const settle = async () => {
      await act(async () => {});
      act(() => map().fire('idle'));
    };
    const routesSource = () => (map().sources.routes as unknown as { data: { features: unknown[] } }).data.features;

    it('shows a loading state while the API works, beside the criteria, with a way to cancel', async () => {
      onDesktop();
      ask(new Promise(() => {}));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));

      await submit();

      expect(screen.getByTestId('routes-loading')).toHaveTextContent(routesText.en.finding);
      // The criteria stay, to change while the search goes on.
      expect(screen.getByTestId('criteria-submit')).toBeInTheDocument();
      expect(screen.getByTestId('routes-cancel')).toHaveAccessibleName(routesText.en.cancelSearch);
      expect(document.documentElement.style.getPropertyValue('--list-inset')).not.toBe('');

      fireEvent.click(screen.getByTestId('routes-cancel'));

      expect(screen.queryByTestId('routes-loading')).not.toBeInTheDocument();
      expect(screen.queryByTestId('routes-cancel')).not.toBeInTheDocument();
      expect(document.documentElement.style.getPropertyValue('--list-inset')).toBe('');
    });

    it('shows the route set in the column, and draws its routes on the map', async () => {
      onDesktop();
      ask(answer(route(0), route(1, { kind: 'suggestion', misses: [{ criterion: 'distance', gap: 1 }] })));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));

      await submit();

      expect(await screen.findByTestId('routes-count')).toHaveTextContent('2 routes');
      await settle();
      expect(routesSource()).toHaveLength(2);
      expect(map().fitted).toBeDefined();
    });

    it('estimates the durations at the pace of the settings, and recomputes them on the spot by distance', async () => {
      onDesktop();
      const routeSets = ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');
      // 10 km and 300 m of climb are 13 km of effort: 78 minutes at 6 min/km, not the 70 the server said.
      expect(screen.getByTestId('routes-row-0')).toHaveTextContent('1 h 18');

      fireEvent.click(screen.getByTestId('routes-pace-edit'));
      fireEvent.change(screen.getByTestId('routes-pace-input'), { target: { value: '300' } });

      // As the slider moves, without asking again.
      expect(screen.getByTestId('routes-row-0')).toHaveTextContent('1 h 05');
      expect(screen.getByTestId('routes-pace-input-value')).toHaveTextContent('5:00 min/km');
      fireEvent.click(screen.getByTestId('routes-pace-edit'));
      expect(screen.getByTestId('routes-pace')).toHaveTextContent(routesText.en.estimatedPace('5:00 min/km'));
      expect(routeSets).toHaveBeenCalledTimes(1);
    });

    it('says the pace of the routes by duration, without a way to change it there', async () => {
      onDesktop();
      const routeSets = ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      fireEvent.click(screen.getByTestId('criteria-target-duration'));
      await submit();
      await screen.findByTestId('routes-count');

      // The routes keep the durations of the pace they were asked for: it is set in the criteria.
      expect(screen.getByTestId('routes-row-0')).toHaveTextContent('1 h 10');
      expect(screen.getByTestId('routes-pace')).toHaveTextContent(routesText.en.estimatedPace('6:00 min/km'));
      expect(screen.queryByTestId('routes-pace-edit')).not.toBeInTheDocument();
      expect(routeSets).toHaveBeenCalledTimes(1);
    });

    it('shows no dock and no selection until a route is picked', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();

      await screen.findByTestId('routes-count');

      expect(screen.queryByTestId('route-dock')).not.toBeInTheDocument();
      expect(document.querySelector('[data-selected]')).toBeNull();
      expect(document.documentElement.style.getPropertyValue('--dock-inset')).toBe('');
      expect(document.documentElement.style.getPropertyValue('--list-inset')).toBe('var(--list-reserved)');
    });

    it('opens the dock of the row clicked, and the map does not move', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');
      await settle();
      const fits = map().fits;
      fireEvent.click(screen.getByTestId('routes-row-1'));

      expect(screen.getByTestId('route-dock')).toBeInTheDocument();
      expect(screen.getByTestId('route-position')).toHaveTextContent(routesText.en.route(2, 2));
      expect(screen.getByTestId('route-distance')).toHaveTextContent('11.0 km');
      expect(screen.getByTestId('route-profile')).toBeInTheDocument();
      expect(screen.getByTestId('routes-row-1')).toHaveAttribute('data-selected');
      expect(document.documentElement.style.getPropertyValue('--dock-inset')).toBe('var(--dock-reserved)');
      // The criteria and the list stay beside it.
      expect(screen.getByTestId('criteria-submit')).toBeInTheDocument();
      expect(screen.getByTestId('routes-list')).toBeInTheDocument();
      expect(map().fits).toBe(fits);

      fireEvent.click(screen.getByTestId('route-close'));

      expect(screen.queryByTestId('route-dock')).not.toBeInTheDocument();
      expect(document.documentElement.style.getPropertyValue('--dock-inset')).toBe('');
      expect(map().fits).toBe(fits);
    });

    it('draws every route, the selected one marked with its distances', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      // Every tag is in view.
      map().project = () => ({ x: 400, y: 300 });
      await submit();
      await screen.findByTestId('routes-count');
      await settle();
      const markersSource = () => (map().sources['route-markers'] as unknown as { data: { features: unknown[] } }).data;
      const badges = () => (map().sources['route-badges'] as unknown as { data: { features: unknown[] } }).data;
      expect(markersSource().features).toHaveLength(0);
      expect(badges().features).toHaveLength(2);

      fireEvent.click(screen.getByTestId('routes-row-1'));

      expect(routesSource()).toHaveLength(2);
      expect(markersSource().features.length).toBeGreaterThan(0);
      // The markers say it better for the route that has them.
      expect(badges().features).toHaveLength(1);
    });

    it('only previews the route of a row the pointer is on, on the map', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');
      await settle();
      const thick = () =>
        (routesSource() as { properties: { index: number; selected: boolean } }[])
          .filter(({ properties }) => properties.selected)
          .map(({ properties }) => properties.index);

      fireEvent.mouseEnter(screen.getByTestId('routes-row-1'));
      expect(thick()).toEqual([1]);
      expect(screen.queryByTestId('route-dock')).not.toBeInTheDocument();

      fireEvent.mouseLeave(screen.getByTestId('routes-row-1'));
      expect(thick()).toEqual([]);
    });

    it.each([
      ['the close button', () => fireEvent.click(screen.getByTestId('route-close'))],
      ['Escape', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
      ['a click on the map background', () => act(() => map().fire('click', { lngLat: { lng: 6, lat: 45 } }))],
    ])('closes the dock and deselects the route with %s', async (_, close) => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-1'));
      expect(screen.getByTestId('route-dock')).toBeInTheDocument();

      close();

      expect(screen.queryByTestId('route-dock')).not.toBeInTheDocument();
      expect(screen.getByTestId('routes-row-1')).not.toHaveAttribute('data-selected');
      // The routes are still there to pick again.
      expect(screen.getByTestId('routes-list')).toBeInTheDocument();
    });

    it('keeps the dock open when the click is on a route', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-1'));

      map().rendered = [{}];
      act(() => map().fire('click', { lngLat: { lng: 6, lat: 45 } }));

      expect(screen.getByTestId('route-dock')).toBeInTheDocument();
    });

    it('stops picking the start point with Escape before it closes the dock', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-1'));
      fireEvent.click(screen.getByTestId('criteria-start-pick'));
      expect(screen.getByTestId('criteria-pick-bar')).toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: 'Escape' });

      expect(screen.queryByTestId('criteria-pick-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('route-dock')).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByTestId('route-dock')).not.toBeInTheDocument();
    });

    it('sets the start point on a click while picking, instead of deselecting', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-0'));
      fireEvent.click(screen.getByTestId('criteria-start-pick'));

      act(() => map().fire('click', { lngLat: { lng: 6.3, lat: 45.9 } }));

      expect(markers.at(-1)).toMatchObject({ position: [6.3, 45.9], shown: true });
      expect(screen.queryByTestId('criteria-pick-bar')).not.toBeInTheDocument();
    });

    it('shows a bar while picking the start point, with a way to cancel', () => {
      onDesktop();
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getByTestId('criteria-start-pick'));
      expect(screen.getByTestId('criteria-pick-bar')).toHaveTextContent(en.pickStart);
      fireEvent.click(screen.getByTestId('criteria-pick-cancel'));

      expect(screen.queryByTestId('criteria-pick-bar')).not.toBeInTheDocument();
    });

    it('says the routes are stale once the criteria change, and searches again on request', async () => {
      onDesktop();
      // A response body is read once: each search gets its own.
      const routeSets = vi.fn(() => Promise.resolve(answer(route(0))));
      vi.stubGlobal('fetch', () => routeSets());
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');
      expect(screen.queryByTestId('routes-stale')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));

      expect(screen.getByTestId('routes-stale')).toHaveTextContent(routesText.en.stale);
      // The routes stay on the list and the map, to compare with.
      expect(screen.getByTestId('routes-row-0')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('routes-search-again'));

      expect(routeSets).toHaveBeenCalledTimes(2);
      await screen.findByTestId('routes-count');
      expect(screen.queryByTestId('routes-stale')).not.toBeInTheDocument();
    });

    it('compares the criteria to the routes still shown after a search that failed', async () => {
      onDesktop();
      const answers = [answer(route(0)), Response.json({ error: 'rate-limited' }, { status: 429 })];
      vi.stubGlobal('fetch', () => Promise.resolve(answers.shift()!));
      render(<CriteriaView language="en" />);
      await submit();
      await screen.findByTestId('routes-count');
      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));
      fireEvent.click(screen.getByTestId('routes-search-again'));
      await screen.findByTestId('routes-toast');

      // The routes that came back are those of the first criteria: they still do not match the form.
      expect(screen.getByTestId('routes-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('routes-stale')).toBeInTheDocument();
    });

    it('does not call the routes stale when the units change', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submit();
      await screen.findByTestId('routes-count');

      const settings = renderHook(() => useSettings());
      act(() => settings.result.current[1]({ units: 'imperial' }));

      expect(screen.queryByTestId('routes-stale')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));
      expect(screen.getByTestId('routes-stale')).toBeInTheDocument();
    });

    it('does not call the routes stale when only the pace of a distance changes', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submit();
      await screen.findByTestId('routes-count');

      fireEvent.click(screen.getByTestId('routes-pace-edit'));
      fireEvent.change(screen.getByTestId('routes-pace-input'), { target: { value: '300' } });

      expect(screen.queryByTestId('routes-stale')).not.toBeInTheDocument();
    });

    it('offers no new search while the criteria are invalid', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submit();
      await screen.findByTestId('routes-count');

      fireEvent.click(screen.getByTestId('criteria-target-duration'));
      fireEvent.change(screen.getByTestId('criteria-duration'), { target: { value: '30' } });
      fireEvent.click(screen.getByTestId('criteria-elevation-target'));
      fireEvent.change(screen.getByTestId('criteria-gain'), { target: { value: '2000' } });

      expect(screen.getByTestId('routes-stale')).toBeInTheDocument();
      expect(screen.queryByTestId('routes-search-again')).not.toBeInTheDocument();
    });

    it('puts the routes back in view after the user moved the map', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');
      await settle();
      expect(screen.queryByTestId('criteria-reframe')).not.toBeInTheDocument();

      act(() => map().fire('movestart', { originalEvent: {} }));
      map().fitted = undefined;
      expect(screen.getByTestId('criteria-reframe')).toHaveAccessibleName(en.reframe);
      fireEvent.click(screen.getByTestId('criteria-reframe'));

      expect(map().fitted?.options).toMatchObject({ bearing: 0 });
      expect(screen.queryByTestId('criteria-reframe')).not.toBeInTheDocument();
      expect(screen.getByTestId('criteria-settings')).toHaveFocus();
    });

    it('offers no way to frame the routes before there are some', () => {
      onDesktop();
      render(<CriteriaView language="en" />);

      act(() => map().fire('movestart', { originalEvent: {} }));

      expect(screen.queryByTestId('criteria-reframe')).not.toBeInTheDocument();
    });

    it('shows a dot on the map where the user points on the profile', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-0'));
      const plot = screen.getByTestId('route-profile-plot');
      plot.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

      const dot = () => (map().getSource('route-hover') as { data: { features: unknown[] } }).data.features;

      fireEvent.pointerMove(plot, { clientX: 50 });
      expect(dot()).toHaveLength(1);

      fireEvent.pointerLeave(plot);
      expect(dot()).toEqual([]);
    });

    it('opens the dock of a route tapped on the map', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');

      act(() => map().fire('click', { features: [{ properties: { index: 1 } }] }, 'routes-hit'));

      expect(screen.getByTestId('routes-row-1')).toHaveAttribute('data-selected');
      expect(screen.getByTestId('route-position')).toHaveTextContent(routesText.en.route(2, 2));
    });

    it('draws the thumbnails over the snapshot the map took', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');
      expect(screen.queryByTestId('routes-row-0-thumbnail-map')).not.toBeInTheDocument();

      await settle();

      expect(document.querySelector('image')).toHaveAttribute('href', expect.stringMatching(/^blob:/));
    });

    it('keeps the criteria beside the routes, and the routes on the map while they change', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));
      await submit();
      await screen.findByTestId('routes-count');
      await settle();

      expect(screen.getByTestId('criteria-surface-unpaved')).toBeChecked();
      expect((field() as HTMLInputElement).value).toContain('45.8');
      expect(screen.queryByTestId('routes-back')).not.toBeInTheDocument();
      expect(screen.queryByTestId('criteria-routes')).not.toBeInTheDocument();
      expect(routesSource()).toHaveLength(1);
    });

    it('offers to show the routes found again from the criteria on phones', async () => {
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-1'));
      await settle();
      fireEvent.click(screen.getByTestId('route-back'));
      fireEvent.click(screen.getByTestId('routes-back'));

      const button = screen.getByTestId('criteria-routes');
      expect(button).toHaveAccessibleName(routesText.en.showRoutes(2));
      fireEvent.click(button);

      expect(screen.getByTestId('routes-count')).toHaveTextContent('2 routes');
      expect(screen.getByTestId('routes-row-1')).toHaveAttribute('data-selected');
      expect(screen.queryByTestId('criteria-routes')).not.toBeInTheDocument();
    });

    it('drops the routes found, and the dock, when the start point changes', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-0'));
      await settle();

      fireEvent.change(field(), { target: { value: '45.9, 6.3' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(screen.queryByTestId('routes-list')).not.toBeInTheDocument();
      expect(screen.queryByTestId('route-dock')).not.toBeInTheDocument();
      expect(routesSource()).toEqual([]);
      expect(document.documentElement.style.getPropertyValue('--list-inset')).toBe('');
    });

    it('keeps the routes found when the start point is set again to the same place', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submit();
      await screen.findByTestId('routes-count');

      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(screen.getByTestId('routes-list')).toBeInTheDocument();
    });

    it('shows the way back to the routes in the sheet on phones', async () => {
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('criteria-submit'));
      fireEvent.click(await screen.findByTestId('routes-back'));

      expect(screen.getByTestId('criteria-routes')).toBeInTheDocument();
    });

    it('shows the route set in the sheet on phones', async () => {
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('criteria-submit'));

      expect(await screen.findByTestId('routes-count')).toBeInTheDocument();
      expect(screen.getByTestId('criteria-sheet-handle')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTestId('criteria-sheet-handle')).toHaveAccessibleName(routesText.en.routes);
      fireEvent.click(screen.getByTestId('routes-row-0'));
      expect(screen.getByTestId('route-detail')).toBeInTheDocument();
      // The collapsed sheet shows the top of the detail only; its handle expands it to the rest.
      expect(screen.queryByTestId('route-profile')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));
      expect(screen.getByTestId('route-profile')).toBeInTheDocument();
    });

    it.each([
      ['an empty route set', answer(), routesText.en.noRoutes],
      ['an error code', Response.json({ error: 'rate-limited' }, { status: 429 }), errorText.en['rate-limited']],
      ['an unreachable API', new Response('', { status: 502 }), routesText.en.unreachable],
      ['a failing API', new Response('', { status: 500 }), routesText.en.failed],
    ])('says what happened on %s, and keeps the criteria', async (_, response, message) => {
      onDesktop();
      ask(response);
      render(<CriteriaView language="en" />);

      await submit();

      expect(await screen.findByTestId('routes-toast')).toHaveTextContent(message);
      expect(screen.getByTestId('criteria-submit')).toBeInTheDocument();
    });

    it('drops the message on a click', async () => {
      onDesktop();
      ask(answer());
      render(<CriteriaView language="fr" />);
      await submit();

      fireEvent.click(await screen.findByTestId('routes-toast'));

      expect(screen.queryByTestId('routes-toast')).not.toBeInTheDocument();
    });

    it.each(['en', 'fr'] as const)('names every control of the route set in %s', async (language) => {
      ask(answer(route(0)));
      const { container } = render(<CriteriaView language={language} />);
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('criteria-submit'));
      await screen.findByTestId('routes-count');

      expectNamedControls(container);
    });
  });
});
