import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Map } from 'maplibre-gl';

import { App } from './App.tsx';
import { expectNamedControls } from './accessible-names.ts';
import { commonText } from './i18n/index.ts';

// jsdom has no WebGL.
vi.mock('maplibre-gl');

const onDesktop = () =>
  vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(
      (query) => ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }) as never,
    );

// The page whose title is shown: the sub-page stays mounted while it changes from one page to the next.
const onPage = (title: string) => waitFor(() => expect(screen.getByTestId('sub-page-title')).toHaveTextContent(title));

afterEach(() => {
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('App', () => {
  it('shows the app name', () => {
    render(<App />);

    expect(screen.getByTestId('app-title')).toHaveTextContent('Path finder');
  });

  it.each([
    ['credits', commonText.en.credits],
    ['privacy', commonText.en.privacy],
    ['legal-notice', commonText.en.legalNotice],
  ])('opens the %s page from the settings and goes back', async (page, title) => {
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId(`settings-${page}`));

    await onPage(title);

    fireEvent.click(screen.getByTestId('sub-page-back'));

    await onPage(commonText.en.settings);
  });

  it.each([
    ['phones', false],
    ['desktops', true],
  ])('names the controls of a page on %s', async (_, desktop) => {
    if (desktop) onDesktop();
    const { container } = render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));
    await onPage(commonText.en.settings);

    expectNamedControls(container);
  });

  it('keeps the map across a visit to the settings', async () => {
    render(<App />);
    const created = vi.mocked(Map).mock.instances.length;

    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId('sub-page-back'));
    // The settings button comes back once the page is closed: the sheet handle never left.
    await screen.findByTestId('criteria-settings');

    expect(vi.mocked(Map).mock.instances).toHaveLength(created);
  });

  it('moves the focus to the title of the page it opens', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));

    expect(await screen.findByTestId('sub-page-title')).toHaveFocus();
  });

  it('gives the focus back to the settings button once the page is closed', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId('sub-page-back'));

    expect(await screen.findByTestId('criteria-settings')).toHaveFocus();
  });

  it('opens a page as a modal dialog, without the settings button behind it', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));

    expect(await screen.findByTestId('sub-page')).toHaveAttribute('open');
    expect(screen.getByTestId('sub-page')).toHaveAccessibleName(commonText.en.settings);
    expect(screen.queryByTestId('criteria-settings')).not.toBeInTheDocument();
  });

  it('goes back a level from a page on Escape', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId('settings-credits'));
    await onPage(commonText.en.credits);

    fireEvent(screen.getByTestId('sub-page'), new Event('cancel', { cancelable: true }));

    await onPage(commonText.en.settings);
  });

  it('closes every page on a click on the scrim', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId('settings-credits'));
    await onPage(commonText.en.credits);

    fireEvent.click(screen.getByTestId('sub-page'));

    expect(await screen.findByTestId('criteria-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('sub-page')).not.toBeInTheDocument();
  });

  it('closes a page with a back arrow on phones', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));

    expect(await screen.findByTestId('sub-page-back')).toHaveAttribute('href', '#/');
    expect(screen.queryByTestId('sub-page-close')).not.toBeInTheDocument();
  });

  it('closes a page with a cross on desktops, and keeps the back arrow for a page within a page', async () => {
    onDesktop();
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));
    expect(await screen.findByTestId('sub-page-close')).toHaveAttribute('href', '#/');
    expect(screen.queryByTestId('sub-page-back')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-credits'));
    expect(await screen.findByTestId('sub-page-back')).toHaveAttribute('href', '#/settings');
    expect(screen.getByTestId('sub-page-close')).toHaveAttribute('href', '#/');
  });

  it('stays on a page after a click inside it', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('criteria-settings'));

    fireEvent.click(await screen.findByTestId('sub-page-title'));

    expect(screen.getByTestId('sub-page')).toHaveAccessibleName(commonText.en.settings);
  });

  it('shows the settings button again on desktops once the page is closed', async () => {
    onDesktop();
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId('sub-page-close'));

    expect(await screen.findByTestId('criteria-settings')).toBeInTheDocument();
  });

  it('speaks French when the browser prefers French', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId('settings-privacy'));

    await onPage(commonText.fr.privacy);
  });

  it('sets the document language to fr when the browser prefers French', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    render(<App />);

    expect(document.documentElement.lang).toBe('fr');
  });

  it('speaks the language picked in the settings over the browser one', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    render(<App />);

    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId('settings-language'));
    fireEvent.click(screen.getByTestId('settings-language-fr'));

    expect(screen.getByTestId('sub-page-title')).toHaveTextContent(commonText.fr.settings);
    expect(document.documentElement.lang).toBe('fr');
  });

  it('sets the document language to en otherwise', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
    render(<App />);

    expect(document.documentElement.lang).toBe('en');
  });
});
