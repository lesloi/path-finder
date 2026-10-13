import { useSyncExternalStore } from 'react';

import {
  MAX_TARGET_DISTANCE,
  MAX_TARGET_ELEVATION_GAIN,
  MIN_TARGET_DISTANCE,
  SURFACES,
  TARGET_DURATION,
  type Criteria,
} from '../contract/index.ts';
import {
  BASEMAPS,
  DEFAULT_POI_LAYERS,
  POI_CATEGORIES,
  type PoiLayers,
  DEFAULT_BASEMAP,
  DEFAULT_PACE,
  DEFAULT_PACE_UNIT,
  DEFAULT_THEME,
  type Basemap,
  type Theme,
  PACE_UNITS,
  type PaceUnit,
} from '../core/index.ts';
import { browserLanguage, type Language } from '../i18n/index.ts';

/** How the elevation gain is asked for: no preference, a shortcut, or a target in metres. */
export type ElevationLevel = 'any' | 'flat' | 'hilly' | 'target';

/** The criteria the form starts from: what the user asked for last. */
export type LastCriteria = {
  /** What the length is set by. */
  target: 'distance' | 'duration';
  /** The target distance, in kilometres. */
  distance: number;
  /** The target duration, in minutes. */
  duration: number;
  surface: Criteria['surface'];
  level: ElevationLevel;
  /** The target elevation gain, in metres. */
  gain: number;
};

/** What the user sets once and keeps on the device. Only the pace and the last criteria leave it, with a route set request. */
export type Settings = {
  /** Minutes per km on flat ground. */
  pace: number;
  /** Absent until the user picks one: the app follows the browser. */
  language?: Language;
  /** How the pace is written: minutes per km until the user picks km/h. */
  paceUnit: PaceUnit;
  theme: Theme;
  basemap: Basemap;
  /** Which categories of points of interest the map shows. */
  poiLayers: PoiLayers;
  lastCriteria: LastCriteria;
};

const KEY = 'path-finder.settings';
const LEVELS: ElevationLevel[] = ['any', 'flat', 'hilly', 'target'];

export const DEFAULT_CRITERIA: LastCriteria = {
  target: 'distance',
  distance: 10,
  duration: 60,
  surface: 'any',
  level: 'any',
  gain: 300,
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isPace = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const inRange =
  (min: number, max: number) =>
  (value: unknown): value is number =>
    typeof value === 'number' && value >= min && value <= max;
const isGain = inRange(0, MAX_TARGET_ELEVATION_GAIN);
const isDistance = inRange(MIN_TARGET_DISTANCE, MAX_TARGET_DISTANCE);
const isDuration = inRange(TARGET_DURATION.min, TARGET_DURATION.max);

const isTarget = (value: unknown): value is LastCriteria['target'] => value === 'distance' || value === 'duration';
const isSurface = (value: unknown): value is LastCriteria['surface'] =>
  SURFACES.includes(value as LastCriteria['surface']);
const isLevel = (value: unknown): value is ElevationLevel => LEVELS.includes(value as ElevationLevel);

function parsePoiLayers(stored: unknown): PoiLayers {
  const layers = isObject(stored) ? stored : {};
  const shown = (category: keyof PoiLayers) =>
    typeof layers[category] === 'boolean' ? layers[category] : DEFAULT_POI_LAYERS[category];
  return Object.fromEntries(POI_CATEGORIES.map((category) => [category, shown(category)])) as PoiLayers;
}

function parseLastCriteria(stored: unknown): LastCriteria {
  const { target, distance, duration, surface, level, gain } = isObject(stored) ? stored : {};
  return {
    target: isTarget(target) ? target : DEFAULT_CRITERIA.target,
    distance: isDistance(distance) ? distance : DEFAULT_CRITERIA.distance,
    duration: isDuration(duration) ? duration : DEFAULT_CRITERIA.duration,
    surface: isSurface(surface) ? surface : DEFAULT_CRITERIA.surface,
    level: isLevel(level) ? level : DEFAULT_CRITERIA.level,
    gain: isGain(gain) ? gain : DEFAULT_CRITERIA.gain,
  };
}

// Each field falls back to its default on its own, so older or damaged data never breaks the app.
// A pace kept per activity, a last activity, or units (miles and feet) from an earlier version are not read.
function parse(raw: string | null): Settings {
  let stored: unknown;
  try {
    stored = JSON.parse(raw ?? '{}');
  } catch {
    stored = {};
  }
  const { pace, language, paceUnit, theme, basemap, poiLayers, lastCriteria } = isObject(stored) ? stored : {};
  return {
    pace: isPace(pace) ? pace : DEFAULT_PACE,
    ...((language === 'fr' || language === 'en') && { language }),
    paceUnit: PACE_UNITS.includes(paceUnit as PaceUnit) ? (paceUnit as PaceUnit) : DEFAULT_PACE_UNIT,
    theme: theme === 'light' || theme === 'dark' ? theme : DEFAULT_THEME,
    basemap: BASEMAPS.includes(basemap as Basemap) ? (basemap as Basemap) : DEFAULT_BASEMAP,
    poiLayers: parsePoiLayers(poiLayers),
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

/** The language the app is shown in: the user's, else the browser's. */
export function languageOf({ language }: Settings): Language {
  return language ?? browserLanguage(navigator.languages);
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
