import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';

import { MAX_WAYPOINTS } from '../contract/index.ts';
import { basemapStyle } from '../components/basemap-style.ts';
import { LazyStartPointMap } from '../components/index.ts';
import { CriteriaView } from './criteria-view.tsx';
import { expectNamedControls } from '../accessible-names.ts';
import { criteriaText, errorText, routesText } from '../i18n/index.ts';
import { maps, markers, popups } from '../maplibre-mock.ts';
import { useSettings } from '../state/index.ts';

vi.mock('maplibre-gl', () => import('../maplibre-mock.ts'));

const en = criteriaText.en;
const fr = criteriaText.fr;

const map = () => maps.at(-1)!;
const field = () => screen.getByTestId('criteria-start');
// A desktop shows the criteria only once there is a start point.
function setStartPoint() {
  fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
  fireEvent.keyDown(field(), { key: 'Enter' });
}
const place = (lng: number, lat: number) => act(() => map().fire('click', { lngLat: { lng, lat } }));
const items = () => screen.queryAllByTestId(/^criteria-waypoint-item-\d+$/);
const names = () => items().map((item) => item.querySelector('[data-name]')!.textContent);
const waypointMarkers = () => markers.filter((marker) => marker.shown && marker.options?.element?.dataset.waypoint);
const onDesktop = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query) => ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as never,
    );

// Stands in for the API's route sets. The coverage is another request, which most tests leave unanswered:
// the map then greys nothing.
function stubFetch(routeSets: (...args: never[]) => Promise<Response>) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    url === '/api/v1/coverage' ? Promise.reject(new Error('No coverage')) : routeSets(...([url, init] as never[])),
  );
}

// The map's code loads once, then every render has it at once, as in a session that has opened the map.
beforeAll(async () => {
  const { unmount } = render(<LazyStartPointMap onStartChange={vi.fn()} />);
  await waitFor(() => expect(maps.length).toBeGreaterThan(0));
  unmount();
});

