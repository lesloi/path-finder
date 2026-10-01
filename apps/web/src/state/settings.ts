import { useSyncExternalStore } from 'react';

import { ACTIVITY_PACES, DEFAULT_ACTIVITY, type Activity, type Units } from '../core/index.ts';
import type { Language } from '../i18n/index.ts';

/** What the user sets once and keeps on the device. Only the pace leaves it, with a route set request. */
export type Settings = {
  /** Minutes per km, per activity. Absent until the user sets it. */
  pace: Partial<Record<Activity, number>>;
  /** Absent until the user picks one: the app follows the browser. */
  language?: Language;
  units: Units;
  lastActivity: Activity;
};

const KEY = 'path-finder.settings';
const ACTIVITIES = Object.keys(ACTIVITY_PACES) as Activity[];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// Each field falls back to its default on its own, so older or damaged data never breaks the app.
function parse(raw: string | null): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? '{}');
  } catch {
    stored = {};
  }
  const { pace, language, units, lastActivity } = isObject(stored) ? stored : {};
  const paces = isObject(pace) ? pace : {};
  return {
    pace: Object.fromEntries(
      ACTIVITIES.flatMap((activity) => {
        const value = paces[activity];
        return typeof value === 'number' && Number.isFinite(value) && value > 0 ? [[activity, value]] : [];
      }),
    ),
    ...((language === 'fr' || language === 'en') && { language }),
    units: units === 'imperial' ? 'imperial' : 'metric',
    lastActivity: ACTIVITIES.includes(lastActivity as Activity) ? (lastActivity as Activity) : DEFAULT_ACTIVITY,
  };
}

// Storage can be blocked by the browser: the app then runs on the defaults.
function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; settings: Settings } | undefined;

function getSettings(): Settings {
  const raw = readRaw();
  if (!snapshot || snapshot.raw !== raw) snapshot = { raw, settings: parse(raw) };
  return snapshot.settings;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function updateSettings(change: Partial<Settings>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getSettings(), ...change }));
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

/** The settings kept on the device, shared by every component that uses them. */
export function useSettings(): [Settings, (change: Partial<Settings>) => void] {
  return [useSyncExternalStore(subscribe, getSettings), updateSettings];
}

/** The user's pace for an activity, in minutes per km, or its default. */
export function paceFor(settings: Settings, activity: Activity): number {
  return settings.pace[activity] ?? ACTIVITY_PACES[activity].default;
}
