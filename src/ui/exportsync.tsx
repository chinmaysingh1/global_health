import { useMemo, useState } from 'react';
import { protocol } from '../protocol';
import type { Encounter } from '../store/types';
import type { EncounterSummary } from '../engine/summary';
import { buildSummary } from '../engine/summary';
import { buildHandoff, FIELD_MAPPINGS } from '../integration/adapter';
import { fetchTransport, SyncClient } from '../integration/sync';
import { NO_SERVER, STANDALONE } from '../platform';
import { setSync } from '../store/encounter';
import { renderNote } from '../ai/note';
import { Card } from './common';
import { useApp, type Update } from './ctx';

const client = new SyncClient(fetchTransport);

export function ExportTab({ enc, summary, update }: { enc: Encounter; summary: EncounterSummary; update: Update }) {
  const { tr, actor, store, online } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const bundle = useMemo(() => buildHandoff(protocol, summary), [summary]);

  const download = () => {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `handoff-${enc.id}-r${enc.revision}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const queue = () => update((e) => client.queue(e, actor));
  const syncNow = async () => {
    setBusy(true);
    setMsg(null);
    const cur = store.get(enc.id)!;
    // the bundle is rebuilt from the exact revision being submitted
    const s = buildSummary(protocol, summary.patient, cur);
    const next = await client.submit(cur, actor, buildHandoff(protocol, s));
    await store.put(next);
    setBusy(false);
    setMsg(next.sync.lastError ?? null);
  };
  const demo = async (path: string) => {
    if (STANDALONE) return setMsg(`${path}: ${NO_SERVER}`);
    try {
      const r = await fetch(`/mock-intelehealth${path}`, { method: 'POST' });
      setMsg(`${path}: ${r.status}`);
    } catch (e) {
      setMsg(`${path}: ${(e as Error).message}`);
    }
  };
  const adopt = async () => {
    try {
      const r = await client.fetchServerCopy(enc.id);
      if (r.status === 200) update((e) => client.queue(setSync(e, actor, { ...e.sync, serverVersion: r.body.serverVersion, state: 'saved_on_device', lastError: undefined }), actor));
      else setMsg(`GET: ${r.status}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const st = enc.sync;
  return (
    <>
      <h1>{tr('ex.title')}</h1>
      <Card>
        <p><span className={`chip ${st.state === 'received_by_server' ? 'ok' : ['sync_conflict', 'auth_expired', 'sync_failed'].includes(st.state) ? 'present' : 'warn'}`}>{tr(`sync.${st.state}`)}</span></p>
        <p className="muted">{tr('sync.simulated')}</p>
        {STANDALONE && <div className="notice warn">{tr('app.standalone')}</div>}
        {st.receiptId && st.state === 'received_by_server' && <p>{tr('sync.receipt')}: <code>{st.receiptId}</code> · v{st.serverVersion} · {st.ackAt && new Date(st.ackAt).toLocaleString()}</p>}
        {st.lastError && <div className="notice err" role="alert">{st.lastError}</div>}
        {!online && <div className="notice warn">{tr('app.offline')}</div>}
        <div className="stack">
          <button type="button" disabled={st.state === 'queued_for_sync'} onClick={queue}>{tr('sync.queue')}</button>
          <button type="button" className="primary" disabled={busy || st.state !== 'queued_for_sync'} onClick={() => void syncNow()}>{busy ? tr('ai.working') : tr('sync.now')}</button>
          {st.state === 'sync_conflict' && <button type="button" onClick={() => void adopt()}>{tr('ex.adopt')}</button>}
        </div>
        {msg && <p className="muted" role="status">{msg}</p>}
        <details>
          <summary>{tr('ex.states')}</summary>
          <ul>{['saved_on_device', 'awaiting_review', 'queued_for_sync', 'received_by_server'].map((s) => <li key={s}>{tr(`sync.${s}`)}</li>)}</ul>
          <p className="muted">{tr('app.storageNote')}</p>
        </details>
      </Card>
      <Card>
        <div className="stack noprint">
          <button type="button" onClick={download}>{tr('ex.json')}</button>
          <button type="button" onClick={() => window.print()}>{tr('ex.print')}</button>
        </div>
        <pre className="note" lang="en">{renderNote(protocol, summary)}</pre>
      </Card>
      <Card title={tr('ex.unmapped')} className="noprint">
        <table><tbody>{FIELD_MAPPINGS.map((m) => <tr key={m.field}><td><code>{m.field}</code></td><td lang="en">{m.blocker}{m.candidate && <div className="muted">{m.candidate}</div>}</td></tr>)}</tbody></table>
      </Card>
      <Card title={tr('ex.demoControls')} className="noprint">
        <div className="stack">
          <button type="button" onClick={() => void demo('/_test/expire-tokens')}>{tr('ex.expire')}</button>
          <button type="button" onClick={() => void demo(`/_test/clinician-edit/${encodeURIComponent(enc.id)}`)}>{tr('ex.serverEdit')}</button>
        </div>
      </Card>
    </>
  );
}
