import { strategyFor } from './strategy.ts';

const ORIGIN = 'https://pathfinder.test';
const strategy = (path: string, method = 'GET', mode = 'no-cors', origin = ORIGIN) =>
  strategyFor(new URL(path, origin), ORIGIN, method, mode);

describe('strategyFor', () => {
  it('asks the network first for a page, so a reload after a deploy gets the new build', () => {
    expect(strategy('/', 'GET', 'navigate')).toBe('network-first');
  });

  it('keeps fingerprinted assets and static files for good', () => {
    expect(strategy('/assets/index-abc123.js')).toBe('cache-first');
    expect(strategy('/manifest.webmanifest')).toBe('cache-first');
    expect(strategy('/icon-192.png')).toBe('cache-first');
  });

  it('never touches the API', () => {
    expect(strategy('/api/v1/route-sets', 'POST')).toBe('ignore');
    expect(strategy('/api/v1/route-sets')).toBe('ignore');
    expect(strategy('/api/v1/route-sets', 'GET', 'navigate')).toBe('ignore');
  });

  it('never touches another origin', () => {
    expect(strategy('https://tiles.test/tile.png', 'GET', 'no-cors', 'https://tiles.test')).toBe('ignore');
  });

  it('ignores what it does not know', () => {
    expect(strategy('/build-id')).toBe('ignore');
  });
});
