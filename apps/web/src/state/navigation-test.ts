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
  it('does not go back further than the history holds', async () => {
    // Arrange: an entry whose saved trail is longer than the history behind it, as when the app is reopened.
    vi.resetModules();
    const trail = ['#/', ...Array.from({ length: window.history.length + 1 }, (_, i) => `#/page-${String(i)}`)];
    window.history.replaceState({ trail }, '', trail.at(-1));
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const { goTo: restoredGoTo } = await import('./navigation.ts');

    // Act
    restoredGoTo('#/');

    // Assert: leaving the history would close the installed app.
    expect(go).not.toHaveBeenCalled();
    go.mockRestore();
  });
});
