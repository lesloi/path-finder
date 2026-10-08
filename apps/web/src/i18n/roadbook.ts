import type { Language } from './language.ts';

/** The lines of a roadbook. Figures arrive written in the user's units. */
export const roadbookText = {
  en: {
    cueStart: 'Start',
    cueFinish: 'Finish: back at the start',
    cueTechnical: 'Technical stretches on this route',
    cueTurn: { left: 'Turn left', right: 'Turn right' },
    cueSurface: { paved: 'Paved section', unpaved: 'Unpaved section' },
    cueClimb: (gain: string, length: string, grade: string) => `Climb: +${gain} over ${length} (${grade})`,
    cueDescent: (loss: string, length: string, grade: string) => `Descent: -${loss} over ${length} (${grade})`,
    cuePoi: { water: 'Water point', viewpoint: 'Viewpoint' },
    cueSeasonal: (label: string) => `${label} (seasonal)`,
  },
  fr: {
    cueStart: 'Départ',
    cueFinish: 'Arrivée : retour au départ',
    cueTechnical: 'Passages techniques sur le parcours',
    cueTurn: { left: 'Tourner à gauche', right: 'Tourner à droite' },
    cueSurface: { paved: 'Section goudronnée', unpaved: 'Section non goudronnée' },
    cueClimb: (gain: string, length: string, grade: string) => `Montée : +${gain} sur ${length} (${grade})`,
    cueDescent: (loss: string, length: string, grade: string) => `Descente : -${loss} sur ${length} (${grade})`,
    cuePoi: { water: 'Point d’eau', viewpoint: 'Point de vue' },
    cueSeasonal: (label: string) => `${label} (saisonnier)`,
  },
} satisfies Record<Language, unknown>;
