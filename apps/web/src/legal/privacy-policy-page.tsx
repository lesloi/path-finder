import type { Language } from '../language.ts';
import { PROSE } from '../ui/index.ts';

const cnil = 'https://www.cnil.fr/fr/plaintes';

export function PrivacyPolicyPage({ language }: { language: Language }) {
  if (language === 'fr') {
    return (
      <div className={PROSE}>
        <p>
          Pas de compte, pas de cookie, pas de mesure d’audience, pas de pistage. Vos réglages restent dans votre
          navigateur. Notre serveur calcule les itinéraires et n’en garde rien.
        </p>

        <h2>Ce qui reste sur votre appareil</h2>
        <p>
          Vos réglages (allure, langue, unités, dernière activité) sont enregistrés dans le stockage de votre
          navigateur. Les itinéraires ne sont jamais enregistrés. Nous ne recevons ni les uns ni les autres. Effacer les
          données du site dans votre navigateur les supprime.
        </p>

        <h2>Votre position</h2>
        <p>
          L’application ne demande votre position que lorsque vous touchez « ma position ». Sinon, vous choisissez le
          point de départ sur la carte.
        </p>

        <h2>Ce que reçoit notre serveur</h2>
        <p>
          Quand vous demandez des itinéraires, notre serveur reçoit vos critères (coordonnées du point de départ,
          activité, allure, distance ou durée visée, dénivelé, préférence de revêtement) et, comme pour toute connexion,
          votre adresse IP. Il s’en sert uniquement pour calculer les itinéraires et les oublie dès la réponse envoyée.
          Il n’écrit aucun journal contenant une position ou une adresse IP.
        </p>
        <p>
          Pour limiter les abus, il garde en mémoire une empreinte (hash) de votre adresse IP, salée avec un secret qui
          change chaque jour. Cette empreinte n’est jamais écrite sur disque et disparaît au plus tard le lendemain.
        </p>
        <p>
          Base légale : notre intérêt légitime à fournir le service que vous demandez et à le protéger (article 6.1.f du
          RGPD).
        </p>

        <h2>Destinataires</h2>
        <ul>
          <li>
            Scaleway, notre hébergeur, fait tourner notre serveur en France et ne traite ces données que pour notre
            compte.
          </li>
          <li>
            L’IGN (Institut national de l’information géographique et forestière), organisme public français : votre
            navigateur charge la carte, avec ses polices et ses icônes, directement depuis la Géoplateforme de l’IGN,
            qui reçoit donc votre adresse IP et la zone de carte affichée. Nos pages n’envoient pas leur adresse (aucun
            « referrer ») à l’IGN.
          </li>
        </ul>
        <p>
          Aucun autre tiers : pas de mesure d’audience, de publicité, de rapport de plantage, ni de police ou de script
          chargé d’ailleurs. Vos données ne quittent pas l’Union européenne.
        </p>

        <h2>Vos droits</h2>
        <p>
          Le RGPD vous donne un droit d’accès, de rectification, d’effacement, d’opposition et de limitation. Comme
          notre serveur ne garde rien qui vous concerne, il n’y a en général rien à consulter ni à effacer chez nous.
          Pour toute question, écrivez à l’éditeur (voir les mentions légales). Vous pouvez aussi{' '}
          <a href={cnil}>saisir la CNIL</a>.
        </p>

        <p>Dernière mise à jour : 28 septembre 2026.</p>
      </div>
    );
  }
  return (
    <div className={PROSE}>
      <p>
        No account, no cookie, no analytics, no tracking. Your settings stay in your browser. Our server generates
        routes and keeps nothing.
      </p>

      <h2>What stays on your device</h2>
      <p>
        Your settings (pace, language, units, last activity) are kept in your browser’s storage. Routes are never saved.
        We receive neither. Clearing the site’s data in your browser erases them.
      </p>

      <h2>Your location</h2>
      <p>
        The app asks for your location only when you tap “my location”. Otherwise, you pick the start point on the map.
      </p>

      <h2>What our server receives</h2>
      <p>
        When you ask for routes, our server receives your criteria (start point coordinates, activity, pace, target
        distance or duration, elevation gain, surface preference) and, as with any connection, your IP address. It uses
        them only to generate the routes and forgets them once the response is sent. It writes no log that contains a
        location or an IP address.
      </p>
      <p>
        To limit abuse, it keeps in memory a hash of your IP address, salted with a secret that changes every day. The
        hash is never written to disk and is gone by the next day at the latest.
      </p>
      <p>
        Legal basis: our legitimate interest in providing the service you ask for and protecting it (Article 6(1)(f)
        GDPR).
      </p>

      <h2>Recipients</h2>
      <ul>
        <li>Scaleway, our host, runs our server in France and processes this data only on our behalf.</li>
        <li>
          IGN (the French national institute of geographic and forest information), a French public body: your browser
          loads the map, with its fonts and icons, straight from the IGN Géoplateforme, which therefore receives your IP
          address and the map area you view. Our pages do not send their address (no referrer) to IGN.
        </li>
      </ul>
      <p>
        No other third party: no analytics, advertising, crash reporting, or fonts or scripts loaded from anywhere else.
        Your data does not leave the European Union.
      </p>

      <h2>Your rights</h2>
      <p>
        The GDPR gives you the right to access, correct, erase, object, and restrict. Since our server keeps nothing
        about you, there is usually nothing for us to show or erase. For any question, write to the publisher (see the
        legal notice). You can also <a href={cnil}>complain to the CNIL</a>, the French data protection authority.
      </p>

      <p>Last updated: 28 September 2026.</p>
    </div>
  );
}
