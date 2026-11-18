import { useRef, useState } from 'react';
import { protocol } from '../protocol';
import type { Encounter } from '../store/types';
import type { ComplaintSummary, EncounterSummary, PendingItem } from '../engine/summary';
import { addDecision, logAiUsage, setAiNote } from '../store/encounter';
import { factLines, lintDraft, renderNote } from '../ai/note';
import { mockProvider } from '../ai/mockProvider';
import { httpProvider } from '../ai/httpProvider';
import { AI_LIMITS } from '../ai/types';
import { STANDALONE } from '../platform';
import { nodeTitle } from '../i18n';
import { AlertCard, Card, Icon, Loc, Notice, Pill, ReasonForm, Source, fmtDate } from './common';
import { useApp, type Update } from './ctx';
import { complaintLabel } from './assess';
import { itemsText, sectionForPending } from './flow';
import { SyncPill } from './home';

function pendingRef(p: PendingItem, tr: (k: string) => string): string {
  if (p.code === 'MEASURE') return tr(protocol.measures.find((m) => m.id === p.ref)?.labelKey ?? '');
  if (!p.ref || p.code === 'AI_PROPOSAL' || p.code === 'STALE_DECISION') return '';
  return protocol.nodes[p.ref]?.source.code ?? (p.ref.includes('|') ? protocol.nodes[p.ref.split('|')[1]]?.source.code ?? '' : p.code === 'LINKED_COMPLAINT' ? tr(`region.${p.ref}`) : p.ref);
}

/** Missing baseline measurements for one pain location are one task, not five. */
function groupPending(items: PendingItem[]): PendingItem[][] {
  const out: PendingItem[][] = [];
  for (const p of items) {
    const last = out[out.length - 1];
    if (p.code === 'MEASURE' && last && last[0].code === 'MEASURE' && last[0].complaintId === p.complaintId) last.push(p);
    else out.push([p]);
  }
  return out;
}

function PlanPill({ status }: { status: ComplaintSummary['plan']['status'] }) {
  const { tr } = useApp();
  if (status === 'approved_demo_only') return <Pill tone="ok" icon="check">{tr('plan.statusApproved')}</Pill>;
  if (status === 'awaiting_approval') return <Pill tone="progress" icon="clock">{tr('plan.statusAwaiting')}</Pill>;
  return <Pill tone="attn" icon="lock">{tr('plan.statusBlocked')}</Pill>;
}
function SafetyPill({ state }: { state: string }) {
  const { tr } = useApp();
  const tone = state === 'no_concern_reported' ? 'ok' : state === 'concern_raised' ? 'emergency' : 'attn';
  return <Pill tone={tone} icon={tone === 'ok' ? 'shield' : 'alert'}>{tr(`safety.${state}`)}</Pill>;
}

