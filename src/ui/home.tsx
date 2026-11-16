import { useEffect, useState } from 'react';
import { protocol } from '../protocol';
import { DEMO_PATIENTS } from '../store/fixtures';
import { LANGS, type Complaint, type Encounter, type Patient } from '../store/types';
import { createEncounter, createFollowUp } from '../store/encounter';
import { buildSummary } from '../engine/summary';
import { fetchAiStatus, type AiServerStatus } from '../ai/httpProvider';
import { LANG_NAMES } from '../i18n';
import { Card } from './common';
import { useApp } from './ctx';

function carriedFrom(patient: Patient, prev: Encounter): Record<string, Complaint['fromPrevious']> {
  const s = buildSummary(protocol, patient, prev);
  const out: Record<string, Complaint['fromPrevious']> = {};
  for (const c of s.complaints) {
    const approved = c.plan.status === 'approved_demo_only';
    out[c.complaint.id] = {
      pathway: c.ev.pathway ?? undefined,
      diagnosisId: approved ? c.plan.diagnosis?.id : undefined,
      doseLevel: approved ? c.plan.doseLevel ?? undefined : undefined,
      exerciseGroups: approved ? c.plan.exerciseGroups.map((g) => g.id) : undefined,
    };
  }
  return out;
}

export function Home({ nav }: { nav: (p: string) => void }) {
  const { tr, settings, set, actor, store, lang } = useApp();
  const [ai, setAi] = useState<AiServerStatus | null>(null);
  useEffect(() => { void fetchAiStatus().then(setAi); }, []);
  const all = store.all();
  const start = (p: Patient) => {
    const enc = createEncounter(p, actor, protocol.protocolVersion);
    void store.put(enc).then(() => nav(`/enc/${enc.id}/start`));
  };
  const followUp = (p: Patient, prev: Encounter, visit: 'week1' | 'week4' | 'week12') => {
    const enc = createFollowUp(protocol, p, actor, prev, visit, carriedFrom(p, prev));
    void store.put(enc).then(() => nav(`/enc/${enc.id}/start`));
  };
  return (
    <>
      <header className="top"><div className="row"><h1>{tr('app.title')}</h1><a href="#/protocol" style={{ marginLeft: 'auto' }}>{tr('app.protocol')}</a></div></header>
      <main className="wrap">
        <Card>
          <label>{tr('app.language')}</label>
          <div className="rowwrap" role="radiogroup" aria-label={tr('app.language')}>
            {LANGS.map((l) => <button key={l} type="button" role="radio" lang={l} aria-checked={lang === l} aria-pressed={lang === l} onClick={() => set({ lang: l })}>{LANG_NAMES[l]}</button>)}
          </div>
          <label>{tr('app.role')}</label>
          <div className="rowwrap" role="radiogroup" aria-label={tr('app.role')}>
            {(['chw', 'clinician'] as const).map((r) => <button key={r} type="button" role="radio" aria-checked={settings.role === r} aria-pressed={settings.role === r} onClick={() => set({ role: r })}>{tr(`app.role.${r}`)}</button>)}
          </div>
          <p className="muted">{tr('app.role.note')}</p>
          {settings.role === 'chw' && (
            <label style={{ fontWeight: 400 }}><input type="checkbox" checked={settings.kit} onChange={(e) => set({ kit: e.target.checked })} style={{ width: 22, height: 22, verticalAlign: 'middle', marginRight: 8 }} />{tr('app.kit')}</label>
          )}
          <label>{tr('ai.title')}</label>
          <div className="rowwrap" role="radiogroup" aria-label={tr('ai.title')}>
            <button type="button" role="radio" aria-checked={settings.aiMode === 'off'} aria-pressed={settings.aiMode === 'off'} onClick={() => set({ aiMode: 'off' })}>{tr('ai.off')}</button>
            <button type="button" role="radio" aria-checked={settings.aiMode === 'mock'} aria-pressed={settings.aiMode === 'mock'} onClick={() => set({ aiMode: 'mock' })}>{tr('ai.mock')}</button>
            <button type="button" role="radio" aria-checked={settings.aiMode === 'server'} aria-pressed={settings.aiMode === 'server'} disabled={!ai?.enabled} onClick={() => set({ aiMode: 'server' })}>{tr('ai.server')}{ai?.enabled ? ` (${ai.model})` : ` — ${tr('ai.serverDisabled')}`}</button>
          </div>
          <p className="muted">{tr('app.storageNote')}</p>
        </Card>
        <h2 style={{ marginTop: 16 }}>{tr('home.patients')}</h2>
        {DEMO_PATIENTS.map((p) => {
          const encs = all.filter((e) => e.patientId === p.id);
          return (
            <Card key={p.id}>
              <h2>{p.name}</h2>
              <p className="muted">{p.age ?? '?'} {tr('home.years')} · {p.sex} · {p.village} · {LANG_NAMES[p.preferredLanguage]}</p>
              <p className="muted" lang="en">{p.demoNote}</p>
              {encs.length === 0 && <p className="muted">{tr('home.noEncounters')}</p>}
              {encs.map((e) => {
                const pend = buildSummary(protocol, p, e).pending.length;
                return (
                  <div key={e.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                    <div className="rowwrap">
                      <strong>{e.type === 'followup' ? tr(`visit.${e.visit}`) : tr('home.initial')}</strong>
                      <span className="muted">{new Date(e.updatedAt).toLocaleString()}</span>
                      <span className={`chip ${e.sync.state === 'received_by_server' ? 'ok' : 'warn'}`}>{tr(`sync.${e.sync.state}`)}</span>
                      {pend > 0 && <span className="chip warn">{pend} {tr('home.openItems')}</span>}
                    </div>
                    <div className="rowwrap" style={{ marginTop: 6 }}>
                      <button type="button" className="small primary" onClick={() => nav(`/enc/${e.id}/${e.type === 'followup' ? 'followup' : e.complaints.length ? 'assess' : 'start'}`)}>{tr('home.resume')}</button>
                      {e.type === 'initial' && (['week1', 'week4', 'week12'] as const).map((v) => <button key={v} type="button" className="small" onClick={() => followUp(p, e, v)}>{tr('home.followup')}: {tr(`visit.${v}`)}</button>)}
                      <button type="button" className="small danger" onClick={() => { if (window.confirm(tr('home.delete'))) void store.remove(e.id); }}>{tr('home.delete')}</button>
                    </div>
                  </div>
                );
              })}
              <button type="button" className="primary" style={{ marginTop: 8 }} onClick={() => start(p)}>{tr('home.new')}</button>
            </Card>
          );
        })}
      </main>
    </>
  );
}
