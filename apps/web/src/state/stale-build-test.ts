import type { RouteSetRequest } from '../core/index.ts';
import { forgetPendingSearch, pendingSearch, reloadForNewBuild } from './stale-build.ts';

const request: RouteSetRequest = {
  start: [6.1294, 45.8992],
  target: { distance: 10 },
  surface: 'any',
  pace: 6,
};

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  vi.stubGlobal('location', { reload });
});

afterEach(() => {
  vi.unstubAllEnvs();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reloadForNewBuild', () => {
  it('reloads the page and keeps the search for after it', () => {
    const reloading = reloadForNewBuild(request);

    expect(reloading).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(pendingSearch()).toEqual(request);
  });

  it('reloads without a search to keep', () => {
    expect(reloadForNewBuild()).toBe(true);

    expect(pendingSearch()).toBeUndefined();
  });

  it('does not reload twice in a row, so a build that stays stale cannot loop', () => {
    reloadForNewBuild(request);

    const reloading = reloadForNewBuild(request);

    expect(reloading).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads again when the page is of a newer build', () => {
    vi.stubEnv('VITE_BUILD_ID', 'build-1');
    reloadForNewBuild(request);
    vi.stubEnv('VITE_BUILD_ID', 'build-2');

    expect(reloadForNewBuild(request)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when the storage is out of reach, as it could not stop a loop', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(reloadForNewBuild(request)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('pendingSearch', () => {
  it('gives the same search until it is forgotten', () => {
    reloadForNewBuild(request);

    expect(pendingSearch()).toEqual(request);
    expect(pendingSearch()).toEqual(request);
    forgetPendingSearch();
    expect(pendingSearch()).toBeUndefined();
  });

  it.each([
    ['a start point only', '{"start":[6.1,45.8]}'],
    ['a start point out of the world', '{"start":[600,45.8],"target":{"distance":10},"surface":"any","pace":6}'],
    ['a target out of bounds', '{"start":[6.1,45.8],"target":{"distance":9999},"surface":"any","pace":6}'],
  ])('ignores what is not criteria: %s', (_, stored) => {
    sessionStorage.setItem('path-finder.pending-search', stored);

    expect(pendingSearch()).toBeUndefined();
  });

  it('ignores unreadable storage', () => {
    sessionStorage.setItem('path-finder.pending-search', '{');

    expect(pendingSearch()).toBeUndefined();
  });
});
