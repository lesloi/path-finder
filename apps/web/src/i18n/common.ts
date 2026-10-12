import type { Language } from './language.ts';

/** Words several screens share: page titles, hemispheres, units of time, the GPX attribution and start label, the map's names. */
export const commonText = {
  en: {
    back: 'Back',
    close: 'Close',
    settings: 'Settings',
    credits: 'Credits',
    privacy: 'Privacy policy',
    legalNotice: 'Legal notice',
    hemispheres: { north: 'N', south: 'S', east: 'E', west: 'W' },
    hour: 'h',
    minute: 'min',
    mapName: 'Map',
    toggleAttribution: 'Toggle attribution',
    gpxStart: 'Start',
    gpxAttribution: 'Data © OpenStreetMap contributors, ODbL.',
    description: 'Generate a custom running or trail route. Free, no account, no tracking.',
  },
  fr: {
    back: 'Retour',
    close: 'Fermer',
    settings: 'Réglages',
    credits: 'Crédits',
    privacy: 'Politique de confidentialité',
    legalNotice: 'Mentions légales',
    hemispheres: { north: 'N', south: 'S', east: 'E', west: 'O' },
    hour: 'h',
    minute: 'min',
    mapName: 'Carte',
    toggleAttribution: 'Afficher les crédits de la carte',
    gpxStart: 'Départ',
    gpxAttribution: 'Données © les contributeurs d’OpenStreetMap, ODbL.',
    description: 'Générez un parcours de course ou de trail sur mesure. Gratuit, sans compte ni suivi.',
  },
} satisfies Record<Language, unknown>;
