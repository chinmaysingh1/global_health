import { useMemo, useRef, useState } from 'react';
import { protocol } from '../protocol';
import type { AnswerStatus, Encounter, Lang, Laterality, Patient, Region } from '../store/types';
import { LANGS } from '../store/types';
import { addComplaint, addNarrative, addProposals, decideProposal, logAiUsage, proposalConflict, setConsent, setHistoryField, setPatientLanguage, withdrawComplaint } from '../store/encounter';
import { HISTORY_CHOICE_FIELDS, HISTORY_LIST_FIELDS, HISTORY_TEXT_FIELDS, LOCAL_TASKS, MODIFIER_FIELDS } from '../store/historyFields';
import { evaluateEncounterComplaints } from '../engine/evaluate';
import { buildSummary } from '../engine/summary';
import { permittedTargets } from '../ai/permitted';
import { runExtraction } from '../ai/orchestrator';
import { mockProvider } from '../ai/mockProvider';
import { httpProvider } from '../ai/httpProvider';
import { LANG_NAMES, nodeTitle } from '../i18n';
import { Card, Loc, StatusButtons, fmtTime } from './common';
import { useApp, type Update } from './ctx';
import { AssessTab, complaintLabel } from './assess';
import { PlanTab, ReviewTab, SummaryTab } from './review';
import { FollowUpTab } from './followup';
import { ExportTab } from './exportsync';

const TABS_INITIAL = ['start', 'complaints', 'history', 'assess', 'summary', 'review', 'plan', 'export'];
const TABS_FOLLOWUP = ['start', 'followup', 'summary', 'review', 'export'];

export function EncounterScreen({ enc, patient, tab, nav }: { enc: Encounter; patient: Patient; tab: string; nav: (p: string) => void }) {
  const { tr, store, actor } = useApp();
  const update: Update = (fn) => {
    const cur = store.get(enc.id);
    if (cur) void store.put(fn(cur));
  };
  const summary = useMemo(() => buildSummary(protocol, patient, enc), [enc, patient]);
  const tabs = enc.type === 'followup' ? TABS_FOLLOWUP : TABS_INITIAL;
  const go = (t: string) => { nav(`/enc/${enc.id}/${t}`); window.scrollTo({ top: 0 }); };
  const save = store.saveState;
  const unacked = summary.alerts.filter((a) => !enc.alertAcks[a.key]).length;
  void actor;
  return (
    <>
      <header className="top">
        <div className="row">
          <button type="button" className="link" onClick={() => nav('/')} aria-label={tr('app.home')}>← {tr('app.home')}</button>
          <span className="pid">{patient.name}</span>
          <span className="pmeta">{patient.age ?? '?'} {tr('home.years')} · {enc.type === 'followup' ? tr(`visit.${enc.visit}`) : tr('home.initial')}</span>
          <span className={`savestate ${save.status === 'error' ? 'err' : ''}`} role="status" aria-live="polite">
            {save.status === 'error' ? `${tr('save.error')}: ${save.error}` : save.status === 'saving' ? tr('save.saving') : `${tr('save.saved')} ${fmtTime(save.at ?? enc.updatedAt)}`}
          </span>
        </div>
        <div className="row pmeta">
          {enc.complaints.filter((c) => !c.withdrawn).map((c) => <span key={c.id} className="chip" style={{ color: '#14201f' }}>{complaintLabel(c, tr)}</span>)}
        </div>
      </header>
      <nav className="tabs" aria-label="Steps">
        {tabs.map((t, i) => (
          <a key={t} href={`#/enc/${enc.id}/${t}`} aria-current={t === tab ? 'page' : undefined}>
            {i + 1}. {tr(`tab.${t}`)}
            {t === 'summary' && summary.pending.length > 0 && <span className="dot" aria-label={`${summary.pending.length} ${tr('home.openItems')}`}>{summary.pending.length}</span>}
            {t === (enc.type === 'followup' ? 'followup' : 'assess') && unacked > 0 && <span className="dot">!</span>}
          </a>
        ))}
      </nav>
      <main className="wrap">
        {unacked > 0 && tab !== 'assess' && tab !== 'followup' && (
          <div className="notice err" role="alert">
            <strong>{tr('alert.title')} ({unacked})</strong>{' '}
            <button type="button" className="link" onClick={() => go(enc.type === 'followup' ? 'followup' : 'assess')}>{tr('alert.view')}</button>
          </div>
        )}
        {tab === 'start' && <ConsentTab enc={enc} update={update} go={go} next={tabs[1]} />}
        {tab === 'complaints' && <ComplaintsTab enc={enc} update={update} go={go} />}
        {tab === 'history' && <HistoryTab enc={enc} patient={patient} update={update} go={go} />}
        {tab === 'assess' && <AssessTab enc={enc} patient={patient} update={update} go={go} />}
        {tab === 'followup' && <FollowUpTab enc={enc} patient={patient} update={update} go={go} />}
        {tab === 'summary' && <SummaryTab enc={enc} summary={summary} update={update} go={go} />}
        {tab === 'review' && <ReviewTab enc={enc} summary={summary} update={update} />}
        {tab === 'plan' && <PlanTab enc={enc} summary={summary} />}
        {tab === 'export' && <ExportTab enc={enc} summary={summary} update={update} />}
      </main>
    </>
  );
}

