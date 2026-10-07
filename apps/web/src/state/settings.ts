import { useSyncExternalStore } from 'react';

import { MAX_TARGET_ELEVATION_GAIN, SURFACES, type Criteria } from '../contract/index.ts';
import {
  BASEMAPS,
  DEFAULT_BASEMAP,
  DEFAULT_PACE,
  DEFAULT_THEME,
  type Basemap,
  type Theme,
  type Units,
} from '../core/index.ts';
import type { Language } from '../i18n/index.ts';

/** How the elevation gain is asked for: no preference, a shortcut, or a target in metres. */
export type ElevationLevel = 'any' | 'flat' | 'hilly' | 'target';

/** The criteria the form starts from, the ones that do not change from one search to the next. */
export type LastCriteria = {
  /** What the length is set by. */
  target: 'distance' | 'duration';
  surface: Criteria['surface'];
  level: ElevationLevel;
  /** The target elevation gain, in metres whatever the units. */
  gain: number;
};

/** What the user sets once and keeps on the device. Only the pace leaves it, with a route set request. */
export type Settings = {
  /** Minutes per km on flat ground. */
  pace: number;
  /** Absent until the user picks one: the app follows the browser. */
  language?: Language;
  units: Units;
  theme: Theme;
  basemap: Basemap;
  lastCriteria: LastCriteria;
};

const KEY = 'path-finder.settings';
const LEVELS: ElevationLevel[] = ['any', 'flat', 'hilly', 'target'];

export const DEFAULT_CRITERIA: LastCriteria = { target: 'distance', surface: 'any', level: 'any', gain: 300 };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isPace = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isGain = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= MAX_TARGET_ELEVATION_GAIN;

const isTarget = (value: unknown): value is LastCriteria['target'] => value === 'distance' || value === 'duration';
const isSurface = (value: unknown): value is LastCriteria['surface'] =>
  SURFACES.includes(value as LastCriteria['surface']);
const isLevel = (value: unknown): value is ElevationLevel => LEVELS.includes(value as ElevationLevel);

function parseLastCriteria(stored: unknown): LastCriteria {
  const { target, surface, level, gain } = isObject(stored) ? stored : {};
  return {
    target: isTarget(target) ? target : DEFAULT_CRITERIA.target,
    surface: isSurface(surface) ? surface : DEFAULT_CRITERIA.surface,
    level: isLevel(level) ? level : DEFAULT_CRITERIA.level,
    gain: isGain(gain) ? gain : DEFAULT_CRITERIA.gain,
  };
}

// Each field falls back to its default on its own, so older or damaged data never breaks the app.
// A pace kept per activity, or a last activity, from an earlier version is not read.
function parse(raw: string | null): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? '{}');
  } catch {
    stored = {};
  }
  const { pace, language, units, theme, basemap, lastCriteria } = isObject(stored) ? stored : {};
  return {
    pace: isPace(pace) ? pace : DEFAULT_PACE,
    ...((language === 'fr' || language === 'en') && { language }),
    units: units === 'imperial' ? 'imperial' : 'metric',
    theme: theme === 'light' || theme === 'dark' ? theme : DEFAULT_THEME,
    basemap: BASEMAPS.includes(basemap as Basemap) ? (basemap as Basemap) : DEFAULT_BASEMAP,
    lastCriteria: parseLastCriteria(lastCriteria),
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

/** Calls `listener` with the current settings now and after every change, until the returned function is called. */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const notify = () => listener(getSettings());
  notify();
  return subscribe(notify);
}

/** The settings kept on the device, shared by every component that uses them. */
export function useSettings(): [Settings, (change: Partial<Settings>) => void] {
  return [useSyncExternalStore(subscribe, getSettings), updateSettings];
}
