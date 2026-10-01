import type { ErrorCode } from '../../../api/src/contract.ts';
import type { Language } from './language.ts';

/** What the user reads for each error code the API answers with. */
export const errorText = {
  en: {
    'invalid-json': 'The request could not be read.',
    'invalid-criteria': 'These criteria are not valid.',
    'stale-build': 'A new version is available: the page reloads.',
    'rate-limited': 'Too many requests: try again in a few minutes.',
    overloaded: 'The service is busy: try again in a few seconds.',
    'generation-timeout': 'The routes took too long to compute: try other criteria.',
  },
  fr: {
    'invalid-json': 'La requête n’a pas pu être lue.',
    'invalid-criteria': 'Ces critères ne sont pas valides.',
    'stale-build': 'Une nouvelle version est disponible : la page se recharge.',
    'rate-limited': 'Trop de requêtes : réessayez dans quelques minutes.',
    overloaded: 'Le service est occupé : réessayez dans quelques secondes.',
    'generation-timeout': 'Le calcul des parcours a pris trop de temps : essayez d’autres critères.',
  },
} satisfies Record<Language, Record<ErrorCode, string>>;
