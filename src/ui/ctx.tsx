import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
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

export function useHash(): [string[], (path: string) => void] {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash,
  );
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return [parts, (path: string) => { if (window.location.hash.replace(/^#/, '') !== path) window.location.hash = path; }];
}

export type Update = (fn: (enc: Encounter) => Encounter) => void;
