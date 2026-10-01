import { act, fireEvent, render, screen } from '@testing-library/react';

import { CriteriaView } from './criteria-view.tsx';
import { expectNamedControls } from '../accessible-names.ts';
import { criteriaText } from '../i18n/index.ts';
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
      const onSubmit = vi.fn();
      render(<CriteriaView language="en" onSubmit={onSubmit} />);
      expect(screen.queryByTestId('criteria-submit')).not.toBeInTheDocument();

      fireEvent.change(field(), { target: { value: '45.8, 6.2' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.click(screen.getByTestId('criteria-submit'));

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ start: [6.2, 45.8], activity: 'run' }));
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
});
