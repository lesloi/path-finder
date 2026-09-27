import type { Activity } from '../../api/src/route-generation/index.ts';
import type { Language } from './language.ts';

export type { Activity };

export const ACTIVITY_NAMES: Record<Activity, Record<Language, string>> = {
  run: { fr: 'Course', en: 'Run' },
  hike: { fr: 'Randonnée', en: 'Hike' },
};