function ConsentTab({ enc, update, go, next }: { enc: Encounter; update: Update; go: (t: string) => void; next: string }) {
  const { tr, actor } = useApp();
  const [by, setBy] = useState<'patient' | 'caregiver'>(enc.consent?.by ?? 'patient');
  return (
    <>
      <Card title={tr('consent.patientLang')}>
        <div className="rowwrap">
          {LANGS.map((l: Lang) => (
            <button key={l} type="button" lang={l} aria-pressed={enc.patientLanguage === l} onClick={() => update((e) => setPatientLanguage(e, actor, l))}>{LANG_NAMES[l]}</button>
          ))}
        </div>
      </Card>
      <Card title={tr('consent.title')}>
        <p>{tr('consent.ask')}</p>
        <p className="muted">{tr('consent.noRecording')}</p>
        <label>{tr('consent.by')}</label>
        <div className="rowwrap">
          {(['patient', 'caregiver'] as const).map((b) => <button key={b} type="button" aria-pressed={by === b} onClick={() => setBy(b)}>{tr(`consent.${b}`)}</button>)}
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          <button type="button" className="primary" aria-pressed={enc.consent?.status === 'given'} onClick={() => { update((e) => setConsent(e, actor, 'given', by)); go(next); }}>{tr('consent.given')}</button>
          <button type="button" aria-pressed={enc.consent?.status === 'declined'} onClick={() => update((e) => setConsent(e, actor, 'declined', by))}>{tr('consent.declined')}</button>
        </div>
        {enc.consent?.status === 'declined' && <div className="notice warn">{tr('consent.blocked')}</div>}
      </Card>
    </>
  );
}

const ZONES: { region: Region; side: Laterality; d: string; label: string }[] = [
  { region: 'neck', side: 'central', d: 'M88 44 h24 v26 h-24 z', label: 'neck' },
  { region: 'low_back', side: 'central', d: 'M84 118 h32 v30 h-32 z', label: 'low back' },
  { region: 'hip', side: 'right', d: 'M70 150 h28 v30 h-28 z', label: 'right hip' },
  { region: 'hip', side: 'left', d: 'M102 150 h28 v30 h-28 z', label: 'left hip' },
  { region: 'knee', side: 'right', d: 'M72 226 h24 v26 h-24 z', label: 'right knee' },
  { region: 'knee', side: 'left', d: 'M104 226 h24 v26 h-24 z', label: 'left knee' },
];

