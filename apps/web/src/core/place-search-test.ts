import { isPlaceQuery, parsePlaces, placeQueryUrl, searchPlaces } from './place-search.ts';

const address = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [2.331303, 48.869141] },
  properties: {
    label: '12 Rue de la Paix 75002 Paris',
    name: '12 Rue de la Paix',
    context: '75, Paris, Île-de-France',
    score: 0.96,
    type: 'housenumber',
  },
};

// A point of interest names its toponym in an array and its town in arrays: the shape differs from an address.
const poi = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [6.750135, 45.905274] },
  properties: { toponym: 'Col de la Forclaz', name: ['Col de la Forclaz'], postcode: ['74190'], city: ['Passy'] },
};

const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });

describe('placeQueryUrl', () => {
  it('asks for addresses and places, near the map when it knows where it is', () => {
    const url = new URL(placeQueryUrl('12 rue de la Paix', [2.33, 48.87]));

    expect(url.origin + url.pathname).toBe('https://data.geopf.fr/geocodage/search');
    expect(url.searchParams.get('q')).toBe('12 rue de la Paix');
    expect(url.searchParams.get('index')).toBe('address,poi');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('autocomplete')).toBe('1');
    expect(url.searchParams.get('lat')).toBe('48.87');
    expect(url.searchParams.get('lon')).toBe('2.33');
  });

  it('leaves the bias out without a map', () => {
    const url = new URL(placeQueryUrl('Chamonix'));

    expect(url.searchParams.has('lat')).toBe(false);
    expect(url.searchParams.has('lon')).toBe(false);
  });
});

describe('isPlaceQuery', () => {
  it.each(['Chamonix', '12 rue de la Paix', '  Lac d’Annecy ', 'Col du 45'])('searches %s', (text) => {
    expect(isPlaceQuery(text)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['spaces', '   '],
    ['two letters', 'Ch'],
    ['a coordinate', '45.8, 6.2'],
    ['hemispheric coordinates', '45.8° N, 6.2° E'],
    ['the format the field writes', '45.8000° N · 6.2000° E'],
    ['digits only', '75002'],
  ])('does not search %s', (_, text) => {
    expect(isPlaceQuery(text)).toBe(false);
  });
});

describe('parsePlaces', () => {
  it('reads an address and a place, with their context', () => {
    expect(parsePlaces(collection(address, poi))).toEqual([
      { position: [2.331303, 48.869141], label: '12 Rue de la Paix', context: '75, Paris, Île-de-France' },
      { position: [6.750135, 45.905274], label: 'Col de la Forclaz', context: '74190 Passy' },
    ]);
  });

  it('falls back to the full label, and leaves the context out when there is none', () => {
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [6.86, 45.92] },
      properties: { label: 'Chamonix 74400 Chamonix-Mont-Blanc' },
    };

    expect(parsePlaces(collection(feature))).toEqual([
      { position: [6.86, 45.92], label: 'Chamonix 74400 Chamonix-Mont-Blanc' },
    ]);
  });

  it.each([
    ['a feature without a position', { type: 'Feature', properties: { label: 'Nowhere' } }],
    [
      'a position beyond the bounds',
      { type: 'Feature', geometry: { type: 'Point', coordinates: [200, 45] }, properties: { label: 'Nowhere' } },
    ],
    ['a feature without a name', { type: 'Feature', geometry: { type: 'Point', coordinates: [6.86, 45.92] } }],
  ])('leaves out %s', (_, feature) => {
    expect(parsePlaces(collection(address, feature))).toEqual([
      { position: [2.331303, 48.869141], label: '12 Rue de la Paix', context: '75, Paris, Île-de-France' },
    ]);
  });

  it.each([
    ['nothing', undefined],
    ['an array', []],
    ['an object without features', {}],
    ['features that are not a list', { features: 'none' }],
    ['another type', { type: 'Feature', features: [] }],
  ])('refuses %s', (_, body) => {
    expect(parsePlaces(body)).toBeUndefined();
  });

  it('answers no place for an empty collection', () => {
    expect(parsePlaces(collection())).toEqual([]);
  });
});

describe('searchPlaces', () => {
  it('asks the Géoplateforme, watching the signal it was given', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(collection(address))));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const places = await searchPlaces('12 rue de la Paix', { signal: controller.signal, near: [2.33, 48.87] });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get('q')).toBe('12 rue de la Paix');
    expect(init.signal).toBe(controller.signal);
    expect(places).toEqual([
      { position: [2.331303, 48.869141], label: '12 Rue de la Paix', context: '75, Paris, Île-de-France' },
    ]);
  });

  it.each([
    ['the answer is not ok', () => Promise.resolve(new Response(null, { status: 503 }))],
    ['the request fails', () => Promise.reject(new Error('No network'))],
    ['the request is aborted', () => Promise.reject(new DOMException('Aborted', 'AbortError'))],
    ['the answer is not a collection', () => Promise.resolve(Response.json({ error: 'nope' }))],
  ])('answers nothing when %s', async (_, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer));

    await expect(searchPlaces('Chamonix')).resolves.toBeUndefined();
  });
});
