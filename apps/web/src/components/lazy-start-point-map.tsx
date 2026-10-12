import { lazy, type ComponentProps } from 'react';

import { LoadBoundary, loadChunk } from './load-boundary.tsx';
import type { StartPointMap } from './start-point-map.tsx';

function load() {
  return loadChunk(() =>
    Promise.all([
      import('maplibre-gl'),
      // The bundler moves maplibre-gl, so its worker cannot be found next to it.
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('./start-point-map.tsx'),
    ]),
  ).then(([{ setWorkerUrl }, { default: workerUrl }, { StartPointMap }]) => {
    setWorkerUrl(workerUrl);
    return { default: StartPointMap };
  });
}

/** Starts loading the map's code. maplibre-gl is most of the app: main.tsx starts it while React boots. */
export const preloadMap = load;

const LoadedMap = lazy(load);

/** The map, in the place the real one will take, so nothing moves when it arrives. */
export function LazyStartPointMap(props: ComponentProps<typeof StartPointMap>) {
  return (
    <LoadBoundary
      language={props.language ?? 'en'}
      fallback={<div data-testid="map-placeholder" className="fixed inset-0 bg-white" />}
    >
      <LoadedMap {...props} />
    </LoadBoundary>
  );
}
