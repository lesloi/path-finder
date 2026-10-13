import { ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { BASEMAPS, PACE_UNITS, type Basemap, type PaceUnit, type Theme } from '../core/index.ts';
import { commonText, settingsText, type Language } from '../i18n/index.ts';
import { useSettings } from '../state/index.ts';
import { GROUP_TITLE, LIST, LIST_ROW, LIST_ROW_CHEVRON, SelectControl } from '../components/index.ts';

export function SettingsView({ language }: { language: Language }) {
  const t = { ...commonText[language], ...settingsText[language] };
  const [settings, update] = useSettings();
  const errorId = useId();
  // The map gives the previous background back when the style of a new one fails to load, behind this page: a pick
  // that is no longer the saved one is the one that failed.
  const [picked, setPicked] = useState<Basemap>();
  const basemapFailed = picked !== undefined && picked !== settings.basemap;
  return (
    <>
      <h2 className={GROUP_TITLE}>{t.display}</h2>
      <div className={LIST}>
        <SettingRow label={t.theme}>
          <SelectControl
            testId="settings-theme"
            label={t.theme}
            value={settings.theme}
            options={[
              { value: 'system', label: t.system },
              { value: 'light', label: t.light },
              { value: 'dark', label: t.dark },
            ]}
            onChange={(theme: Theme) => update({ theme })}
          />
        </SettingRow>
        <SettingRow label={t.language}>
          <SelectControl
            testId="settings-language"
            label={t.language}
            value={language}
            options={[
              { value: 'fr', label: 'Français' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(picked) => update({ language: picked })}
          />
        </SettingRow>
        <SettingRow label={t.basemap}>
          <SelectControl
            testId="settings-basemap"
            label={t.basemap}
            value={settings.basemap}
            options={BASEMAPS.map((value) => ({ value, label: t[value] }))}
            describedBy={basemapFailed ? errorId : undefined}
            onChange={(basemap: Basemap) => {
              setPicked(basemap);
              update({ basemap });
            }}
          />
          {basemapFailed && (
            <p id={errorId} role="alert" data-testid="settings-basemap-error" className="w-full text-sm">
              {t.basemapFailed}
            </p>
          )}
        </SettingRow>
        <SettingRow label={t.paceUnit}>
          <SelectControl
            testId="settings-pace-unit"
            label={t.paceUnit}
            value={settings.paceUnit}
            options={PACE_UNITS.map((value) => ({ value, label: value }))}
            onChange={(paceUnit: PaceUnit) => update({ paceUnit })}
          />
        </SettingRow>
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

/** A label and its control; the control wraps under the label when the row is too narrow, or the text too large. */
function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={`${LIST_ROW} flex-wrap py-2`}>
      <span className="font-semibold">{label}</span>
      {children}
    </div>
  );
}