function ComplaintsTab({ enc, update, go }: { enc: Encounter; update: Update; go: (t: string) => void }) {
  const { tr, actor } = useApp();
  const [region, setRegion] = useState<Region | null>(null);
  const [side, setSide] = useState<Laterality | null>(null);
  const [words, setWords] = useState('');
  const active = enc.complaints.filter((c) => !c.withdrawn);
  if (enc.consent?.status !== 'given') return <div className="notice warn">{tr('consent.blocked')}</div>;
  const add = () => {
    if (!region || !side) return;
    update((e) => addComplaint(e, actor, region, side, words.trim() || undefined));
    setRegion(null);
    setSide(null);
    setWords('');
  };
  return (
    <>
      <Card title={tr('cmp.title')}>
        <p>{tr('cmp.ask')}</p>
        <div className="figure">
          {/* viewed from the front: the patient's right is on the left of the picture */}
          <svg viewBox="0 0 200 320" role="group" aria-label={tr('cmp.figure')}>
            <circle className="body" cx="100" cy="26" r="18" />
            <path className="body" d="M64 70 q36 -22 72 0 l8 78 h-24 l-4 8 v150 h-12 l-4 -120 l-4 120 h-12 v-150 l-4 -8 h-24 z" />
            {ZONES.map((z) => (
              <path key={z.label} className={`zone ${region === z.region && side === z.side ? 'on' : ''}`} d={z.d} tabIndex={0} role="button" aria-label={`${tr(`region.${z.region}`)} — ${tr(`side.${z.side}`)}`} aria-pressed={region === z.region && side === z.side}
                onClick={() => { setRegion(z.region); setSide(z.side); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRegion(z.region); setSide(z.side); } }} />
            ))}
          </svg>
        </div>
        <div className="stack" role="radiogroup" aria-label={tr('cmp.title')}>
          {(['knee', 'hip', 'hip_knee_unsure', 'low_back', 'neck', 'back_unsure'] as Region[]).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={region === r} aria-pressed={region === r} onClick={() => { setRegion(r); if (side && !sidesFor(r).includes(side)) setSide(null); }}>{tr(`region.${r}`)}</button>
          ))}
        </div>
        <p className="muted">{tr('cmp.other')}</p>
        {region && (
          <>
            <label>{tr('side.title')}</label>
            <div className="rowwrap" role="radiogroup" aria-label={tr('side.title')}>
              {sidesFor(region).map((s) => <button key={s} type="button" role="radio" aria-checked={side === s} aria-pressed={side === s} onClick={() => setSide(s)}>{tr(`side.${s}`)}</button>)}
            </div>
            <label htmlFor="cmp-words">{tr('cmp.words')}</label>
            <textarea id="cmp-words" lang={enc.patientLanguage} value={words} onChange={(e) => setWords(e.target.value)} />
            <button type="button" className="primary" disabled={!side} onClick={add} style={{ marginTop: 8 }}>{tr('app.add')}</button>
          </>
        )}
      </Card>
      <Card title={tr('cmp.added')}>
        {active.length === 0 && <p className="muted">{tr('cmp.none')}</p>}
        {active.map((c) => (
          <div key={c.id} className="rowwrap" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
            <span>
              <strong>{complaintLabel(c, tr)}</strong>
              {c.origin && <span className="chip switch">{tr('cmp.linked')}</span>}
              {c.patientWords && <><br /><span className="muted" lang={enc.patientLanguage}>“{c.patientWords}”</span></>}
            </span>
            <button type="button" className="small" onClick={() => update((e) => withdrawComplaint(e, actor, c.id, 'removed by user'))}>{tr('cmp.withdraw')}</button>
          </div>
        ))}
        {active.length > 0 && <button type="button" className="primary" style={{ marginTop: 12 }} onClick={() => go('history')}>{tr('app.next')}</button>}
      </Card>
    </>
  );
}
const sidesFor = (r: Region): Laterality[] => (r === 'low_back' || r === 'neck' || r === 'back_unsure' ? ['central', 'left', 'right', 'both'] : ['left', 'right', 'both']);

