import { fireEvent, render, screen } from '@testing-library/react';

import { parseCriteria } from '../contract/index.ts';
import { expectNamedControls } from '../accessible-names.ts';
import { criteriaText } from '../i18n/index.ts';
import { CriteriaForm, criteriaChanged } from './criteria-form.tsx';
import type { Position, RouteSetRequest } from '../core/index.ts';

const en = criteriaText.en;
const fr = criteriaText.fr;

const START: Position = [6.1294, 45.8992];

const store = (settings: object) => localStorage.setItem('path-finder.settings', JSON.stringify(settings));

function setup(props: { start?: Position; language?: 'en' | 'fr' } = {}) {
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
