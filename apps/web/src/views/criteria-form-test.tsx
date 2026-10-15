import { fireEvent, render, screen } from '@testing-library/react';

import { parseCriteria, type AvoidedArea } from '../contract/index.ts';
import { expectNamedControls } from '../accessible-names.ts';
import { criteriaText } from '../i18n/index.ts';
import { CriteriaForm, criteriaChanged, criteriaRequest, invalidField } from './criteria-form.tsx';
import type { Position, RouteSetRequest } from '../core/index.ts';

const en = criteriaText.en;
const fr = criteriaText.fr;

const START: Position = [6.1294, 45.8992];

const store = (settings: object) => localStorage.setItem('path-finder.settings', JSON.stringify(settings));

function setup(props: { start?: Position; waypoints?: Position[]; language?: 'en' | 'fr'; searched?: boolean } = {}) {
  const onSubmit = vi.fn();
  render(<CriteriaForm language="en" start={START} onSubmit={onSubmit} {...props} />);
  const submit = () => fireEvent.click(screen.getByTestId('criteria-submit'));
  return { onSubmit, submit };
}

const slider = (name: 'distance' | 'duration' | 'gain') => screen.getByTestId(`criteria-${name}`);
const choose = (group: 'target' | 'elevation' | 'surface', value: string) =>
  fireEvent.click(screen.getByTestId(`criteria-${group}-${value}`));

