import { useRef, useState } from 'react';
import { protocol } from '../protocol';
import type { Encounter } from '../store/types';
import type { ComplaintSummary, EncounterSummary } from '../engine/summary';
import { addDecision, logAiUsage, setAiNote, setSync } from '../store/encounter';
import { factLines, lintDraft, renderNote } from '../ai/note';
import { mockProvider } from '../ai/mockProvider';
import { httpProvider } from '../ai/httpProvider';
import { AI_LIMITS } from '../ai/types';
import { nodeTitle } from '../i18n';
import { AlertCard, Card, Loc, ReasonForm, Source } from './common';
import { useApp, type Update } from './ctx';
import { complaintLabel } from './assess';

export function SummaryTab({ enc, summary, update, go }: { enc: Encounter; summary: EncounterSummary; update: Update; go: (t: string) => void }) {
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

  return (
    <>
      <h1>{tr('sum.title')}</h1>
      {summary.alerts.map((a) => <AlertCard key={a.key} alert={a} acked={enc.alertAcks[a.key]} />)}
      <Card title={`${tr('sum.pending')} (${summary.pending.length})`}>
        {summary.pending.length === 0 ? <p className="chip ok">{tr('sum.none')}</p> : (
          <ul>
            {summary.pending.map((p, i) => (
              <li key={i}>
                <strong>{p.code}</strong> {p.code === 'MEASURE' ? tr(protocol.measures.find((m) => m.id === p.ref)?.labelKey ?? '') : p.ref ? protocol.nodes[p.ref]?.source.code ?? (p.ref.includes('|') ? protocol.nodes[p.ref.split('|')[1]]?.source.code : p.code === 'AI_PROPOSAL' || p.code === 'STALE_DECISION' ? '' : p.ref) : ''}
                {p.detail && <span className="muted"> — {String(p.detail).replace(/_/g, ' ')}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {summary.complaints.map((c) => (
        <Card key={c.complaint.id} title={complaintLabel(c.complaint, tr)}>
          <p><span className={`chip ${c.ev.safety.state === 'no_concern_reported' ? 'ok' : c.ev.safety.state === 'concern_raised' ? 'emergency' : 'warn'}`}>{tr(`safety.${c.ev.safety.state}`)}</span></p>
          <table>
            <tbody>
              {c.safetyRows.map((r) => (
                <tr key={r.checkId}>
                  <td style={{ width: '3rem' }}><strong>{r.code}</strong></td>
                  <td><Loc v={nodeTitle(protocol.nodes[r.checkId], lang)} /></td>
                  <td><span className={`chip ${r.state}`}>{tr(`st.${r.state}`)}</span>{r.reason && <div className="muted">{r.reason.replace(/_/g, ' ')}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>{tr('sum.trace')}</h3>
          <ol>
            {c.trace.filter((t) => t.answerLabel || t.status).map((t) => (
              <li key={t.nodeId}><strong>{t.code}</strong> <span lang="en">{t.title.replace(/^[A-Z0-9-]+ · /, '')}</span> → <span lang="en">{t.answerLabel ?? tr(`st.${t.status}`)}</span></li>
            ))}
          </ol>
          {c.ev.halt && <div className="notice warn"><strong>{c.ev.halt.reason}</strong> — {tr(`halt.${c.ev.halt.reason}`)}</div>}
          {c.ev.contradictions.map((x, i) => <div key={i} className="notice err">{tr('sum.contradiction')}: {protocol.nodes[x.nodeId]?.source.code} — <span lang="en">{x.detail}</span></div>)}
          {c.confirmed ? (
            <div className="notice ok"><span className="kicker">{tr('sum.confirmed')}</span><br /><span lang="en">{protocol.nodes[c.confirmed.targetId!]?.title}</span> — {c.confirmed.by.name}</div>
          ) : c.ev.candidate ? (
            <div className="notice info"><span className="kicker">{tr('sum.candidate')}</span><br /><span lang="en">{protocol.nodes[c.ev.candidate.diagnosisId].title}</span></div>
          ) : <div className="notice warn">{tr('sum.noCandidate')}</div>}
        </Card>
      ))}
      <Card title={tr('sum.note')}>
        <pre className="note" lang="en">{note}</pre>
        {settings.aiMode !== 'off' && (
          <div className="rowwrap noprint">
            <button type="button" disabled={busy} onClick={() => void draft()}>{tr('sum.aiDraft')} ({settings.aiMode === 'mock' ? 'MOCK' : 'server'})</button>
            {busy && <button type="button" className="small" onClick={() => abort.current?.abort()}>{tr('ai.cancel')}</button>}
          </div>
        )}
        {msg && <div className="notice info" role="status">{msg}</div>}
        {enc.aiNote && (
          <div className="notice warn">
            <strong>{tr('sum.aiDraft.label')}</strong> <span className="muted">({enc.aiNote.providerId}{enc.aiNote.basedOnRevision !== enc.revision ? ' · STALE: record changed since this draft' : ''})</span>
            <pre className="note" lang="en">{enc.aiNote.text}</pre>
            {lintDraft(protocol, enc.aiNote.text, facts).map((w, i) => <div key={i} className="err">⚠ {w}</div>)}
          </div>
        )}
      </Card>
      <div className="rowwrap noprint">
        <button type="button" className="primary" disabled={enc.sync.state === 'awaiting_review'} onClick={() => { update((e) => setSync(e, actor, { ...e.sync, state: 'awaiting_review' })); go('review'); }}>{tr('sync.markReady')}</button>
        <span className="chip">{tr(`sync.${enc.sync.state}`)}</span>
      </div>
    </>
  );
}

function ComplaintReview({ enc, c, update }: { enc: Encounter; c: ComplaintSummary; update: Update }) {
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
  return (
    <Card title={complaintLabel(cp, tr)}>
      <h3>{tr('rv.blockers')}</h3>
      {plan.blockers.length === 0 ? <p className="chip ok">{tr('rv.noBlockers')}</p> : (
        <ul>
          {plan.blockers.map((b) => (
            <li key={b.code}>{tr(`bk.${b.code}`)}{b.refs.length > 0 && <span className="muted"> — {b.refs.map((r) => protocol.nodes[r]?.source.code ?? (r.includes('|') ? protocol.nodes[r.split('|')[1]]?.source.code : r.startsWith('mod.') ? tr(r) : r)).join(', ')}</span>}</li>
          ))}
        </ul>
      )}
      {(has('SAFETY_INCOMPLETE') || has('EXAM_PENDING')) && <p className="muted">{tr('rv.examHint')}</p>}
      {!isClin && <div className="notice info">{tr('rv.chwOnly')}</div>}

      {isClin && (
        <>
          {has('ELIGIBILITY_UNVERIFIED') && <ReasonForm label={tr('rv.resolveElig')} onSubmit={(r) => decide('resolve_eligibility', r)} />}
          {c.alerts.map((a) => (
            <div key={a.key}>
              <AlertCard alert={a} acked={enc.alertAcks[a.key]} />
              {a.gatedNext.map((g) => <p key={g} className="muted">{tr('rv.gated')}: <span lang="en">{protocol.nodes[g].title}</span></p>)}
              {plan.blockers.find((b) => b.code === 'ALERT_UNRESOLVED')?.refs.includes(a.key) && <ReasonForm label={tr('rv.clearAlert')} onSubmit={(r) => decide('clear_alert', r, a.key)} />}
            </div>
          ))}
          {has('PAEDIATRIC_REVIEW') && <ReasonForm label={tr('rv.ackPaed')} onSubmit={(r) => decide('ack_paediatric', r)} />}
          {has('MODIFIER_SIGNOFF') && <ReasonForm label={tr('rv.ackMods')} onSubmit={(r) => decide('ack_modifiers', r)} />}

          {pathway && (
            <ReasonForm label={tr('rv.confirm')} disabled={!dx} onSubmit={(r) => decide('confirm_diagnosis', r, dx, { doseLevel: dose || null })}>
              <label>{tr('rv.confirmDx')}
                <select value={dx} onChange={(e) => setDx(e.target.value)} lang="en">
                  <option value="">—</option>
                  {protocol.pathways[pathway].diagnoses.map((d) => (
                    <option key={d} value={d}>{protocol.nodes[d].title}{c.ev.candidate?.diagnosisId === d ? ' ← engine candidate' : ''}</option>
                  ))}
                </select>
              </label>
              {!c.ev.doseLevel && (
                <label>{tr('rv.dose')}
                  <select value={dose} onChange={(e) => setDose(e.target.value)}>
                    <option value="">—</option>
                    <option value="HI">HIGH irritability → start gentle</option>
                    <option value="MD">MODERATE → start moderate</option>
                    <option value="LO">LOW → start stronger</option>
                  </select>
                </label>
              )}
              {c.confirmed && <p className="chip ok">{tr('sum.confirmed')}: <Loc v={nodeTitle(protocol.nodes[c.confirmed.targetId!], lang)} /></p>}
            </ReasonForm>
          )}
          {plan.status === 'awaiting_approval' && <ReasonForm label={tr('rv.approve')} onSubmit={(r) => decide('approve_plan', r, plan.diagnosis?.id, { groups: plan.exerciseGroups.map((g) => g.id), doseLevel: plan.doseLevel })}><p>{tr('plan.approvedDemo')}</p></ReasonForm>}
          {plan.status === 'approved_demo_only' && <div className="notice ok">{tr('rv.approved')} — {plan.approval?.by.name}</div>}
        </>
      )}
      {stale.length > 0 && (
        <>
          <h3>{tr('rv.stale')}</h3>
          <ul>{stale.map((d) => <li key={d.id} className="muted">{d.type} — {d.reason} ({d.by.name})</li>)}</ul>
        </>
      )}
    </Card>
  );
}

export function ReviewTab({ enc, summary, update }: { enc: Encounter; summary: EncounterSummary; update: Update }) {
  const { tr } = useApp();
  return (
    <>
      <h1>{tr('rv.title')}</h1>
      {summary.complaints.map((c) => <ComplaintReview key={c.complaint.id} enc={enc} c={c} update={update} />)}
      {enc.decisions.length > 0 && (
        <Card title="Decision log">
          <ul>{enc.decisions.map((d) => <li key={d.id}><strong>{d.type}</strong> {d.targetId && (protocol.nodes[d.targetId]?.source.code ?? '')} — {d.reason} <span className="muted">({d.by.name}, {new Date(d.at).toLocaleString()})</span></li>)}</ul>
        </Card>
      )}
    </>
  );
}

export function PlanTab({ enc, summary }: { enc: Encounter; summary: EncounterSummary }) {
  const { tr, lang } = useApp();
  void enc;
  return (
    <>
      <h1>{tr('plan.title')}</h1>
      {summary.complaints.map((c) => {
        const p = c.plan;
        return (
          <Card key={c.complaint.id} title={complaintLabel(c.complaint, tr)}>
            {p.status === 'blocked' && (
              <div className="notice warn">
                <strong>{tr('plan.blocked')}</strong>
                <ul>{p.blockers.map((b) => <li key={b.code}>{tr(`bk.${b.code}`)}</li>)}</ul>
              </div>
            )}
            {p.status === 'awaiting_approval' && <div className="notice info">{tr('plan.awaiting')}</div>}
            {p.status === 'approved_demo_only' && <div className="notice err">{tr('plan.approvedDemo')}</div>}
            {p.status !== 'blocked' && p.diagnosis && (
              <>
                <p><span className="kicker">{p.diagnosisSource === 'clinician_confirmed' ? tr('sum.confirmed') : tr('sum.candidate')}</span><br /><Loc v={nodeTitle(p.diagnosis, lang)} /></p>
                <Source label="Next step (source)" text={p.diagnosis.fields['NEXT STEP'] ?? p.diagnosis.fields['NEXT STEP — rehab first'] ?? Object.entries(p.diagnosis.fields).find(([k]) => k.startsWith('NEXT STEP'))?.[1]} />
                <h3>{tr('plan.groups')}</h3>
                {p.exerciseGroups.length === 0 && <p className="muted">{tr('plan.noGroup')}</p>}
                {p.exerciseGroups.map((g) => <Source key={g.id} label={g.title} text={g.sourceText.split('\n').slice(1).join('\n')} />)}
                {p.coreProgramme && <details><summary>{tr('plan.core')}</summary><Source label={p.coreProgramme.title} text={p.coreProgramme.sourceText.split('\n').slice(1).join('\n')} /></details>}
                {p.doseNode && <Source label={`${tr('plan.dose')}: ${p.doseNode.title}`} text={p.doseNode.sourceText.split('\n').slice(1).join('\n')} />}
                {p.addOnModule && <Source label="Measurement add-on (source)" text={p.addOnModule} />}
                {p.precautions.length > 0 && (
                  <>
                    <h3>{tr('plan.precautions')}</h3>
                    {p.precautions.map((x, i) => <Source key={i} label={x.code} text={x.text} />)}
                  </>
                )}
                {p.painRule && <Source label={tr('plan.painRule')} text={p.painRule.sourceText.split('\n').slice(1).join('\n')} />}
                <h3>{tr('plan.followup')}</h3>
                <ul>{p.followUp.map((f) => <li key={f.visit}>{tr(`visit.${f.visit}`)} — +{f.offsetDays} d</li>)}</ul>
                {p.status === 'approved_demo_only' && (
                  <div className="card" style={{ background: '#fbfdfc' }}>
                    <h3>{tr('plan.instructions')}</h3>
                    <p>{tr('plan.painRule.plain')}</p>
                    <p><strong>{tr('plan.returnIf')}</strong></p>
                    {p.exerciseGroups.map((g) => <Source key={g.id} label={g.title} text={g.sourceText.split('\n').slice(2).join('\n').trim()} />)}
                    <button type="button" className="noprint" onClick={() => window.print()}>{tr('plan.print')}</button>
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
