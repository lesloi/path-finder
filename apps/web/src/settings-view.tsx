import { useState } from 'react';

import { ACTIVITY_NAMES, ACTIVITY_PACES, type Activity } from './activity.ts';
import type { Language } from './language.ts';
import { paceFor, useSettings } from './settings.ts';
import { formatPace, paceUnit, parsePace, type Units } from './units.ts';

const text = {
  en: {
    title: 'Settings',
    pace: 'Pace',
    language: 'Language',
    units: 'Units',
    metric: 'Metric (km, m)',
    imperial: 'Imperial (mi, ft)',
    about: 'About',
    credits: 'Credits',
    privacy: 'Privacy policy',
    legalNotice: 'Legal notice',
  },
  fr: {
    title: 'Réglages',
    pace: 'Allure',
    language: 'Langue',
    units: 'Unités',
    metric: 'Métriques (km, m)',
    imperial: 'Impériales (mi, ft)',
    about: 'À propos',
    credits: 'Crédits',
    privacy: 'Politique de confidentialité',
    legalNotice: 'Mentions légales',
  },
} satisfies Record<Language, unknown>;

export function SettingsView({ language }: { language: Language }) {
  const t = text[language];
  const [settings, update] = useSettings();
  return (
    <>
      <h1>{t.title}</h1>
      <h2>{t.pace}</h2>
      {(Object.keys(ACTIVITY_PACES) as Activity[]).map((activity) => (
        // A new key on a units change shows the pace again in the new units.
        <PaceInput key={`${activity}-${settings.units}`} activity={activity} language={language} units={settings.units} />
      ))}
      <p>
        <label>
          {t.language}{' '}
          <select value={language} onChange={(event) => update({ language: event.target.value as Language })}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
      </p>
      <p>
        <label>
          {t.units}{' '}
          <select value={settings.units} onChange={(event) => update({ units: event.target.value as Units })}>
            <option value="metric">{t.metric}</option>
            <option value="imperial">{t.imperial}</option>
          </select>
        </label>
      </p>
      <h2>{t.about}</h2>
      <ul>
        <li>
          <a href="#/credits">{t.credits}</a>
        </li>
        <li>
          <a href="#/privacy">{t.privacy}</a>
        </li>
        <li>
          <a href="#/legal-notice">{t.legalNotice}</a>
        </li>
      </ul>
    </>
  );
}

// Keeps what the user types, and saves it as soon as it reads as a pace.
function PaceInput({ activity, language, units }: { activity: Activity; language: Language; units: Units }) {
  const [settings, update] = useSettings();
  const { display } = ACTIVITY_PACES[activity];
  const shown = formatPace(paceFor(settings, activity), display, units, language);
  const [draft, setDraft] = useState(shown);
  return (
    <p>
      <label>
        {`${ACTIVITY_NAMES[activity][language]} (${paceUnit(display, units)})`}{' '}
        <input
          inputMode="decimal"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const pace = parsePace(event.target.value, display, units);
            if (pace !== undefined) update({ pace: { ...settings.pace, [activity]: pace } });
          }}
          onBlur={() => setDraft(shown)}
        />
      </label>
    </p>
  );
}
