import type { Language } from './language.ts';

export const settingsText = {
  en: {
    display: 'Display',
    theme: 'Theme',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
    language: 'Language',
    paceUnit: 'Pace',
    about: 'About',
  },
  fr: {
    display: 'Affichage',
    theme: 'Thème',
    system: 'Système',
    light: 'Clair',
    dark: 'Sombre',
    language: 'Langue',
    paceUnit: 'Allure',
    about: 'À propos',
  },
} satisfies Record<Language, unknown>;
