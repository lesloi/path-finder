import { fireEvent, render, screen, within } from '@testing-library/react';

import { parseCriteria } from '../../api/src/route-generation/index.ts';
import { CriteriaForm } from './criteria-form.tsx';
import { useSettings } from './settings.ts';
import type { Position } from './start-point-map.tsx';

const START: Position = [6.1294, 45.8992];

const store = (settings: object) => localStorage.setItem('path-finder.settings', JSON.stringify(settings));
const onDesktop = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query) => ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as never,
    );

// The form is the full one, as on desktops, unless a test asks for the compact one.
function setup(props: { start?: Position; compact?: boolean; onExpand?: () => void; language?: 'en' | 'fr' } = {}) {
  const onSubmit = vi.fn();
  render(<CriteriaForm language="en" start={START} onSubmit={onSubmit} {...props} />);
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Find routes' }));
  return { onSubmit, submit };
}

const slider = (name: string) => screen.getByRole('slider', { name });
const choose = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

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

    expect(screen.queryByRole('button', { name: 'Find routes' })).not.toBeInTheDocument();
  });

  it('sends criteria that parseCriteria accepts', () => {
    const { onSubmit, submit } = setup();
    choose('Duration');
    fireEvent.change(slider('Duration'), { target: { value: '90' } });
    choose('Target');
    fireEvent.change(slider('Elevation gain'), { target: { value: '400' } });
    choose('Unpaved');

    submit();

    const request = onSubmit.mock.calls[0][0];
    expect(request).toMatchObject({ target: { duration: 90 }, elevationGain: 400, surface: 'unpaved' });
    expect(() => parseCriteria(request)).not.toThrow();
  });

  describe('target', () => {
    it('is a distance or a duration, never both', () => {
      const { onSubmit, submit } = setup();
      fireEvent.change(slider('Distance'), { target: { value: '21' } });

      choose('Duration');

      expect(screen.queryByRole('slider', { name: 'Distance' })).not.toBeInTheDocument();
      submit();
      expect(onSubmit.mock.calls[0][0].target).toEqual({ duration: 60 });

      choose('Distance');

      expect(slider('Distance')).toHaveValue('21');
    });

    it.each([
      ['metric', 'run', 2, 50],
      ['metric', 'hike', 2, 40],
      ['imperial', 'run', 2, 31],
      ['imperial', 'hike', 2, 24],
    ])('keeps the distance slider within the API bounds in %s units, for a %s', (units, activity, min, max) => {
      store({ units, lastActivity: activity });
      setup();

      expect(slider('Distance')).toHaveAttribute('min', `${min}`);
      expect(slider('Distance')).toHaveAttribute('max', `${max}`);
    });

    it('keeps the duration slider within the API bounds', () => {
      setup();
      choose('Duration');

      expect(slider('Duration')).toHaveAttribute('min', '15');
      expect(slider('Duration')).toHaveAttribute('max', '360');
    });

    it('converts miles to kilometres', () => {
      store({ units: 'imperial' });
      const { onSubmit, submit } = setup();
      fireEvent.change(slider('Distance'), { target: { value: '31' } });

      submit();

      expect(onSubmit.mock.calls[0][0].target).toEqual({ distance: 49.89 });
      expect(() => parseCriteria(onSubmit.mock.calls[0][0])).not.toThrow();
    });

    it('follows a change of units from the settings page', () => {
      const onSubmit = vi.fn();
      render(<UnitsSwitch onSubmit={onSubmit} />);
      fireEvent.change(slider('Distance'), { target: { value: '16' } });
      choose('Target');
      fireEvent.change(slider('Elevation gain'), { target: { value: '500' } });

      fireEvent.click(screen.getByRole('button', { name: 'Imperial' }));

      // 16 km is 9.9 mi, and 500 m is 1,640 ft, which the sliders round to their steps.
      expect(slider('Distance')).toHaveValue('10');
      expect(slider('Elevation gain')).toHaveValue('1600');
    });
  });

  describe('elevation gain', () => {
    it('is left out for Any', () => {
      const { onSubmit, submit } = setup();

      submit();

      expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('elevationGain');
    });

    it.each([
      ['Flat', 'flat'],
      ['Hilly', 'hilly'],
    ])('is sent as %s', (label, expected) => {
      const { onSubmit, submit } = setup();
      choose(label);

      submit();

      expect(onSubmit.mock.calls[0][0].elevationGain).toBe(expected);
    });

    it('is a number of metres for Target', () => {
      const { onSubmit, submit } = setup();
      choose('Target');

      submit();

      expect(onSubmit.mock.calls[0][0].elevationGain).toBe(300);
    });

    it('shows its slider for Target only', () => {
      setup();
      expect(screen.queryByRole('slider', { name: 'Elevation gain' })).not.toBeInTheDocument();

      choose('Target');

      expect(slider('Elevation gain')).toHaveAttribute('max', '2500');
    });

    it('converts feet to metres, within the API bounds', () => {
      store({ units: 'imperial' });
      const { onSubmit, submit } = setup();
      choose('Target');
      expect(slider('Elevation gain')).toHaveAttribute('max', '8200');
      fireEvent.change(slider('Elevation gain'), { target: { value: '8200' } });

      submit();

      expect(onSubmit.mock.calls[0][0].elevationGain).toBe(2_499);
    });
  });

  describe('surface', () => {
    it.each([
      ['Paved', 'paved'],
      ['Unpaved', 'unpaved'],
    ])('sends %s', (label, expected) => {
      const { onSubmit, submit } = setup();
      choose(label);

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
      expect(screen.getByRole('button', { name: 'Hike' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('stores the activity picked and uses its pace', () => {
      store({ pace: { hike: 15 } });
      const { onSubmit, submit } = setup();

      fireEvent.click(screen.getByRole('button', { name: 'Hike' }));
      submit();

      expect(JSON.parse(localStorage.getItem('path-finder.settings')!)).toMatchObject({ lastActivity: 'hike' });
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ activity: 'hike', pace: 15 });
    });

    it('brings the distance down to the longest one of a new activity', () => {
      const { onSubmit, submit } = setup();
      fireEvent.change(slider('Distance'), { target: { value: '50' } });

      fireEvent.click(screen.getByRole('button', { name: 'Hike' }));
      submit();

      expect(slider('Distance')).toHaveValue('40');
      expect(onSubmit.mock.calls[0][0].target).toEqual({ distance: 40 });
    });
  });

  describe('pace hint', () => {
    const hint = () => screen.queryByRole('link', { name: 'Adjust your pace' });

    it('links to the settings while the activity has no pace', () => {
      setup();

      expect(hint()).toHaveAttribute('href', '#/settings');
    });

    it('goes away for the activity whose pace is set, and stays for the others', () => {
      store({ pace: { run: 5.5 } });
      setup();
      expect(hint()).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Hike' }));

      expect(hint()).toBeInTheDocument();
    });
  });

  describe('errors', () => {
    it('names the field and hides Find routes when the target duration does not fit the elevation gain', () => {
      setup();
      choose('Duration');
      fireEvent.change(slider('Duration'), { target: { value: '30' } });
      choose('Target');
      fireEvent.change(slider('Elevation gain'), { target: { value: '2000' } });

      expect(screen.getByRole('alert')).toHaveTextContent(
        'This duration does not fit the elevation gain and your pace.',
      );
      expect(screen.queryByRole('button', { name: 'Find routes' })).not.toBeInTheDocument();
    });

    it('is shown in French', () => {
      setup({ language: 'fr' });
      choose('Durée');
      fireEvent.change(slider('Durée'), { target: { value: '30' } });
      choose('Objectif');
      // Two controls are named "Objectif": the elevation gain's is the last one.
      fireEvent.change(slider('Dénivelé positif'), { target: { value: '2000' } });

      expect(screen.getByRole('alert')).toHaveTextContent('Cette durée ne convient pas');
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

      expect(screen.queryByRole('slider')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Activity: Hike' })).toHaveAttribute('data-set');
      expect(screen.getByRole('button', { name: 'Target: 10 km' })).not.toHaveAttribute('data-set');
      expect(screen.getByRole('button', { name: 'Surface: Any' })).not.toHaveAttribute('data-set');
    });

    it('opens one criterion in a dialog and applies its changes as they are made', () => {
      const { onSubmit, submit } = setup({ compact: true });

      fireEvent.click(screen.getByRole('button', { name: 'Surface: Any' }));
      const dialog = screen.getByRole('dialog', { name: 'Surface' });
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Paved' }));

      expect(screen.getByRole('button', { name: 'Surface: Paved' })).toHaveAttribute('data-set');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      submit();
      expect(onSubmit.mock.calls[0][0].surface).toBe('paved');
    });

    it('shows the target as a duration with its own chip', () => {
      setup({ compact: true });

      fireEvent.click(screen.getByRole('button', { name: 'Target: 10 km' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Duration' }));

      expect(screen.getByRole('button', { name: 'Target: 1 h 00' })).toHaveAttribute('data-set');
    });

    it('asks the view to expand for the last chip', () => {
      const onExpand = vi.fn();
      setup({ compact: true, onExpand });

      fireEvent.click(screen.getByRole('button', { name: 'All criteria' }));

      expect(onExpand).toHaveBeenCalled();
    });

    it('hides Find routes until a start point is set', () => {
      setup({ compact: true, start: undefined });

      expect(screen.queryByRole('button', { name: 'Find routes' })).not.toBeInTheDocument();
    });
  });
});

// Settings are changed elsewhere in the app: a button stands for the settings page.
function UnitsSwitch({ onSubmit }: { onSubmit: () => void }) {
  const [, update] = useSettings();
  return (
    <>
      <button type="button" onClick={() => update({ units: 'imperial' })}>
        Imperial
      </button>
      <CriteriaForm language="en" start={START} onSubmit={onSubmit} />
    </>
  );
}