export function SummaryTab({ enc, summary, go }: { enc: Encounter; summary: EncounterSummary; go: (t: string) => void }) {
  const { tr, lang, actor, settings, store } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const note = renderNote(protocol, summary);
  const facts = factLines(protocol, summary);

  const draft = async () => {
    if (enc.aiUsage.calls >= AI_LIMITS.maxCallsPerEncounter) return setMsg(tr('ai.status.limit_reached'));
    setBusy(true);
    setMsg(null);
    abort.current = new AbortController();
    const provider = settings.aiMode === 'mock' ? mockProvider : httpProvider;
    const started = Date.now();
    const basedOn = enc.revision;
    const timer = setTimeout(() => abort.current?.abort(), AI_LIMITS.timeoutMs);
    let outcome = 'failed';
    try {
      const r = await provider.draftNote({ factLines: facts, lang: 'en' }, abort.current.signal);
      const cur = store.get(enc.id);
      if (!cur) return;
      let next = cur;
      if (r.ok) {
        // discard a draft that was produced from facts that have since changed
        if (cur.revision !== basedOn) outcome = 'stale';
        else {
          outcome = 'ok';
          next = setAiNote(next, actor, { text: r.data.text.slice(0, AI_LIMITS.maxResponseChars), providerId: provider.id, basedOnRevision: basedOn, at: new Date().toISOString() });
        }
      } else outcome = r.error === 'disabled' || r.error === 'bad_config' ? 'disabled' : r.error === 'refused' ? 'refused' : 'failed';
      next = logAiUsage(next, actor, { at: new Date().toISOString(), providerId: provider.id, model: r.usage?.model, task: 'note', ms: Date.now() - started, inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens, outcome });
      await store.put(next);
    } catch {
      outcome = abort.current.signal.aborted ? 'timeout' : 'failed';
    } finally {
      clearTimeout(timer);
      setBusy(false);
      setMsg(tr(`ai.status.${outcome}`));
    }
  };

  const states = summary.complaints.map((c) => c.ev.safety.state);
  const safetyAll = states.includes('concern_raised') ? 'concern_raised' : states.includes('incomplete') ? 'incomplete' : states.includes('in_progress') || states.includes('not_started') ? (states.includes('in_progress') ? 'in_progress' : 'not_started') : states.length ? 'no_concern_reported' : 'not_started';

  return (
    <>
      <section className="card statusboard" aria-labelledby="sb-h">
        <div className="sb-head">
          <h2 id="sb-h">{tr('sum.status')}</h2>
          <p>{summary.patient.name} · {enc.type === 'followup' ? tr(`visit.${enc.visit}`) : tr('home.initial')} · {fmtDate(enc.createdAt)}</p>
        </div>
        <div className="sb-grid">
          <div className="sb-cell"><span className="k">{tr('sum.safetyRows')}</span><SafetyPill state={safetyAll} /></div>
          <div className="sb-cell"><span className="k">{tr('sum.pending')}</span><span className="v">{summary.pending.length === 0 ? <Pill tone="ok" icon="check">{tr('sum.none')}</Pill> : itemsText(summary.pending.length, tr)}</span></div>
          <div className="sb-cell"><span className="k">{tr('sum.plan')}</span><div className="row">{summary.complaints.length ? summary.complaints.map((c) => <PlanPill key={c.complaint.id} status={c.plan.status} />) : <Pill tone="todo">{tr('flow.notStarted')}</Pill>}</div></div>
          <div className="sb-cell"><span className="k">{tr('sync.status')}</span><SyncPill state={enc.sync.state} /></div>
        </div>
      </section>

      {summary.alerts.map((a) => <AlertCard key={a.key} alert={a} acked={enc.alertAcks[a.key]} />)}

      <Card title={`${tr('sum.pending')} (${summary.pending.length})`}>
        {summary.pending.length === 0 ? <Notice tone="ok">{tr('sum.none')}</Notice> : (
          <ul className="list">
            {groupPending(summary.pending).map((g, i) => {
              const p = g[0];
              const c = summary.complaints.find((x) => x.complaint.id === p.complaintId);
              const target = sectionForPending(enc.type, p);
              const path = p.code === 'SAFETY_ITEM' && p.ref && target === 'assess' ? `assess/${p.ref}` : target;
              const isMeasure = p.code === 'MEASURE';
              const ref = isMeasure ? '' : pendingRef(p, tr);
              return (
                <li key={i} className="openitem">
                  <Icon name={['ALERT_ACK', 'CONTRADICTION', 'HALT'].includes(p.code) ? 'alert' : 'info'} />
                  <span className="body">
                    <span className="t">{tr(`pend.${p.code}`)}{g.length > 1 && ` (${g.length})`}{ref && <> · <span className="code">{ref}</span></>}</span>
                    {isMeasure && <span className="s">{g.map((x) => pendingRef(x, tr)).join(' · ')}</span>}
                    <span className="s">{c ? complaintLabel(c.complaint, tr) : ''}{p.detail && !isMeasure ? `${c ? ' · ' : ''}${String(p.detail).replace(/_/g, ' ')}` : ''}</span>
                  </span>
                  <button type="button" className="btn" onClick={() => go(path)}>{tr('sum.resolve')}</button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <h2 className="section-title">{tr('sum.findings')}</h2>
      {summary.complaints.map((c) => (
        <Card key={c.complaint.id} title={complaintLabel(c.complaint, tr)} actions={<SafetyPill state={c.ev.safety.state} />}>
          {c.confirmed ? (
            <div className="dx confirmed"><span className="k">{tr('sum.confirmed')}</span><span lang="en">{protocol.nodes[c.confirmed.targetId!]?.title}</span><div className="faint">{c.confirmed.by.name}</div></div>
          ) : c.ev.candidate ? (
            <div className="dx candidate"><span className="k">{tr('sum.candidate')}</span><Loc v={nodeTitle(protocol.nodes[c.ev.candidate.diagnosisId], lang)} /></div>
          ) : <div className="dx"><span className="k">{tr('sum.candidate')}</span>{tr('sum.noCandidate')}</div>}
          {c.ev.halt && <Notice tone="warn"><strong>{tr('pend.HALT')}</strong> — {tr(`halt.${c.ev.halt.reason}`)}</Notice>}
          {c.ev.contradictions.map((x, i) => <Notice key={i} tone="err">{tr('sum.contradiction')}: {protocol.nodes[x.nodeId]?.source.code} — <span lang="en">{x.detail}</span></Notice>)}
          <div className="row" style={{ margin: '8px 0 4px' }}><span className="muted">{tr('sum.plan')}:</span><PlanPill status={c.plan.status} /></div>
          <h3 className="section-title" style={{ marginLeft: 0 }}>{tr('sum.trace')}</h3>
          <ol className="trace">
            {c.trace.filter((t) => t.answerLabel || t.status).map((t) => (
              <li key={t.nodeId}><span className="code">{t.code}</span> <span lang="en">{t.title.replace(/^[A-Z0-9-]+ · /, '')}</span><span className="a" lang="en">→ {t.answerLabel ?? tr(`st.${t.status}`)}</span></li>
            ))}
          </ol>
          <details className="disclose">
            <summary>{tr('sum.safetyRows')} ({c.safetyRows.filter((r) => r.state !== 'not_asked').length} / {c.safetyRows.length})<Icon name="chevron-down" /></summary>
            <div className="dbody safetygrid">
              {c.safetyRows.map((r) => (
                <div key={r.checkId} className="srow">
                  <span className="code">{r.code}</span>
                  <span className="body"><Loc v={nodeTitle(protocol.nodes[r.checkId], lang)} />{r.reason && <span className="s">{r.reason.replace(/_/g, ' ')}</span>}</span>
                  <Pill tone={r.state}>{tr(`st.${r.state}`)}</Pill>
                </div>
              ))}
            </div>
          </details>
        </Card>
      ))}

      <Card title={tr('sum.note')}>
        <pre className="note" lang="en">{note}</pre>
        {settings.aiMode !== 'off' && (
          <div className="row noprint mt-3">
            <button type="button" className="btn" disabled={busy} onClick={() => void draft()}>{tr('sum.aiDraft')} ({settings.aiMode === 'mock' ? 'MOCK' : 'server'})</button>
            {busy && <button type="button" className="btn btn-ghost" onClick={() => abort.current?.abort()}>{tr('ai.cancel')}</button>}
          </div>
        )}
        {msg && <Notice tone="info" role="status">{msg}</Notice>}
        {enc.aiNote && (
          <Notice tone="warn">
            <strong>{tr('sum.aiDraft.label')}</strong> <span className="faint">({enc.aiNote.providerId}{enc.aiNote.basedOnRevision !== enc.revision ? ' · STALE: record changed since this draft' : ''})</span>
            <pre className="note mt-2" lang="en">{enc.aiNote.text}</pre>
            {lintDraft(protocol, enc.aiNote.text, facts).map((w, i) => <div key={i} className="err">⚠ {w}</div>)}
          </Notice>
        )}
      </Card>
    </>
  );
}

const BLOCKER_SECTION: Record<string, string> = {
  CONSENT_MISSING: 'start',
  SAFETY_NOT_FINISHED: 'assess', SAFETY_INCOMPLETE: 'assess', EXAM_PENDING: 'assess', PATHWAY_HALTED: 'assess', CONTRADICTION: 'assess', NO_CANDIDATE: 'assess', ALERT_UNACKNOWLEDGED: 'assess',
  MODIFIERS_NOT_ASKED: 'history',
};

function RoleBar() {
  const { tr, settings, set } = useApp();
  const isClin = settings.role === 'clinician';
  return (
    <Notice tone={isClin ? 'ok' : 'info'}>
      <strong>{tr('nav.workingAs')}: {tr(`app.role.${settings.role}`)}</strong>
      {!isClin && <p className="mt-2">{tr('rv.chwOnly')}</p>}
      {isClin && <p className="faint mt-2">{tr('app.role.note')}</p>}
      <button type="button" className="btn mt-2" onClick={() => set({ role: isClin ? 'chw' : 'clinician' })}>
        <Icon name={isClin ? 'user' : 'clinician'} />{isClin ? tr('rv.switchToChw') : tr('rv.switchToClinician')}
      </button>
    </Notice>
  );
}

function ComplaintReview({ enc, c, update, go }: { enc: Encounter; c: ComplaintSummary; update: Update; go: (t: string) => void }) {
  const { tr, actor, lang } = useApp();
  const cp = c.complaint;
  const plan = c.plan;
  const isClin = actor.role === 'clinician';
  const [dx, setDx] = useState<string>(c.confirmed?.targetId ?? c.ev.candidate?.diagnosisId ?? '');
  const [dose, setDose] = useState<string>(c.ev.doseLevel ?? c.confirmed?.value?.doseLevel ?? '');
  const decide = (type: Parameters<typeof addDecision>[2]['type'], reason: string, targetId?: string, value?: unknown) =>
    update((e) => addDecision(e, actor, { type, complaintId: cp.id, targetId, value, reason }));
  const has = (code: string) => plan.blockers.some((b) => b.code === code);
  const pathway = c.ev.pathway;
  const stale = enc.decisions.filter((d) => c.pending.some((p) => p.code === 'STALE_DECISION' && p.ref === d.id));
  const fu = enc.type === 'followup';
  return (
    <Card title={complaintLabel(cp, tr)} actions={<PlanPill status={plan.status} />}>
      <h3 className="section-title" style={{ marginLeft: 0, marginTop: 0 }}>{tr('rv.blockers')}</h3>
      {plan.blockers.length === 0 ? <Notice tone="ok">{tr('rv.noBlockers')}</Notice> : (
        <ul className="list">
          {plan.blockers.map((b) => {
            const to = BLOCKER_SECTION[b.code];
            const target = to === 'assess' && fu ? 'followup' : to === 'history' && fu ? undefined : to;
            return (
              <li key={b.code} className="openitem">
                <Icon name="lock" />
                <span className="body">
                  <span className="t">{tr(`bk.${b.code}`)}</span>
                  {b.refs.length > 0 && <span className="s">{b.refs.map((r) => protocol.nodes[r]?.source.code ?? (r.includes('|') ? protocol.nodes[r.split('|')[1]]?.source.code : r.startsWith('mod.') ? tr(r) : r)).join(', ')}</span>}
                </span>
                {target && <button type="button" className="btn" onClick={() => go(target)}>{tr('sum.resolve')}</button>}
              </li>
            );
          })}
        </ul>
      )}
      {(has('SAFETY_INCOMPLETE') || has('EXAM_PENDING')) && <p className="faint mt-2">{tr('rv.examHint')}</p>}

      {isClin && (
        <div className="stack mt-4">
          {has('ELIGIBILITY_UNVERIFIED') && <ReasonForm label={tr('rv.resolveElig')} onSubmit={(r) => decide('resolve_eligibility', r)} />}
          {c.alerts.map((a) => (
            <div key={a.key}>
              <AlertCard alert={a} acked={enc.alertAcks[a.key]} />
              {a.gatedNext.map((g) => <p key={g} className="faint">{tr('rv.gated')}: <span lang="en">{protocol.nodes[g].title}</span></p>)}
              {plan.blockers.find((b) => b.code === 'ALERT_UNRESOLVED')?.refs.includes(a.key) && <ReasonForm label={tr('rv.clearAlert')} onSubmit={(r) => decide('clear_alert', r, a.key)} />}
            </div>
          ))}
          {has('PAEDIATRIC_REVIEW') && <ReasonForm label={tr('rv.ackPaed')} onSubmit={(r) => decide('ack_paediatric', r)} />}
          {has('MODIFIER_SIGNOFF') && <ReasonForm label={tr('rv.ackMods')} onSubmit={(r) => decide('ack_modifiers', r)} />}

          {pathway && (
            <ReasonForm label={tr('rv.confirm')} disabled={!dx} onSubmit={(r) => decide('confirm_diagnosis', r, dx, { doseLevel: dose || null })}>
              <div className="field">
                <label htmlFor={`dx-${cp.id}`}>{tr('rv.confirmDx')}</label>
                <select id={`dx-${cp.id}`} value={dx} onChange={(e) => setDx(e.target.value)} lang="en">
                  <option value="">—</option>
                  {protocol.pathways[pathway].diagnoses.map((d) => (
                    <option key={d} value={d}>{protocol.nodes[d].title}{c.ev.candidate?.diagnosisId === d ? ' ← engine candidate' : ''}</option>
                  ))}
                </select>
              </div>
              {!c.ev.doseLevel && (
                <div className="field">
                  <label htmlFor={`dose-${cp.id}`}>{tr('rv.dose')}</label>
                  <select id={`dose-${cp.id}`} value={dose} onChange={(e) => setDose(e.target.value)} lang="en">
                    <option value="">—</option>
                    <option value="HI">HIGH irritability → start gentle</option>
                    <option value="MD">MODERATE → start moderate</option>
                    <option value="LO">LOW → start stronger</option>
                  </select>
                </div>
              )}
              {c.confirmed && <div className="dx confirmed"><span className="k">{tr('sum.confirmed')}</span><Loc v={nodeTitle(protocol.nodes[c.confirmed.targetId!], lang)} /></div>}
            </ReasonForm>
          )}
          {plan.status === 'awaiting_approval' && <ReasonForm label={tr('rv.approve')} onSubmit={(r) => decide('approve_plan', r, plan.diagnosis?.id, { groups: plan.exerciseGroups.map((g) => g.id), doseLevel: plan.doseLevel })}><Notice tone="warn">{tr('plan.approvedDemo')}</Notice></ReasonForm>}
          {plan.status === 'approved_demo_only' && <Notice tone="ok"><strong>{tr('rv.approved')}</strong> — {plan.approval?.by.name}</Notice>}
        </div>
      )}
      {stale.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginLeft: 0 }}>{tr('rv.stale')}</h3>
          <ul className="list">{stale.map((d) => <li key={d.id} className="lrow"><span className="body"><span className="t" lang="en">{d.type}</span><span className="s">{d.reason} · {d.by.name}</span></span><Pill tone="attn">{tr('pend.STALE_DECISION')}</Pill></li>)}</ul>
        </>
      )}
    </Card>
  );
}

export function ReviewTab({ enc, summary, update, go }: { enc: Encounter; summary: EncounterSummary; update: Update; go: (t: string) => void }) {
  const { tr } = useApp();
  return (
    <>
      <RoleBar />
      {summary.complaints.map((c) => <ComplaintReview key={c.complaint.id} enc={enc} c={c} update={update} go={go} />)}
      {enc.decisions.length > 0 && (
        <Card title={tr('rv.decisions')}>
          <ul className="list">{enc.decisions.map((d) => <li key={d.id} className="lrow"><span className="body"><span className="t"><span lang="en">{d.type}</span> {d.targetId && <span className="code">{protocol.nodes[d.targetId]?.source.code ?? ''}</span>}</span><span className="s">{d.reason} · {d.by.name} · {new Date(d.at).toLocaleString()}</span></span></li>)}</ul>
        </Card>
      )}
    </>
  );
}

export function PlanTab({ summary, go }: { enc: Encounter; summary: EncounterSummary; go: (t: string) => void }) {
  const { tr, lang } = useApp();
  return (
    <>
      {summary.complaints.map((c) => {
        const p = c.plan;
        return (
          <Card key={c.complaint.id} title={complaintLabel(c.complaint, tr)} actions={<PlanPill status={p.status} />}>
            {p.status === 'blocked' && (
              <Notice tone="warn">
                <strong>{tr('plan.blocked')}</strong>
                <ul className="mt-2">{p.blockers.map((b) => <li key={b.code}>{tr(`bk.${b.code}`)}</li>)}</ul>
                <button type="button" className="btn mt-3" onClick={() => go('review')}>{tr('flow.openReview')}</button>
              </Notice>
            )}
            {p.status === 'awaiting_approval' && <Notice tone="info">{tr('plan.awaiting')}</Notice>}
            {p.status === 'approved_demo_only' && <Notice tone="warn" role="note"><strong>{tr('plan.statusApproved')}</strong><br />{tr('plan.approvedDemo')}</Notice>}
            {p.status !== 'blocked' && p.diagnosis && (
              <>
                <div className={`dx ${p.diagnosisSource === 'clinician_confirmed' ? 'confirmed' : 'candidate'}`}><span className="k">{p.diagnosisSource === 'clinician_confirmed' ? tr('sum.confirmed') : tr('sum.candidate')}</span><Loc v={nodeTitle(p.diagnosis, lang)} /></div>
                <Source label={tr('plan.nextStep')} text={p.diagnosis.fields['NEXT STEP'] ?? p.diagnosis.fields['NEXT STEP — rehab first'] ?? Object.entries(p.diagnosis.fields).find(([k]) => k.startsWith('NEXT STEP'))?.[1]} />
                <h3 className="section-title" style={{ marginLeft: 0 }}>{tr('plan.groups')}</h3>
                {p.exerciseGroups.length === 0 && <p className="faint">{tr('plan.noGroup')}</p>}
                {p.exerciseGroups.map((g) => <Source key={g.id} label={g.title} text={g.sourceText.split('\n').slice(1).join('\n')} />)}
                {p.coreProgramme && <details className="disclose"><summary>{tr('plan.core')}<Icon name="chevron-down" /></summary><div className="dbody"><Source label={p.coreProgramme.title} text={p.coreProgramme.sourceText.split('\n').slice(1).join('\n')} /></div></details>}
                {p.doseNode && <Source label={`${tr('plan.dose')}: ${p.doseNode.title}`} text={p.doseNode.sourceText.split('\n').slice(1).join('\n')} />}
                {p.addOnModule && <Source label={tr('plan.addOn')} text={p.addOnModule} />}
                {p.precautions.length > 0 && (
                  <>
                    <h3 className="section-title" style={{ marginLeft: 0 }}>{tr('plan.precautions')}</h3>
                    {p.precautions.map((x, i) => <Source key={i} label={x.code} text={x.text} />)}
                  </>
                )}
                {p.painRule && <Source label={tr('plan.painRule')} text={p.painRule.sourceText.split('\n').slice(1).join('\n')} />}
                <h3 className="section-title" style={{ marginLeft: 0 }}>{tr('plan.followup')}</h3>
                <ul className="list">{p.followUp.map((f) => <li key={f.visit} className="lrow"><Icon name="calendar" /><span className="body"><span className="t">{tr(`visit.${f.visit}`)}</span><span className="s">+{f.offsetDays} d</span></span></li>)}</ul>
                {p.status === 'approved_demo_only' && (
                  <div className="card flat mt-4" style={{ background: 'var(--pearl)' }}>
                    <h3>{tr('plan.instructions')}</h3>
                    <p className="mt-2">{tr('plan.painRule.plain')}</p>
                    <Notice tone="err"><strong>{tr('plan.returnIf')}</strong></Notice>
                    {p.exerciseGroups.map((g) => <Source key={g.id} label={g.title} text={g.sourceText.split('\n').slice(2).join('\n').trim()} />)}
                    {STANDALONE ? <Notice tone="info">{tr('plan.printUnavailable')}</Notice> : <button type="button" className="btn noprint" onClick={() => window.print()}><Icon name="printer" />{tr('plan.print')}</button>}
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}
