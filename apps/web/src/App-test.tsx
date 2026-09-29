import { fireEvent, render, screen } from '@testing-library/react';

import { Map } from 'maplibre-gl';

import { App } from './App.tsx';

// jsdom has no WebGL.
vi.mock('maplibre-gl');

const onDesktop = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query) => ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as never,
    );

afterEach(() => {
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('App', () => {
  it('shows the app name', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Path finder' })).toBeInTheDocument();
  });

  it.each(['Credits', 'Privacy policy', 'Legal notice'])(
    'opens the %s page from the settings and goes back',
    async (page) => {
      render(<App />);

      fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
      fireEvent.click(await screen.findByRole('link', { name: page }));

      expect(await screen.findByRole('heading', { level: 1, name: page })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('link', { name: 'Back' }));

      expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    },
  );

  it('keeps the map across a visit to the settings', async () => {
    render(<App />);
    const created = vi.mocked(Map).mock.instances.length;

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Back' }));
    await screen.findByRole('button', { name: 'Criteria' });

    expect(vi.mocked(Map).mock.instances).toHaveLength(created);
  });

  it('moves the focus to the title of the page it opens', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toHaveFocus();
  });

  it('gives the focus back to the settings button once the page is closed', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Back' }));

    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveFocus();
  });

  it('opens a page as a modal dialog, without the settings button behind it', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

    expect(await screen.findByRole('dialog', { name: 'Settings' })).toHaveAttribute('open');
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('goes back a level from a page on Escape', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Credits' }));

    fireEvent(await screen.findByRole('dialog', { name: 'Credits' }), new Event('cancel', { cancelable: true }));

    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('closes every page on a click on the scrim', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Credits' }));

    fireEvent.click(await screen.findByRole('dialog', { name: 'Credits' }));

    expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes a page with a back arrow on phones', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '#/');
    expect(screen.queryByRole('link', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('closes a page with a cross on desktops, and keeps the back arrow for a page within a page', async () => {
    onDesktop();
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('link', { name: 'Close' })).toHaveAttribute('href', '#/');
    expect(screen.queryByRole('link', { name: 'Back' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Credits' }));
    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '#/settings');
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', '#/');
  });

  it('stays on a page after a click inside it', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));

    fireEvent.click(await screen.findByRole('heading', { level: 1, name: 'Settings' }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows the settings button again on desktops once the page is closed', async () => {
    onDesktop();
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Close' }));

    expect(await screen.findByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('speaks French when the browser prefers French', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Réglages' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Politique de confidentialité' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Politique de confidentialité' })).toBeInTheDocument();
  });

  it('sets the document language to fr when the browser prefers French', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    render(<App />);

    expect(document.documentElement.lang).toBe('fr');
  });

  it('speaks the language picked in the settings over the browser one', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Language/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Français' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('fr');
  });

  it('sets the document language to en otherwise', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    render(<App />);

    expect(document.documentElement.lang).toBe('en');
  });
});
