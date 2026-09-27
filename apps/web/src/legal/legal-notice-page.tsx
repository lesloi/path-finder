import type { Language } from '../language.ts';

const publisher = 'https://github.com/lesloi';
const contact = 'https://github.com/lesloi/path-finder/issues';
const scaleway = 'https://www.scaleway.com';

export function LegalNoticePage({ language }: { language: Language }) {
  if (language === 'fr') {
    return (
      <>
        <h1>Mentions légales</h1>
        <h2>Éditeur</h2>
        <p>
          Path finder est édité à titre non professionnel par un particulier, connu sur GitHub
          sous le nom <a href={publisher}>lesloi</a>, qui est aussi directeur de la publication.
          Comme l’article 6, III, 2 de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans
          l’économie numérique le permet, ses coordonnées personnelles ont été communiquées à
          l’hébergeur.
        </p>
        <p>
          Contact : <a href={contact}>github.com/lesloi/path-finder/issues</a>
        </p>
        <h2>Hébergeur</h2>
        <p>
          Scaleway SAS, 8 rue de la Ville l’Évêque, 75008 Paris, France. Téléphone : +33 1 84 13
          00 00. <a href={scaleway}>www.scaleway.com</a>
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Legal notice</h1>
      <h2>Publisher</h2>
      <p>
        Path finder is published on a non-professional basis by a private individual, known on
        GitHub as <a href={publisher}>lesloi</a>, who is also the director of publication. As
        article 6, III, 2 of French law no. 2004-575 of 21 June 2004 (LCEN) allows, their personal
        details have been given to the host.
      </p>
      <p>
        Contact: <a href={contact}>github.com/lesloi/path-finder/issues</a>
      </p>
      <h2>Host</h2>
      <p>
        Scaleway SAS, 8 rue de la Ville l’Évêque, 75008 Paris, France. Phone: +33 1 84 13 00 00.{' '}
        <a href={scaleway}>www.scaleway.com</a>
      </p>
    </>
  );
}
