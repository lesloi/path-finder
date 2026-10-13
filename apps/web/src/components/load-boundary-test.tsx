import { render, screen } from '@testing-library/react';

import { errorText } from '../i18n/index.ts';
import { reloadForNewBuild } from '../state/index.ts';
import { ChunkLoadError, loadChunk, LoadBoundary } from './load-boundary.tsx';

function Broken(): never {
  throw new ChunkLoadError(new Error('Failed to fetch dynamically imported module'));
}

function Buggy(): never {
  throw new Error('a bug');
}

beforeEach(() => {
  // React logs the error it hands to the boundary.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LoadBoundary', () => {
  it('reloads the page itself, once, when what it holds fails', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });

    render(
      <LoadBoundary language="fr">
        <Broken />
      </LoadBoundary>,
    );

    expect(reload).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('load-failure')).not.toBeInTheDocument();
  });

  it('asks for a reload, in the language, when a reload did not mend it', () => {
    vi.stubGlobal('location', { reload: vi.fn() });
    reloadForNewBuild();
    render(
      <LoadBoundary language="fr">
        <Broken />
      </LoadBoundary>,
    );

    expect(screen.getByTestId('load-failure')).toHaveTextContent(errorText.fr['stale-build']);
  });

  it('shows what it holds while it works', () => {
    render(
      <LoadBoundary language="en">
        <p data-testid="content">fine</p>
      </LoadBoundary>,
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.queryByTestId('load-failure')).not.toBeInTheDocument();
  });

  it('leaves an error that is not a failed load to the app, which no reload would mend', () => {
    expect(() =>
      render(
        <LoadBoundary language="en">
          <Buggy />
        </LoadBoundary>,
      ),
    ).toThrow('a bug');
  });

  it('wraps what a failed load rejects with', async () => {
    const cause = new Error('offline');

    await expect(loadChunk(() => Promise.reject(cause))).rejects.toMatchObject({ cause });
    await expect(loadChunk(() => Promise.resolve(1))).resolves.toBe(1);
  });
});
