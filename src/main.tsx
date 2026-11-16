import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/app';
import { EncounterStore, IdbPersistence, MemoryPersistence } from './store/persistence';
import './ui/styles.css';

async function boot() {
  let loadError: string | null = null;
  let store = new EncounterStore(new IdbPersistence());
  try {
    await store.load();
  } catch (e) {
    // Storage is unavailable (private mode, blocked, or corrupt). Say so; do not pretend to save.
    loadError = `${(e as Error).message}. Working in memory only — drafts will be lost on reload.`;
    store = new EncounterStore(new MemoryPersistence());
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App store={store} loadError={loadError} />
    </StrictMode>,
  );
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      // Hand the worker the exact shell files this page loaded so the app opens offline next time.
      const urls = [location.origin + '/', ...performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin) && !u.includes('/api/') && !u.includes('/mock-intelehealth'))];
      (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'precache', urls });
    } catch {
      /* offline shell caching is best effort; the app still works online */
    }
  }
  void navigator.storage?.persist?.();
}
void boot();
