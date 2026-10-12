/** The addresses the legal pages and the GPX export link to; the dictionaries name the former by id. */
export const LINKS = {
  app: 'https://mypathfinder.fr/',
  odbl: 'https://www.openstreetmap.org/copyright',
  // The licence text itself, where `odbl` is OSM's copyright page.
  odblText: 'https://opendatacommons.org/licenses/odbl/',
  licence: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  agpl: 'https://www.gnu.org/licenses/agpl-3.0.html',
  source: 'https://github.com/lesloi/path-finder',
  publisher: 'https://github.com/lesloi',
  contact: 'https://github.com/lesloi/path-finder/issues',
  ovh: 'https://www.ovhcloud.com/fr/terms-and-conditions/',
  cnil: 'https://www.cnil.fr/fr/plaintes',
};

export type LinkId = keyof typeof LINKS;