beforeEach(() => {
  store({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CriteriaForm', () => {
  it('sends the defaults at the default pace', () => {
    const { onSubmit, submit } = setup();

    submit();

    expect(onSubmit).toHaveBeenCalledWith({
      start: START,
      target: { distance: 10 },
      surface: 'any',
      pace: 6,
    });
  });

  it('offers to search again once routes were found', () => {
    setup({ searched: true });

    expect(screen.getByTestId('criteria-submit')).toHaveTextContent(criteriaText.en.searchAgain);
  });

  it('offers to find routes before any were found', () => {
    setup();

    expect(screen.getByTestId('criteria-submit')).toHaveTextContent(en.findRoutes);
  });

  it('sends the waypoints in the order they were placed', () => {
    const waypoints: Position[] = [
      [6.14, 45.91],
      [6.12, 45.88],
    ];
    const { onSubmit, submit } = setup({ waypoints });

    submit();

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ waypoints }));
    expect(() => parseCriteria(onSubmit.mock.calls[0][0])).not.toThrow();
  });

  it('sends no waypoints field when none is placed', () => {
    const { onSubmit, submit } = setup({ waypoints: [] });

    submit();

    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('waypoints');
  });

  it('hides Find routes until a start point is set', () => {
    setup({ start: undefined });

    expect(screen.queryByTestId('criteria-submit')).not.toBeInTheDocument();
  });

  it('sends criteria that parseCriteria accepts', () => {
    const { onSubmit, submit } = setup();
    choose('target', 'duration');
    fireEvent.change(slider('duration'), { target: { value: '90' } });
    choose('elevation', 'target');
    fireEvent.change(slider('gain'), { target: { value: '400' } });
    choose('surface', 'unpaved');

    submit();

    const request = onSubmit.mock.calls[0][0];
    expect(request).toMatchObject({ target: { duration: 90 }, elevationGain: 400, surface: 'unpaved' });
    expect(() => parseCriteria(request)).not.toThrow();
  });

  describe('target', () => {
    it('is a distance or a duration, never both', () => {
      const { onSubmit, submit } = setup();
      fireEvent.change(slider('distance'), { target: { value: '21' } });

      choose('target', 'duration');

      expect(screen.queryByTestId('criteria-distance')).not.toBeInTheDocument();
      submit();
      expect(onSubmit.mock.calls[0][0].target).toEqual({ duration: 60 });

      choose('target', 'distance');

      expect(slider('distance')).toHaveValue('21');
    });

    it('keeps the distance slider within the API bounds, in kilometres', () => {
      setup();

      expect(slider('distance')).toHaveAttribute('min', '2');
      expect(slider('distance')).toHaveAttribute('max', '50');
      expect(screen.getByTestId('criteria-distance-value')).toHaveTextContent(/\d+ km$/);
    });

    it('keeps the duration slider within the API bounds', () => {
      setup();
      choose('target', 'duration');

      expect(slider('duration')).toHaveAttribute('min', '15');
      expect(slider('duration')).toHaveAttribute('max', '360');
    });
  });

  describe('elevation gain', () => {
    it('is left out for Any', () => {
      const { onSubmit, submit } = setup();

      submit();

      expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('elevationGain');
    });

    it.each(['flat', 'hilly'])('is sent as %s', (expected) => {
      const { onSubmit, submit } = setup();
      choose('elevation', expected);

      submit();

      expect(onSubmit.mock.calls[0][0].elevationGain).toBe(expected);
    });

    it('is a number of metres for Target', () => {
      const { onSubmit, submit } = setup();
      choose('elevation', 'target');

      submit();

      expect(onSubmit.mock.calls[0][0].elevationGain).toBe(300);
    });

    it('shows its slider for Exact only', () => {
      setup();
      expect(screen.queryByTestId('criteria-gain')).not.toBeInTheDocument();

      choose('elevation', 'target');

      expect(slider('gain')).toHaveAttribute('max', '2500');
    });
  });

  describe('surface', () => {
    it.each(['paved', 'unpaved'])('sends %s', (expected) => {
      const { onSubmit, submit } = setup();
      choose('surface', expected);

      submit();

      expect(onSubmit.mock.calls[0][0].surface).toBe(expected);
    });
  });

  describe('technical stretches', () => {
    it.each(['paved', 'any', 'unpaved'])('are not a choice, whatever the %s surface preference', (surface) => {
      const { onSubmit, submit } = setup();
      choose('surface', surface);
      submit();

      expect(screen.queryByTestId('criteria-technical')).not.toBeInTheDocument();
      expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('includeTechnical');
    });
  });

  describe('last criteria', () => {
    it('restores what was asked last', () => {
      store({ lastCriteria: { target: 'duration', surface: 'unpaved', level: 'target', gain: 450 } });
      const { onSubmit, submit } = setup();

      submit();

      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        target: { duration: 60 },
        surface: 'unpaved',
        elevationGain: 450,
      });
      expect(screen.getByTestId('criteria-surface-unpaved')).toBeChecked();
    });
  });

  describe('pace', () => {
    const field = () => screen.queryByTestId('criteria-pace');

    it('is not asked for a distance, which does not need it', () => {
      setup();

      expect(field()).not.toBeInTheDocument();
    });

    it('is asked under a duration, in min/km, and saved as the slider moves', () => {
      const { onSubmit, submit } = setup();
      choose('target', 'duration');
      expect(field()).toHaveValue('360');
      expect(screen.getByTestId('criteria-pace-value')).toHaveTextContent('6:00 min/km');
      expect(field()).toHaveAccessibleName(en.pace);

      fireEvent.change(field()!, { target: { value: '330' } });
      submit();

      expect(onSubmit.mock.calls[0][0].pace).toBe(5.5);
      expect(JSON.parse(localStorage.getItem('path-finder.settings')!).pace).toBe(5.5);
    });

    it('is shown in km/h when the user asks for it, and saved in minutes per km as the slider moves', () => {
      store({ paceUnit: 'km/h' });
      const { onSubmit, submit } = setup();
      choose('target', 'duration');
      expect(field()).toHaveValue('10');
      expect(screen.getByTestId('criteria-pace-value')).toHaveTextContent('10.0 km/h');

      fireEvent.change(field()!, { target: { value: '12' } });
      submit();

      expect(onSubmit.mock.calls[0][0].pace).toBe(5);
    });

    it('shows the saved pace', () => {
      store({ pace: 5 });
      setup();
      choose('target', 'duration');

      expect(screen.getByTestId('criteria-pace-value')).toHaveTextContent('5:00 min/km');
    });
  });

  describe('errors', () => {
    it('names the field and hides Find routes when the target duration does not fit the elevation gain', () => {
      setup();
      choose('target', 'duration');
      fireEvent.change(slider('duration'), { target: { value: '30' } });
      choose('elevation', 'target');
      fireEvent.change(slider('gain'), { target: { value: '2000' } });

      expect(screen.getByTestId('criteria-error')).toHaveTextContent(en.durationError);
      expect(screen.queryByTestId('criteria-submit')).not.toBeInTheDocument();
    });

    it('is shown in French', () => {
      setup({ language: 'fr' });
      choose('target', 'duration');
      fireEvent.change(slider('duration'), { target: { value: '30' } });
      choose('elevation', 'target');
      fireEvent.change(slider('gain'), { target: { value: '2000' } });

      expect(screen.getByTestId('criteria-error')).toHaveTextContent(fr.durationError);
    });
  });

  describe('accessibility', () => {
    it.each(['en', 'fr'] as const)('names every control of the full form in %s', (language) => {
      const { container } = render(<CriteriaForm language={language} start={START} onSubmit={vi.fn()} />);
      choose('target', 'duration');
      choose('elevation', 'target');

      expectNamedControls(container);
    });
  });
});

