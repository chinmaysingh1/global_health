import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_PATIENTS } from '../store/fixtures';
import type { EncounterStore } from '../store/persistence';
import { t } from '../i18n';
import { actorFor, AppContext, loadSettings, saveSettings, useHash, useOnline, useStoreVersion, type Settings } from './ctx';
import { Home } from './home';
import { EncounterScreen } from './encounter';
import { ProtocolReview } from './protocolReview';
import { Notice } from './common';

/** Hides the fixed bottom action bar while the software keyboard is likely open, so it never covers a field. */
function useKeyboardAware() {
  useEffect(() => {
    const isField = (el: Element | null) => !!el && (el.matches('input:not([type=radio]):not([type=checkbox]), textarea, select') || (el as HTMLElement).isContentEditable);
    const on = (e: FocusEvent) => { if (isField(e.target as Element)) document.body.classList.add('kb-open'); };
    const off = () => window.setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('kb-open'); }, 60);
    document.addEventListener('focusin', on);
    document.addEventListener('focusout', off);
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); };
  }, []);
}

export function App({ store, loadError }: { store: EncounterStore; loadError: string | null }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [parts, nav] = useHash();
  const online = useOnline();
  const [said, setSaid] = useState('');
  useStoreVersion(store);
  useKeyboardAware();
  useEffect(() => {
    document.documentElement.lang = settings.lang;
    saveSettings(settings);
  }, [settings]);
  const announce = useCallback((msg: string) => { setSaid(''); window.setTimeout(() => setSaid(msg), 30); }, []);
  const app = useMemo(
    () => ({ settings, set: (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), actor: actorFor(settings), store, online, lang: settings.lang, tr: (k: string) => t(k, settings.lang), announce }),
    [settings, store, online, announce],
  );

  // Moving to another screen starts at the top and puts keyboard / screen-reader focus on its title.
  const routeKey = parts.slice(0, 3).join('/');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = document.querySelector<HTMLElement>('[data-page-title]');
    h?.focus({ preventScroll: true });
  }, [routeKey]);

  let screen;
  if (parts[0] === 'enc' && parts[1]) {
    const enc = store.get(parts[1]);
    const patient = enc && DEMO_PATIENTS.find((p) => p.id === enc.patientId);
    screen = enc && patient ? <EncounterScreen enc={enc} patient={patient} section={parts[2]} focusNode={parts[3]} nav={nav} /> : <Home nav={nav} />;
  } else if (parts[0] === 'protocol') screen = <ProtocolReview nav={nav} />;
  else screen = <Home nav={nav} />;
  return (
    <AppContext.Provider value={app}>
      {loadError && <div className="page no-bar" style={{ paddingTop: 12, paddingBottom: 0 }}><Notice tone="err" role="alert"><strong>{app.tr('save.error')}</strong> {loadError}</Notice></div>}
      {screen}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{said}</div>
    </AppContext.Provider>
  );
}
