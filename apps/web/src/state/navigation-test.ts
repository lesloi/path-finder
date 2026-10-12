import { goTo } from './navigation.ts';

// History traversals in jsdom end with a hashchange, a task later.
const hashChange = () => new Promise((resolve) => window.addEventListener('hashchange', resolve, { once: true }));

async function visit(hash: string) {
  const changed = hashChange();
  window.location.hash = hash;
  await changed;
}

describe('goTo', () => {
  it('goes back through the history to a page the tab came from', async () => {
    await visit('#/map-a');
    await visit('#/settings-a');
    await visit('#/credits-a');

    const changed = hashChange();
    goTo('#/map-a');
    await changed;

    expect(window.location.hash).toBe('#/map-a');
    // The pages left behind are ahead in the history, not behind: back leaves them for good.
    const forward = hashChange();
    window.history.forward();
    await forward;
    expect(window.location.hash).toBe('#/settings-a');
  });

  it('adds an entry for a page the tab did not come from', async () => {
    await visit('#/map-b');

    const changed = hashChange();
    goTo('#/settings-b');
    await changed;

    expect(window.location.hash).toBe('#/settings-b');
    const back = hashChange();
    window.history.back();
    await back;
    expect(window.location.hash).toBe('#/map-b');
  });
});

describe('goTo on a restored entry', () => {
  // Loads a fresh module on an entry that carries `trail`, as when the system restores the app.
  async function restore(trail: string[], entriesBehind?: number) {
    vi.resetModules();
    if (entriesBehind !== undefined) vi.stubGlobal('navigation', { currentEntry: { index: entriesBehind } });
    window.history.replaceState({ trail }, '', trail.at(-1) ?? '#/');
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    return { go, ...(await import('./navigation.ts')) };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not go back past the first entry the app has', async () => {
    const { go, goTo } = await restore(['#/', '#/settings', '#/credits', '#/privacy'], 1);

    goTo('#/');

    // Only the last two hashes have an entry: '#/' is not one of them, so it is added, not reached by going back.
    expect(go).not.toHaveBeenCalled();
  });

  it('keeps the entries that exist when the trail is longer than the history', async () => {
    const { go, goTo } = await restore(['#/', '#/settings', '#/credits', '#/privacy'], 1);

    goTo('#/credits');

    expect(go).toHaveBeenCalledWith(-1);
  });

  it('keeps a trail as long as the entries behind it', async () => {
    const { go, goTo } = await restore(['#/', '#/settings', '#/credits'], 2);

    goTo('#/');

    expect(go).toHaveBeenCalledWith(-2);
  });

  it('falls back to the history length without the Navigation API', async () => {
    const trail = ['#/', ...Array.from({ length: window.history.length + 1 }, (_, i) => `#/page-${String(i)}`)];
    const { go, goTo } = await restore(trail);

    goTo('#/');

    expect(go).not.toHaveBeenCalled();
  });
});
