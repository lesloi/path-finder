import { act, fireEvent, render, screen } from '@testing-library/react';

import { CriteriaView } from './criteria-view.tsx';
import { expectNamedControls } from '../accessible-names.ts';
import { criteriaText, errorText, routesText } from '../i18n/index.ts';
import { maps, markers } from '../maplibre-mock.ts';

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

    it('offers the elevation gain only when the API has elevation data', async () => {
      onDesktop();
      const fetchMock = vi.fn().mockResolvedValue(Response.json({ elevation: true }));
      vi.stubGlobal('fetch', fetchMock);
      render(<CriteriaView language="en" />);
      expect(screen.queryByTestId('criteria-elevation-hilly')).not.toBeInTheDocument();

      expect(await screen.findByTestId('criteria-elevation-hilly')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/capabilities', expect.anything());
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
      expect(JSON.parse(body as string)).toMatchObject({ start: [6.2, 45.8], activity: 'run' });
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
      surfaces: [{ surface: 'paved', share: 1 }],
      ...overrides,
    });
    const answer = (...routes: object[]) => Response.json({ routes });

    function ask(response: Promise<Response> | Response) {
      const routeSets = vi.fn(() => Promise.resolve(response));
      vi.stubGlobal('fetch', (url: string) =>
        url === '/api/v1/route-sets' ? routeSets() : Promise.resolve(Response.json({ elevation: false })),
      );
      return routeSets;
    }
    async function submit() {
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('criteria-submit'));
    }
    // The map settles on the routes it frames: it then draws them and takes its snapshot.
    const settle = () => act(() => map().fire('idle'));
    const routesSource = () => (map().sources.routes as unknown as { data: { features: unknown[] } }).data.features;

    it('shows a loading state while the API works, with no way back before it answers', async () => {
      onDesktop();
      ask(new Promise(() => {}));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));

      await submit();

      expect(screen.getByTestId('routes-loading')).toHaveTextContent(routesText.en.finding);
      expect(screen.queryByTestId('criteria-submit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('routes-cancel')).not.toBeInTheDocument();
    });

    it('shows the route set in the column, and draws its routes on the map', async () => {
      onDesktop();
      ask(answer(route(0), route(1, { kind: 'suggestion', misses: [{ criterion: 'distance', gap: 1 }] })));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));

      await submit();

      expect(await screen.findByTestId('routes-count')).toHaveTextContent('2 routes');
      settle();
      expect(routesSource()).toHaveLength(2);
      expect(map().fitted).toBeDefined();
    });

    it('opens the detail of a route, frames it on the map, and goes back to the list', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));
      await submit();

      await screen.findByTestId('routes-count');
      settle();
      fireEvent.click(screen.getByTestId('routes-row-1'));
      expect(screen.getByTestId('route-position')).toHaveTextContent('2/2');
      expect(map().fitted?.bounds).toEqual([
        [7.2, expect.closeTo(45.8)],
        [7.2, expect.closeTo(45.8 + 1_200 / METRES_PER_DEGREE)],
      ]);

      fireEvent.click(screen.getByTestId('route-back'));
      expect(screen.getByTestId('routes-count')).toBeInTheDocument();
    });

    it('shows a dot on the map where the user points on the profile', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-0'));
      const plot = screen.getByTestId('route-profile-plot');
      plot.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

      fireEvent.pointerMove(plot, { clientX: 50 });
      expect(markers.filter((marker) => marker.shown)).toHaveLength(2);

      fireEvent.pointerLeave(plot);
      expect(markers.filter((marker) => marker.shown)).toHaveLength(1);
    });

    it('selects the row of a route tapped on the map', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));
      await submit();
      await screen.findByTestId('routes-count');

      act(() => map().fire('click', { features: [{ properties: { index: 1 } }] }, 'routes-hit'));

      expect(screen.getByTestId('routes-row-1')).toHaveAttribute('data-selected');
    });

    it('draws the thumbnails over the snapshot the map took', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));
      await submit();
      await screen.findByTestId('routes-count');
      expect(screen.queryByTestId('routes-row-0-thumbnail-map')).not.toBeInTheDocument();

      settle();

      expect(document.querySelector('image')).toHaveAttribute('href', expect.stringMatching(/^blob:/));
    });

    it('goes back to the criteria, kept as they were, with the routes still on the map', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));
      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));
      await submit();
      await screen.findByTestId('routes-count');
      settle();

      fireEvent.click(screen.getByTestId('routes-back'));

      expect(screen.getByTestId('criteria-surface-unpaved')).toBeChecked();
      expect((field() as HTMLInputElement).value).toContain('45.8');
      expect(routesSource()).toHaveLength(1);
    });

    it('offers to show the routes found again from the criteria', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));
      await submit();
      fireEvent.click(await screen.findByTestId('routes-row-1'));
      settle();
      fireEvent.click(screen.getByTestId('route-back'));
      fireEvent.click(screen.getByTestId('routes-back'));

      const button = screen.getByTestId('criteria-routes');
      expect(button).toHaveAccessibleName(routesText.en.showRoutes(2));
      fireEvent.click(button);

      expect(screen.getByTestId('routes-count')).toHaveTextContent('2 routes');
      expect(screen.getByTestId('routes-row-1')).toHaveAttribute('data-selected');
      expect(screen.queryByTestId('criteria-routes')).not.toBeInTheDocument();
    });

    it('drops the routes found when the start point changes', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));
      await submit();
      await screen.findByTestId('routes-count');
      settle();
      fireEvent.click(screen.getByTestId('routes-back'));

      fireEvent.change(field(), { target: { value: '45.9, 6.3' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(screen.queryByTestId('criteria-routes')).not.toBeInTheDocument();
      expect(routesSource()).toEqual([]);
    });

    it('keeps the routes found when the start point is set again to the same place', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('load'));
      await submit();
      await screen.findByTestId('routes-count');
      fireEvent.click(screen.getByTestId('routes-back'));

      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(screen.getByTestId('criteria-routes')).toBeInTheDocument();
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
      act(() => map().fire('load'));
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
