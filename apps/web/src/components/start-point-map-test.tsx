import { act, render } from '@testing-library/react';

import type { Position } from '../core/index.ts';
import { maps, markers, type GeoJSONSource } from '../maplibre-mock.ts';
import { basemapStyle } from './basemap-style.ts';
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

  describe('the basemap', () => {
    it('starts on the Plan IGN raster', () => {
      render(<StartPointMap onStartChange={vi.fn()} />);

      expect(map().options.style).toEqual(basemapStyle('plan'));
      expect(JSON.stringify(map().options.style)).toContain('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2');
    });

    it('starts on the basemap it is given', () => {
      render(<StartPointMap basemap="minimal" onStartChange={vi.fn()} />);

      expect(map().options.style).toBe(basemapStyle('minimal'));
      expect(map().options.style).toMatch(/PLAN\.IGN\/epure\.json$/);
    });

    it('serves the aerial photography as JPEG tiles', () => {
      expect(JSON.stringify(basemapStyle('aerial'))).toMatch(/ORTHOIMAGERY\.ORTHOPHOTOS.*image\/jpeg/);
    });

    it('swaps the style when it changes, with a full reload, and only then', () => {
      const { rerender } = render(<StartPointMap onStartChange={vi.fn()} />);
      rerender(<StartPointMap start={[6, 45]} onStartChange={vi.fn()} />);
      expect(map().styles).toEqual([]);

      rerender(<StartPointMap basemap="aerial" onStartChange={vi.fn()} />);

      expect(map().styles).toEqual([{ style: basemapStyle('aerial'), options: { diff: false } }]);
    });

    it('draws the routes again, and selects a tapped route once, on the new style', () => {
      const routes = [
        [
          [6, 45],
          [6.1, 45.2],
        ],
        [
          [7, 45],
          [7.1, 45.2],
        ],
      ] satisfies Position[][];
      const onRouteSelect = vi.fn();
      const view = render(<StartPointMap routes={routes} onRouteSelect={onRouteSelect} onStartChange={vi.fn()} />);
      act(() => map().fire('style.load'));
      act(() => map().fire('idle'));

      view.rerender(
        <StartPointMap basemap="aerial" routes={routes} onRouteSelect={onRouteSelect} onStartChange={vi.fn()} />,
      );
      // Between the swap and the new style there is nothing to draw in: the map does not break.
      view.rerender(
        <StartPointMap
          basemap="aerial"
          routes={routes}
          selectedRoute={1}
          onRouteSelect={onRouteSelect}
          onStartChange={vi.fn()}
        />,
      );
      expect(map().sources.routes).toBeUndefined();
      act(() => map().fire('style.load'));

      const drawn = (map().getSource('routes') as GeoJSONSource & { data: { features: unknown[] } }).data.features;
      expect(drawn).toHaveLength(2);
      expect(map().layers.map(({ id }) => id)).toEqual(['background', 'routes-casing', 'routes-line', 'routes-hit']);
      act(() => map().fire('click', { features: [{ properties: { index: 1 } }] }, 'routes-hit'));
      expect(onRouteSelect).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('goes back to the previous basemap when the style of the new one fails to load', () => {
      const onBasemapFail = vi.fn();
      const view = render(<StartPointMap onBasemapFail={onBasemapFail} onStartChange={vi.fn()} />);
      act(() => map().fire('style.load'));

      view.rerender(<StartPointMap basemap="minimal" onBasemapFail={onBasemapFail} onStartChange={vi.fn()} />);
      act(() => map().fire('error'));

      expect(map().styles.map(({ style }) => style)).toEqual([basemapStyle('minimal'), basemapStyle('plan')]);
      expect(onBasemapFail).toHaveBeenCalledExactlyOnceWith('plan');
      // The old style loads again, and the routes' layers are made again.
      act(() => map().fire('style.load'));
      expect(map().sources.routes).toBeDefined();
      view.rerender(<StartPointMap basemap="plan" onBasemapFail={onBasemapFail} onStartChange={vi.fn()} />);
      expect(map().styles).toHaveLength(2);
    });

    it('does not go back for an error that is not its style: a tile, or the first style', () => {
      const onBasemapFail = vi.fn();
      const view = render(<StartPointMap onBasemapFail={onBasemapFail} onStartChange={vi.fn()} />);
      act(() => map().fire('error'));
      act(() => map().fire('style.load'));

      view.rerender(<StartPointMap basemap="aerial" onBasemapFail={onBasemapFail} onStartChange={vi.fn()} />);
      act(() => map().fire('style.load'));
      act(() => map().fire('error'));

      expect(map().styles).toHaveLength(1);
      expect(onBasemapFail).not.toHaveBeenCalled();
    });

    it('keeps the snapshot of the routes it took on the old style', () => {
      const onSnapshot = vi.fn();
      const routes: Position[][] = [
        [
          [6, 45],
          [6.1, 45.2],
        ],
      ];
      const view = render(<StartPointMap routes={routes} onSnapshot={onSnapshot} onStartChange={vi.fn()} />);
      act(() => map().fire('style.load'));
      act(() => map().fire('idle'));
      const calls = onSnapshot.mock.calls.length;

      view.rerender(
        <StartPointMap basemap="minimal" routes={routes} onSnapshot={onSnapshot} onStartChange={vi.fn()} />,
      );
      act(() => map().fire('style.load'));
      act(() => map().fire('idle'));

      // A snapshot taken now would hold the routes already drawn on the canvas.
      expect(onSnapshot).toHaveBeenCalledTimes(calls);
    });
  });

  describe('with routes', () => {
    const loop = (offset: number): Position[] => [
      [6 + offset, 45],
      [6.1 + offset, 45.2],
      [6 + offset, 45],
    ];
    const routes = [loop(0), loop(1), loop(2)];

    // The style loads, the map frames the routes and settles: then they are drawn.
    function renderRoutes(props: Partial<Parameters<typeof StartPointMap>[0]> = {}) {
      const view = render(<StartPointMap routes={routes} onStartChange={vi.fn()} {...props} />);
      act(() => map().fire('style.load'));
      act(() => map().fire('idle'));
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

    it('keeps the routes off the map until it has taken its snapshot', () => {
      render(<StartPointMap routes={routes} onStartChange={vi.fn()} />);
      act(() => map().fire('style.load'));

      expect(features()).toEqual([]);

      act(() => map().fire('idle'));
      expect(features()).toHaveLength(3);
    });

    it('draws the routes anyway when the map never settles', () => {
      render(<StartPointMap routes={routes} onStartChange={vi.fn()} />);
      act(() => map().fire('style.load'));

      act(() => vi.advanceTimersByTime(5_000));

      expect(features()).toHaveLength(3);
    });

    describe('the snapshot', () => {
      it('is taken after framing all the routes at once, and reported with where places lie in it', () => {
        const onSnapshot = vi.fn();
        renderRoutes({ onSnapshot });

        expect(map().fitted?.options).toMatchObject({ animate: false });
        const [snapshot] = onSnapshot.mock.calls.at(-1)!;
        expect(snapshot).toMatchObject({ url: expect.stringMatching(/^blob:/), width: 800, height: 600, of: routes });
        // The mock puts the centre, 6° E 45° N, at the middle of its 800 by 600 screen.
        const [x, y] = snapshot.toPixel([6 * 111_319.49, 5_621_521.5]);
        expect(x).toBeCloseTo(400, 0);
        expect(y).toBeCloseTo(300, 0);
      });

      it('lets later selections move the map with an animation', () => {
        const { rerender } = renderRoutes({ framing: 'selected', selectedRoute: 0 });

        rerender(<StartPointMap routes={routes} framing="selected" selectedRoute={1} onStartChange={vi.fn()} />);

        expect(map().fitted?.options).not.toMatchObject({ animate: false });
      });

      it('leads on to the selected route when its detail was opened before the map settled', () => {
        render(<StartPointMap routes={routes} framing="selected" selectedRoute={1} onStartChange={vi.fn()} />);
        act(() => map().fire('style.load'));

        act(() => map().fire('idle'));

        expect(map().fitted?.bounds).toEqual([
          [7, 45],
          [7.1, 45.2],
        ]);
        expect(map().fitted?.options).not.toMatchObject({ animate: false });
      });

      it('is dropped with the route set', () => {
        const onSnapshot = vi.fn();
        const { rerender } = renderRoutes({ onSnapshot });

        rerender(<StartPointMap onSnapshot={onSnapshot} onStartChange={vi.fn()} />);

        expect(onSnapshot).toHaveBeenLastCalledWith(undefined);
      });

      it('is taken again for a new route set', () => {
        const onSnapshot = vi.fn();
        const { rerender } = renderRoutes({ onSnapshot });
        const first = onSnapshot.mock.calls.at(-1)![0];

        rerender(<StartPointMap routes={[loop(5)]} onSnapshot={onSnapshot} onStartChange={vi.fn()} />);
        act(() => map().fire('idle'));

        const second = onSnapshot.mock.calls.at(-1)![0];
        expect(second.url).not.toBe(first.url);
        expect(second.of).toEqual([loop(5)]);
      });

      it('reports nothing when the canvas cannot be read', () => {
        const onSnapshot = vi.fn();
        render(<StartPointMap routes={routes} onSnapshot={onSnapshot} onStartChange={vi.fn()} />);
        act(() => map().fire('style.load'));
        map().canvas.toBlob = (callback) => callback(null);

        act(() => map().fire('idle'));

        expect(onSnapshot).toHaveBeenLastCalledWith(undefined);
        expect(features()).toHaveLength(3);
      });
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

    it('lets the start point be set again while the routes are only a backdrop', () => {
      const onStartChange = vi.fn();
      renderRoutes({ pickOnClick: true, routesInteractive: false, onStartChange });

      act(() => map().fire('click', { lngLat: { lng: 6.2, lat: 45.8 } }));
      act(() => map().fire('click', { features: [{ properties: { index: 2 } }] }, 'routes-hit'));

      expect(onStartChange).toHaveBeenCalledWith([6.2, 45.8]);
    });

    it('does not select a route that is only a backdrop', () => {
      const onRouteSelect = vi.fn();
      renderRoutes({ routesInteractive: false, onRouteSelect });

      act(() => map().fire('click', { features: [{ properties: { index: 2 } }] }, 'routes-hit'));

      expect(onRouteSelect).not.toHaveBeenCalled();
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
