import type { LinkId } from './links.ts';
import type { Language } from './language.ts';

/** A paragraph or list item: `{id}` in `text` stands for the link of that id, shown as `links[id]`. */
export type Paragraph = { text: string; links?: Partial<Record<LinkId, string>> };

type Block = { paragraph: Paragraph } | { list: Paragraph[] };

/** A part of a legal page: its id, its heading unless it is the introduction, and what follows. */
export type Section = { id: string; title?: string; blocks: Block[] };

/** Where the privacy policy was last updated, as a UTC calendar day. */
export const PRIVACY_POLICY_UPDATED = '2026-09-28';

/** The "Last updated" line of the privacy policy, with the day written as the language does (28 September 2026). */
export function privacyUpdatedLine(language: Language): string {
  const locale = language === 'en' ? 'en-GB' : language;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(PRIVACY_POLICY_UPDATED),
  );
  return legalText[language].privacyUpdated(day);
}

/** The legal pages: the credits, the privacy policy, and the legal notice. */
export const legalText = {
  en: {
    credits: [
      {
        id: 'data',
        title: 'Data',
        blocks: [
          {
            list: [
              {
                text: 'Routes built on data © OpenStreetMap contributors, available under the {odbl}.',
                links: { odbl: 'ODbL' },
              },
              {
                text: 'Plan IGN map, aerial photography and BD ALTI 25 m elevation © IGN, under the {licence}.',
                links: { licence: 'Licence Ouverte' },
              },
            ],
          },
        ],
      },
      {
        id: 'source-code',
        title: 'Source code',
        blocks: [
          {
            paragraph: {
              text: 'Path finder is free software under the {agpl} licence. Its source code is at {source}.',
              links: { agpl: 'AGPL-3.0-or-later', source: 'github.com/lesloi/path-finder' },
            },
          },
        ],
      },
    ],
    privacy: [
      {
        id: 'summary',
        blocks: [
          {
            paragraph: {
              text: 'No account, no cookie, no analytics, no tracking. Your settings stay in your browser. Our server generates routes and keeps nothing.',
            },
          },
        ],
      },
      {
        id: 'on-device',
        title: 'What stays on your device',
        blocks: [
          {
            paragraph: {
              text: 'Your settings (pace, language, units, last criteria) are kept in your browser’s storage. Routes are never saved. We receive neither. Clearing the site’s data in your browser erases them.',
            },
          },
        ],
      },
      {
        id: 'location',
        title: 'Your location',
        blocks: [
          {
            paragraph: {
              text: 'The app asks for your location only when you tap “my location”. Otherwise, you pick the start point on the map.',
            },
          },
        ],
      },
      {
        id: 'server',
        title: 'What our server receives',
        blocks: [
          {
            paragraph: {
              text: 'When you ask for routes, our server receives your criteria (start point coordinates, pace, target distance or duration, elevation gain, surface preference) and, as with any connection, your IP address. It uses them only to generate the routes and forgets them once the response is sent. It writes no log that contains a location or an IP address.',
            },
          },
          {
            paragraph: {
              text: 'When the app opens, it also asks our server which areas it can generate routes in, to grey out the others on the map. This request holds nothing about you: your IP address, as with any connection, and no location.',
            },
          },
          {
            paragraph: {
              text: 'To limit abuse, it keeps in memory a hash of your IP address, salted with a secret that changes every day. The hash is never written to disk and is gone by the next day at the latest.',
            },
          },
          {
            paragraph: {
              text: 'Legal basis: our legitimate interest in providing the service you ask for and protecting it (Article 6(1)(f) GDPR).',
            },
          },
        ],
      },
      {
        id: 'recipients',
        title: 'Recipients',
        blocks: [
          {
            list: [
              { text: 'OVHcloud, our host, runs our server in France and processes this data only on our behalf.' },
              {
                text: 'IGN (the French national institute of geographic and forest information), a French public body: your browser loads the map, with its fonts and icons, straight from the IGN Géoplateforme, which therefore receives your IP address and the map area you view. Our pages do not send their address (no referrer) to IGN.',
              },
            ],
          },
          {
            paragraph: {
              text: 'No other third party: no analytics, advertising, crash reporting, or fonts or scripts loaded from anywhere else. Your data does not leave the European Union.',
            },
          },
        ],
      },
      {
        id: 'rights',
        title: 'Your rights',
        blocks: [
          {
            paragraph: {
              text: 'The GDPR gives you the right to access, correct, erase, object, and restrict. Since our server keeps nothing about you, there is usually nothing for us to show or erase. For any question, write to the publisher (see the legal notice). You can also {cnil}, the French data protection authority.',
              links: { cnil: 'complain to the CNIL' },
            },
          },
        ],
      },
    ],
    privacyUpdated: (date: string) => `Last updated: ${date}.`,
    legalNotice: [
      {
        id: 'publisher',
        title: 'Publisher',
        blocks: [
          {
            paragraph: {
              text: 'Path finder is published on a non-professional basis by a private individual, known on GitHub as {publisher}, who is also the director of publication. As the French law on confidence in the digital economy (LCEN) allows for a non-professional publisher, their personal details have been given to the host.',
              links: { publisher: 'lesloi' },
            },
          },
          { paragraph: { text: 'Contact: {contact}', links: { contact: 'github.com/lesloi/path-finder/issues' } } },
        ],
      },
      {
        id: 'host',
        title: 'Host',
        blocks: [
          {
            paragraph: {
              text: 'OVH SAS, 2 rue Kellermann, 59100 Roubaix, France. Legal notice: {ovh}',
              links: { ovh: 'www.ovhcloud.com/fr/terms-and-conditions' },
            },
          },
        ],
      },
    ],
  },
  fr: {
    credits: [
      {
        id: 'data',
        title: 'Données',
        blocks: [
          {
            list: [
              {
                text: 'Itinéraires calculés sur les données © contributeurs OpenStreetMap, disponibles sous licence {odbl}.',
                links: { odbl: 'ODbL' },
              },
              {
                text: 'Fond de carte Plan IGN, photographies aériennes et altitudes BD ALTI 25 m © IGN, sous {licence}.',
                links: { licence: 'Licence Ouverte' },
              },
            ],
          },
        ],
      },
      {
        id: 'source-code',
        title: 'Code source',
        blocks: [
          {
            paragraph: {
              text: 'Path finder est un logiciel libre sous licence {agpl}. Son code source est sur {source}.',
              links: { agpl: 'AGPL-3.0-or-later', source: 'github.com/lesloi/path-finder' },
            },
          },
        ],
      },
    ],
    privacy: [
      {
        id: 'summary',
        blocks: [
          {
            paragraph: {
              text: 'Pas de compte, pas de cookie, pas de mesure d’audience, pas de pistage. Vos réglages restent dans votre navigateur. Notre serveur calcule les itinéraires et n’en garde rien.',
            },
          },
        ],
      },
      {
        id: 'on-device',
        title: 'Ce qui reste sur votre appareil',
        blocks: [
          {
            paragraph: {
              text: 'Vos réglages (allure, langue, unités, derniers critères) sont enregistrés dans le stockage de votre navigateur. Les itinéraires ne sont jamais enregistrés. Nous ne recevons ni les uns ni les autres. Effacer les données du site dans votre navigateur les supprime.',
            },
          },
        ],
      },
      {
        id: 'location',
        title: 'Votre position',
        blocks: [
          {
            paragraph: {
              text: 'L’application ne demande votre position que lorsque vous touchez « ma position ». Sinon, vous choisissez le point de départ sur la carte.',
            },
          },
        ],
      },
      {
        id: 'server',
        title: 'Ce que reçoit notre serveur',
        blocks: [
          {
            paragraph: {
              text: 'Quand vous demandez des itinéraires, notre serveur reçoit vos critères (coordonnées du point de départ, allure, distance ou durée visée, dénivelé, préférence de revêtement) et, comme pour toute connexion, votre adresse IP. Il s’en sert uniquement pour calculer les itinéraires et les oublie dès la réponse envoyée. Il n’écrit aucun journal contenant une position ou une adresse IP.',
            },
          },
          {
            paragraph: {
              text: 'À l’ouverture, l’application demande aussi à notre serveur dans quelles zones il peut calculer des itinéraires, pour griser les autres sur la carte. Cette requête ne contient rien sur vous : votre adresse IP, comme pour toute connexion, et aucune position.',
            },
          },
          {
            paragraph: {
              text: 'Pour limiter les abus, il garde en mémoire une empreinte (hash) de votre adresse IP, salée avec un secret qui change chaque jour. Cette empreinte n’est jamais écrite sur disque et disparaît au plus tard le lendemain.',
            },
          },
          {
            paragraph: {
              text: 'Base légale : notre intérêt légitime à fournir le service que vous demandez et à le protéger (article 6.1.f du RGPD).',
            },
          },
        ],
      },
      {
        id: 'recipients',
        title: 'Destinataires',
        blocks: [
          {
            list: [
              {
                text: 'OVHcloud, notre hébergeur, fait tourner notre serveur en France et ne traite ces données que pour notre compte.',
              },
              {
                text: 'L’IGN (Institut national de l’information géographique et forestière), organisme public français : votre navigateur charge la carte, avec ses polices et ses icônes, directement depuis la Géoplateforme de l’IGN, qui reçoit donc votre adresse IP et la zone de carte affichée. Nos pages n’envoient pas leur adresse (aucun « referrer ») à l’IGN.',
              },
            ],
          },
          {
            paragraph: {
              text: 'Aucun autre tiers : pas de mesure d’audience, de publicité, de rapport de plantage, ni de police ou de script chargé d’ailleurs. Vos données ne quittent pas l’Union européenne.',
            },
          },
        ],
      },
      {
        id: 'rights',
        title: 'Vos droits',
        blocks: [
          {
            paragraph: {
              text: 'Le RGPD vous donne un droit d’accès, de rectification, d’effacement, d’opposition et de limitation. Comme notre serveur ne garde rien qui vous concerne, il n’y a en général rien à consulter ni à effacer chez nous. Pour toute question, écrivez à l’éditeur (voir les mentions légales). Vous pouvez aussi {cnil}.',
              links: { cnil: 'saisir la CNIL' },
            },
          },
        ],
      },
    ],
    privacyUpdated: (date: string) => `Dernière mise à jour : ${date}.`,
    legalNotice: [
      {
        id: 'publisher',
        title: 'Éditeur',
        blocks: [
          {
            paragraph: {
              text: 'Path finder est édité à titre non professionnel par un particulier, connu sur GitHub sous le nom {publisher}, qui est aussi directeur de la publication. Comme la loi pour la confiance dans l’économie numérique (LCEN) le permet à un éditeur non professionnel, ses coordonnées personnelles ont été communiquées à l’hébergeur.',
              links: { publisher: 'lesloi' },
            },
          },
          { paragraph: { text: 'Contact : {contact}', links: { contact: 'github.com/lesloi/path-finder/issues' } } },
        ],
      },
      {
        id: 'host',
        title: 'Hébergeur',
        blocks: [
          {
            paragraph: {
              text: 'OVH SAS, 2 rue Kellermann, 59100 Roubaix, France. Mentions légales : {ovh}',
              links: { ovh: 'www.ovhcloud.com/fr/terms-and-conditions' },
            },
          },
        ],
      },
    ],
  },
} satisfies Record<
  Language,
  { credits: Section[]; privacy: Section[]; legalNotice: Section[] } & Record<string, unknown>
>;
