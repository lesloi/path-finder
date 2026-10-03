import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './components/index.css';
import { App } from './App.tsx';
import { applyTheme } from './core/index.ts';
import { watchSettings } from './state/index.ts';

// The bundler moves maplibre-gl, so its worker cannot be found next to it.
setWorkerUrl(workerUrl);

// Before the first render, so a forced theme never flashes the system one.
watchSettings(({ theme }) => applyTheme(theme));

// Production only: the dev server serves modules that the worker would cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
