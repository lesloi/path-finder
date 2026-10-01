import { ChevronRight, Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';

import {
  ACTIVITY_PACES,
  type Activity,
  formatPace,
  paceUnit,
  parsePace,
  type Theme,
  type Units,
} from '../core/index.ts';
import { commonText, settingsText, type Language } from '../i18n/index.ts';
import { paceFor, useSettings } from '../state/index.ts';
import { Dropdown, GROUP_TITLE, LIST, LIST_ROW, LIST_ROW_CHEVRON } from '../components/index.ts';

const FLAG_CLASSES = 'flex-none ring-1 ring-border';

export function SettingsView({ language }: { language: Language }) {
  const t = { ...commonText[language], ...settingsText[language] };
  const [settings, update] = useSettings();
  return (
    <>
      <h2 className={GROUP_TITLE}>{t.display}</h2>
      <div className={LIST}>
        <div className={LIST_ROW}>
          <Dropdown
            testId="settings-theme"
            label={t.theme}
            value={settings.theme}
            options={[
              { value: 'system', label: t.system, icon: <Monitor size={18} aria-hidden /> },
              { value: 'light', label: t.light, icon: <Sun size={18} aria-hidden /> },
              { value: 'dark', label: t.dark, icon: <Moon size={18} aria-hidden /> },
            ]}
            onChange={(theme: Theme) => update({ theme })}
          />
        </div>
        <div className={LIST_ROW}>
          <Dropdown
            testId="settings-language"
            label={t.language}
            value={language}
            options={[
              { value: 'fr', label: 'Français', icon: <FrenchFlag /> },
              { value: 'en', label: 'English', icon: <BritishFlag /> },
            ]}
            onChange={(picked) => update({ language: picked })}
          />
        </div>
        <div className={LIST_ROW}>
          <Dropdown
            testId="settings-units"
            label={t.units}
            value={settings.units}
            options={[
              { value: 'metric', label: t.metric },
              { value: 'imperial', label: t.imperial },
            ]}
            onChange={(units: Units) => update({ units })}
          />
        </div>
      </div>
      <h2 className={GROUP_TITLE}>{t.pace}</h2>
      <div className={LIST}>
        {(Object.keys(ACTIVITY_PACES) as Activity[]).map((activity) => (
          // A new key on a units change shows the pace again in the new units.
          <PaceInput
            key={`${activity}-${settings.units}`}
            activity={activity}
            language={language}
            units={settings.units}
          />
        ))}
      </div>
      <h2 className={GROUP_TITLE}>{t.about}</h2>
      <nav className={LIST}>
        {[
          [t.credits, '#/credits', 'settings-credits'],
          [t.privacy, '#/privacy', 'settings-privacy'],
          [t.legalNotice, '#/legal-notice', 'settings-legal-notice'],
        ].map(([name, href, testId]) => (
          <a key={href} className={LIST_ROW} data-testid={testId} href={href}>
            {name}
            <ChevronRight size={18} aria-hidden className={LIST_ROW_CHEVRON} />
          </a>
        ))}
      </nav>
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
    <label className={LIST_ROW}>
      {`${commonText[language].activities[activity]} (${paceUnit(display, units)})`}
      <input
        data-testid={`settings-pace-${activity}`}
        className="min-h-touch w-22 rounded-sm bg-surface-2 px-3 text-right"
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
  );
}

function FrenchFlag() {
  return (
    <svg className={FLAG_CLASSES} viewBox="0 0 3 2" width="24" height="16" aria-hidden>
      <path fill="#002395" d="M0 0h1v2H0z" />
      <path fill="#ffffff" d="M1 0h1v2H1z" />
      <path fill="#ed2939" d="M2 0h1v2H2z" />
    </svg>
  );
}

function BritishFlag() {
  return (
    <svg className={FLAG_CLASSES} viewBox="0 0 60 30" width="24" height="16" aria-hidden>
      <path fill="#012169" d="M0 0h60v30H0z" />
      <path stroke="#ffffff" strokeWidth="6" d="M0 0l60 30M60 0L0 30" />
      <path stroke="#c8102e" strokeWidth="2" d="M0 0l60 30M60 0L0 30" />
      <path stroke="#ffffff" strokeWidth="10" d="M30 0v30M0 15h60" />
      <path stroke="#c8102e" strokeWidth="6" d="M30 0v30M0 15h60" />
    </svg>
  );
}
