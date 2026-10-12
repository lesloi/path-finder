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
    basemap: 'Map background',
    plan: 'Plan IGN',
    minimal: 'Minimal',
    aerial: 'Aerial photo',
    basemapFailed: 'This map background could not be loaded.',
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
    basemap: 'Fond de carte',
    plan: 'Plan IGN',
    minimal: 'Épuré',
    aerial: 'Photo aérienne',
    basemapFailed: "Ce fond de carte n'a pas pu être chargé.",
    about: 'À propos',
  },
} satisfies Record<Language, unknown>;
