import type { Language } from './language.ts';

export const settingsText = {
  en: {
    display: 'Display',
    pace: 'Pace',
    language: 'Language',
    units: 'Units',
    metric: 'Metric (km, m)',
    imperial: 'Imperial (mi, ft)',
    about: 'About',
  },
  fr: {
    display: 'Affichage',
    pace: 'Allure',
    language: 'Langue',
    units: 'Unités',
    metric: 'Métriques (km, m)',
    imperial: 'Impériales (mi, ft)',
    about: 'À propos',
  },
} satisfies Record<Language, unknown>;
