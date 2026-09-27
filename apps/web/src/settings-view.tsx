import type { Language } from './language.ts';

const text = {
  en: {
    title: 'Settings',
    about: 'About',
    credits: 'Credits',
    privacy: 'Privacy policy',
    legalNotice: 'Legal notice',
  },
  fr: {
    title: 'Réglages',
    about: 'À propos',
    credits: 'Crédits',
    privacy: 'Politique de confidentialité',
    legalNotice: 'Mentions légales',
  },
} satisfies Record<Language, unknown>;

export function SettingsView({ language }: { language: Language }) {
  const t = text[language];
  return (
    <>
      <h1>{t.title}</h1>
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