function HistoryTab({ enc, patient, update, go }: { enc: Encounter; patient: Patient; update: Update; go: (t: string) => void }) {
  const { tr, actor, settings, store, lang } = useApp();
  const [text, setText] = useState('');
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  if (enc.consent?.status !== 'given') return <div className="notice warn">{tr('consent.blocked')}</div>;

  const saveNarrative = async (suggest: boolean) => {
    if (!text.trim()) return;
    const cur = store.get(enc.id)!;
    const { enc: withNarr, narrativeId } = addNarrative(cur, actor, text.trim(), enc.patientLanguage);
    await store.put(withNarr);
    setText('');
    if (!suggest || settings.aiMode === 'off') return;
    setBusy(true);
    setAiMsg(null);
    abort.current = new AbortController();
    const provider = settings.aiMode === 'mock' ? mockProvider : httpProvider;
    const evals = evaluateEncounterComplaints(protocol, withNarr.complaints, patient.age);
    const run = await runExtraction({ provider, encounter: withNarr, narrativeId, permitted: permittedTargets(protocol, withNarr, evals), getCurrent: () => store.get(enc.id), signal: abort.current.signal });
    setBusy(false);
    let latest = store.get(enc.id);
    if (!latest) return;
    if (run.status !== 'disabled' && run.status !== 'limit_reached') {
      latest = logAiUsage(latest, actor, { at: new Date().toISOString(), providerId: run.usage.providerId, model: run.usage.model, task: 'extract', ms: run.usage.ms, inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, outcome: run.status });
    }
    if (run.status === 'ok' && run.result) latest = addProposals(latest, actor, run.result.proposals);
    await store.put(latest);
    const rejected = run.result?.rejected.length ?? 0;
    setAiMsg(`${tr(`ai.status.${run.status}`)}${rejected ? ` ${rejected} ${tr('ai.rejected')}.` : ''}`);
  };

  const pending = enc.proposals.filter((p) => p.state === 'pending');
  return (
    <>
      <Card title={tr('hx.narrative')}>
        <p className="muted">{tr('hx.narrative.hint')} {tr('speech.note')}</p>
        <textarea lang={enc.patientLanguage} aria-label={tr('hx.narrative')} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="rowwrap" style={{ marginTop: 8 }}>
          <button type="button" className="primary" disabled={!text.trim() || busy} onClick={() => void saveNarrative(false)}>{tr('hx.narrative.save')}</button>
          {settings.aiMode !== 'off' && <button type="button" disabled={!text.trim() || busy} onClick={() => void saveNarrative(true)}>{tr('hx.narrative.save')} + {tr('hx.suggest')}</button>}
          {busy && <><span>{tr('ai.working')}</span><button type="button" className="small" onClick={() => abort.current?.abort()}>{tr('ai.cancel')}</button></>}
        </div>
        <p className="muted">{tr(`hx.ai.${settings.aiMode}`)} · {tr('ai.calls')}: {enc.aiUsage.calls}</p>
        {aiMsg && <div className="notice info" role="status">{aiMsg}</div>}
        {enc.narratives.map((n) => <p key={n.id} className="src" lang={n.lang}>“{n.text}” <span className="muted">({LANG_NAMES[n.lang]}, {fmtTime(n.at)})</span></p>)}
      </Card>

      {pending.length > 0 && (
        <Card title={tr('hx.proposals')}>
          {pending.map((p) => {
            const conflict = proposalConflict(enc, p.id);
            return (
              <div key={p.id} className={`notice ${p.urgentFlag ? 'err' : 'info'}`}>
                {p.urgentFlag && <strong>{tr('hx.proposal.urgent')}<br /></strong>}
                {p.target.kind === 'safety_check' ? <Loc v={nodeTitle(protocol.nodes[p.target.nodeId], lang)} /> : tr(p.target.code)} → <strong>{tr(`st.${p.status}`)}</strong>{p.value ? ` (${p.value})` : ''}
                <br /><span className="muted">{tr('hx.proposal.from')}: “{p.quote}” · {p.providerId}</span>
                {conflict && <div className="err">{tr('hx.proposal.conflict')}</div>}
                <div className="rowwrap" style={{ marginTop: 6 }}>
                  <button type="button" className="small primary" disabled={conflict} onClick={() => update((e) => decideProposal(e, actor, p.id, true))}>{tr('hx.proposal.accept')}</button>
                  <button type="button" className="small" onClick={() => update((e) => decideProposal(e, actor, p.id, false))}>{tr('hx.proposal.reject')}</button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <Card title={tr('hx.title')}>
        {HISTORY_TEXT_FIELDS.map((code) => <TextField key={code} code={code} enc={enc} update={update} />)}
        {HISTORY_LIST_FIELDS.map((code) => <ListField key={code} code={code} enc={enc} update={update} />)}
        {HISTORY_CHOICE_FIELDS.map((code) => <ChoiceField key={code} code={code} enc={enc} update={update} />)}
      </Card>
      <Card title={tr('hx.modifiers')}>
        {MODIFIER_FIELDS.map((code) => (
          <div key={code} style={{ marginBottom: 14 }}>
            <label>{tr(code)}</label>
            <StatusButtons options={['present', 'denied', 'unknown', 'declined', 'not_applicable']} current={enc.history[code]?.status} onPick={(s, reason) => update((e) => setHistoryField(e, actor, code, s, { value: reason }))} />
          </div>
        ))}
        <button type="button" className="primary" onClick={() => go('assess')}>{tr('app.next')}</button>
      </Card>
    </>
  );
}

function FieldState({ enc, code, update }: { enc: Encounter; code: string; update: Update }) {
  const { tr, actor } = useApp();
  const f = enc.history[code];
  const set = (s: AnswerStatus) => update((e) => setHistoryField(e, actor, code, s));
  return (
    <div className="rowwrap" style={{ marginTop: 4 }}>
      <span className={`chip ${f ? (f.status === 'present' ? 'ok' : 'warn') : 'not_asked'}`}>{f ? (f.status === 'present' ? tr('st.answered') : f.status === 'denied' ? tr('st.none_reported') : tr(`st.${f.status}`)) : tr('st.not_asked')}</span>
      <button type="button" className="small" onClick={() => set('unknown')}>{tr('st.unknown')}</button>
      <button type="button" className="small" onClick={() => set('declined')}>{tr('st.declined')}</button>
    </div>
  );
}
function TextField({ code, enc, update }: { code: string; enc: Encounter; update: Update }) {
  const { tr, actor } = useApp();
  const f = enc.history[code];
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={code}>{tr(code)}</label>
      <input id={code} type="text" lang={enc.patientLanguage} key={`${code}-${f?.at ?? ''}`} defaultValue={f?.status === 'present' ? f.value ?? '' : ''} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== f?.value) update((x) => setHistoryField(x, actor, code, 'present', { value: v })); }} />
      <FieldState enc={enc} code={code} update={update} />
    </div>
  );
}
function ListField({ code, enc, update }: { code: string; enc: Encounter; update: Update }) {
  const { tr, actor } = useApp();
  const f = enc.history[code];
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={code}>{tr(code)} <span className="muted">({tr('hx.listHint')})</span></label>
      <textarea id={code} lang={enc.patientLanguage} style={{ minHeight: 64 }} key={`${code}-${f?.at ?? ''}`} defaultValue={f?.status === 'present' ? (f.items ?? []).join('\n') : ''} onBlur={(e) => { const items = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); if (items.length && items.join('|') !== (f?.items ?? []).join('|')) update((x) => setHistoryField(x, actor, code, 'present', { items })); }} />
      <div className="rowwrap"><button type="button" className="small" aria-pressed={f?.status === 'denied'} onClick={() => update((x) => setHistoryField(x, actor, code, 'denied'))}>{tr('st.none_reported')}</button></div>
      <FieldState enc={enc} code={code} update={update} />
    </div>
  );
}
function ChoiceField({ code, enc, update }: { code: string; enc: Encounter; update: Update }) {
  const { tr, actor } = useApp();
  const f = enc.history[code];
  const items = f?.status === 'present' ? f.items ?? [] : [];
  const [other, setOther] = useState('');
  const toggle = (k: string) => {
    const next = items.includes(k) ? items.filter((i) => i !== k) : [...items, k];
    update((x) => setHistoryField(x, actor, code, next.length ? 'present' : 'unknown', { items: next }));
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <label>{tr(code)}</label>
      <p className="muted">{tr('hx.choicesHint')}</p>
      <div className="rowwrap">
        {LOCAL_TASKS.map((k) => <button key={k} type="button" className="small" aria-pressed={items.includes(k)} onClick={() => toggle(k)}>{tr(k)}</button>)}
        {items.filter((i) => !i.startsWith('task.')).map((i) => <button key={i} type="button" className="small" aria-pressed onClick={() => toggle(i)}>{i}</button>)}
      </div>
      <div className="rowwrap" style={{ marginTop: 6 }}>
        <input type="text" lang={enc.patientLanguage} aria-label={tr('task.other')} placeholder={tr('task.other')} value={other} onChange={(e) => setOther(e.target.value)} style={{ flex: 1 }} />
        <button type="button" className="small" disabled={!other.trim()} onClick={() => { toggle(other.trim()); setOther(''); }}>{tr('app.add')}</button>
      </div>
      <FieldState enc={enc} code={code} update={update} />
    </div>
  );
}
