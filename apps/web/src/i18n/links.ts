/** The addresses the legal pages link to, which the dictionaries name by id. */
export const LINKS = {
  odbl: 'https://www.openstreetmap.org/copyright',
  licence: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  agpl: 'https://www.gnu.org/licenses/agpl-3.0.html',
  source: 'https://github.com/lesloi/path-finder',
  publisher: 'https://github.com/lesloi',
  contact: 'https://github.com/lesloi/path-finder/issues',
  ovh: 'https://www.ovhcloud.com/fr/terms-and-conditions/',
  cnil: 'https://www.cnil.fr/fr/plaintes',
};

export type LinkId = keyof typeof LINKS;