beforeEach(() => {
  maps.length = 0;
  markers.length = 0;
  popups.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CriteriaView', () => {
  it('links to the settings', () => {
    render(<CriteriaView language="en" />);

    expect(screen.getByTestId('criteria-settings')).toHaveAttribute('href', '#/settings');
  });

  describe('the layers button', () => {
    it('keeps the layers chosen across reloads', () => {
      const first = render(<CriteriaView language="en" />);
      fireEvent.click(screen.getByTestId('criteria-layers'));
      fireEvent.click(screen.getByTestId('layers-viewpoint'));
      fireEvent.click(screen.getByTestId('layers-water'));
      first.unmount();

      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getByTestId('criteria-layers'));

      expect(screen.getByTestId('layers-viewpoint')).toBeChecked();
      expect(screen.getByTestId('layers-water')).not.toBeChecked();
    });
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

  it('shows the map on the basemap picked in the settings', () => {
    render(<CriteriaView language="en" />);
    act(() => map().fire('style.load'));
    const settings = renderHook(() => useSettings());

    act(() => settings.result.current[1]({ basemap: 'aerial' }));

    expect(map().styles.at(-1)!.style).toEqual(basemapStyle('aerial'));
  });

  it('goes back to the saved basemap that failed to load', () => {
    localStorage.setItem('path-finder.settings', JSON.stringify({ basemap: 'plan' }));
    render(<CriteriaView language="en" />);
    act(() => maps.at(-1)!.fire('style.load'));
    const settings = renderHook(() => useSettings());
    act(() => settings.result.current[1]({ basemap: 'minimal' }));

    act(() => maps.at(-1)!.fire('error'));

    expect(renderHook(() => useSettings()).result.current[0].basemap).toBe('plan');
  });

  describe('accessibility', () => {
    it.each(['en', 'fr'] as const)('names every control on phones in %s, with the criteria layer open', (language) => {
      const { container } = render(<CriteriaView language={language} />);
      expectNamedControls(container);

      fireEvent.click(screen.getByTestId('criteria-bar'));

      expectNamedControls(container);
    });

    it.each(['en', 'fr'] as const)('names every control on desktops in %s', (language) => {
      onDesktop();
      const { container } = render(<CriteriaView language={language} />);
      setStartPoint();

      expectNamedControls(container);
    });
  });

  describe('on phones', () => {
    it('invites a long press in the sheet until the start point is set', () => {
      vi.useFakeTimers();
      render(<CriteriaView language="en" />);
      // Nothing to expand before there are routes.
      expect(screen.queryByTestId('criteria-sheet-handle')).not.toBeInTheDocument();
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

    it('sets the start point from coordinates typed in the criteria layer', () => {
      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getByTestId('criteria-bar'));

      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(markers.at(-1)).toMatchObject({ position: [6.2, 45.8], shown: true });
    });
  });

  describe('criteria', () => {
    it('sums them up in a bar over the map on phones, with the start point once it is set', () => {
      localStorage.setItem(
        'path-finder.settings',
        JSON.stringify({
          lastCriteria: { target: 'distance', surface: 'unpaved', level: 'hilly', gain: 300 },
        }),
      );
      render(<CriteriaView language="en" />);
      const bar = screen.getByTestId('criteria-bar');
      expect(bar).toHaveTextContent('10.0 km · Hilly · Unpaved');
      expect(bar).not.toHaveTextContent('45.');

      fireEvent.click(screen.getByTestId('criteria-bar'));
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('sub-page-back'));

      expect(screen.getByTestId('criteria-bar')).toHaveTextContent('45.8');
    });

    it('opens the criteria in a layer over the map, from the bar or from the sheet, and closes it', () => {
      render(<CriteriaView language="en" />);
      expect(screen.queryByTestId('criteria-distance')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-open'));
      expect(screen.getByTestId('sub-page-title')).toHaveTextContent(en.search);
      expect(screen.getByTestId('criteria-distance')).toHaveAccessibleName(en.distance);

      fireEvent.click(screen.getByTestId('sub-page-back'));
      expect(screen.queryByTestId('sub-page')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-bar'));
      fireEvent(screen.getByTestId('sub-page'), new Event('cancel', { cancelable: true }));
      expect(screen.queryByTestId('sub-page')).not.toBeInTheDocument();
    });

    it('asks for routes from the layer, which closes', async () => {
      const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise(() => {}));
      stubFetch(fetchMock);
      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getByTestId('criteria-bar'));
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      fireEvent.click(screen.getByTestId('criteria-submit'));

      expect(screen.queryByTestId('sub-page')).not.toBeInTheDocument();
      expect(screen.getByTestId('routes-loading')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    describe('where the server cannot route', () => {
      const covered = [[6, 45.8, 6.1, 45.9]];
      const cover = (cells: unknown) =>
        vi.stubGlobal('fetch', (url: string) =>
          url === '/api/v1/coverage' ? Promise.resolve(Response.json({ cells })) : new Promise(() => {}),
        );

      it('disables the search, and says why without the coordinates', async () => {
        cover(covered);
        render(<CriteriaView language="en" />);
        fireEvent.click(screen.getByTestId('criteria-bar'));
        fireEvent.change(field(), { target: { value: '48.8, 2.3' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        const submit = await screen.findByTestId('criteria-submit');
        await waitFor(() => expect(submit).toBeDisabled());
        const message = screen.getByTestId('criteria-uncovered');
        expect(message).toHaveTextContent(en.uncoveredStart);
        expect(message).not.toHaveTextContent(/48|2\.3/);
        expect(submit).toHaveAccessibleDescription(en.uncoveredStart);
      });

      it('says it in French', async () => {
        cover(covered);
        render(<CriteriaView language="fr" />);
        fireEvent.click(screen.getByTestId('criteria-bar'));
        fireEvent.change(field(), { target: { value: '48.8, 2.3' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        expect(await screen.findByTestId('criteria-uncovered')).toHaveTextContent(fr.uncoveredStart);
      });

      it('lets a start point inside the cells search again', async () => {
        cover(covered);
        render(<CriteriaView language="en" />);
        fireEvent.click(screen.getByTestId('criteria-bar'));
        fireEvent.change(field(), { target: { value: '48.8, 2.3' } });
        fireEvent.keyDown(field(), { key: 'Enter' });
        await waitFor(() => expect(screen.getByTestId('criteria-submit')).toBeDisabled());

        fireEvent.change(field(), { target: { value: '45.85, 6.05' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        expect(screen.getByTestId('criteria-submit')).toBeEnabled();
        expect(screen.queryByTestId('criteria-uncovered')).not.toBeInTheDocument();
      });

      describe('in the sheet, behind the criteria', () => {
        const enterStart = (text: string) => {
          fireEvent.click(screen.getByTestId('criteria-bar'));
          fireEvent.change(field(), { target: { value: text } });
          fireEvent.keyDown(field(), { key: 'Enter' });
        };
        const startAndLeave = async (text: string) => {
          enterStart(text);
          await waitFor(() => expect(screen.getByTestId('criteria-submit')).toBeDisabled());
          fireEvent.click(screen.getByTestId('sub-page-back'));
        };
        const sheetNotice = () => within(screen.getByTestId('criteria-sheet')).getByTestId('criteria-sheet-uncovered');

        it('says it once the criteria are closed, without the coordinates', async () => {
          cover(covered);
          render(<CriteriaView language="en" />);

          await startAndLeave('48.8, 2.3');

          expect(sheetNotice()).toHaveTextContent(en.uncoveredStart);
          expect(sheetNotice()).not.toHaveTextContent(/48|2\.3/);
        });

        it('says it in French', async () => {
          cover(covered);
          render(<CriteriaView language="fr" />);

          await startAndLeave('48.8, 2.3');

          expect(sheetNotice()).toHaveTextContent(fr.uncoveredStart);
        });

        it('is empty for a start point inside the cells', async () => {
          cover(covered);
          render(<CriteriaView language="en" />);

          await startAndLeave('48.8, 2.3');
          enterStart('45.85, 6.05');
          fireEvent.click(screen.getByTestId('sub-page-back'));

          expect(sheetNotice()).toBeEmptyDOMElement();
        });

        it('disables the criteria button, and explains why, for a start point outside the cells', async () => {
          cover(covered);
          render(<CriteriaView language="en" />);

          await startAndLeave('48.8, 2.3');

          const open = screen.getByTestId('criteria-open');
          expect(open).toBeDisabled();
          expect(open).toHaveAccessibleDescription(en.uncoveredStart);
        });

        it('drops the description of the criteria button while the criteria are open', async () => {
          cover(covered);
          render(<CriteriaView language="en" />);
          await startAndLeave('48.8, 2.3');

          fireEvent.click(screen.getByTestId('criteria-bar'));

          expect(screen.getByTestId('criteria-open')).not.toHaveAttribute('aria-describedby');
        });

        it('enables the criteria button for a start point inside the cells', async () => {
          cover(covered);
          render(<CriteriaView language="en" />);
          await startAndLeave('48.8, 2.3');

          enterStart('45.85, 6.05');
          fireEvent.click(screen.getByTestId('sub-page-back'));

          expect(screen.getByTestId('criteria-open')).toBeEnabled();
        });

        it('is empty when the coverage is unknown', async () => {
          stubFetch(() => new Promise(() => {}));
          render(<CriteriaView language="en" />);
          enterStart('48.8, 2.3');
          await act(async () => {});
          fireEvent.click(screen.getByTestId('sub-page-back'));

          expect(sheetNotice()).toBeEmptyDOMElement();
        });
      });

      it('lets the search run when the coverage is unknown', async () => {
        stubFetch(() => new Promise(() => {}));
        render(<CriteriaView language="en" />);
        fireEvent.click(screen.getByTestId('criteria-bar'));
        fireEvent.change(field(), { target: { value: '48.8, 2.3' } });
        fireEvent.keyDown(field(), { key: 'Enter' });

        await act(async () => {});
        expect(screen.getByTestId('criteria-submit')).toBeEnabled();
      });

      it('checks a start point that was set before the coverage arrived', async () => {
        let answer: (response: Response) => void = () => {};
        vi.stubGlobal('fetch', (url: string) =>
          url === '/api/v1/coverage' ? new Promise<Response>((resolve) => (answer = resolve)) : new Promise(() => {}),
        );
        render(<CriteriaView language="en" />);
        fireEvent.click(screen.getByTestId('criteria-bar'));
        fireEvent.change(field(), { target: { value: '48.8, 2.3' } });
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(screen.getByTestId('criteria-submit')).toBeEnabled();

        await act(async () => answer(Response.json({ cells: covered })));

        expect(screen.getByTestId('criteria-submit')).toBeDisabled();
      });
    });

    it('picks the start point with a tap on the map once the layer sends the user there', () => {
      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getByTestId('criteria-bar'));

      fireEvent.click(screen.getByTestId('criteria-start-pick'));
      expect(screen.queryByTestId('sub-page')).not.toBeInTheDocument();
      expect(screen.getByTestId('criteria-pick-bar')).toHaveTextContent(en.pickStartTouch);

      act(() => map().fire('click', { lngLat: { lng: 6.2, lat: 45.8 } }));

      expect(markers.at(-1)).toMatchObject({ position: [6.2, 45.8], shown: true });
      expect(screen.queryByTestId('criteria-pick-bar')).not.toBeInTheDocument();
    });

    it('shows the full form in the desktop column and passes the criteria on', () => {
      onDesktop();
      const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise(() => {}));
      stubFetch(fetchMock);
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
    fireEvent.click(screen.getByTestId('criteria-bar'));
    fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));

    onDesktop();
    rerender(<CriteriaView language="en" />);
    setStartPoint();

    expect(screen.getByTestId('criteria-surface-unpaved')).toBeChecked();
  });

  describe('the GPX import button', () => {
    const importButton = () => screen.getByTestId('gpx-import');

    it('is offered on a phone, with or without a start point', () => {
      render(<CriteriaView language="en" />);
      expect(importButton()).toHaveAccessibleName(en.importGpx);

      fireEvent.click(screen.getByTestId('criteria-bar'));
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(importButton()).toBeInTheDocument();
    });

    it('is offered on a desktop, with or without a start point', () => {
      onDesktop();
      render(<CriteriaView language="en" />);
      expect(importButton()).toHaveAccessibleName(en.importGpx);

      setStartPoint();

      expect(importButton()).toBeInTheDocument();
    });
  });

  describe('on desktops', () => {
    it('shows the criteria only once there is a start point', () => {
      onDesktop();
      render(<CriteriaView language="en" />);
      expect(screen.getByTestId('criteria-start')).toBeInTheDocument();
      expect(screen.queryByTestId('criteria-surface-unpaved')).not.toBeInTheDocument();
      expect(screen.queryByTestId('criteria-distance')).not.toBeInTheDocument();
      expect(screen.getByTestId('criteria-long-press')).toBeInTheDocument();

      setStartPoint();

      expect(screen.getByTestId('criteria-surface-unpaved')).toBeInTheDocument();
      expect(screen.getByTestId('criteria-distance')).toBeInTheDocument();
      expect(screen.queryByTestId('criteria-long-press')).not.toBeInTheDocument();
    });

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

    describe('while waiting for the position', () => {
      const pending = () => {
        const callbacks: { success?: PositionCallback; failure?: PositionErrorCallback } = {};
        getCurrentPosition.mockImplementation((success: PositionCallback, failure: PositionErrorCallback) => {
          callbacks.success = success;
          callbacks.failure = failure;
        });
        return callbacks;
      };

      it('marks the button as busy and says the location is in progress', () => {
        pending();
        render(<CriteriaView language="en" />);

        fireEvent.click(screen.getByTestId('criteria-locate'));

        const button = screen.getByTestId('criteria-locate');
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(button).toHaveAccessibleName(en.locating);
      });

      it('does the same on the desktop button', () => {
        onDesktop();
        pending();
        render(<CriteriaView language="en" />);

        fireEvent.click(screen.getByTestId('criteria-start-locate'));

        const button = screen.getByTestId('criteria-start-locate');
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(button).toHaveAccessibleName(en.locating);
      });

      it('does not ask twice, even for two taps before the next render', () => {
        pending();
        render(<CriteriaView language="en" />);
        const button = screen.getByTestId('criteria-locate');

        act(() => {
          button.click();
          button.click();
        });

        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      });

      it('gives up when the browser never answers, so the user can tap again', () => {
        vi.useFakeTimers();
        pending();
        render(<CriteriaView language="en" />);
        fireEvent.click(screen.getByTestId('criteria-locate'));

        act(() => vi.advanceTimersByTime(15_000));
        fireEvent.click(screen.getByTestId('criteria-locate'));

        expect(screen.getByTestId('criteria-locate')).toHaveAttribute('aria-busy', 'true');
        expect(getCurrentPosition).toHaveBeenCalledTimes(2);
      });

      it('is not reset by the answer of a request it gave up on', () => {
        vi.useFakeTimers();
        const callbacks = pending();
        render(<CriteriaView language="en" />);
        fireEvent.click(screen.getByTestId('criteria-locate'));
        const abandoned = callbacks.failure;
        act(() => vi.advanceTimersByTime(15_000));
        fireEvent.click(screen.getByTestId('criteria-locate'));

        act(() => abandoned?.({ code: 1 } as GeolocationPositionError));

        expect(screen.getByTestId('criteria-locate')).toHaveAttribute('aria-busy', 'true');
      });

      it('goes back to normal once the position arrives', () => {
        const callbacks = pending();
        render(<CriteriaView language="en" />);
        fireEvent.click(screen.getByTestId('criteria-locate'));

        act(() => callbacks.success?.({ coords: { longitude: 5.7, latitude: 45.2 } } as GeolocationPosition));

        const button = screen.getByTestId('criteria-locate');
        expect(button).toHaveAttribute('aria-busy', 'false');
        expect(button).toHaveAccessibleName(en.myLocation);
      });

      it('goes back to normal and shows the toast when the location fails', () => {
        const callbacks = pending();
        render(<CriteriaView language="en" />);
        fireEvent.click(screen.getByTestId('criteria-locate'));

        act(() => callbacks.failure?.({ code: 1 } as GeolocationPositionError));

        expect(screen.getByTestId('criteria-locate')).toHaveAttribute('aria-busy', 'false');
        expect(screen.getByTestId('criteria-toast')).toBeInTheDocument();
      });
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

      fireEvent.click(screen.getByTestId('criteria-start-locate'));

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
      unpavedShare: 0.3,
      surfaces: [{ surface: 'paved', from: 0, to: 10 }],
      technical: false,
      technicalStretches: [],
      ...overrides,
    });
    const answer = (...routes: object[]) => Response.json({ routes });

    function ask(response: Promise<Response> | Response) {
      const routeSets = vi.fn(() => Promise.resolve(response));
      stubFetch(() => routeSets());
      return routeSets;
    }
    async function submit() {
      setStartPoint();
      fireEvent.click(screen.getByTestId('criteria-submit'));
    }
    // The map settles on the routes it frames: it then draws them and takes its snapshot. The effects that listen
    // for it run first: a route set that has just been found may not have committed them yet, on a busy machine.
    const settle = async () => {
      await act(async () => {});
      act(() => map().fire('idle'));
    };
    const routesSource = () => (map().sources.routes as unknown as { data: { features: unknown[] } }).data.features;

    it('renames the search button once routes were found', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();

      await screen.findByTestId('routes-count');
      expect(screen.getByTestId('criteria-submit')).toHaveTextContent(criteriaText.en.searchAgain);
    });

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
      expect(screen.queryByTestId('gpx-import')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('routes-cancel'));

      expect(screen.queryByTestId('routes-loading')).not.toBeInTheDocument();
      expect(screen.queryByTestId('routes-cancel')).not.toBeInTheDocument();
      expect(screen.getByTestId('gpx-import')).toBeInTheDocument();
      expect(document.documentElement.style.getPropertyValue('--list-inset')).toBe('');
    });

    describe('folding the panels on a desktop', () => {
      async function findRoutes() {
        onDesktop();
        ask(answer(route(0), route(1)));
        render(<CriteriaView language="en" />);
        act(() => map().fire('style.load'));
        await submit();
        await screen.findByTestId('routes-count');
      }
      const rootProperty = (name: string) => document.documentElement.style.getPropertyValue(name);

      it('offers no button to hide the form before a search', () => {
        onDesktop();
        render(<CriteriaView language="en" />);

        expect(screen.queryByTestId('criteria-fold')).not.toBeInTheDocument();
      });

      it('folds the form to its button and unfolds it, keeping what was typed', async () => {
        await findRoutes();
        fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
        const toggle = screen.getByTestId('criteria-fold');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('criteria-title').closest('aside')).toHaveAttribute('inert');
        expect(rootProperty('--column-inset')).not.toBe('');

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('criteria-title').closest('aside')).not.toHaveAttribute('inert');
        expect(field()).toHaveValue('45.8, 6.2');
        expect(rootProperty('--column-inset')).toBe('');
      });

      it('shows the form again when the routes are cleared while it is folded', async () => {
        await findRoutes();
        fireEvent.click(screen.getByTestId('criteria-fold'));

        fireEvent.click(screen.getByTestId('routes-clear'));

        expect(screen.queryByTestId('criteria-fold')).not.toBeInTheDocument();
        expect(screen.getByTestId('criteria-title').closest('aside')).not.toHaveAttribute('inert');
        expect(rootProperty('--column-inset')).toBe('');
      });

      it('does not fold the form again by itself when a search follows clearing the routes', async () => {
        await findRoutes();
        fireEvent.click(screen.getByTestId('criteria-fold'));
        fireEvent.click(screen.getByTestId('routes-clear'));

        await submit();

        expect(await screen.findByTestId('criteria-fold')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('criteria-title').closest('aside')).not.toHaveAttribute('inert');
      });

      it('moves the focus to the button when the form folds around it', async () => {
        await findRoutes();
        field().focus();

        fireEvent.click(screen.getByTestId('criteria-fold'));

        expect(screen.getByTestId('criteria-fold')).toHaveFocus();
      });

      it('folds the routes to their button and unfolds them', async () => {
        await findRoutes();
        const toggle = screen.getByTestId('routes-fold');

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('routes-list').closest('aside')).toHaveAttribute('inert');

        fireEvent.click(toggle);

        expect(screen.getByTestId('routes-list').closest('aside')).not.toHaveAttribute('inert');
      });

      it('unfolds the routes when a new search starts', async () => {
        await findRoutes();
        fireEvent.click(screen.getByTestId('routes-fold'));

        await submit();

        expect(screen.getByTestId('routes-fold')).toHaveAttribute('aria-expanded', 'true');
      });
    });

    describe('clearing the routes', () => {
      async function findRoutes({ phone = false } = {}) {
        if (!phone) onDesktop();
        ask(answer(route(0), route(1)));
        render(<CriteriaView language="en" />);
        act(() => map().fire('style.load'));
        // On a phone, the criteria are behind the bar.
        if (phone) fireEvent.click(screen.getByTestId('criteria-bar'));
        await submit();
        await screen.findByTestId('routes-count');
      }

      it('forgets the routes on a desktop, with the one selected', async () => {
        await findRoutes();
        fireEvent.click(screen.getByTestId('routes-row-0'));
        expect(screen.getByTestId('route-dock')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('routes-clear'));

        expect(screen.queryByTestId('routes-list')).not.toBeInTheDocument();
        expect(screen.queryByTestId('route-dock')).not.toBeInTheDocument();
        expect(document.documentElement.style.getPropertyValue('--list-inset')).toBe('');
      });

      it('forgets the routes on a phone', async () => {
        await findRoutes({ phone: true });

        fireEvent.click(screen.getByTestId('routes-clear'));

        expect(screen.queryByTestId('routes-list')).not.toBeInTheDocument();
        expect(screen.queryByTestId('routes-clear')).not.toBeInTheDocument();
      });

      it('forgets routes that no longer match the criteria', async () => {
        await findRoutes();
        fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));
        expect(screen.getByTestId('routes-stale')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('routes-clear'));

        expect(screen.queryByTestId('routes-stale')).not.toBeInTheDocument();
      });

      it('hands the focus to the settings link, and says the routes are gone', async () => {
        await findRoutes();
        const status = screen.getByTestId('routes-announcement');

        fireEvent.click(screen.getByTestId('routes-clear'));

        expect(screen.getByTestId('criteria-settings')).toHaveFocus();
        expect(status).toHaveTextContent(routesText.en.routesCleared);
      });

      it('stops announcing it once another search starts', async () => {
        await findRoutes();
        fireEvent.click(screen.getByTestId('routes-clear'));

        await submit();

        expect(screen.getByTestId('routes-announcement')).not.toHaveTextContent(routesText.en.routesCleared);
      });
    });

    it('announces the routes found in a status that is there before them and empty while searching', async () => {
      onDesktop();
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      const status = screen.getByTestId('routes-announcement');
      expect(status).toHaveAttribute('role', 'status');
      expect(status).toBeEmptyDOMElement();

      await submit();
      expect(status).toBeEmptyDOMElement();

      await screen.findByTestId('routes-count');
      expect(status).toHaveTextContent(routesText.en.routeCount(2));
    });

    it('shows the route set in the column, and draws its routes on the map', async () => {
      onDesktop();
      ask(answer(route(0), route(1, { kind: 'suggestion' })));
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
      setStartPoint();
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

    it('says the routes are stale once the criteria change, until a new search', async () => {
      onDesktop();
      // A response body is read once: each search gets its own.
      const routeSets = vi.fn(() => Promise.resolve(answer(route(0))));
      stubFetch(() => routeSets());
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');
      expect(screen.queryByTestId('routes-stale')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));

      expect(screen.getByTestId('routes-stale')).toHaveTextContent(routesText.en.stale);
      // The routes stay on the list and the map, to compare with.
      expect(screen.getByTestId('routes-row-0')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('criteria-submit'));

      expect(routeSets).toHaveBeenCalledTimes(2);
      await screen.findByTestId('routes-count');
      expect(screen.queryByTestId('routes-stale')).not.toBeInTheDocument();
    });

    it('offers no new search from a start point that turns out to be out of the server’s reach', async () => {
      onDesktop();
      const routeSets = vi.fn(() => Promise.resolve(answer(route(0))));
      // The coverage comes after the first search, and leaves its start point out.
      let coverage: (response: Response) => void = () => {};
      vi.stubGlobal('fetch', (url: string) =>
        url === '/api/v1/coverage' ? new Promise<Response>((resolve) => (coverage = resolve)) : routeSets(),
      );
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submit();
      await screen.findByTestId('routes-count');
      await act(async () => coverage(Response.json({ cells: [[10, 45, 11, 46]] })));

      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));

      expect(screen.getByTestId('routes-stale')).toBeInTheDocument();
      expect(screen.getByTestId('criteria-submit')).toBeDisabled();
    });

    describe('the criteria kept', () => {
      const kept = () => JSON.parse(localStorage.getItem('path-finder.settings') ?? '{}').lastCriteria;

      it('are kept once a search is made, the distance in kilometres and the gain in metres', async () => {
        onDesktop();
        stubFetch(() => Promise.resolve(answer(route(0))));
        render(<CriteriaView language="en" />);
        setStartPoint();
        fireEvent.change(screen.getByTestId('criteria-distance'), { target: { value: '21' } });
        fireEvent.click(screen.getByTestId('criteria-surface-paved'));
        fireEvent.click(screen.getByTestId('criteria-elevation-target'));
        fireEvent.change(screen.getByTestId('criteria-gain'), { target: { value: '450' } });

        expect(kept()).toBeUndefined();

        await submit();
        await screen.findByTestId('routes-count');

        expect(kept()).toMatchObject({ distance: 21, surface: 'paved', level: 'target', gain: 450 });
      });

      it('are kept by a new search once routes were found', async () => {
        onDesktop();
        stubFetch(() => Promise.resolve(answer(route(0))));
        render(<CriteriaView language="en" />);
        await submit();
        await screen.findByTestId('routes-count');

        fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));
        fireEvent.change(screen.getByTestId('criteria-distance'), { target: { value: '21' } });
        expect(kept()).toBeUndefined();
        fireEvent.click(screen.getByTestId('criteria-submit'));

        expect(kept()).toMatchObject({ surface: 'unpaved', distance: 21 });
      });
    });

    it('compares the criteria to the routes still shown after a search that failed', async () => {
      onDesktop();
      const answers = [answer(route(0)), Response.json({ error: 'rate-limited' }, { status: 429 })];
      stubFetch(() => Promise.resolve(answers.shift()!));
      render(<CriteriaView language="en" />);
      await submit();
      await screen.findByTestId('routes-count');
      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));
      fireEvent.click(screen.getByTestId('criteria-submit'));
      await screen.findByTestId('routes-toast');

      // The routes that came back are those of the first criteria: they still do not match the form.
      expect(screen.getByTestId('routes-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('routes-stale')).toBeInTheDocument();
    });

    it('does not call the routes stale when the pace unit changes', async () => {
      onDesktop();
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submit();
      await screen.findByTestId('routes-count');

      const settings = renderHook(() => useSettings());
      act(() => settings.result.current[1]({ paceUnit: 'km/h' }));

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
      expect(screen.queryByTestId('criteria-submit')).not.toBeInTheDocument();
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
      setStartPoint();
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

    async function submitOnPhone() {
      fireEvent.click(screen.getByTestId('criteria-bar'));
      await submit();
    }

    it('shows the routes as a carousel in the sheet on phones, the first one in the middle', async () => {
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submitOnPhone();

      expect(await screen.findByTestId('routes-count')).toHaveTextContent('2 routes');
      expect(screen.getByTestId('routes-row-0')).toHaveAttribute('data-selected');
      expect(screen.getByTestId('criteria-sheet-handle')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTestId('criteria-sheet-handle')).toHaveAccessibleName(routesText.en.routes);
      // The criteria stay a tap away, in the bar.
      expect(screen.getByTestId('criteria-bar')).toBeInTheDocument();
      expect(screen.queryByTestId('criteria-open')).not.toBeInTheDocument();
    });

    it('selects the route of the card tapped, and opens the detail of the one in the middle', async () => {
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submitOnPhone();
      fireEvent.click(await screen.findByTestId('routes-row-1'));
      await settle();

      expect(screen.getByTestId('routes-row-1')).toHaveAttribute('data-selected');
      expect(screen.queryByTestId('route-detail')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('routes-row-1'));

      expect(screen.getByTestId('route-detail')).toBeInTheDocument();
      expect(screen.getByTestId('route-position')).toHaveTextContent('2/2');
      expect(screen.getByTestId('route-profile')).toBeInTheDocument();
      expect(screen.getByTestId('criteria-sheet-handle')).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens and closes the detail of the selected route from the handle of the sheet', async () => {
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submitOnPhone();
      await screen.findByTestId('routes-count');

      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));
      expect(screen.getByTestId('route-detail')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));
      expect(screen.getByTestId('routes-count')).toBeInTheDocument();
      expect(screen.queryByTestId('route-detail')).not.toBeInTheDocument();
    });

    it('goes back to the carousel from the detail', async () => {
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submitOnPhone();
      await screen.findByTestId('routes-count');
      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));

      fireEvent.click(screen.getByTestId('route-back'));

      expect(screen.getByTestId('routes-list')).toBeInTheDocument();
      expect(screen.getByTestId('criteria-sheet-handle')).toHaveAttribute('aria-expanded', 'false');
    });

    it('hides the floating buttons over the map while the detail is open, which takes the room', async () => {
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submitOnPhone();
      await screen.findByTestId('routes-count');
      act(() => map().rotateTo(30));
      expect(screen.getByTestId('criteria-north')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));

      expect(screen.queryByTestId('criteria-north')).not.toBeInTheDocument();
      expect(screen.queryByTestId('criteria-locate')).not.toBeInTheDocument();
    });

    it('moves the carousel to the route tapped on the map', async () => {
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submitOnPhone();
      await screen.findByTestId('routes-count');
      await settle();

      act(() => map().fire('click', { features: [{ properties: { index: 1 } }] }, 'routes-hit'));

      expect(screen.getByTestId('routes-row-1')).toHaveAttribute('data-selected');
    });

    it('frames the route selected clear of the sheet, which draws the others as well', async () => {
      ask(answer(route(0), route(1)));
      render(<CriteriaView language="en" />);
      act(() => map().fire('style.load'));
      await submitOnPhone();
      await screen.findByTestId('routes-count');
      await settle();

      fireEvent.click(screen.getByTestId('routes-row-1'));
      await settle();

      expect(routesSource()).toHaveLength(2);
      expect(map().fitted?.options).toMatchObject({ padding: expect.objectContaining({ top: 24, bottom: 24 }) });
    });

    it('calls the routes stale in the sheet once the criteria changed', async () => {
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submitOnPhone();
      await screen.findByTestId('routes-count');
      expect(screen.queryByTestId('routes-stale')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-bar'));
      fireEvent.click(screen.getByTestId('criteria-surface-unpaved'));
      fireEvent.click(screen.getByTestId('sub-page-back'));

      expect(screen.getByTestId('routes-stale')).toHaveTextContent(routesText.en.stale);
      expect(screen.getByTestId('routes-row-0')).toBeInTheDocument();
    });

    it('cancels a search from the sheet', async () => {
      ask(new Promise(() => {}));
      render(<CriteriaView language="en" />);
      await submitOnPhone();

      expect(screen.getByTestId('routes-loading')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('routes-cancel'));

      expect(screen.queryByTestId('routes-loading')).not.toBeInTheDocument();
      expect(screen.getByTestId('criteria-open')).toBeInTheDocument();
    });

    it('drops the routes found when a new start point is typed in the layer', async () => {
      ask(answer(route(0)));
      render(<CriteriaView language="en" />);
      await submitOnPhone();
      await screen.findByTestId('routes-count');

      fireEvent.click(screen.getByTestId('criteria-bar'));
      fireEvent.change(field(), { target: { value: '45.9, 6.3' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('sub-page-back'));

      expect(screen.queryByTestId('routes-list')).not.toBeInTheDocument();
      expect(screen.getByTestId('criteria-open')).toBeInTheDocument();
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
      fireEvent.click(screen.getByTestId('criteria-bar'));
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('criteria-submit'));
      await screen.findByTestId('routes-count');
      expectNamedControls(container);

      fireEvent.click(screen.getByTestId('criteria-sheet-handle'));

      expectNamedControls(container);
    });
  });

  describe('waypoints', () => {
    const waypointButton = () => screen.getByTestId('criteria-waypoint');
    const banner = () => screen.getByTestId('criteria-waypoint-bar');
    const setStart = () => {
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
    };
    const route = {
      geometry: [
        [6.2, 45.8, 450],
        [6.21, 45.81, 480],
      ],
      distance: 10,
      elevationGain: 30,
      estimatedDuration: 70,
      kind: 'match',
      unpavedShare: 0.3,
      surfaces: [{ surface: 'paved', from: 0, to: 10 }],
      technical: false,
      technicalStretches: [],
    };
    const startPlacing = () => {
      setStart();
      fireEvent.click(waypointButton());
    };
    const lastRequest = (fetchMock: ReturnType<typeof vi.fn>) =>
      JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string) as Record<string, unknown>;

    beforeEach(() => onDesktop());

    it('shows the button once a start point is set', () => {
      render(<CriteriaView language="en" />);
      expect(screen.queryByTestId('criteria-waypoint')).not.toBeInTheDocument();

      setStart();

      expect(waypointButton()).toHaveAccessibleName(en.addWaypoint);
    });

    it('is named in French', () => {
      render(<CriteriaView language="fr" />);
      setStart();

      expect(waypointButton()).toHaveAccessibleName(fr.addWaypoint);
    });

    it('asks for the next waypoint in a banner, and places one on each tap', () => {
      render(<CriteriaView language="en" />);
      startPlacing();
      expect(banner()).toHaveTextContent(en.placeWaypoint);
      expect(waypointButton()).toHaveAttribute('aria-pressed', 'true');

      place(6.21, 45.81);
      place(6.22, 45.82);

      expect(banner()).toHaveTextContent(en.placeWaypoint);
      expect(waypointMarkers().map((marker) => [marker.options?.element?.textContent, marker.position])).toEqual([
        ['1', [6.21, 45.81]],
        ['2', [6.22, 45.82]],
      ]);
    });

    it('ends with Done, with the button again, or with Escape', () => {
      render(<CriteriaView language="en" />);
      startPlacing();

      fireEvent.click(screen.getByTestId('criteria-waypoint-done'));
      expect(screen.queryByTestId('criteria-waypoint-bar')).not.toBeInTheDocument();

      fireEvent.click(waypointButton());
      fireEvent.click(waypointButton());
      expect(screen.queryByTestId('criteria-waypoint-bar')).not.toBeInTheDocument();

      fireEvent.click(waypointButton());
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('criteria-waypoint-bar')).not.toBeInTheDocument();
    });

    it('stops placing at the fifth waypoint, and disables the button then', () => {
      render(<CriteriaView language="en" />);
      startPlacing();

      for (let k = 1; k <= 6; k++) place(6.2 + k / 100, 45.8);

      expect(screen.queryByTestId('criteria-waypoint-bar')).not.toBeInTheDocument();
      expect(waypointMarkers()).toHaveLength(5);
      expect(waypointButton()).toBeDisabled();
    });

    it('places no waypoint on the veiled part of the map, where the server cannot route', async () => {
      vi.stubGlobal('fetch', (url: string) =>
        url === '/api/v1/coverage'
          ? Promise.resolve(Response.json({ cells: [[6, 45.7, 6.3, 45.9]] }))
          : new Promise(() => {}),
      );
      render(<CriteriaView language="en" />);
      startPlacing();
      await act(async () => {});

      place(2.3, 48.8);
      place(6.21, 45.81);

      expect(waypointMarkers().map((marker) => marker.position)).toEqual([[6.21, 45.81]]);
    });

    it('says so under the banner when a tap falls on the veiled part of the map', async () => {
      vi.stubGlobal('fetch', (url: string) =>
        url === '/api/v1/coverage'
          ? Promise.resolve(Response.json({ cells: [[6, 45.7, 6.3, 45.9]] }))
          : new Promise(() => {}),
      );
      render(<CriteriaView language="en" />);
      startPlacing();
      await act(async () => {});

      // A region that is there from the start, so that what it says is announced.
      expect(screen.getByTestId('criteria-waypoint-refused')).toBeEmptyDOMElement();

      place(2.3, 48.8);
      expect(screen.getByTestId('criteria-waypoint-refused')).toHaveTextContent(en.waypointUncovered);
      expect(banner()).toHaveTextContent(en.placeWaypoint);

      place(6.21, 45.81);
      expect(screen.getByTestId('criteria-waypoint-refused')).toBeEmptyDOMElement();
    });

    it('refuses the same point of interest read a few metres off, as the map does at another zoom', async () => {
      render(<CriteriaView language="en" />);
      startPlacing();
      await act(async () => {});
      act(() => map().fire('style.load'));
      const tap = (coordinates: [number, number]) => {
        map().rendered = [{ properties: { category: 'water', seasonal: false }, geometry: { coordinates } }];
        act(() => map().fire('click', { lngLat: { lng: 6.21, lat: 45.81 }, point: { x: 1, y: 1 } }));
      };

      tap([6.21, 45.81]);
      tap([6.21, 45.81003]);

      expect(waypointMarkers()).toHaveLength(1);
      expect(screen.getByTestId('criteria-waypoint-refused')).toHaveTextContent(en.waypointDuplicate);
    });

    it('refuses a point of interest that already is a waypoint, and says so', async () => {
      render(<CriteriaView language="en" />);
      startPlacing();
      await act(async () => {});
      act(() => map().fire('style.load'));
      map().rendered = [
        { properties: { category: 'water', seasonal: false }, geometry: { coordinates: [6.21, 45.81] } },
      ];

      act(() => map().fire('click', { lngLat: { lng: 6.2101, lat: 45.8101 }, point: { x: 1, y: 1 } }));
      expect(screen.getByTestId('criteria-waypoint-refused')).toBeEmptyDOMElement();
      act(() => map().fire('click', { lngLat: { lng: 6.2099, lat: 45.8099 }, point: { x: 1, y: 1 } }));

      expect(waypointMarkers().map((marker) => marker.position)).toEqual([[6.21, 45.81]]);
      expect(screen.getByTestId('criteria-waypoint-refused')).toHaveTextContent(en.waypointDuplicate);
    });

    describe('listed under the criteria', () => {
      const placeThree = () => {
        startPlacing();
        place(6.21, 45.81);
        place(6.22, 45.82);
        place(6.23, 45.83);
      };

      it('has the button to add a waypoint in its header, and none over the map', () => {
        render(<CriteriaView language="en" />);

        setStart();

        expect(
          within(screen.getByTestId('criteria-waypoint-list')).getByTestId('criteria-waypoint'),
        ).toHaveAccessibleName(en.addWaypoint);
        expect(items()).toHaveLength(0);
        expect(document.querySelectorAll('[data-testid="criteria-waypoint"]')).toHaveLength(1);
      });

      it('names a waypoint made from a point of interest after it', async () => {
        render(<CriteriaView language="fr" />);
        startPlacing();
        await act(async () => {});
        act(() => map().fire('style.load'));
        map().rendered = [
          {
            properties: { category: 'water', seasonal: false, name: 'Fontaine du Roi' },
            geometry: { coordinates: [6.21, 45.81] },
          },
        ];

        act(() => map().fire('click', { lngLat: { lng: 6.21, lat: 45.81 }, point: { x: 1, y: 1 } }));
        map().rendered = [];
        place(6.22, 45.82);

        expect(names()).toEqual(['Fontaine du Roi', fr.waypointLabel]);
      });

      it('removes a waypoint from the list and the map', () => {
        render(<CriteriaView language="en" />);
        placeThree();

        const remove = screen.getByTestId('criteria-waypoint-item-2-remove');
        expect(remove).toHaveAccessibleName(en.removeWaypointNamed(en.waypointName(2)));

        fireEvent.click(remove);

        expect(waypointMarkers().map((marker) => marker.position)).toEqual([
          [6.21, 45.81],
          [6.23, 45.83],
        ]);
        expect(items()).toHaveLength(2);
      });

      it('centers the map on a waypoint when its row is clicked', () => {
        render(<CriteriaView language="en" />);
        placeThree();

        fireEvent.click(screen.getByTestId('criteria-waypoint-item-2-name'));

        expect(map().easedTo).toMatchObject({ center: [6.22, 45.82] });
      });

      const button = (number: number, which: 'up' | 'down') =>
        screen.getByTestId(`criteria-waypoint-item-${number}-${which}`);
      const positions = () => waypointMarkers().map((marker) => marker.position);

      it('keeps two waypoints at the same position apart', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<CriteriaView language="en" />);
        startPlacing();
        place(6.21, 45.81);
        place(6.21, 45.81);
        place(6.22, 45.82);

        fireEvent.click(button(3, 'up'));

        expect(items()).toHaveLength(3);
        expect(positions()).toEqual([
          [6.21, 45.81],
          [6.22, 45.82],
          [6.21, 45.81],
        ]);
        expect(error).not.toHaveBeenCalled();
      });

      it('moves the focus to the other arrow of a waypoint that reaches an end', () => {
        render(<CriteriaView language="en" />);
        placeThree();

        button(2, 'down').focus();
        fireEvent.click(button(2, 'down'));

        expect(button(3, 'up')).toHaveFocus();
      });

      it('moves a waypoint down, and up, with its buttons', () => {
        render(<CriteriaView language="en" />);
        placeThree();

        fireEvent.click(button(1, 'down'));

        expect(positions()).toEqual([
          [6.22, 45.82],
          [6.21, 45.81],
          [6.23, 45.83],
        ]);

        fireEvent.click(button(3, 'up'));

        expect(positions()).toEqual([
          [6.22, 45.82],
          [6.23, 45.83],
          [6.21, 45.81],
        ]);
      });

      it('says where a moved waypoint now stands', () => {
        render(<CriteriaView language="en" />);
        placeThree();

        fireEvent.click(button(1, 'down'));

        expect(screen.getByTestId('criteria-waypoint-announcement')).toHaveTextContent(en.waypointMoved(2));
      });

      it('stops saying a waypoint moved once it is removed', () => {
        render(<CriteriaView language="en" />);
        placeThree();
        fireEvent.click(button(1, 'down'));

        fireEvent.click(screen.getByTestId('criteria-waypoint-item-2-remove'));

        expect(screen.getByTestId('criteria-waypoint-announcement')).toBeEmptyDOMElement();
      });

      it('says it again when a waypoint moves to the position the last one reached', () => {
        render(<CriteriaView language="en" />);
        placeThree();
        fireEvent.click(button(1, 'down'));
        const announcement = screen.getByTestId('criteria-waypoint-announcement');
        const first = announcement.firstElementChild;

        fireEvent.click(button(3, 'up'));

        expect(announcement).toHaveTextContent(en.waypointMoved(2));
        expect(announcement.firstElementChild).not.toBe(first);
      });

      it('has no button to move the first waypoint up or the last one down', () => {
        render(<CriteriaView language="en" />);
        placeThree();

        expect(button(1, 'up')).toBeDisabled();
        expect(button(3, 'down')).toBeDisabled();
      });

      it('names the buttons after their waypoint', () => {
        render(<CriteriaView language="fr" />);
        placeThree();

        expect(button(2, 'up')).toHaveAccessibleName(fr.moveWaypointUp(fr.waypointName(2)));
        expect(button(2, 'down')).toHaveAccessibleName(fr.moveWaypointDown(fr.waypointName(2)));
      });

      it('has no handle to drag', () => {
        render(<CriteriaView language="en" />);
        placeThree();

        expect(screen.queryByTestId('criteria-waypoint-item-1-handle')).not.toBeInTheDocument();
      });

      it('asks for the routes through the waypoints in their new order', () => {
        const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise(() => {}));
        stubFetch(fetchMock);
        render(<CriteriaView language="en" />);
        placeThree();
        fireEvent.click(screen.getByTestId('criteria-waypoint-done'));

        fireEvent.click(button(1, 'down'));
        fireEvent.click(screen.getByTestId('criteria-submit'));

        expect(lastRequest(fetchMock).waypoints).toEqual([
          [6.22, 45.82],
          [6.21, 45.81],
          [6.23, 45.83],
        ]);
      });
    });

    it('does not say a tap was refused once placing starts again', async () => {
      vi.stubGlobal('fetch', (url: string) =>
        url === '/api/v1/coverage'
          ? Promise.resolve(Response.json({ cells: [[6, 45.7, 6.3, 45.9]] }))
          : new Promise(() => {}),
      );
      render(<CriteriaView language="en" />);
      startPlacing();
      await act(async () => {});
      place(2.3, 48.8);

      fireEvent.click(screen.getByTestId('criteria-waypoint-done'));
      fireEvent.click(waypointButton());

      expect(screen.getByTestId('criteria-waypoint-refused')).toBeEmptyDOMElement();
    });

    it('stops placing once the search starts', () => {
      stubFetch(() => new Promise(() => {}));
      render(<CriteriaView language="en" />);
      startPlacing();

      fireEvent.click(screen.getByTestId('criteria-submit'));

      expect(screen.queryByTestId('criteria-waypoint-bar')).not.toBeInTheDocument();
    });

    it('keeps placing when the start point is typed meanwhile', () => {
      render(<CriteriaView language="en" />);
      startPlacing();

      fireEvent.change(field(), { target: { value: '45.9, 6.3' } });
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(banner()).toBeInTheDocument();
    });

    it('does not move the start point while placing', () => {
      render(<CriteriaView language="en" />);
      startPlacing();

      place(6.5, 45.5);

      expect(field()).toHaveValue('45.8000° N · 6.2000° E');
    });

    it('stops picking the start point on the map when placing starts, and the other way round', () => {
      render(<CriteriaView language="en" />);
      setStart();
      fireEvent.click(screen.getByTestId('criteria-start-pick'));

      fireEvent.click(waypointButton());
      expect(screen.getByTestId('criteria-start-pick')).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(screen.getByTestId('criteria-start-pick'));
      expect(screen.queryByTestId('criteria-waypoint-bar')).not.toBeInTheDocument();
    });

    it('removes a waypoint from the bubble of its marker, and numbers the others again', () => {
      render(<CriteriaView language="en" />);
      startPlacing();
      place(6.21, 45.81);
      place(6.22, 45.82);
      place(6.23, 45.83);
      fireEvent.click(screen.getByTestId('criteria-waypoint-done'));

      act(() => waypointMarkers()[1]!.options!.element!.click());
      act(() => popups.at(-1)!.content!.click());

      expect(waypointMarkers().map((marker) => [marker.options?.element?.textContent, marker.position])).toEqual([
        ['1', [6.21, 45.81]],
        ['2', [6.23, 45.83]],
      ]);
    });

    it('sends the waypoints with the criteria, in the order they were placed', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(Response.json({ routes: [route] })));
      stubFetch(fetchMock);
      render(<CriteriaView language="en" />);
      startPlacing();
      place(6.23, 45.83);
      place(6.21, 45.81);

      fireEvent.click(screen.getByTestId('criteria-submit'));

      await screen.findByTestId('routes-count');
      expect(lastRequest(fetchMock).waypoints).toEqual([
        [6.23, 45.83],
        [6.21, 45.81],
      ]);
    });

    it('sends no waypoints when none is placed', async () => {
      const fetchMock = vi.fn(() => Promise.resolve(Response.json({ routes: [route] })));
      stubFetch(fetchMock);
      render(<CriteriaView language="en" />);
      setStart();

      fireEvent.click(screen.getByTestId('criteria-submit'));

      await screen.findByTestId('routes-count');
      expect(lastRequest(fetchMock)).not.toHaveProperty('waypoints');
    });

    it('keeps the waypoint list once the routes are found', async () => {
      stubFetch(() => Promise.resolve(Response.json({ routes: [route] })));
      render(<CriteriaView language="en" />);
      startPlacing();
      place(6.21, 45.81);
      place(6.22, 45.82);
      fireEvent.click(screen.getByTestId('criteria-submit'));

      await screen.findByTestId('routes-count');

      expect(screen.getByTestId('criteria-waypoint-list')).toBeInTheDocument();
    });

    it('numbers the waypoints on the elevation profile of the route selected', async () => {
      stubFetch(() => Promise.resolve(Response.json({ routes: [route] })));
      render(<CriteriaView language="en" />);
      startPlacing();
      place(6.21, 45.81);
      fireEvent.click(screen.getByTestId('criteria-submit'));
      await screen.findByTestId('routes-count');

      fireEvent.click(await screen.findByTestId('routes-row-0'));

      expect(await screen.findByTestId('route-profile-waypoint-1')).toBeInTheDocument();
    });

    describe('with routes found', () => {
      const found = async () => {
        stubFetch(() => Promise.resolve(Response.json({ routes: [route] })));
        render(<CriteriaView language="en" />);
        startPlacing();
        place(6.21, 45.81);
        place(6.22, 45.82);
        fireEvent.click(screen.getByTestId('criteria-waypoint-done'));
        fireEvent.click(screen.getByTestId('criteria-submit'));
        await screen.findByTestId('routes-count');
      };

      it('keeps the waypoints listed, to be changed', async () => {
        await found();

        expect(screen.getAllByTestId(/^criteria-waypoint-item-\d+$/)).toHaveLength(2);
        expect(screen.getByTestId('criteria-waypoint')).toBeEnabled();
      });

      it('keeps the routes, and says they are stale, once a waypoint is removed', async () => {
        await found();

        fireEvent.click(screen.getByTestId('criteria-waypoint-item-2-remove'));

        expect(screen.getByTestId('routes-count')).toBeInTheDocument();
        expect(screen.getByTestId('routes-stale')).toBeInTheDocument();
      });

      it('keeps the routes, and says they are stale, once a waypoint is moved', async () => {
        await found();

        fireEvent.click(screen.getByTestId('criteria-waypoint-item-1-down'));

        expect(screen.getByTestId('routes-count')).toBeInTheDocument();
        expect(screen.getByTestId('routes-stale')).toBeInTheDocument();
      });

      it('closes the dock of the route selected once a waypoint is changed, and keeps the routes', async () => {
        await found();
        fireEvent.click(await screen.findByTestId('routes-row-0'));
        expect(await screen.findByTestId('route-dock')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('criteria-waypoint-item-1-down'));

        expect(screen.queryByTestId('route-dock')).not.toBeInTheDocument();
        expect(screen.getByTestId('routes-count')).toBeInTheDocument();
      });

      it('keeps the routes while a waypoint is added, and searches again with it', async () => {
        await found();

        fireEvent.click(screen.getByTestId('criteria-waypoint'));
        place(6.23, 45.83);

        expect(screen.getByTestId('routes-count')).toBeInTheDocument();
        expect(screen.getAllByTestId(/^criteria-waypoint-item-\d+$/)).toHaveLength(3);
        expect(screen.getByTestId('criteria-submit')).toHaveTextContent(en.searchAgain);
      });
    });

    describe.each(['en', 'fr'] as const)('the refusals of the API, in %s', (language) => {
      const t = routesText[language];
      const refuse = async (body: object) => {
        stubFetch(() => Promise.resolve(Response.json({ error: 'invalid-criteria', ...body }, { status: 400 })));
        render(<CriteriaView language={language} />);
        startPlacing();
        place(6.21, 45.81);
        fireEvent.click(screen.getByTestId('criteria-submit'));
        return screen.findByTestId('routes-toast');
      };

      it('names the waypoint that is too far from a way', async () => {
        expect(await refuse({ field: 'waypoints', waypoint: 2 })).toHaveTextContent(t.waypointTooFar(2));
      });

      it('says the start point is too far from a way', async () => {
        expect(await refuse({ field: 'start' })).toHaveTextContent(t.startTooFar);
      });

      it('says the waypoints make too long a route, or that no way joins them', async () => {
        expect(await refuse({ field: 'waypoints' })).toHaveTextContent(t.waypointsUnreachable);
      });
    });
  });

  describe('waypoints on a phone', () => {
    const placeThenOpenCriteria = (count: number) => {
      fireEvent.click(screen.getByTestId('criteria-bar'));
      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('sub-page-back'));
      fireEvent.click(screen.getByTestId('criteria-waypoint'));
      for (const [lng, lat] of [
        [6.21, 45.81],
        [6.22, 45.82],
        [6.23, 45.83],
      ].slice(0, count)) {
        place(lng!, lat!);
      }
      fireEvent.click(screen.getByTestId('criteria-waypoint-done'));
      fireEvent.click(screen.getByTestId('criteria-open'));
    };

    it('lists them in the criteria, between the last criterion and the search button', () => {
      render(<CriteriaView language="en" />);

      placeThenOpenCriteria(2);

      const list = screen.getByTestId('criteria-waypoint-list');
      expect(names()).toEqual([en.waypointLabel, en.waypointLabel]);
      expect(list.nextElementSibling).toBe(screen.getByTestId('criteria-submit'));
    });

    it('shows how many waypoints are set out of the maximum', () => {
      render(<CriteriaView language="en" />);

      placeThenOpenCriteria(2);

      expect(screen.getByTestId('criteria-waypoint-count')).toHaveTextContent(`2/${MAX_WAYPOINTS}`);
      expect(screen.getByTestId('criteria-waypoint-count')).toHaveTextContent(en.countOfMax(2, MAX_WAYPOINTS));
    });

    it('has no section without waypoints', () => {
      render(<CriteriaView language="en" />);

      placeThenOpenCriteria(0);

      expect(screen.queryByTestId('criteria-waypoint-list')).not.toBeInTheDocument();
    });

    it('moves a waypoint down and removes another', () => {
      render(<CriteriaView language="en" />);
      placeThenOpenCriteria(3);

      fireEvent.click(screen.getByTestId('criteria-waypoint-item-1-down'));
      fireEvent.click(screen.getByTestId('criteria-waypoint-item-3-remove'));

      expect(items()).toHaveLength(2);
      expect(waypointMarkers().map((marker) => marker.position)).toEqual([
        [6.22, 45.82],
        [6.21, 45.81],
      ]);
    });

    it('keeps the one button to add a waypoint, the one over the map', () => {
      render(<CriteriaView language="en" />);

      placeThenOpenCriteria(2);

      expect(document.querySelectorAll('[data-testid="criteria-waypoint"]')).toHaveLength(1);
      expect(screen.getByTestId('criteria-waypoint-list')).not.toContainElement(
        screen.getByTestId('criteria-waypoint'),
      );
    });

    it('does not offer to centre the map on a waypoint', () => {
      render(<CriteriaView language="en" />);
      placeThenOpenCriteria(2);

      expect(screen.getByTestId('criteria-waypoint-item-1-name').tagName).not.toBe('BUTTON');
    });
  });
});
