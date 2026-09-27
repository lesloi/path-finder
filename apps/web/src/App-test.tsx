import { fireEvent, render, screen } from '@testing-library/react';

import { App } from './App.tsx';

// jsdom has no WebGL.
vi.mock('maplibre-gl');

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

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Settings' }),
      ).toBeInTheDocument();
    },
  );

  it('speaks French when the browser prefers French', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: 'Réglages' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Politique de confidentialité' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Politique de confidentialité' }),
    ).toBeInTheDocument();
  });

  it('sets the document language to fr when the browser prefers French', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    render(<App />);

    expect(document.documentElement.lang).toBe('fr');
  });

  it('sets the document language to en otherwise', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    render(<App />);

    expect(document.documentElement.lang).toBe('en');
  });
});
