// Follow-up visit: adherence, adverse response, safety re-check, like-for-like measures and
// the source's week 1 / 4 / 12 question. Improvement never "confirms" a diagnosis here.
import { useMemo, useState } from 'react';
import { protocol } from '../protocol';
import type { Complaint, Encounter, Patient } from '../store/types';
import { evaluateEncounterComplaints } from '../engine/evaluate';
import { compareMeasures, evaluateFollowUp } from '../engine/followup';
import { acknowledgeAlert, addDecision, answerRecord, setAnswer, setFollowUp } from '../store/encounter';
import { nodeTitle, optionLabel } from '../i18n';
import { AlertCard, Card, Choice, Icon, Loc, Notice, Pill, RadioGroup, ReasonForm, Source, StatusButtons, fmtDate, useTapLock } from './common';
import { useApp, type Update } from './ctx';
import { complaintLabel, MeasuresForm, NodeStep, SafetyList } from './assess';

function show(v: unknown, tr: (k: string) => string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return tr(v ? 'st.present' : 'st.denied');
  return String(v);
}

export function FollowUpTab({ enc, patient, update }: { enc: Encounter; patient: Patient; update: Update }) {
  const { tr, actor, store, lang } = useApp();
  const evals = useMemo(() => evaluateEncounterComplaints(protocol, enc.complaints, patient.age), [enc.complaints, patient.age]);
  const previous = enc.followUpOf ? store.get(enc.followUpOf) : null;
  const [open, setOpen] = useState<{ cid: string; nodeId: string } | null>(null);
  const [locked, lock] = useTapLock();
  if (enc.consent?.status !== 'given') return <Notice tone="warn">{tr('consent.blocked')}</Notice>;
  const visit = enc.visit!;
  const adverse = enc.followUp?.adverseStatus;
  return (
    <>
      <Card title={tr('fu.adherence')}>
        <RadioGroup legend={tr('fu.adherence')} hideLegend variant="list" value={enc.followUp?.adherence ?? null} onChange={(a: string) => update((e) => setFollowUp(e, actor, { adherence: a }))} options={['most_days', 'some_days', 'rarely'].map((a) => ({ value: a, label: tr(`fu.adherence.${a}`) }))} />
      </Card>
      <Card title={tr('fu.adverse')}>
        <StatusButtons options={['present', 'denied', 'unknown', 'declined']} current={adverse} onPick={(s, reason) => update((e) => setFollowUp(e, actor, { adverseStatus: s, adverse: s === 'present' ? e.followUp?.adverse : reason }))} />
        {adverse === 'present' && (
          <>
            <Notice tone="err" role="alert">{tr('fu.adverse.yes')}</Notice>
            <div className="field">
              <label htmlFor="adv">{tr('fu.adverse.details')}</label>
              <textarea id="adv" lang={enc.patientLanguage} defaultValue={enc.followUp?.adverse ?? ''} onBlur={(e) => update((x) => setFollowUp(x, actor, { adverse: e.target.value.trim() }))} />
            </div>
          </>
        )}
      </Card>

      {enc.complaints.filter((c) => !c.withdrawn).map((c: Complaint) => {
        const ev = evals.get(c.id)!;
        const pathway = c.fromPrevious?.pathway ?? ev.pathway;
        if (!pathway) return <Card key={c.id} title={complaintLabel(c, tr)}><Notice tone="warn">{tr('fu.noPlan')}</Notice></Card>;
        const defs = protocol.measures.filter((m) => m.pathway === pathway);
        const prevComplaint = previous?.complaints.find((p) => p.id === c.id);
        const baseline = prevComplaint?.measures ?? {};
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
            <div className={`dx ${c.fromPrevious?.diagnosisId ? 'confirmed' : ''}`}>
              <span className="k">{tr('fu.carried')}</span>
              <span lang="en">{c.fromPrevious?.diagnosisId ? protocol.nodes[c.fromPrevious.diagnosisId].title : '—'}</span>
              <div className="faint">{tr('plan.dose')}: {dose ?? '—'}</div>
            </div>
            {!c.fromPrevious?.diagnosisId && <Notice tone="warn">{tr('fu.noPlan')}</Notice>}
            {ev.alerts.map((a) => <AlertCard key={a.key} alert={a} acked={enc.alertAcks[a.key]} onAck={() => update((e) => acknowledgeAlert(e, actor, a.key))} />)}

            <details className="disclose" open={safetyOpen}>
              <summary>{tr('fu.rescreen')} ({ev.safety.answered} / {ev.safety.total})<Icon name="chevron-down" /></summary>
              <div className="dbody">
                {open?.cid === c.id ? (
                  <>
                    <div className="edit-banner"><span>{tr('as.editing')}</span><button type="button" className="btn" onClick={() => setOpen(null)}>{tr('app.cancel')}</button></div>
                    <NodeStep node={protocol.nodes[open.nodeId]} complaint={c} update={update} late onDone={() => setOpen(null)} />
                  </>
                ) : (
                  <SafetyList complaint={c} ev={ev} onOpen={(nodeId) => setOpen({ cid: c.id, nodeId })} />
                )}
              </div>
            </details>

            <h3 className="section-title" style={{ marginLeft: 0 }}>{tr('bl.title')}</h3>
            {/* at a re-test every measure may be recorded; only measures present at both visits are compared */}
            <MeasuresForm complaint={c} update={update} pathway={pathway} doseLevel={null} />

            <h3 className="section-title" style={{ marginLeft: 0 }}>{tr('fu.compare')}</h3>
            <div className="cmp">
              {cmp.map((r, i) => {
                const def = defs.find((d) => d.id === r.measureId)!;
                const b = show(r.baseline, tr);
                const cur = show(r.current, tr);
                const unit = def.unit && def.unit !== '0-10' ? ` ${def.unit}` : def.unit === '0-10' ? '/10' : '';
                const tone = r.trend === 'better' ? 'ok' : r.trend === 'worse' ? 'danger' : 'todo';
                return (
                  <div key={i} className="cmp-row">
                    <div className="row between">
                      <span className="t">{tr(def.labelKey)}{r.side ? ` · ${tr(`bl.${r.side}`)}` : ''}{r.item ? `: ${r.item}` : ''}</span>
                      <Pill tone={tone} icon={r.trend === 'better' ? 'check' : r.trend === 'worse' ? 'alert' : undefined}>{tr(`fu.${r.trend}`)}{r.delta !== null ? ` (${r.delta > 0 ? '+' : ''}${r.delta})` : ''}</Pill>
                    </div>
                    <div className="cmp-vals">
                      <div><span className="k">{tr('home.initial')}{prevComplaint?.measures[r.measureId]?.at ? ` · ${fmtDate(prevComplaint.measures[r.measureId].at)}` : ''}</span><span className={`v ${b ? '' : 'none'}`}>{b ? `${b}${unit}` : tr('fu.notRecorded')}</span></div>
                      <div><span className="k">{tr(`visit.${visit}`)}{c.measures[r.measureId]?.at ? ` · ${fmtDate(c.measures[r.measureId].at)}` : ''}</span><span className={`v ${cur ? '' : 'none'}`}>{cur ? `${cur}${unit}` : tr('fu.notRecorded')}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="faint mt-2">{tr('fu.notConfirm')}</p>

            <h3 className="section-title" style={{ marginLeft: 0 }}>{tr('fu.question')}</h3>
            <Source label={q.title} text={q.sourceText.split('\n').slice(1).join('\n')} />
            {onHold ? (
              <Notice tone="warn">{adverse === undefined ? tr('fu.adverse') : tr('halt.ESCALATED')}</Notice>
            ) : (
              <>
                <div className="choices" role="group" aria-label={q.title}>
                  {q.options.map((o) => (
                    <Choice key={o.id} pressed={c.answers[qId]?.optionId === o.id} disabled={locked} onClick={() => lock(() => update((e) => setAnswer(e, actor, c.id, answerRecord(actor, qId, 'present', { optionId: o.id }))))}><Loc v={optionLabel(o, lang)} /></Choice>
                  ))}
                </div>
                <div className="choices-sub">
                  <span className="eyebrow">{tr('as.cantAnswer')}</span>
                  <StatusButtons options={['unknown']} current={c.answers[qId]?.optionId ? undefined : c.answers[qId]?.status} onPick={(s, reason) => update((e) => setAnswer(e, actor, c.id, answerRecord(actor, qId, s, { reason })))} />
                </div>
              </>
            )}
            {!onHold && outcome.state !== 'unanswered' && (
              <Notice tone="info">
                <span className="eyebrow">{tr('fu.outcome')}</span>
                <strong>{outcome.proposal ? tr(`fu.p.${outcome.proposal}`) : tr('halt.NEEDS_REVIEW')}</strong>
                {outcome.actionNode && <Source label={outcome.actionNode.title} text={outcome.actionNode.sourceText.split('\n').slice(1).join('\n')} />}
                {outcome.refs.length > 0 && <p className="faint">→ {outcome.refs.map((r) => protocol.nodes[r]?.source.code ?? r).join(', ')}</p>}
              </Notice>
            )}
            {decision && <Notice tone="ok">{tr('fu.decision')}: {decision.reason} — {decision.by.name}</Notice>}
            {actor.role === 'clinician' && outcome.state !== 'unanswered' && (
              <ReasonForm label={tr('fu.decision')} onSubmit={(r) => update((e) => addDecision(e, actor, { type: 'followup_outcome', complaintId: c.id, targetId: qId, value: { proposal: outcome.proposal, optionId: outcome.optionId }, reason: r }))} />
            )}
          </Card>
        );
      })}
    </>
  );
}

export { nodeTitle };
