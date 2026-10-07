import type { Language } from './language.ts';

export const settingsText = {
  en: {
    display: 'Display',
    theme: 'Theme',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
    language: 'Language',
    units: 'Units',
    metric: 'Metric (km, m)',
    imperial: 'Imperial (mi, ft)',
    about: 'About',
  },
  fr: {
    display: 'Affichage',
    theme: 'Thème',
    system: 'Système',
    light: 'Clair',
    dark: 'Sombre',
    language: 'Langue',
    units: 'Unités',
    metric: 'Métriques (km, m)',
    imperial: 'Impériales (mi, ft)',
    about: 'À propos',
  },
} satisfies Record<Language, unknown>;
