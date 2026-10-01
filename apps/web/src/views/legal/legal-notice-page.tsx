import type { Language } from '../../language.ts';
import { PROSE } from '../../components/index.ts';

const publisher = 'https://github.com/lesloi';
const contact = 'https://github.com/lesloi/path-finder/issues';
const scaleway = 'https://www.scaleway.com';

export function LegalNoticePage({ language }: { language: Language }) {
  if (language === 'fr') {
    return (
      <div className={PROSE} data-testid="legal-notice-page">
        <h2>Éditeur</h2>
        <p>
          Path finder est édité à titre non professionnel par un particulier, connu sur GitHub sous le nom{' '}
          <a href={publisher}>lesloi</a>, qui est aussi directeur de la publication. Comme la loi pour la confiance dans
          l’économie numérique (LCEN) le permet à un éditeur non professionnel, ses coordonnées personnelles ont été
          communiquées à l’hébergeur.
        </p>
        <p>
          Contact : <a href={contact}>github.com/lesloi/path-finder/issues</a>
        </p>
        <h2>Hébergeur</h2>
        <p>
          Scaleway SAS, 8 rue de la Ville l’Évêque, 75008 Paris, France. Téléphone : +33 1 84 13 00 00.{' '}
          <a href={scaleway}>www.scaleway.com</a>
        </p>
      </div>
    );
  }
  return (
    <div className={PROSE} data-testid="legal-notice-page">
      <h2>Publisher</h2>
      <p>
        Path finder is published on a non-professional basis by a private individual, known on GitHub as{' '}
        <a href={publisher}>lesloi</a>, who is also the director of publication. As the French law on confidence in the
        digital economy (LCEN) allows for a non-professional publisher, their personal details have been given to the
        host.
      </p>
      <p>
        Contact: <a href={contact}>github.com/lesloi/path-finder/issues</a>
      </p>
      <h2>Host</h2>
      <p>
        Scaleway SAS, 8 rue de la Ville l’Évêque, 75008 Paris, France. Phone: +33 1 84 13 00 00.{' '}
        <a href={scaleway}>www.scaleway.com</a>
      </p>
    </div>
  );
}
