import { act, fireEvent, render, screen } from '@testing-library/react';

import { StartPointMap } from './start-point-map.tsx';

// jsdom has no WebGL: a stand-in map records its handlers so tests can fire map events.
type MapOptions = { attributionControl: { customAttribution: string[] } };
const maps = vi.hoisted(() => [] as { options: MapOptions; fire: (type: string, event?: object) => void }[]);
const markers = vi.hoisted(() => [] as { position?: unknown; shown: boolean }[]);

vi.mock('maplibre-gl', () => {
  class Map {
    handlers: Record<string, ((event: object) => void)[]> = {};
    options: MapOptions;
    constructor(options: MapOptions) {
      this.options = options;
      maps.push(this);
    }
    on(type: string, handler: (event: object) => void) {
      (this.handlers[type] ??= []).push(handler);
    }
    fire(type: string, event: object = {}) {
      for (const handler of this.handlers[type] ?? []) handler(event);
    }
    addControl() {}
    easeTo() {}
    remove() {}
  }
  class Marker {
    position?: unknown;
    shown = false;
    constructor() {
      markers.push(this);
    }
    setLngLat(position: unknown) {
      this.position = position;
      return this;
    }
    addTo() {
      this.shown = true;
      return this;
    }
    remove() {
      this.shown = false;
    }
  }
  return { Map, Marker, AttributionControl: class {} };
});

const map = () => maps.at(-1)!;
const touch = { touches: [{}] };

beforeEach(() => {
  maps.length = 0;
  markers.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StartPointMap', () => {
  it('sets the start point on a long press', () => {
    const onStartChange = vi.fn();
    render(<StartPointMap language="en" onStartChange={onStartChange} />);

    act(() => {
      map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: touch });
      vi.advanceTimersByTime(600);
    });

    expect(onStartChange).toHaveBeenCalledWith([6.2, 45.8]);
  });

  it('sets the start point on a long mouse press', () => {
    const onStartChange = vi.fn();
    render(<StartPointMap language="en" onStartChange={onStartChange} />);

    act(() => {
      map().fire('mousedown', { lngLat: { lng: 2.3, lat: 48.8 }, originalEvent: { button: 0 } });
      vi.advanceTimersByTime(600);
    });

    expect(onStartChange).toHaveBeenCalledWith([2.3, 48.8]);
  });

  it('keeps the start point on a two-finger press', () => {
    const onStartChange = vi.fn();
    render(<StartPointMap language="en" onStartChange={onStartChange} />);

    act(() => {
      map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: { touches: [{}, {}] } });
      vi.advanceTimersByTime(600);
    });

    expect(onStartChange).not.toHaveBeenCalled();
  });

  it.each([
    ['a tap', 'touchend'],
    ['a click', 'mouseup'],
    ['a pan', 'movestart'],
    ['a cancelled touch', 'touchcancel'],
    ['a box zoom', 'boxzoomstart'],
  ])('keeps the start point on %s', (_, interruption) => {
    const onStartChange = vi.fn();
    render(<StartPointMap language="en" onStartChange={onStartChange} />);

    act(() => {
      map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: touch });
      vi.advanceTimersByTime(200);
      map().fire(interruption);
      vi.advanceTimersByTime(600);
    });

    expect(onStartChange).not.toHaveBeenCalled();
  });

  it('credits IGN and OpenStreetMap', () => {
    render(<StartPointMap language="en" onStartChange={vi.fn()} />);

    const credits = map().options.attributionControl.customAttribution.join(' ');
    expect(credits).toMatch(/IGN/);
    expect(credits).toMatch(/OpenStreetMap/);
  });

  it('shows the start point on the map', () => {
    const { rerender } = render(<StartPointMap language="en" onStartChange={vi.fn()} />);
    expect(markers.filter((marker) => marker.shown)).toEqual([]);

    rerender(<StartPointMap language="en" start={[6.2, 45.8]} onStartChange={vi.fn()} />);
    rerender(<StartPointMap language="en" start={[6.3, 45.9]} onStartChange={vi.fn()} />);

    expect(markers.filter((marker) => marker.shown)).toEqual([
      expect.objectContaining({ position: [6.3, 45.9] }),
    ]);
  });

  describe('my location', () => {
    const getCurrentPosition = vi.fn();

    beforeEach(() => {
      getCurrentPosition.mockReset();
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    });

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'geolocation');
    });

    it('is not asked for on load', () => {
      render(<StartPointMap language="en" onStartChange={vi.fn()} />);

      expect(getCurrentPosition).not.toHaveBeenCalled();
    });

    it('sets the start point to the device location', () => {
      getCurrentPosition.mockImplementation((success: PositionCallback) =>
        success({ coords: { longitude: 5.7, latitude: 45.2 } } as GeolocationPosition),
      );
      const onStartChange = vi.fn();
      render(<StartPointMap language="en" onStartChange={onStartChange} />);

      fireEvent.click(screen.getByRole('button', { name: 'My location' }));

      expect(onStartChange).toHaveBeenCalledWith([5.7, 45.2]);
    });

    it('invites a long press when the location is refused', () => {
      getCurrentPosition.mockImplementation((_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
      );
      const onStartChange = vi.fn();
      render(<StartPointMap language="fr" onStartChange={onStartChange} />);

      fireEvent.click(screen.getByRole('button', { name: 'Ma position' }));

      expect(screen.getByRole('alert')).toHaveTextContent(/appuyez longuement sur la carte/i);
      expect(onStartChange).not.toHaveBeenCalled();
    });

    it('drops the message once the start point is set', () => {
      getCurrentPosition.mockImplementation((_: PositionCallback, failure: PositionErrorCallback) =>
        failure({ code: 1 } as GeolocationPositionError),
      );
      const { rerender } = render(<StartPointMap language="en" onStartChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'My location' }));

      rerender(<StartPointMap language="en" start={[6.2, 45.8]} onStartChange={vi.fn()} />);

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('invites a long press when the browser has no geolocation', () => {
      Reflect.deleteProperty(navigator, 'geolocation');
      render(<StartPointMap language="en" onStartChange={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'My location' }));

      expect(screen.getByRole('alert')).toHaveTextContent(/long-press the map/i);
    });
  });
});
