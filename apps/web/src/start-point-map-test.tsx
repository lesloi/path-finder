import { act, render } from '@testing-library/react';

import { maps, markers } from './maplibre-mock.ts';
import { StartPointMap } from './start-point-map.tsx';

vi.mock('maplibre-gl', () => import('./maplibre-mock.ts'));

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

    expect(markers.filter((marker) => marker.shown)).toEqual([
      expect.objectContaining({ position: [6.3, 45.9] }),
    ]);
  });

  it('moves the map to its focus', () => {
    const { rerender } = render(<StartPointMap onStartChange={vi.fn()} />);

    rerender(<StartPointMap focus={[5.7, 45.2]} onStartChange={vi.fn()} />);

    expect(map().easedTo).toEqual({ center: [5.7, 45.2], zoom: 14 });
  });
});
