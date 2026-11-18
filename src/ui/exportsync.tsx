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
import { Card, Icon, Notice } from './common';
import { useApp, type Update } from './ctx';
import { SyncPill } from './home';

const client = new SyncClient(fetchTransport);

const STATE_HELP: Record<string, string> = { saved_on_device: 'device', awaiting_review: 'clock', queued_for_sync: 'cloud-up', received_by_server: 'check' };

export function ExportTab({ enc, summary, update }: { enc: Encounter; summary: EncounterSummary; update: Update }) {
  const { tr, actor, store, online, announce } = useApp();
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
  const queue = () => { update((e) => client.queue(e, actor)); announce(tr('sync.queued_for_sync')); };
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
    announce(tr(`sync.${next.sync.state}`));
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
  const failed = ['sync_conflict', 'auth_expired', 'sync_failed'].includes(st.state);
  return (
    <>
      <Card title={tr('sync.status')} actions={<SyncPill state={st.state} />}>
        <p className="muted">{tr('sync.simulated')}</p>
        {STANDALONE && <Notice tone="warn">{tr('app.standalone')}</Notice>}
        {st.receiptId && st.state === 'received_by_server' && (
          <Notice tone="ok">
            <strong>{tr('sync.simulatedReceipt')}</strong>
            <div className="mt-2"><code>{st.receiptId}</code> · v{st.serverVersion}{st.ackAt && ` · ${new Date(st.ackAt).toLocaleString()}`}</div>
          </Notice>
        )}
        {st.lastError && <Notice tone={failed ? 'err' : 'warn'} role="alert">{st.lastError}</Notice>}
        {!online && <Notice tone="warn">{tr('app.offline')}</Notice>}
        <div className="stack mt-3">
          <button type="button" className="btn btn-block" disabled={st.state === 'queued_for_sync'} onClick={queue}><Icon name="cloud-up" />{tr('sync.queue')}</button>
          <button type="button" className="btn btn-primary btn-block" disabled={busy || st.state !== 'queued_for_sync'} onClick={() => void syncNow()}>{busy ? tr('ai.working') : <><Icon name="refresh" />{tr('sync.now')}</>}</button>
          {st.state === 'sync_conflict' && <button type="button" className="btn btn-block" onClick={() => void adopt()}>{tr('ex.adopt')}</button>}
        </div>
        {msg && msg !== st.lastError && <p className="faint mt-2" role="status">{msg}</p>}
        <details className="disclose">
          <summary>{tr('ex.states')}<Icon name="chevron-down" /></summary>
          <div className="dbody">
            <ul className="list">{['saved_on_device', 'awaiting_review', 'queued_for_sync', 'received_by_server'].map((s) => <li key={s} className="lrow"><Icon name={STATE_HELP[s]} /><span className="body"><span className="t">{tr(`sync.${s}`)}</span></span></li>)}</ul>
            <p className="faint mt-2">{tr('app.storageNote')}</p>
          </div>
        </details>
      </Card>
      <Card title={tr('ex.note')}>
        {STANDALONE ? (
          <Notice tone="info">{tr('ex.fileUnavailable')}</Notice>
        ) : (
          <div className="row noprint" style={{ marginBottom: 12 }}>
            <button type="button" className="btn" onClick={download}><Icon name="download" />{tr('ex.json')}</button>
            <button type="button" className="btn" onClick={() => window.print()}><Icon name="printer" />{tr('ex.print')}</button>
          </div>
        )}
        <pre className="note" lang="en">{renderNote(protocol, summary)}</pre>
      </Card>
      <Card className="noprint">
        <details className="disclose" style={{ borderTop: 0, marginTop: 0 }}>
          <summary>{tr('ex.unmapped')}<Icon name="chevron-down" /></summary>
          <div className="dbody table-wrap">
            <table><tbody>{FIELD_MAPPINGS.map((m) => <tr key={m.field}><td><code>{m.field}</code></td><td lang="en">{m.blocker}{m.candidate && <div className="faint">{m.candidate}</div>}</td></tr>)}</tbody></table>
          </div>
        </details>
        <details className="disclose">
          <summary>{tr('ex.demoControls')}<Icon name="chevron-down" /></summary>
          <div className="dbody stack">
            <button type="button" className="btn btn-block" onClick={() => void demo('/_test/expire-tokens')}>{tr('ex.expire')}</button>
            <button type="button" className="btn btn-block" onClick={() => void demo(`/_test/clinician-edit/${encodeURIComponent(enc.id)}`)}>{tr('ex.serverEdit')}</button>
          </div>
        </details>
      </Card>
    </>
  );
}
