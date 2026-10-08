import { act, render } from '@testing-library/react';
import { createRef } from 'react';

import type { Position } from '../core/index.ts';
import { maps, markers, ScaleControl, type GeoJSONSource } from '../maplibre-mock.ts';
import { basemapStyle } from './basemap-style.ts';
import { StartPointMap, type MapHandle } from './start-point-map.tsx';

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

  it('shows a scale bar in the units of the display, and follows them', () => {
    const { rerender } = render(
      <StartPointMap display={{ units: 'imperial', language: 'en' }} onStartChange={vi.fn()} />,
    );
    const scale = map().controls.find((control) => control instanceof ScaleControl) as ScaleControl;
    expect(scale.options).toEqual({ unit: 'imperial' });

    rerender(<StartPointMap display={{ units: 'metric', language: 'en' }} onStartChange={vi.fn()} />);

    expect(scale.options).toEqual({ unit: 'metric' });
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
      expect(map().layers.map(({ id }) => id)).toEqual([
        'background',
        'routes-casing',
        'routes-line',
        'routes-marking',
        'routes-hit',
        'route-badges',
        'route-markers',
      ]);
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

    it('draws the selected route in its colour, last, and the others in grey', () => {
      renderRoutes({ selectedRoute: 0 });

      expect(features().map(({ properties }) => properties)).toEqual([
        { index: 1, selected: false, color: '#9aa595' },
        { index: 2, selected: false, color: '#9aa595' },
        { index: 0, selected: true, color: '#e0115f' },
      ]);
    });

    it('keeps every route in its colour while none is selected', () => {
      renderRoutes();

      expect(features().map(({ properties }) => (properties as { color: string }).color)).toEqual([
        '#e0115f',
        '#2563eb',
        '#7a3fc4',
      ]);
    });

    it('draws only the selected route once its detail is open, and all of them again when it closes', () => {
      const view = renderRoutes({ selectedRoute: 1, framing: 'selected' });

      expect(features().map(({ properties }) => properties)).toEqual([{ index: 1, selected: true, color: '#2563eb' }]);

      view.rerender(<StartPointMap routes={routes} selectedRoute={1} framing="all" onStartChange={vi.fn()} />);
      expect(features()).toHaveLength(3);
    });

    it('draws the route it is given as selected when the detail moves to another route', () => {
      const view = renderRoutes({ selectedRoute: 0, framing: 'selected' });

      view.rerender(<StartPointMap routes={routes} selectedRoute={2} framing="selected" onStartChange={vi.fn()} />);

      expect(features().map(({ properties }) => properties)).toEqual([{ index: 2, selected: true, color: '#7a3fc4' }]);
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

    describe('the view', () => {
      it('is flat: it cannot be tilted', () => {
        render(<StartPointMap onStartChange={vi.fn()} />);

        expect(map().options).toMatchObject({ maxPitch: 0, pitchWithRotate: false });
      });

      it('frames a new route set north up, and at once', () => {
        renderRoutes();

        expect(map().fitted?.options).toMatchObject({ bearing: 0, animate: false });
      });

      it('reports a turn, and the map put back', () => {
        const onViewChange = vi.fn();
        render(<StartPointMap onViewChange={onViewChange} onStartChange={vi.fn()} />);

        act(() => map().rotateTo(40));
        expect(onViewChange).toHaveBeenLastCalledWith({ bearing: 40, rotated: true, movedAway: false });
        act(() => map().rotateTo(0.05));
        expect(onViewChange).toHaveBeenLastCalledWith({ bearing: 0.05, rotated: false, movedAway: false });
      });

      it('reports a change once, however many times the map moves', () => {
        const onViewChange = vi.fn();
        render(<StartPointMap onViewChange={onViewChange} onStartChange={vi.fn()} />);

        act(() => map().rotateTo(40));
        act(() => map().rotateTo(40));

        expect(onViewChange).toHaveBeenCalledTimes(1);
      });

      it('turns the map back to north with the handle', () => {
        const handle = createRef<MapHandle>();
        render(<StartPointMap ref={handle} onStartChange={vi.fn()} />);
        act(() => map().rotateTo(40));

        act(() => handle.current!.resetNorth());

        expect(map().bearing).toBe(0);
      });

      it('notices a move by the user, not a framing', () => {
        const onViewChange = vi.fn();
        renderRoutes({ onViewChange });

        act(() => map().fire('movestart', {}));
        expect(onViewChange).not.toHaveBeenCalled();
        act(() => map().fire('movestart', { originalEvent: {} }));
        expect(onViewChange).toHaveBeenLastCalledWith(expect.objectContaining({ movedAway: true }));
      });

      it('frames the routes again with the handle, keeping the orientation, and is no longer away', () => {
        const onViewChange = vi.fn();
        const handle = createRef<MapHandle>();
        renderRoutes({ onViewChange, ref: handle });
        act(() => map().rotateTo(40));
        act(() => map().fire('movestart', { originalEvent: {} }));
        map().fitted = undefined;

        act(() => handle.current!.reframe());

        expect(map().fitted?.options).toMatchObject({ bearing: 40 });
        expect(map().fitted?.options).not.toMatchObject({ animate: false });
        expect(onViewChange).toHaveBeenLastCalledWith(expect.objectContaining({ movedAway: false }));
      });
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

      it('is taken from a map turned back to north, once it has settled again', () => {
        const onSnapshot = vi.fn();
        render(<StartPointMap routes={routes} onSnapshot={onSnapshot} onStartChange={vi.fn()} />);
        act(() => map().fire('style.load'));
        act(() => map().rotateTo(40));

        act(() => map().fire('idle'));
        expect(map().bearing).toBe(0);
        expect(onSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.anything() }));
        act(() => map().fire('idle'));

        expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ of: routes }));
      });

      it('is taken anyway when a turned map never settles', () => {
        const onSnapshot = vi.fn();
        render(<StartPointMap routes={routes} onSnapshot={onSnapshot} onStartChange={vi.fn()} />);
        act(() => map().fire('style.load'));
        act(() => map().rotateTo(40));

        act(() => vi.advanceTimersByTime(5_000));
        act(() => vi.advanceTimersByTime(5_000));

        expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ of: routes }));
      });

      describe('on a change of layout', () => {
        const listeners: (() => void)[] = [];
        let wide = false;
        const matchMedia = window.matchMedia;
        afterEach(() => {
          window.matchMedia = matchMedia;
        });
        beforeEach(() => {
          listeners.length = 0;
          wide = false;
          window.matchMedia = () =>
            ({
              get matches() {
                return wide;
              },
              addEventListener: (_: string, listener: () => void) => listeners.push(listener),
              removeEventListener() {},
            }) as unknown as MediaQueryList;
        });
        const widen = () => {
          wide = true;
          act(() => listeners.forEach((listener) => listener()));
        };

        it('takes the snapshot again from a map that is north up', () => {
          const onSnapshot = vi.fn();
          renderRoutes({ onSnapshot });
          const first = onSnapshot.mock.calls.at(-1)![0];

          widen();
          act(() => map().fire('idle'));

          expect(onSnapshot.mock.calls.at(-1)![0].url).not.toBe(first.url);
        });

        it('keeps the snapshot it has while the map is turned', () => {
          const onSnapshot = vi.fn();
          renderRoutes({ onSnapshot });
          const calls = onSnapshot.mock.calls.length;
          act(() => map().rotateTo(40));

          widen();
          act(() => map().fire('idle'));

          expect(onSnapshot).toHaveBeenCalledTimes(calls);
        });
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

      expect(map().layers.map(({ id }) => id)).toEqual([
        'background',
        'routes-casing',
        'routes-line',
        'routes-marking',
        'routes-hit',
        'route-badges',
        'route-markers',
      ]);
    });

    describe('the distance', () => {
      // About 7 km out and back.
      const out: Position[] = [
        [6, 45],
        [6.05, 45.05],
        [6, 45],
      ];
      const summaries = [{ distance: 14, elevationGain: 340 }];
      const labelled = (id: 'route-badges' | 'route-markers') =>
        (
          map().getSource(id) as GeoJSONSource & {
            data: { features: { properties: Record<string, unknown>; geometry: { coordinates: Position } }[] };
          }
        ).data.features;
      const labels = (id: 'route-badges' | 'route-markers') => labelled(id).map(({ properties }) => properties.label);

      it('labels each route with its distance and elevation gain', () => {
        renderRoutes({
          routes: [out, out],
          summaries: [...summaries, { distance: 12.5 }],
          display: { units: 'metric', language: 'fr' },
        });

        expect(labels('route-badges')).toEqual(['14,0 km\n+340 m', '12,5 km']);
      });

      it('writes it in miles and feet in imperial units', () => {
        renderRoutes({ routes: [out], summaries, display: { units: 'imperial', language: 'en' } });

        expect(labels('route-badges')).toEqual(['8.7 mi\n+1115 ft']);
      });

      it('marks the distance along the selected route only once its detail is open', () => {
        const set = [out];
        const view = renderRoutes({ routes: set, summaries, selectedRoute: 0 });
        expect(labels('route-markers')).toEqual([]);

        view.rerender(
          <StartPointMap
            routes={set}
            summaries={summaries}
            selectedRoute={0}
            framing="selected"
            onStartChange={vi.fn()}
          />,
        );

        expect(labels('route-markers')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
        // The route's own labels give way to its markers.
        expect(labels('route-badges')).toEqual([]);
      });

      it('marks every mile in imperial units, and gives a multiple of ten the first place', () => {
        renderRoutes({
          routes: [out],
          summaries,
          selectedRoute: 0,
          framing: 'selected',
          display: { units: 'imperial', language: 'en' },
        });

        expect(labels('route-markers')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
        expect(labelled('route-markers').map(({ properties }) => properties.priority)).toEqual([
          2, 2, 2, 2, 1, 2, 2, 2,
        ]);
      });

      it('draws each tag in a box the map has an image for, white or in the colour of a route', () => {
        renderRoutes({ routes: [out], summaries });

        expect(map().images['route-tag']).toMatchObject({ width: 36, height: 36 });
        expect(Object.keys(map().images).filter((id) => id.startsWith('route-tag-'))).toHaveLength(5);
      });

      it('fills the tag of the selected route in its colour and leaves the others white', () => {
        renderRoutes({ routes: [out, out], summaries: [...summaries, { distance: 12.5 }], selectedRoute: 1 });

        expect(labelled('route-badges').map(({ properties }) => [properties.tag, properties.textColor])).toEqual([
          ['route-tag', '#1c1d1b'],
          ['route-tag-1', '#ffffff'],
        ]);
      });

      describe('inside the map', () => {
        // East along the latitude of the centre: the map shows longitudes 5.92 to 6.67 in its free area.
        const long: Position[] = [
          [5.9, 45],
          [7, 45],
        ];
        const anchor = () => labelled('route-badges')[0];

        it('moves the tag along its route to where the map shows it', () => {
          renderRoutes({ routes: [long], summaries });

          const [lon] = anchor().geometry.coordinates;
          // The midpoint, at 6.45, is under the controls on the right.
          expect(lon).toBeGreaterThan(6.2);
          expect(lon).toBeLessThan(6.32);
        });

        it('places it again once the map settles somewhere else', () => {
          renderRoutes({ routes: [long], summaries });
          map().project = ([lng, lat]) => ({ x: 400 + (lng - 6.6) * 1000, y: 300 - (lat - 45) * 1000 });
          act(() => map().fire('moveend'));

          // The midpoint is in view now: the tag goes back to it.
          expect(anchor().geometry.coordinates[0]).toBeCloseTo(6.45, 2);
        });

        it('leaves the tag out of a route that is not in view', () => {
          renderRoutes({ routes: [long], summaries });
          map().project = () => ({ x: 5000, y: 5000 });
          act(() => map().fire('moveend'));

          expect(labelled('route-badges')).toEqual([]);
        });

        it('keeps clear of the sheet on phones', () => {
          document.documentElement.style.setProperty('--sheet-height', '500px');
          try {
            renderRoutes({ routes: [out], summaries });
            // The route is at 250 to 300 px from the top: the sheet leaves 600 - 500 - 40 - 28 = 32 px.
            expect(labelled('route-badges')).toEqual([]);
          } finally {
            document.documentElement.style.removeProperty('--sheet-height');
          }
        });

        it('leaves out the distance markers that are out of view', () => {
          renderRoutes({ routes: [long], summaries: [{ distance: 20 }], selectedRoute: 0, framing: 'selected' });

          const lons = labelled('route-markers').map(({ geometry }) => geometry.coordinates[0]);
          expect(lons.length).toBeGreaterThan(0);
          // The route is some 85 km long, a marker every kilometre.
          expect(lons.length).toBeLessThan(60);
          expect(Math.max(...lons)).toBeLessThan(6.32);
        });
      });

      it('draws each marker on a dark disc the map has an image for', () => {
        renderRoutes({ routes: [out], summaries });

        expect(map().images['distance-marker']).toMatchObject({ width: 52, height: 52 });
      });

      it('has no label until the snapshot is taken', () => {
        render(<StartPointMap routes={[out]} summaries={summaries} onStartChange={vi.fn()} />);
        act(() => map().fire('style.load'));

        expect(labelled('route-badges')).toEqual([]);
      });
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
