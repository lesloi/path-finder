import type { Activity } from '../contract/index.ts';
import type { PaceDisplay } from './units.ts';

export type { Activity };

/** Each activity's pace until the user sets one, in minutes per km, and how it is shown. */
export const ACTIVITY_PACES: Record<Activity, { default: number; display: PaceDisplay }> = {
  run: { default: 6, display: 'pace' },
  hike: { default: 60 / 4.5, display: 'speed' },
};

/** The activity before the user has used one. */
export const DEFAULT_ACTIVITY: Activity = 'run';
