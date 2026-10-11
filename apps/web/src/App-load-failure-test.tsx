import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Map, ScaleControl } from 'maplibre-gl';

import { App } from './App.tsx';
import { commonText } from './i18n/index.ts';

// jsdom has no WebGL.
vi.mock('maplibre-gl');
ScaleControl.prototype.setUnit = vi.fn();
Map.prototype.getCanvas = vi.fn(() => ({ setAttribute: vi.fn() }) as never);
Map.prototype.getContainer = vi.fn(() => document.createElement('div'));
// The credits page cannot be loaded, as after a deploy that removed its file.
vi.mock('./views/legal/credits-page.tsx', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

beforeEach(() => {
  // React logs the error it hands to the boundary.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('App when a page cannot be loaded', () => {
  it('asks for a reload, and shows the pages that load once the user is back from it', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('criteria-settings'));
    fireEvent.click(await screen.findByTestId('settings-credits'));

    expect(await screen.findByTestId('load-failure')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sub-page-back'));

    await waitFor(() => expect(screen.getByTestId('sub-page-title')).toHaveTextContent(commonText.en.settings));
    expect(screen.queryByTestId('load-failure')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-credits')).toBeInTheDocument();
  });
});
