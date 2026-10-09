import { fireEvent, render, screen } from '@testing-library/react';

import { parseCriteria } from '../contract/index.ts';
import { expectNamedControls } from '../accessible-names.ts';
import { criteriaText } from '../i18n/index.ts';
import { CriteriaForm, criteriaChanged } from './criteria-form.tsx';
import { useSettings } from '../state/index.ts';
import type { Position, RouteSetRequest } from '../core/index.ts';

const en = criteriaText.en;
const fr = criteriaText.fr;

const START: Position = [6.1294, 45.8992];

// The tests read metric figures, whatever the language, unless they pick other units.
const store = (settings: object) =>
  localStorage.setItem('path-finder.settings', JSON.stringify({ units: 'metric', ...settings }));

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
      includeTechnical: false,
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

    it.each([
      ['metric', 2, 50],
      ['imperial', 2, 31],
    ])('keeps the distance slider within the API bounds in %s units', (units, min, max) => {
      store({ units });
      setup();

      expect(slider('distance')).toHaveAttribute('min', `${min}`);
      expect(slider('distance')).toHaveAttribute('max', `${max}`);
    });

    it.each([
      ['en', 'imperial', 'mi'],
      ['fr', 'metric', 'km'],
    ] as const)('asks the distance in the units of the %s language by default: %s', (language, units, unit) => {
      localStorage.clear();
      const { onSubmit, submit } = setup({ language });

      expect(screen.getByTestId('criteria-distance')).toHaveAttribute('max', units === 'metric' ? '50' : '31');
      expect(screen.getByTestId('criteria-distance-value')).toHaveTextContent(new RegExp(`\\d+ ${unit}$`));
      submit();
      expect(() => parseCriteria(onSubmit.mock.calls[0][0])).not.toThrow();
    });

    it('keeps the duration slider within the API bounds', () => {
      setup();
      choose('target', 'duration');

      expect(slider('duration')).toHaveAttribute('min', '15');
      expect(slider('duration')).toHaveAttribute('max', '360');
    });

    it('converts miles to kilometres', () => {
      store({ units: 'imperial' });
      const { onSubmit, submit } = setup();
      fireEvent.change(slider('distance'), { target: { value: '31' } });

      submit();

      expect(onSubmit.mock.calls[0][0].target).toEqual({ distance: 49.89 });
      expect(() => parseCriteria(onSubmit.mock.calls[0][0])).not.toThrow();
    });

    it('follows a change of units from the settings page', () => {
      const onSubmit = vi.fn();
      render(<UnitsSwitch onSubmit={onSubmit} />);
      fireEvent.change(slider('distance'), { target: { value: '16' } });
      choose('elevation', 'target');
      fireEvent.change(slider('gain'), { target: { value: '500' } });

      fireEvent.click(screen.getByTestId('imperial'));

      // 16 km is 9.9 mi, and 500 m is 1,640 ft, which the sliders round to their steps.
      expect(slider('distance')).toHaveValue('10');
      expect(slider('gain')).toHaveValue('1600');
    });
  });

  it('converts the longest distance to the longest one in the new units', () => {
    render(<UnitsSwitch onSubmit={vi.fn()} />);
    fireEvent.change(slider('distance'), { target: { value: '50' } });

    fireEvent.click(screen.getByTestId('imperial'));

    // 50 km is 31.07 mi, which the slider shows as 31.
    expect(slider('distance')).toHaveValue('31');
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

    it('converts feet to metres, within the API bounds', () => {
      store({ units: 'imperial' });
      const { onSubmit, submit } = setup();
      choose('elevation', 'target');
      expect(slider('gain')).toHaveAttribute('max', '8200');
      fireEvent.change(slider('gain'), { target: { value: '8200' } });

      submit();

      expect(onSubmit.mock.calls[0][0].elevationGain).toBe(2_499);
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
    const technical = () => screen.queryByTestId('criteria-technical');
    const stored = () => JSON.parse(localStorage.getItem('path-finder.settings')!).lastCriteria;

    it('is off by default and asks for the stretches to be excluded', () => {
      const { onSubmit, submit } = setup();

      expect(technical()).not.toBeChecked();
      expect(technical()).toHaveAccessibleName(en.includeTechnical);
      submit();

      expect(onSubmit.mock.calls[0][0].includeTechnical).toBe(false);
    });

    it.each(['any', 'unpaved'])('can be turned on with the %s surface preference', (surface) => {
      const { onSubmit, submit } = setup();
      choose('surface', surface);

      fireEvent.click(technical()!);
      submit();

      expect(technical()).toBeChecked();
      expect(onSubmit.mock.calls[0][0].includeTechnical).toBe(true);
    });

    it('is hidden with the paved surface preference, which excludes them whatever was kept', () => {
      store({ lastCriteria: { target: 'distance', surface: 'any', level: 'any', gain: 300, includeTechnical: true } });
      const { onSubmit, submit } = setup();
      choose('surface', 'paved');

      expect(technical()).not.toBeInTheDocument();
      submit();

      expect(onSubmit.mock.calls[0][0].includeTechnical).toBe(false);
      expect(stored().includeTechnical).toBe(true);
      expect(parseCriteria(onSubmit.mock.calls[0][0]).includeTechnical).toBe(false);
    });

    it('comes back as it was kept when the surface preference is not paved again', () => {
      store({ lastCriteria: { target: 'distance', surface: 'any', level: 'any', gain: 300, includeTechnical: true } });
      setup();
      choose('surface', 'paved');

      choose('surface', 'unpaved');

      expect(technical()).toBeChecked();
    });

    it('is worded in French', () => {
      setup({ language: 'fr' });

      expect(technical()).toHaveAccessibleName('Autoriser les passages techniques signalés');
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

    it('shows a gain kept in metres in the units of the settings', () => {
      store({ units: 'imperial', lastCriteria: { target: 'distance', surface: 'any', level: 'target', gain: 457 } });
      setup();

      expect(slider('gain')).toHaveValue('1500');
    });

    it('shows a distance kept in kilometres in the units of the settings', () => {
      store({ units: 'imperial', lastCriteria: { distance: 16.09344 } });
      setup();

      expect(slider('distance')).toHaveValue('10');
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

    it('is shown in min/mi with imperial units', () => {
      store({ units: 'imperial' });
      setup();
      choose('target', 'duration');

      expect(screen.getByTestId('criteria-pace-value')).toHaveTextContent('9:39 min/mi');
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

// Settings are changed elsewhere in the app: a button stands for the settings page.
function UnitsSwitch({ onSubmit }: { onSubmit: () => void }) {
  const [, update] = useSettings();
  return (
    <>
      <button type="button" data-testid="imperial" onClick={() => update({ units: 'imperial' })}>
        Imperial
      </button>
      <CriteriaForm language="en" start={START} onSubmit={onSubmit} />
    </>
  );
}

describe('criteriaChanged', () => {
  const found: RouteSetRequest = {
    start: [6.1, 45.8],
    target: { distance: 10 },
    elevationGain: 300,
    surface: 'any',
    pace: 6,
    includeTechnical: false,
  };
  const changed = (changes: Partial<RouteSetRequest>, units: 'metric' | 'imperial' = 'metric') =>
    criteriaChanged({ ...found, ...changes }, found, units);

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
    ['the technical stretches', { includeTechnical: true }],
  ])('sees a change of %s', (_, changes) => {
    expect(changed(changes)).toBe(true);
  });

  it('sees a change of the pace by duration only', () => {
    expect(changed({ pace: 5 })).toBe(false);
    expect(
      criteriaChanged(
        { ...found, target: { duration: 60 }, pace: 5 },
        { ...found, target: { duration: 60 } },
        'metric',
      ),
    ).toBe(true);
  });

  it('takes a value rounded in other units for the same one, and a step for another', () => {
    // 6 mi is 9.66 km, which a slider in miles holds for 10 km; 7 mi is not.
    expect(changed({ target: { distance: 9.66 } }, 'imperial')).toBe(false);
    expect(changed({ target: { distance: 11.27 } }, 'imperial')).toBe(true);
    // 1000 ft is 305 m, which a slider in metres holds for 300 m; 1100 ft is not.
    expect(changed({ elevationGain: 305 }, 'imperial')).toBe(false);
    expect(changed({ elevationGain: 335 }, 'imperial')).toBe(true);
  });
});
