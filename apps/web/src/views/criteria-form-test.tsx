import { fireEvent, render, screen, within } from '@testing-library/react';

import { parseCriteria } from '../contract/index.ts';
import { expectNamedControls } from '../accessible-names.ts';
import { commonText, criteriaText } from '../i18n/index.ts';
import { CriteriaForm } from './criteria-form.tsx';
import { useSettings } from '../state/index.ts';
import type { Position } from '../core/index.ts';

const en = criteriaText.en;
const fr = criteriaText.fr;

const START: Position = [6.1294, 45.8992];

const store = (settings: object) => localStorage.setItem('path-finder.settings', JSON.stringify(settings));
const onDesktop = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query) => ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as never,
    );

// The form is the full one, as on desktops, unless a test asks for the compact one.
function setup(props: { start?: Position; compact?: boolean; language?: 'en' | 'fr' } = {}) {
  const onSubmit = vi.fn();
  render(<CriteriaForm language="en" start={START} onSubmit={onSubmit} {...props} />);
  const submit = () => fireEvent.click(screen.getByTestId('criteria-submit'));
  return { onSubmit, submit };
}

const slider = (name: 'distance' | 'duration' | 'gain') => screen.getByTestId(`criteria-${name}`);
const choose = (group: 'target' | 'elevation' | 'surface', value: string) =>
  fireEvent.click(screen.getByTestId(`criteria-${group}-${value}`));

