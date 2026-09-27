import type { LoopRequest } from '../route-generation/index.ts';
import { createBRouter } from './brouter.ts';

const request: LoopRequest = {
  start: [6.1294, 45.8992],
  radius: 1666.7,
  heading: 18,
  activity: 'run',
  surface: 'unpaved',
};
const signal = new AbortController().signal;

// A trimmed BRouter GeoJSON answer.
const answer = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        'track-length': '8420',
        messages: [
          ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'WayTags', 'NodeTags'],
          ['6129400', '45899200', '448', '300', '1000', 'highway=track surface=gravel', ''],
          ['6130000', '45901000', '450', '700', '1000', 'highway=residential', ''],
        ],
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [6.1294, 45.8992, 448],
          [6.13, 45.901, 450],
          [6.1294, 45.8992, 448],
        ],
      },
    },
  ],
};

describe('createBRouter', () => {
  const fetch = vi.fn<typeof globalThis.fetch>();

  beforeEach(() => {
    fetch.mockReset();
    vi.stubGlobal('fetch', fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for a loop in round-trip mode with the profile overrides', async () => {
    fetch.mockResolvedValue(Response.json(answer));

    await createBRouter('http://brouter:17777')(request, signal);

    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('http://brouter:17777/brouter');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lonlats: '6.1294,45.8992',
      profile: 'hiking-mountain',
      engineMode: '4',
      roundTripDistance: '1667',
      direction: '18',
      format: 'geojson',
      'profile:SAC_scale_limit': '2',
      'profile:path_preference': '20',
    });
  });

  it.each([
    ['run', 2],
    ['hike', 3],
  ] as const)('limits the SAC scale for a %s to %i', async (activity, limit) => {
    fetch.mockResolvedValue(Response.json(answer));

    await createBRouter('http://brouter:17777')({ ...request, activity }, signal);

    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('profile:SAC_scale_limit')).toBe(String(limit));
  });

  it.each([
    ['unpaved', 20],
    ['paved', 0],
    ['any', 0],
  ] as const)('sets the path preference for the %s surface preference to %i', async (surface, preference) => {
    fetch.mockResolvedValue(Response.json(answer));

    await createBRouter('http://brouter:17777')({ ...request, surface }, signal);

    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('profile:path_preference')).toBe(
      String(preference),
    );
  });

  it('makes at most 4 calls at once and starts the next as one ends', async () => {
    const answers: ((response: Response) => void)[] = [];
    fetch.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const brouter = createBRouter('http://brouter:17777');

    const settled = Promise.allSettled(Array.from({ length: 6 }, () => brouter(request, signal)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledTimes(4);

    answers[0](Response.json(answer));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    answers[1](new Response('busy', { status: 503 }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
    answers.slice(2).forEach((resolve) => resolve(Response.json(answer)));
    expect((await settled).map(({ status }) => status)).toEqual(['fulfilled', 'rejected', ...Array(4).fill('fulfilled')]);
  });

  it('reads the geometry, the distance in kilometres, and the tags of each way', async () => {
    fetch.mockResolvedValue(Response.json(answer));

    const loop = await createBRouter('http://brouter:17777')(request, signal);

    expect(loop).toEqual({
      geometry: [
        [6.1294, 45.8992],
        [6.13, 45.901],
        [6.1294, 45.8992],
      ],
      distance: 8.42,
      ways: [
        { length: 300, surface: 'gravel', highway: 'track' },
        { length: 700, surface: undefined, highway: 'residential' },
      ],
    });
  });

  it('gives up after 5 s', async () => {
    const elapsed = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(elapsed.signal);
    fetch.mockResolvedValue(Response.json(answer));

    await createBRouter('http://brouter:17777')(request, signal);
    const fetchSignal = fetch.mock.calls[0][1]?.signal;
    expect(fetchSignal?.aborted).toBe(false);
    elapsed.abort();

    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('gives up when the generation is aborted', async () => {
    const generation = new AbortController();
    fetch.mockResolvedValue(Response.json(answer));

    await createBRouter('http://brouter:17777')(request, generation.signal);
    const fetchSignal = fetch.mock.calls[0][1]?.signal;
    expect(fetchSignal?.aborted).toBe(false);
    generation.abort();

    expect(fetchSignal?.aborted).toBe(true);
  });

  it('rejects when BRouter answers with an error', async () => {
    fetch.mockResolvedValue(new Response('target island detected', { status: 500 }));

    await expect(createBRouter('http://brouter:17777')(request, signal)).rejects.toThrow('500');
  });
});
