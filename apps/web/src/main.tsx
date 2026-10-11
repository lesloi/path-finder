import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './components/index.css';
import { App, preloadPages } from './App.tsx';
import { preloadMap } from './components/index.ts';
import { applyTheme } from './core/index.ts';
import { watchSettings } from './state/index.ts';

// Before the first render, so a forced theme never flashes the system one.
watchSettings(({ theme }) => applyTheme(theme));

// Production only: the dev server serves modules that the worker would cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}

const ignore = () => undefined;

// Production only, like the registration: a worker that fetches the page's files keeps them for a visit offline,
// so the pages wait until it controls the page. A first visit gets there a moment after the first paint.
async function workerControlsPage() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((done) => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
  }
}

const idle = () =>
  new Promise<void>((done) =>
    'requestIdleCallback' in window
      ? window.requestIdleCallback(() => done(), { timeout: 5000 })
      : setTimeout(done, 3000),
  );

// The map is what the first visit is for: its code loads while React starts. A failure shows when the map renders.
// Then the pages, whether the map's code came or not, once the browser is idle and the worker is there.
preloadMap()
  .catch(ignore)
  .then(() => Promise.all([idle(), workerControlsPage()]))
  .then(preloadPages)
  .catch(ignore);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
