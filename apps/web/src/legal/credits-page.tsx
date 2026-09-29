import type { Language } from '../language.ts';

const osmCopyright = 'https://www.openstreetmap.org/copyright';
const licenceOuverte = 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/';
const agpl = 'https://www.gnu.org/licenses/agpl-3.0.html';
const sourceCode = 'https://github.com/lesloi/path-finder';

export function CreditsPage({ language }: { language: Language }) {
  if (language === 'fr') {
    return (
      <>
        <h2>Données</h2>
        <ul>
          <li>
            Itinéraires calculés sur les données © contributeurs OpenStreetMap, disponibles sous
            licence <a href={osmCopyright}>ODbL</a>.
          </li>
          <li>
            Fond de carte Plan IGN et altitudes BD ALTI 25 m © IGN, sous{' '}
            <a href={licenceOuverte}>Licence Ouverte</a>.
          </li>
        </ul>
        <h2>Code source</h2>
        <p>
          Path finder est un logiciel libre sous licence{' '}
          <a href={agpl}>AGPL-3.0-or-later</a>. Son code source est sur{' '}
          <a href={sourceCode}>github.com/lesloi/path-finder</a>.
        </p>
      </>
    );
  }
  return (
    <>
      <h2>Data</h2>
      <ul>
        <li>
          Routes built on data © OpenStreetMap contributors, available under the{' '}
          <a href={osmCopyright}>ODbL</a>.
        </li>
        <li>
          Plan IGN map and BD ALTI 25 m elevation © IGN, under the{' '}
          <a href={licenceOuverte}>Licence Ouverte</a>.
        </li>
      </ul>
      <h2>Source code</h2>
      <p>
        Path finder is free software under the <a href={agpl}>AGPL-3.0-or-later</a> licence. Its
        source code is at <a href={sourceCode}>github.com/lesloi/path-finder</a>.
      </p>
    </>
  );
}
