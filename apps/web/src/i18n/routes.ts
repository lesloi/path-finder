import type { Miss } from '../../../api/src/contract.ts';
import type { Language } from './language.ts';

/**
 * The route set view, the route detail, and what the app says while it asks for routes. Labels it shares
 * with the criteria (distance, elevation gain, surface…) are in `criteriaText`.
 */
export const routesText = {
  en: {
    routes: 'Routes',
    routeCount: (count: number) => (count === 1 ? '1 route' : `${count} routes`),
    changeCriteria: (summary: string) => `Change the criteria: ${summary}`,
    showRoutes: (count: number) => (count === 1 ? 'Show the route found' : `Show the ${count} routes found`),
    route: (index: number, count: number) => `Route ${index} of ${count}`,
    previous: 'Previous route',
    next: 'Next route',
    climb: 'Climb',
    descent: 'Descent',
    estimatedDuration: 'Estimated duration',
    profile: (min: string, max: string) => `Elevation profile, from ${min} to ${max}`,
    altitude: 'Altitude',
    slope: 'Slope',
    exportGpx: 'Export GPX',
    finding: 'Finding routes…',
    // The worded gap of a missed criterion: "+30% elevation gain".
    misses: { distance: 'distance', duration: 'duration', elevationGain: 'elevation gain' },
    noRoutes: 'No route found around this start point.',
    noRoutesHint: 'Try another start point or other criteria.',
    unreachable: 'The service cannot be reached.',
    unreachableHint: 'Check your connection, then try again.',
    failed: 'The service did not answer properly.',
    failedHint: 'Try again in a moment.',
  },
  fr: {
    routes: 'Parcours',
    routeCount: (count: number) => `${count} parcours`,
    changeCriteria: (summary: string) => `Modifier les critères : ${summary}`,
    showRoutes: (count: number) => (count === 1 ? 'Voir le parcours trouvé' : `Voir les ${count} parcours trouvés`),
    route: (index: number, count: number) => `Parcours ${index} sur ${count}`,
    previous: 'Parcours précédent',
    next: 'Parcours suivant',
    climb: 'Montée',
    descent: 'Descente',
    estimatedDuration: 'Durée estimée',
    profile: (min: string, max: string) => `Profil altimétrique, de ${min} à ${max}`,
    altitude: 'Altitude',
    slope: 'Pente',
    exportGpx: 'Exporter en GPX',
    finding: 'Recherche de parcours…',
    misses: { distance: 'de distance', duration: 'de durée', elevationGain: 'de dénivelé' },
    noRoutes: 'Aucun parcours trouvé autour de ce point de départ.',
    noRoutesHint: 'Essayez un autre point de départ ou d’autres critères.',
    unreachable: 'Le service est injoignable.',
    unreachableHint: 'Vérifiez votre connexion, puis réessayez.',
    failed: 'Le service n’a pas répondu correctement.',
    failedHint: 'Réessayez dans un instant.',
  },
} satisfies Record<Language, { misses: Record<Miss['criterion'], string> } & Record<string, unknown>>;