describe('invalidField', () => {
  const request: RouteSetRequest = { start: START, target: { distance: 10 }, surface: 'any', pace: 6 };

  it('names an invalid waypoints field instead of throwing', () => {
    const tooMany = Array.from({ length: 6 }, (): Position => [6.1, 45.9]);

    expect(invalidField({ ...request, waypoints: tooMany })).toBe('waypoints');
  });

  it('finds nothing wrong with valid criteria', () => {
    expect(invalidField({ ...request, waypoints: [[6.1, 45.9]] })).toBeUndefined();
  });
});

describe('criteriaRequest', () => {
  it('leaves out a start point-less request, and carries the waypoints of a complete one', () => {
    const draft = { target: 'distance', distance: 10, duration: 60, level: 'any', gain: 0, surface: 'any' } as const;

    expect(criteriaRequest(draft, { pace: 6, waypoints: [[6.1, 45.9]] })).toBeUndefined();
    expect(criteriaRequest(draft, { pace: 6, start: START, waypoints: [[6.1, 45.9]] })).toMatchObject({
      waypoints: [[6.1, 45.9]],
    });
  });
});

describe('criteriaRequest and avoided areas', () => {
  const draft = { target: 'distance', distance: 10, duration: 60, level: 'any', gain: 0, surface: 'any' } as const;
  const near: AvoidedArea = { center: [6.14, 45.9], radius: 400 };
  // About 111 km north of the start point.
  const far: AvoidedArea = { center: [6.1294, 46.9], radius: 400 };

  it('carries the areas a route of this length can reach', () => {
    const request = criteriaRequest(draft, { pace: 6, start: START, avoidedAreas: [near] });

    expect(request).toMatchObject({ avoidedAreas: [near] });
  });

  it('keeps an area that is out of reach on the device', () => {
    const request = criteriaRequest(draft, { pace: 6, start: START, avoidedAreas: [near, far] });

    expect(request?.avoidedAreas).toEqual([near]);
  });

  it('leaves the field out when no area is within reach', () => {
    const request = criteriaRequest(draft, { pace: 6, start: START, avoidedAreas: [far] });

    expect(request).not.toHaveProperty('avoidedAreas');
  });

  it('reaches as far as a duration allows at the pace of the user', () => {
    // 20 min at 4 min/km is 5 km at most; the area is 11 km north, less its radius.
    const eleven: AvoidedArea = { center: [6.1294, 45.9992], radius: 400 };
    const short = { ...draft, target: 'duration', duration: 20 } as const;

    expect(criteriaRequest(short, { pace: 4, start: START, avoidedAreas: [eleven] })).not.toHaveProperty(
      'avoidedAreas',
    );
    expect(
      criteriaRequest({ ...short, duration: 90 }, { pace: 4, start: START, avoidedAreas: [eleven] }),
    ).toHaveProperty('avoidedAreas');
  });
});

