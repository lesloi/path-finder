import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';

import { errorText, type Language } from '../i18n/index.ts';

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

/** `lazy`, with the failure of its load told by `LoadBoundary`. */
export function lazyChunk<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(() => loadChunk(load));
}

/**
 * Pages and the map load on demand, behind `fallback`. When a load fails the whole app would go with it: the user
 * reloads instead, as for a `426`. Any other error is not mended by a reload, so it goes on to the app.
 */
export class LoadBoundary extends Component<
  { language: Language; fallback?: ReactNode; children: ReactNode },
  { error?: unknown }
> {
  state: { error?: unknown } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === undefined) return <Suspense fallback={this.props.fallback ?? null}>{this.props.children}</Suspense>;
    if (!(error instanceof ChunkLoadError)) throw error;
    return (
      <p role="alert" data-testid="load-failure" className="fixed inset-x-0 top-1/3 z-10 px-6 text-center text-ink">
        {errorText[this.props.language]['stale-build']}
      </p>
    );
  }
}
