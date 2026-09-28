import type { Activity } from '../../api/src/route-generation/index.ts';
import type { Language } from './language.ts';
import type { PaceDisplay } from './units.ts';

export type { Activity };

export const ACTIVITY_NAMES: Record<Activity, Record<Language, string>> = {
  run: { fr: 'Course', en: 'Run' },
  hike: { fr: 'Randonnée', en: 'Hike' },
};

/** Each activity's pace until the user sets one, in minutes per km, and how it is shown. */
export const ACTIVITY_PACES: Record<Activity, { default: number; display: PaceDisplay }> = {
  run: { default: 6, display: 'pace' },
  hike: { default: 60 / 4.5, display: 'speed' },
};
