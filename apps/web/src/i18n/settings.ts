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
    metric: 'km, m',
    imperial: 'mi, ft',
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
    metric: 'km, m',
    imperial: 'mi, ft',
    about: 'À propos',
  },
} satisfies Record<Language, unknown>;