describe('criteriaChanged', () => {
  const found: RouteSetRequest = {
    start: [6.1, 45.8],
    target: { distance: 10 },
    elevationGain: 300,
    surface: 'any',
    pace: 6,
  };
  const changed = (changes: Partial<RouteSetRequest>) => criteriaChanged({ ...found, ...changes }, found);

  it('sees no change in the same request', () => {
    expect(changed({})).toBe(false);
  });

  it.each([
    ['the start point', { start: [6.2, 45.8] as [number, number] }],
    ['the distance', { target: { distance: 11 } }],
    ['the duration', { target: { duration: 60 } }],
    ['the elevation gain', { elevationGain: 400 }],
    ['the elevation level', { elevationGain: 'hilly' as const }],
    ['the surface', { surface: 'paved' as const }],
  ])('sees a change of %s', (_, changes) => {
    expect(changed(changes)).toBe(true);
  });

  it('sees a waypoint added, moved, removed or reordered, but not an empty list for none', () => {
    const [a, b]: Position[] = [
      [6.14, 45.91],
      [6.12, 45.88],
    ];
    const withWaypoints = { ...found, waypoints: [a, b] };

    expect(criteriaChanged({ ...found, waypoints: [] }, found)).toBe(false);
    expect(criteriaChanged(withWaypoints, withWaypoints)).toBe(false);
    expect(criteriaChanged({ ...found, waypoints: [a] }, found)).toBe(true);
    expect(criteriaChanged(found, withWaypoints)).toBe(true);
    expect(criteriaChanged({ ...found, waypoints: [b, a] }, withWaypoints)).toBe(true);
    expect(criteriaChanged({ ...found, waypoints: [a, [6.12, 45.89]] }, withWaypoints)).toBe(true);
  });

  it('sees an avoided area added, moved, resized or removed', () => {
    const area: AvoidedArea = { center: [6.14, 45.9], radius: 400 };
    const withArea = { ...found, avoidedAreas: [area] };

    expect(criteriaChanged({ ...found, avoidedAreas: [] }, found)).toBe(false);
    expect(criteriaChanged(withArea, { ...found, avoidedAreas: [{ ...area }] })).toBe(false);
    expect(criteriaChanged(withArea, found)).toBe(true);
    expect(criteriaChanged(found, withArea)).toBe(true);
    expect(criteriaChanged({ ...found, avoidedAreas: [{ ...area, radius: 500 }] }, withArea)).toBe(true);
    expect(criteriaChanged({ ...found, avoidedAreas: [{ ...area, center: [6.15, 45.9] }] }, withArea)).toBe(true);
  });

  it('sees a change of the pace by duration only', () => {
    expect(changed({ pace: 5 })).toBe(false);
    expect(
      criteriaChanged({ ...found, target: { duration: 60 }, pace: 5 }, { ...found, target: { duration: 60 } }),
    ).toBe(true);
  });

  it('takes a value within half a step of the slider for the same one, and a step for another', () => {
    // 9.66 km, kept from a search, is held by the slider for 10 km; 11.27 km is not.
    expect(changed({ target: { distance: 9.66 } })).toBe(false);
    expect(changed({ target: { distance: 11.27 } })).toBe(true);
    // 305 m is held for 300 m; 335 m is not.
    expect(changed({ elevationGain: 305 })).toBe(false);
    expect(changed({ elevationGain: 335 })).toBe(true);
  });
});
