import { useEffect, useMemo, useState } from 'react';
import { DEMO_PATIENTS } from '../store/fixtures';
import type { EncounterStore } from '../store/persistence';
import { t } from '../i18n';
import { actorFor, AppContext, loadSettings, saveSettings, useHash, useOnline, useStoreVersion, type Settings } from './ctx';
import { Home } from './home';
import { EncounterScreen } from './encounter';
import { ProtocolReview } from './protocolReview';

export function App({ store, loadError }: { store: EncounterStore; loadError: string | null }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [parts, nav] = useHash();
  const online = useOnline();
  useStoreVersion(store);
  useEffect(() => {
    document.documentElement.lang = settings.lang;
    saveSettings(settings);
  }, [settings]);
  const app = useMemo(
    () => ({ settings, set: (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), actor: actorFor(settings), store, online, lang: settings.lang, tr: (k: string) => t(k, settings.lang) }),
    [settings, store, online],
  );
  let screen;
  if (parts[0] === 'enc' && parts[1]) {
    const enc = store.get(parts[1]);
    const patient = enc && DEMO_PATIENTS.find((p) => p.id === enc.patientId);
    screen = enc && patient ? <EncounterScreen enc={enc} patient={patient} tab={parts[2] ?? 'start'} nav={nav} /> : <Home nav={nav} />;
  } else if (parts[0] === 'protocol') screen = <ProtocolReview nav={nav} />;
  else screen = <Home nav={nav} />;
  return (
    <AppContext.Provider value={app}>
      <div className="banner" role="note">{app.tr('app.banner')}</div>
      {!online && <div className="offline" role="status">{app.tr('app.offline')}</div>}
      {loadError && <div className="notice err" role="alert">{app.tr('save.error')}: {loadError}</div>}
      {screen}
    </AppContext.Provider>
  );
}
