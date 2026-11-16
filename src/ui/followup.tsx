// Follow-up visit: adherence, adverse response, safety re-check, like-for-like measures and
// the source's week 1 / 4 / 12 question. Improvement never "confirms" a diagnosis here.
import { useMemo, useState } from 'react';
import { protocol } from '../protocol';
import type { Complaint, Encounter, Patient } from '../store/types';
import { evaluateEncounterComplaints } from '../engine/evaluate';
import { compareMeasures, evaluateFollowUp } from '../engine/followup';
import { acknowledgeAlert, addDecision, answerRecord, setAnswer, setFollowUp } from '../store/encounter';
import { nodeTitle, optionLabel } from '../i18n';
import { AlertCard, Card, Loc, ReasonForm, Source, StatusButtons } from './common';
import { useApp, type Update } from './ctx';
import { complaintLabel, MeasuresForm, NodeStep, SafetyList } from './assess';

export function FollowUpTab({ enc, patient, update, go }: { enc: Encounter; patient: Patient; update: Update; go: (t: string) => void }) {
  const { tr, actor, store, lang } = useApp();
  const evals = useMemo(() => evaluateEncounterComplaints(protocol, enc.complaints, patient.age), [enc.complaints, patient.age]);
  const previous = enc.followUpOf ? store.get(enc.followUpOf) : null;
  const [open, setOpen] = useState<{ cid: string; nodeId: string } | null>(null);
  if (enc.consent?.status !== 'given') return <div className="notice warn">{tr('consent.blocked')}</div>;
  const visit = enc.visit!;
  const adverse = enc.followUp?.adverseStatus;
  return (
    <>
      <h1>{tr('fu.title')} — {tr(`visit.${visit}`)}</h1>
      <Card title={tr('fu.adherence')}>
        <div className="stack">
          {['most_days', 'some_days', 'rarely'].map((a) => (
            <button key={a} type="button" aria-pressed={enc.followUp?.adherence === a} onClick={() => update((e) => setFollowUp(e, actor, { adherence: a }))}>{tr(`fu.adherence.${a}`)}</button>
          ))}
        </div>
      </Card>
      <Card title={tr('fu.adverse')}>
        <StatusButtons options={['present', 'denied', 'unknown', 'declined']} current={adverse} onPick={(s, reason) => update((e) => setFollowUp(e, actor, { adverseStatus: s, adverse: s === 'present' ? e.followUp?.adverse : reason }))} />
        {adverse === 'present' && (
          <>
            <div className="notice err" role="alert">{tr('fu.adverse.yes')}</div>
            <label htmlFor="adv">{tr('fu.adverse.details')}</label>
            <textarea id="adv" lang={enc.patientLanguage} defaultValue={enc.followUp?.adverse ?? ''} onBlur={(e) => update((x) => setFollowUp(x, actor, { adverse: e.target.value.trim() }))} />
          </>
        )}
      </Card>

      {enc.complaints.filter((c) => !c.withdrawn).map((c: Complaint) => {
        const ev = evals.get(c.id)!;
        const pathway = c.fromPrevious?.pathway ?? ev.pathway;
        if (!pathway) return <Card key={c.id} title={complaintLabel(c, tr)}><div className="notice warn">{tr('fu.noPlan')}</div></Card>;
        const defs = protocol.measures.filter((m) => m.pathway === pathway);
        const baseline = previous?.complaints.find((p) => p.id === c.id)?.measures ?? {};
        const cmp = compareMeasures(defs, baseline, c.measures);
        const qId = protocol.pathways[pathway].followUp[visit];
        const q = protocol.nodes[qId];
        const outcome = evaluateFollowUp(protocol, pathway, visit, c.answers[qId]);
        const safetyOpen = adverse === 'present' || adverse === 'unknown';
        const safetyDone = ev.safety.answered === ev.safety.total && ev.safety.incomplete.length === 0 && ev.safety.positives.length === 0;
        const onHold = ev.alerts.length > 0 || (safetyOpen && !safetyDone) || adverse === undefined;
        const decision = enc.decisions.filter((d) => d.type === 'followup_outcome' && d.complaintId === c.id).pop();
        const dose = (c.fromPrevious?.doseLevel as 'HI' | 'MD' | 'LO' | undefined) ?? null;
        return (
          <Card key={c.id} title={complaintLabel(c, tr)}>
            <p className="muted">{tr('fu.carried')}: <span lang="en">{c.fromPrevious?.diagnosisId ? protocol.nodes[c.fromPrevious.diagnosisId].title : '—'}</span> · {tr('plan.dose')}: {dose ?? '—'}</p>
            {!c.fromPrevious?.diagnosisId && <div className="notice warn">{tr('fu.noPlan')}</div>}
            {ev.alerts.map((a) => <AlertCard key={a.key} alert={a} acked={enc.alertAcks[a.key]} onAck={() => update((e) => acknowledgeAlert(e, actor, a.key))} />)}

            <details open={safetyOpen}>
              <summary>{tr('fu.rescreen')} ({ev.safety.answered}/{ev.safety.total})</summary>
              {open?.cid === c.id ? (
                <>
                  <NodeStep node={protocol.nodes[open.nodeId]} complaint={c} update={update} late onDone={() => setOpen(null)} />
                  <button type="button" onClick={() => setOpen(null)}>{tr('app.cancel')}</button>
                </>
              ) : (
                <SafetyList complaint={c} ev={ev} onOpen={(nodeId) => setOpen({ cid: c.id, nodeId })} />
              )}
            </details>

            <h3>{tr('bl.title')}</h3>
            {/* at a re-test every measure may be recorded; only measures present at both visits are compared */}
            <MeasuresForm complaint={c} update={update} pathway={pathway} doseLevel={null} />

            <h3>{tr('fu.compare')}</h3>
            <table>
              <thead><tr><th></th><th>{tr('home.initial')}</th><th>{tr(`visit.${visit}`)}</th><th></th></tr></thead>
              <tbody>
                {cmp.map((r, i) => (
                  <tr key={i}>
                    <td>{tr(defs.find((d) => d.id === r.measureId)!.labelKey)}{r.side ? ` (${tr(`bl.${r.side}`)})` : ''}{r.item ? `: ${r.item}` : ''}</td>
                    <td>{String(r.baseline ?? '—')}</td>
                    <td>{String(r.current ?? '—')}</td>
                    <td><span className={`chip ${r.trend === 'better' ? 'ok' : r.trend === 'worse' ? 'present' : 'not_asked'}`}>{tr(`fu.${r.trend}`)}{r.delta !== null ? ` (${r.delta > 0 ? '+' : ''}${r.delta})` : ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">{tr('fu.notConfirm')}</p>

            <h3>{tr('fu.question')}</h3>
            <Source label={q.title} text={q.sourceText.split('\n').slice(1).join('\n')} />
            {onHold ? (
              <div className="notice warn">{adverse === undefined ? tr('fu.adverse') : tr('halt.ESCALATED')}</div>
            ) : (
              <div className="stack">
                {q.options.map((o) => (
                  <button key={o.id} type="button" aria-pressed={c.answers[qId]?.optionId === o.id} onClick={() => update((e) => setAnswer(e, actor, c.id, answerRecord(actor, qId, 'present', { optionId: o.id })))}><Loc v={optionLabel(o, lang)} /></button>
                ))}
                <StatusButtons options={['unknown']} onPick={(s, reason) => update((e) => setAnswer(e, actor, c.id, answerRecord(actor, qId, s, { reason })))} />
              </div>
            )}
            {!onHold && outcome.state !== 'unanswered' && (
              <div className="notice info">
                <span className="kicker">{tr('fu.outcome')}</span><br />
                <strong>{outcome.proposal ? tr(`fu.p.${outcome.proposal}`) : tr('halt.NEEDS_REVIEW')}</strong>
                {outcome.actionNode && <Source label={outcome.actionNode.title} text={outcome.actionNode.sourceText.split('\n').slice(1).join('\n')} />}
                {outcome.refs.length > 0 && <p className="muted">→ {outcome.refs.map((r) => protocol.nodes[r]?.source.code ?? r).join(', ')}</p>}
              </div>
            )}
            {decision && <div className="notice ok">{tr('fu.decision')}: {decision.reason} — {decision.by.name}</div>}
            {actor.role === 'clinician' && outcome.state !== 'unanswered' && (
              <ReasonForm label={tr('fu.decision')} onSubmit={(r) => update((e) => addDecision(e, actor, { type: 'followup_outcome', complaintId: c.id, targetId: qId, value: { proposal: outcome.proposal, optionId: outcome.optionId }, reason: r }))} />
            )}
          </Card>
        );
      })}
      <button type="button" className="primary" onClick={() => go('summary')}>{tr('halt.toSummary')}</button>
    </>
  );
}

export { nodeTitle };
