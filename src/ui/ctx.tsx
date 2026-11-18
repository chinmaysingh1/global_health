import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { navDirection } from './flow';
import type { Actor, Encounter, Lang, Role } from '../store/types';
import type { EncounterStore } from '../store/persistence';
import { t } from '../i18n';

export interface Settings {
  lang: Lang;
  role: Role;
  kit: boolean;
  aiMode: 'off' | 'mock' | 'server';
}
const KEY = 'chw-msk-settings';
export function loadSettings(): Settings {
  const d: Settings = { lang: 'en', role: 'chw', kit: true, aiMode: 'off' };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch {
    /* settings are a convenience only */
  }
  return d;
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function actorFor(s: Settings): Actor {
  return s.role === 'clinician'
    ? { id: 'demo-clinician', name: 'Demo Clinician', role: 'clinician', capabilities: ['trained', 'basic_kit', 'physio'] }
    : { id: 'demo-chw', name: 'Demo CHW', role: 'chw', capabilities: s.kit ? ['trained', 'basic_kit'] : ['trained'] };
}

export interface App {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  actor: Actor;
  store: EncounterStore;
  online: boolean;
  tr: (key: string) => string;
  lang: Lang;
  /** Polite screen-reader announcement for state changes (saved, moved on, synced). */
  announce: (msg: string) => void;
}
export const AppContext = createContext<App | null>(null);
export const useApp = (): App => {
  const a = useContext(AppContext);
  if (!a) throw new Error('AppContext missing');
  return a;
};
export const trFor = (lang: Lang) => (key: string) => t(key, lang);

export function useStoreVersion(store: EncounterStore): number {
  const [v, setV] = useState(0);
  useEffect(() => store.subscribe(() => setV((x) => x + 1)), [store]);
  return v;
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Hash routing with animated screen changes. Where the browser supports the View Transitions API
 * (iOS 18+ Safari and web views, Android Chrome 111+), the new screen slides in from the side it
 * belongs to while the header and bottom bar stay in place; elsewhere the screen simply swaps.
 * The new screen always starts at the top.
 */
export function useHash(): [string[], (path: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    let current = window.location.hash;
    const onChange = () => {
      const next = window.location.hash;
      if (next === current) return;
      const dir = navDirection(current, next);
      current = next;
      const apply = () => {
        flushSync(() => setHash(next));
        window.scrollTo(0, 0);
      };
      const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; skipTransition: () => void } };
      if (!doc.startViewTransition || reducedMotion() || document.visibilityState !== 'visible') return apply();
      document.documentElement.dataset.navDir = dir;
      let ran = false;
      const run = () => { if (ran) return; ran = true; apply(); };
      const t = doc.startViewTransition(run);
      void t.finished.catch(() => undefined).finally(() => { delete document.documentElement.dataset.navDir; });
      // never let an animation hold up navigation: if no frame arrives (throttled or backgrounded
      // web view), show the new screen without the transition
      window.setTimeout(() => { if (!ran) { try { t.skipTransition(); } catch { /* already done */ } run(); } }, 250);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return [parts, (path: string) => { if (window.location.hash.replace(/^#/, '') !== path) window.location.hash = path; }];
}

export type Update = (fn: (enc: Encounter) => Encounter) => void;
