import { render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { errorText } from '../i18n/index.ts';
import { maps } from '../maplibre-mock.ts';
import { LazyStartPointMap } from './lazy-start-point-map.tsx';
import type { MapHandle } from './start-point-map.tsx';

vi.mock('maplibre-gl', () => import('../maplibre-mock.ts'));

beforeEach(() => {
  maps.length = 0;
});

afterEach(() => {
  sessionStorage.clear();
  vi.doUnmock('./start-point-map.tsx');
  vi.restoreAllMocks();
});

describe('LazyStartPointMap', () => {
  it('holds the place of the map while its code loads, then shows it', async () => {
    render(<LazyStartPointMap onStartChange={vi.fn()} />);

    expect(screen.getByTestId('map-placeholder')).toBeInTheDocument();
    expect(maps).toHaveLength(0);

    await vi.waitFor(() => expect(maps).toHaveLength(1));
    expect(screen.queryByTestId('map-placeholder')).not.toBeInTheDocument();
  });

  it('hands the map handle to its parent', async () => {
    const handle = createRef<MapHandle>();
    render(<LazyStartPointMap ref={handle} onStartChange={vi.fn()} />);

    await vi.waitFor(() => expect(handle.current).not.toBeNull());
  });

  it('asks for a reload when the code of the map cannot be loaded, once a reload did not mend it', async () => {
    sessionStorage.setItem('path-finder.reloaded-from', '');
    vi.resetModules();
    vi.doMock('./start-point-map.tsx', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { LazyStartPointMap: Fresh } = await import('./lazy-start-point-map.tsx');

    render(<Fresh language="en" onStartChange={vi.fn()} />);

    expect(await screen.findByTestId('load-failure')).toHaveTextContent(errorText.en['stale-build']);
  });
});
