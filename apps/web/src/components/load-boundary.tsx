import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';

import { errorText, type Language } from '../i18n/index.ts';
import { reloadForNewBuild } from '../state/index.ts';

/** The code of a page or of the map could not be fetched: after a deploy its file is gone, offline it is out of reach. */
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super('Failed to load a chunk of the app', { cause });
  }
}

/** Runs a dynamic `import()`, and says apart a failed load from any other error. */
export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (cause) {
    throw new ChunkLoadError(cause);
  }
}

/** `lazy`, with the failure of its load told by `LoadErrorBoundary`. */
export function lazyChunk<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(() => loadChunk(load));
}

// Whether the page reloads itself for the failed load: not known until the boundary has caught the error.
type BoundaryState = { error?: unknown; reload: 'undecided' | 'reloading' | 'refused' };

/**
 * When a load fails the whole app would go with it: the page reloads itself once, as for a `426`, and the user is
 * asked to reload if that did not help. Any other error is not mended by a reload, so it goes on to the app.
 */
export class LoadErrorBoundary extends Component<{ language: Language; children: ReactNode }, BoundaryState> {
  state: BoundaryState = { reload: 'undecided' };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  // Not in `getDerivedStateFromError`: React may call it twice, and the reload happens once.
  componentDidCatch(error: unknown) {
    if (error instanceof ChunkLoadError) this.setState({ reload: reloadForNewBuild() ? 'reloading' : 'refused' });
  }

  render() {
    const { error, reload } = this.state;
    if (error === undefined) return this.props.children;
    if (!(error instanceof ChunkLoadError)) throw error;
    // Nothing shows while the page is about to reload.
    if (reload !== 'refused') return null;
    return (
      <p role="alert" data-testid="load-failure" className="fixed inset-x-0 top-1/3 z-10 px-6 text-center text-ink">
        {errorText[this.props.language]['stale-build']}
      </p>
    );
  }
}

/** The map loads on demand, behind `fallback`, and tells a failed load with `LoadErrorBoundary`. */
export function LoadBoundary({
  language,
  fallback = null,
  children,
}: {
  language: Language;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <LoadErrorBoundary language={language}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </LoadErrorBoundary>
  );
}
