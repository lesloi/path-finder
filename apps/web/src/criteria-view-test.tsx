import { act, fireEvent, render, screen } from '@testing-library/react';

import { CriteriaView } from './criteria-view.tsx';
import { maps, markers } from './maplibre-mock.ts';

vi.mock('maplibre-gl', () => import('./maplibre-mock.ts'));

const map = () => maps.at(-1)!;
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

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '#/settings');
  });

  describe('on phones', () => {
    it('invites a long press in the sheet until the start point is set', () => {
      vi.useFakeTimers();
      render(<CriteriaView language="en" />);
      expect(screen.getByRole('button', { name: 'Criteria' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('Long-press the map to choose your start point')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'My location' })).toHaveLength(2);

      act(() => {
        map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: { touches: [{}] } });
        vi.advanceTimersByTime(600);
      });
      vi.useRealTimers();

      expect(screen.queryByText('Long-press the map to choose your start point')).not.toBeInTheDocument();
      expect(markers.at(-1)).toMatchObject({ position: [6.2, 45.8], shown: true });
    });
  });

  describe('on desktops', () => {
    it('picks the start point with a click on the map once its block is pressed', () => {
      onDesktop();
      render(<CriteriaView language="en" />);
      const block = screen.getByRole('button', { name: /^Start point/ });
      expect(block).toHaveTextContent('Choose on the map');

      act(() => map().fire('click', { lngLat: { lng: 6.2, lat: 45.8 } }));
      expect(markers).toEqual([]);

      fireEvent.click(block);
      expect(block).toHaveAttribute('aria-pressed', 'true');
      expect(block).toHaveTextContent('Click the map');

      act(() => map().fire('click', { lngLat: { lng: 6.2, lat: -45.8 } }));

      expect(block).toHaveAttribute('aria-pressed', 'false');
      expect(block).toHaveTextContent('45.8000° S · 6.2000° E');
      expect(markers.at(-1)).toMatchObject({ position: [6.2, -45.8], shown: true });
    });

    it('shows the start point coordinates in French', () => {
      onDesktop();
      render(<CriteriaView language="fr" />);
      const block = screen.getByRole('button', { name: /^Point de départ/ });

      fireEvent.click(block);
      act(() => map().fire('click', { lngLat: { lng: -1.5, lat: 47.2 } }));

      expect(block).toHaveTextContent('47,2000° N · 1,5000° O');
    });

    it('keeps the start point on a long press', () => {
      vi.useFakeTimers();
      onDesktop();
      render(<CriteriaView language="en" />);

      act(() => {
        map().fire('mousedown', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: { button: 0 } });
        vi.advanceTimersByTime(600);
      });
      vi.useRealTimers();

      expect(markers).toEqual([]);
    });

    it('shows the logo and no sheet', () => {
      onDesktop();
      render(<CriteriaView language="en" />);

      expect(screen.getByText('Path finder')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Criteria' })).not.toBeInTheDocument();
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

      fireEvent.click(screen.getAllByRole('button', { name: 'My location' })[0]);

      expect(markers.at(-1)).toMatchObject({ position: [5.7, 45.2], shown: true });
      expect(map().easedTo).toEqual({ center: [5.7, 45.2], zoom: 14 });
    });

    it('shows a toast inviting a long press when the location is refused', () => {
      refuse();
      render(<CriteriaView language="fr" />);

      fireEvent.click(screen.getAllByRole('button', { name: 'Ma position' })[0]);

      expect(screen.getByRole('alert')).toHaveTextContent(/appuyez longuement sur la carte/i);
      expect(markers).toEqual([]);
    });

    it('shows a toast inviting a pick on the map on desktops', () => {
      onDesktop();
      refuse();
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getAllByRole('button', { name: 'My location' })[0]);

      expect(screen.getByRole('alert')).toHaveTextContent(/press Start point, then click the map/i);
    });

    it('shows a toast when the browser has no geolocation', () => {
      Reflect.deleteProperty(navigator, 'geolocation');
      render(<CriteriaView language="en" />);

      fireEvent.click(screen.getAllByRole('button', { name: 'My location' })[0]);

      expect(screen.getByRole('alert')).toHaveTextContent(/long-press the map/i);
    });

    it('drops the toast once the start point is set', () => {
      vi.useFakeTimers();
      refuse();
      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getAllByRole('button', { name: 'My location' })[0]);

      act(() => {
        map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: { touches: [{}] } });
        vi.advanceTimersByTime(600);
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('drops the toast after a few seconds', () => {
      vi.useFakeTimers();
      refuse();
      render(<CriteriaView language="en" />);
      fireEvent.click(screen.getAllByRole('button', { name: 'My location' })[0]);

      act(() => vi.advanceTimersByTime(6_000));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