beforeEach(() => {
  onDesktop();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CriteriaForm', () => {
  it('sends the defaults for a run at the default pace', () => {
    const { onSubmit, submit } = setup();

    submit();

    expect(onSubmit).toHaveBeenCalledWith({
      start: START,
      activity: 'run',
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

    it.each([
      ['metric', 'run', 2, 50],
      ['metric', 'hike', 2, 40],
      ['imperial', 'run', 2, 31],
      ['imperial', 'hike', 2, 24],
    ])('keeps the distance slider within the API bounds in %s units, for a %s', (units, activity, min, max) => {
      store({ units, lastActivity: activity });
      setup();

      expect(slider('distance')).toHaveAttribute('min', `${min}`);
      expect(slider('distance')).toHaveAttribute('max', `${max}`);
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

  it('converts the distance the slider shows when the units change, not one it had to clamp', () => {
    render(<UnitsSwitch onSubmit={vi.fn()} />);
    fireEvent.change(slider('distance'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('criteria-activity-hike'));
    expect(slider('distance')).toHaveValue('40');

    fireEvent.click(screen.getByTestId('imperial'));

    // 40 km is 24.9 mi, which the slider shows as 25 and the hike's maximum cuts to 24.
    expect(slider('distance')).toHaveValue('24');
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

  describe('activity', () => {
    it('restores the last activity used', () => {
      store({ lastActivity: 'hike' });
      const { onSubmit, submit } = setup();

      submit();

      expect(onSubmit.mock.calls[0][0]).toMatchObject({ activity: 'hike', pace: 60 / 4.5 });
      expect(screen.getByTestId('criteria-activity-hike')).toHaveAttribute('aria-pressed', 'true');
    });

    it('stores the activity picked and uses its pace', () => {
      store({ pace: { hike: 15 } });
      const { onSubmit, submit } = setup();

      fireEvent.click(screen.getByTestId('criteria-activity-hike'));
      submit();

      expect(JSON.parse(localStorage.getItem('path-finder.settings')!)).toMatchObject({ lastActivity: 'hike' });
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ activity: 'hike', pace: 15 });
    });

    it('brings the distance down to the longest one of a new activity', () => {
      const { onSubmit, submit } = setup();
      fireEvent.change(slider('distance'), { target: { value: '50' } });

      fireEvent.click(screen.getByTestId('criteria-activity-hike'));
      submit();

      expect(slider('distance')).toHaveValue('40');
      expect(onSubmit.mock.calls[0][0].target).toEqual({ distance: 40 });
    });
  });

  describe('pace hint', () => {
    const info = () => screen.queryByTestId('criteria-pace-info');
    const link = () => screen.queryByTestId('criteria-pace-link');

    it('is not offered for a distance, which does not need the pace', () => {
      setup();

      expect(info()).not.toBeInTheDocument();
    });

    it('links to the settings from the info button of a duration, while the activity has no pace', () => {
      setup();
      choose('target', 'duration');
      expect(link()).not.toBeInTheDocument();

      fireEvent.click(info()!);

      expect(link()).toHaveAttribute('href', '#/settings');
    });

    it('goes away for the activity whose pace is set, and stays for the others', () => {
      store({ pace: { run: 5.5 } });
      setup();
      choose('target', 'duration');
      expect(info()).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('criteria-activity-hike'));

      expect(info()).toBeInTheDocument();
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

    it.each(['en', 'fr'] as const)('names every chip and the dialog of the compact form in %s', (language) => {
      vi.restoreAllMocks();
      const { container } = render(<CriteriaForm language={language} start={START} compact onSubmit={vi.fn()} />);
      expectNamedControls(container);

      fireEvent.click(screen.getByTestId('criteria-chip-surface'));

      expectNamedControls(container);
    });
  });

  describe('compact', () => {
    // Compact is for phones.
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('shows chips instead of the form, highlighting the criteria that are not the default', () => {
      store({ lastActivity: 'hike' });
      setup({ compact: true });

      expect(screen.queryByTestId('criteria-distance')).not.toBeInTheDocument();
      expect(screen.getByTestId('criteria-chip-activity')).toHaveAttribute('data-set');
      expect(screen.getByTestId('criteria-chip-target')).not.toHaveAttribute('data-set');
      expect(screen.getByTestId('criteria-chip-surface')).not.toHaveAttribute('data-set');
    });

    it('names the elevation gain and surface chips while they are the default, so they are told apart', () => {
      setup({ compact: true });

      expect(screen.getByTestId('criteria-chip-elevation')).toHaveAccessibleName(`${en.elevationGain}: ${en.any}`);
      expect(screen.getByTestId('criteria-chip-elevation')).toHaveTextContent(en.elevationChip);
      expect(screen.getByTestId('criteria-chip-surface')).toHaveAccessibleName(`${en.surface}: ${en.anySurface}`);
      expect(screen.getByTestId('criteria-chip-surface')).toHaveTextContent(en.surface);

      fireEvent.click(screen.getByTestId('criteria-chip-surface'));
      choose('surface', 'paved');

      expect(screen.getByTestId('criteria-chip-surface')).toHaveAccessibleName(`${en.surface}: ${en.paved}`);
      expect(screen.getByTestId('criteria-chip-surface')).toHaveTextContent(en.paved);
    });

    it('opens one criterion in a dialog and applies its changes as they are made', () => {
      const { onSubmit, submit } = setup({ compact: true });

      fireEvent.click(screen.getByTestId('criteria-chip-surface'));
      expect(screen.getByTestId('criteria-dialog')).toHaveAccessibleName(en.surface);
      choose('surface', 'paved');

      expect(screen.getByTestId('criteria-chip-surface')).toHaveAttribute('data-set');
      fireEvent.click(screen.getByTestId('criteria-dialog-close'));
      expect(screen.queryByTestId('criteria-dialog')).not.toBeInTheDocument();
      submit();
      expect(onSubmit.mock.calls[0][0].surface).toBe('paved');
    });

    it('shows the error inside the dialog, which covers the sheet', () => {
      store({ lastActivity: 'run' });
      setup({ compact: true });
      fireEvent.click(screen.getByTestId('criteria-chip-elevation'));
      choose('elevation', 'target');
      fireEvent.change(slider('gain'), { target: { value: '2000' } });
      fireEvent.click(screen.getByTestId('criteria-dialog-close'));
      fireEvent.click(screen.getByTestId('criteria-chip-target'));

      choose('target', 'duration');
      fireEvent.change(slider('duration'), { target: { value: '30' } });

      expect(within(screen.getByTestId('criteria-dialog')).getByTestId('criteria-error')).toHaveTextContent(
        en.durationError,
      );
    });

    it('shows the target as a duration with its own chip', () => {
      setup({ compact: true });

      fireEvent.click(screen.getByTestId('criteria-chip-target'));
      choose('target', 'duration');

      expect(screen.getByTestId('criteria-chip-target')).toHaveAccessibleName(
        `${en.target}: 1 ${commonText.en.hour} 00`,
      );
      expect(screen.getByTestId('criteria-chip-target')).toHaveAttribute('data-set');
    });

    it('hides Find routes until a start point is set', () => {
      setup({ compact: true, start: undefined });

      expect(screen.queryByTestId('criteria-submit')).not.toBeInTheDocument();
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
