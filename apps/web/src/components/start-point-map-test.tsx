import { act, render } from '@testing-library/react';

import type { Position } from '../core/index.ts';
import { maps, markers, type GeoJSONSource } from '../maplibre-mock.ts';
import { StartPointMap } from './start-point-map.tsx';

vi.mock('maplibre-gl', () => import('../maplibre-mock.ts'));

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
    render(<StartPointMap onStartChange={onStartChange} />);

    act(() => {
      map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: touch });
      vi.advanceTimersByTime(600);
    });

    expect(onStartChange).toHaveBeenCalledWith([6.2, 45.8]);
  });

  it('sets the start point on a long mouse press', () => {
    const onStartChange = vi.fn();
    render(<StartPointMap onStartChange={onStartChange} />);

    act(() => {
      map().fire('mousedown', { lngLat: { lng: 2.3, lat: 48.8 }, originalEvent: { button: 0 } });
      vi.advanceTimersByTime(600);
    });

    expect(onStartChange).toHaveBeenCalledWith([2.3, 48.8]);
  });

  it('keeps the start point on a two-finger press', () => {
    const onStartChange = vi.fn();
    render(<StartPointMap onStartChange={onStartChange} />);

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
    render(<StartPointMap onStartChange={onStartChange} />);

    act(() => {
      map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: touch });
      vi.advanceTimersByTime(200);
      map().fire(interruption);
      vi.advanceTimersByTime(600);
    });

    expect(onStartChange).not.toHaveBeenCalled();
  });

  it('keeps the start point on a click unless picking by click', () => {
    const onStartChange = vi.fn();
    render(<StartPointMap onStartChange={onStartChange} />);

    act(() => map().fire('click', { lngLat: { lng: 6.2, lat: 45.8 } }));

    expect(onStartChange).not.toHaveBeenCalled();
  });

  it('sets the start point on a click while picking by click', () => {
    const onStartChange = vi.fn();
    render(<StartPointMap pickOnClick onStartChange={onStartChange} />);

    act(() => map().fire('click', { lngLat: { lng: 6.2, lat: 45.8 } }));

    expect(onStartChange).toHaveBeenCalledWith([6.2, 45.8]);
  });

  it('credits IGN and OpenStreetMap in a compact attribution', () => {
    render(<StartPointMap onStartChange={vi.fn()} />);

    const [attribution] = map().controls as { options: { compact: boolean; customAttribution: string[] } }[];
    expect(attribution.options.compact).toBe(true);
    expect(attribution.options.customAttribution.join(' ')).toMatch(/IGN.*OpenStreetMap/);
  });

  it('shows the start point on the map', () => {
    const { rerender } = render(<StartPointMap onStartChange={vi.fn()} />);
    expect(markers.filter((marker) => marker.shown)).toEqual([]);

    rerender(<StartPointMap start={[6.2, 45.8]} onStartChange={vi.fn()} />);
    rerender(<StartPointMap start={[6.3, 45.9]} onStartChange={vi.fn()} />);

    expect(markers.filter((marker) => marker.shown)).toEqual([expect.objectContaining({ position: [6.3, 45.9] })]);
  });

  it('moves the map to its focus', () => {
    const { rerender } = render(<StartPointMap onStartChange={vi.fn()} />);

    rerender(<StartPointMap focus={[5.7, 45.2]} onStartChange={vi.fn()} />);

    expect(map().easedTo).toEqual({ center: [5.7, 45.2], zoom: 14 });
  });

  describe('with routes', () => {
    const loop = (offset: number): Position[] => [
      [6 + offset, 45],
      [6.1 + offset, 45.2],
      [6 + offset, 45],
    ];
    const routes = [loop(0), loop(1), loop(2)];

    // The style loads, then the routes can be drawn.
    function renderRoutes(props: Partial<Parameters<typeof StartPointMap>[0]> = {}) {
      const view = render(<StartPointMap routes={routes} onStartChange={vi.fn()} {...props} />);
      act(() => map().fire('load'));
      return view;
    }

    const features = () =>
      (map().getSource('routes') as GeoJSONSource & { data: { features: { properties: object }[] } }).data.features;

    it('draws every route in its colour, the selected one last', () => {
      renderRoutes({ selectedRoute: 0 });

      expect(features().map(({ properties }) => properties)).toEqual([
        { index: 1, selected: false, color: '#2563eb' },
        { index: 2, selected: false, color: '#7a3fc4' },
        { index: 0, selected: true, color: '#e0115f' },
      ]);
    });

    it('draws nothing before the style has loaded', () => {
      render(<StartPointMap routes={routes} onStartChange={vi.fn()} />);

      expect(map().sources.routes).toBeUndefined();
    });

    it('draws a wide invisible line to hit the routes', () => {
      renderRoutes();

      expect(map().layers.map(({ id }) => id)).toEqual(['background', 'routes-casing', 'routes-line', 'routes-hit']);
    });

    it('selects the route that is tapped', () => {
      const onRouteSelect = vi.fn();
      renderRoutes({ onRouteSelect });

      act(() => map().fire('click', { features: [{ properties: { index: 2 } }] }, 'routes-hit'));

      expect(onRouteSelect).toHaveBeenCalledWith(2);
    });

    it('shows a pointer over a route', () => {
      renderRoutes();

      act(() => map().fire('mouseenter', {}, 'routes-hit'));
      expect(map().canvas.style.cursor).toBe('pointer');
      act(() => map().fire('mouseleave', {}, 'routes-hit'));
      expect(map().canvas.style.cursor).toBe('');
    });

    it('keeps the start point while routes are shown', () => {
      const onStartChange = vi.fn();
      renderRoutes({ pickOnClick: true, onStartChange });

      act(() => {
        map().fire('click', { lngLat: { lng: 6.2, lat: 45.8 } });
        map().fire('touchstart', { lngLat: { lng: 6.2, lat: 45.8 }, originalEvent: touch });
        vi.advanceTimersByTime(600);
      });

      expect(onStartChange).not.toHaveBeenCalled();
    });

    it('frames every route, clear of the sheet on phones', () => {
      document.documentElement.style.setProperty('--sheet-height', '300px');
      renderRoutes();

      expect(map().fitted).toEqual({
        bounds: [
          [6, 45],
          [8.1, 45.2],
        ],
        options: expect.objectContaining({ padding: expect.objectContaining({ bottom: 300 + 24 }) }),
      });
      document.documentElement.style.removeProperty('--sheet-height');
    });

    it('frames the selected route alone when asked to', () => {
      const { rerender } = renderRoutes({ framing: 'selected', selectedRoute: 0 });
      rerender(<StartPointMap routes={routes} framing="selected" selectedRoute={1} onStartChange={vi.fn()} />);

      expect(map().fitted?.bounds).toEqual([
        [7, 45],
        [7.1, 45.2],
      ]);
    });

    it('keeps its frame when another route is selected while framing all', () => {
      const { rerender } = renderRoutes({ selectedRoute: 0 });
      const before = map().fitted;

      rerender(<StartPointMap routes={routes} selectedRoute={2} onStartChange={vi.fn()} />);

      expect(map().fitted).toBe(before);
    });

    it('clears the routes', () => {
      const { rerender } = renderRoutes();

      rerender(<StartPointMap onStartChange={vi.fn()} />);

      expect(features()).toEqual([]);
    });

    it('shows a dot where the profile is hovered', () => {
      const { rerender } = renderRoutes();

      rerender(<StartPointMap routes={routes} hover={[6.05, 45.1]} onStartChange={vi.fn()} />);
      expect(markers.filter((marker) => marker.shown)).toEqual([expect.objectContaining({ position: [6.05, 45.1] })]);

      rerender(<StartPointMap routes={routes} onStartChange={vi.fn()} />);
      expect(markers.filter((marker) => marker.shown)).toEqual([]);
    });
  });
});
