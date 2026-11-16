// Assessment flow: one question or closely related group at a time, driven entirely by the
// engine. This component records answers; it never decides a branch itself.
import { useMemo, useState } from 'react';
import { protocol } from '../protocol';
import type { ProtocolNode } from '../protocol/schema';
import type { AnswerStatus, Complaint, Encounter, Patient } from '../store/types';
import { evaluateEncounterComplaints, missingCapabilities, type ComplaintEval } from '../engine/evaluate';
import { applicableMeasures } from '../engine/followup';
import { acknowledgeAlert, addLinkedComplaint, answerRecord, clearAnswer, setAnswer, setEligibility, setMeasure } from '../store/encounter';
import { LOCAL_TASKS } from '../store/historyFields';
import { nodeTitle, optionLabel } from '../i18n';
import { AlertCard, Card, Loc, Source, StatusButtons } from './common';
import { useApp, type Update } from './ctx';

const HANDLED = new Set(['ASK', 'WATCH', 'DO', 'FIRST', 'CHECK', 'BODY', 'POSITIVE IF', 'WHO']);
const NP_REASONS = ['as.np.no_skilled_examiner', 'as.np.no_equipment', 'as.np.patient_declined', 'as.np.too_painful', 'as.np.other'];

export function complaintLabel(c: Complaint, tr: (k: string) => string): string {
  return `${tr(`region.${c.region}`)} · ${tr(`side.${c.laterality}`)}`;
}

/** One protocol node rendered as a card with its permitted answers. */
export function NodeStep({ node, complaint, update, onDone, late }: { node: ProtocolNode; complaint: Complaint; update: Update; onDone?: () => void; late?: boolean }) {
  const { tr, lang, actor } = useApp();
  const existing = complaint.answers[node.id];
  const missing = missingCapabilities(node, actor.capabilities);
  const isSafety = node.kind === 'safety_check';
  const isExam = node.kind === 'exam' || node.kind === 'triage_decision';
  const locked = isExam && missing.length > 0;

  const record = (status: AnswerStatus, extra: { optionId?: string; reason?: string } = {}) => {
    update((enc) =>
      setAnswer(
        enc,
        actor,
        complaint.id,
        answerRecord(actor, node.id, status, {
          ...extra,
          infoSource: actor.role === 'clinician' ? 'clinician_finding' : isExam ? 'chw_observation' : 'patient_report',
          via: late && status === 'present' ? 'late_concern' : 'manual',
        }),
      ),
    );
    onDone?.();
  };

  const f = node.fields;
  const more = ['NOTE', 'EVIDENCE', 'TEAM DATA', 'WHY', 'RULE', 'HALLMARKS', 'HISTORY'].filter((k) => f[k]);
  return (
    <Card className="step">
      <div className="kicker">
        {isSafety ? tr('as.safety') : isExam ? tr('as.exam') : tr('as.question')} · {node.source.code}
      </div>
      <h2><Loc v={nodeTitle(node, lang)} /></h2>
      <Source label={tr('as.ask')} text={f['ASK']} />
      <Source label="Watch / do" text={[f['WATCH'], f['DO'], f['FIRST']].filter(Boolean).join('\n') || undefined} />
      <Source label={tr('as.check')} text={f['CHECK'] ?? (isExam ? f['BODY'] : undefined)} />
      {!isExam && f['BODY'] && <Source label={tr('app.source')} text={f['BODY']} />}
      <Source label={tr('as.positiveIf')} text={f['POSITIVE IF']} />
      {/* any other source instruction on this box is shown too, so nothing is silently dropped */}
      {Object.keys(f).filter((k) => !HANDLED.has(k) && !more.includes(k)).map((k) => <Source key={k} label={k} text={f[k]} />)}
      {node.whoText && (
        <p className="muted"><strong>{tr('as.who')}:</strong> <span lang="en">{node.whoText}</span>{node.equipment.length > 0 && ` · ${node.equipment.join(', ')}`}</p>
      )}
      {more.length > 0 && (
        <details>
          <summary>{tr('as.more')}</summary>
          {more.map((k) => <Source key={k} label={k} text={f[k]} />)}
        </details>
      )}
      {isSafety && missing.includes('physio') && <div className="notice warn">{tr('as.needsSkill')}</div>}
      {isSafety && missing.includes('basic_kit') && <div className="notice warn">{tr('as.needsKit')}</div>}
      {locked && <div className="notice err">{tr('as.examLocked')}</div>}

      {isSafety ? (
        <>
          <h3>{tr('as.decision')}: <span lang="en">{node.decision}</span></h3>
          <StatusButtons options={['present', 'denied', 'unknown', 'declined', 'not_performed']} current={existing?.status} onPick={(s, reason) => record(s, { reason })} reasons={NP_REASONS} />
        </>
      ) : (
        <div className="stack" role="group" aria-label={node.title}>
          {!locked &&
            node.options.map((o) => (
              <button key={o.id} type="button" aria-pressed={existing?.optionId === o.id} onClick={() => record('present', { optionId: o.id })}>
                <Loc v={optionLabel(o, lang)} />
              </button>
            ))}
          {!locked && node.kind === 'exam' && node.options.length === 1 && (
            <button type="button" aria-pressed={existing?.optionId === `${node.id}#none`} onClick={() => record('present', { optionId: `${node.id}#none` })}>{tr('as.noneOfThese')}</button>
          )}
          <StatusButtons options={isExam ? ['not_performed'] : ['unknown', 'declined']} current={existing?.optionId ? undefined : existing?.status} onPick={(s, reason) => record(s, { reason })} reasons={NP_REASONS} />
        </div>
      )}
    </Card>
  );
}

function EligibilityStep({ complaint, update }: { complaint: Complaint; update: Update }) {
  const { tr, actor } = useApp();
  const pick = (basis: 'clinician_assessed' | 'referral_document' | 'chw_screen_local_protocol' | 'not_established') =>
    update((enc) => setEligibility(enc, actor, complaint.id, basis === 'not_established' ? 'unclear' : 'established', basis));
  return (
    <Card className="step">
      <div className="kicker">{tr('as.question')}</div>
      <h2>{tr('as.elig.title')}</h2>
      <p className="muted">{tr('as.elig.why')}</p>
      <div className="stack">
        {(['clinician_assessed', 'referral_document', 'chw_screen_local_protocol', 'not_established'] as const).map((b) => (
          <button key={b} type="button" aria-pressed={complaint.eligibility?.basis === b} onClick={() => pick(b)}>{tr(`as.elig.${b}`)}</button>
        ))}
      </div>
    </Card>
  );
}

function SwitchStep({ outcome, complaint, update }: { outcome: ProtocolNode; complaint: Complaint; update: Update }) {
  const { tr, actor } = useApp();
  return (
    <Card className="step">
      <div className="kicker">{outcome.source.code} · {outcome.outcome!.headline}</div>
      <h2>{tr('as.switch.title')}</h2>
      <Source label={tr('app.source')} text={outcome.sourceText.split('\n').slice(1).join('\n')} />
      <div className="stack">
        {outcome.outcome!.switchOptions.map((o) => (
          <button key={o.id} type="button" className={o.target === 'emergency' ? 'danger' : ''} onClick={() => update((enc) => setAnswer(enc, actor, complaint.id, answerRecord(actor, outcome.id, 'present', { optionId: o.id })))}>
            {tr(o.labelKey)}
          </button>
        ))}
      </div>
    </Card>
  );
}

function HaltCard({ ev, complaint, update, onSelect, goSummary }: { ev: ComplaintEval; complaint: Complaint; update: Update; onSelect: (cid: string) => void; goSummary: () => void }) {
  const { tr, actor, lang } = useApp();
  const h = ev.halt!;
  const node = protocol.nodes[h.nodeId];
  return (
    <Card className="halt">
      <div className="kicker">{node?.source.code} · {h.reason}</div>
      <p><strong>{tr(`halt.${h.reason}`)}</strong></p>
      {node && h.reason !== 'ESCALATED' && <Source label={tr('app.source')} text={node.sourceText} />}
      {h.reason === 'REOPEN_SAFETY' &&
        h.refs.map((r) => (
          <button key={r} type="button" className="primary" onClick={() => update((enc) => clearAnswer(enc, actor, complaint.id, r, `re-opened from ${node?.source.code}`))}>
            {tr('halt.reopen')}: {protocol.nodes[r].source.code} — <Loc v={nodeTitle(protocol.nodes[r], lang)} />
          </button>
        ))}
      {ev.switchRequests.map((s) => (
        <button
          key={s.target}
          type="button"
          className="primary"
          onClick={() => {
            let newId = '';
            update((enc) => {
              const next = addLinkedComplaint(enc, actor, protocol, complaint.id, s.target, s.from, s.optionId);
              newId = next.complaints.find((c) => c.origin?.complaintId === complaint.id && c.entryNode === protocol.pathways[s.target].header && !c.withdrawn)?.id ?? '';
              return next;
            });
            if (newId) onSelect(newId);
          }}
        >
          {tr('halt.openLinked')}: {tr(`region.${s.target === 'low_back' ? 'low_back' : s.target}`)}
        </button>
      ))}
      <div style={{ marginTop: 8 }}>
        <button type="button" onClick={goSummary}>{tr('halt.toSummary')}</button>
      </div>
    </Card>
  );
}

export function MeasuresForm({ complaint, ev, update, pathway, doseLevel }: { complaint: Complaint; ev?: ComplaintEval; update: Update; pathway: NonNullable<ComplaintEval['pathway']>; doseLevel: 'HI' | 'MD' | 'LO' | null }) {
  const { tr, actor, lang } = useApp();
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const items = applicableMeasures(protocol, pathway, doseLevel);
  const save = (rec: Parameters<typeof setMeasure>[3]) => update((enc) => setMeasure(enc, actor, complaint.id, rec));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  void ev;
  return (
    <div>
      {doseLevel === 'HI' && <div className="notice info">{tr('bl.limited')}</div>}
      {items.map(({ def, applicable }) => {
        const rec = complaint.measures[def.id];
        const inRange = (n: number | undefined) => n === undefined || (!Number.isNaN(n) && (def.min === undefined || n >= def.min) && (def.max === undefined || n <= def.max));
        const setNum = (patch: { value?: number; left?: number; right?: number }) => {
          const merged = { value: rec?.value as number | undefined, left: rec?.left, right: rec?.right, ...patch };
          const ok = inRange(merged.value) && inRange(merged.left) && inRange(merged.right);
          setErrors((e) => ({ ...e, [def.id]: !ok }));
          if (!ok) return;
          if (merged.value === undefined && merged.left === undefined && merged.right === undefined) return;
          save({ measureId: def.id, status: 'recorded', ...merged });
        };
        return (
          <div key={def.id} className="card" style={{ margin: '8px 0' }}>
            <label htmlFor={`m-${def.id}`}>{tr(def.labelKey)}</label>
            {def.note && <p className="muted" lang="en">{def.note}</p>}
            {!applicable ? (
              <span className="chip not_asked">{tr('st.not_applicable')}</span>
            ) : def.type === 'not_captured' ? (
              <span className="chip not_asked">{tr('bl.notCaptured')}</span>
            ) : rec?.status === 'not_performed' ? (
              <div className="rowwrap">
                <span className="chip incomplete">{tr('st.not_performed')}: {rec.reason}</span>
                <button type="button" className="small" onClick={() => save({ measureId: def.id, status: 'recorded' })}>{tr('app.edit')}</button>
              </div>
            ) : (
              <>
                {def.type === 'psfs' ? (
                  <Psfs rec={rec?.psfs ?? []} onChange={(psfs) => save({ measureId: def.id, status: 'recorded', psfs })} />
                ) : def.type === 'boolean' ? (
                  <div className="rowwrap">
                    {[true, false].map((b) => (
                      <button key={String(b)} type="button" aria-pressed={rec?.value === b} onClick={() => save({ measureId: def.id, status: 'recorded', value: b })}>{tr(b ? 'st.present' : 'st.denied')}</button>
                    ))}
                  </div>
                ) : def.type === 'text' ? (
                  <input id={`m-${def.id}`} type="text" lang={lang} defaultValue={(rec?.value as string) ?? ''} onBlur={(e) => e.target.value.trim() && save({ measureId: def.id, status: 'recorded', value: e.target.value.trim() })} />
                ) : def.bilateral ? (
                  <div className="grid2">
                    {(['left', 'right'] as const).map((side) => (
                      <label key={side} style={{ margin: 0 }}>{tr(`bl.${side}`)} ({def.unit})
                        <input type="number" inputMode="decimal" min={def.min} max={def.max} defaultValue={rec?.[side] ?? ''} onBlur={(e) => setNum({ [side]: num(e.target.value) })} />
                      </label>
                    ))}
                  </div>
                ) : (
                  <input id={`m-${def.id}`} className="narrow" type="number" inputMode="decimal" min={def.min} max={def.max} aria-describedby={`u-${def.id}`} defaultValue={(rec?.value as number) ?? ''} onBlur={(e) => setNum({ value: num(e.target.value) })} />
                )}
                {def.unit && !def.bilateral && def.type !== 'psfs' && <span id={`u-${def.id}`} className="muted"> {def.unit === '0-10' ? '0–10' : `${def.unit}${def.min !== undefined ? ` (${def.min}–${def.max})` : ''}`}</span>}
                {errors[def.id] && <div className="err" role="alert">{tr('bl.outOfRange')} ({def.min}–{def.max})</div>}
                <div style={{ marginTop: 8 }}>
                  <StatusButtons options={['not_performed']} onPick={(_s, reason) => save({ measureId: def.id, status: 'not_performed', reason })} reasons={NP_REASONS} />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Psfs({ rec, onChange }: { rec: { task: string; score: number }[]; onChange: (v: { task: string; score: number }[]) => void }) {
  const { tr, lang } = useApp();
  const [rows, setRows] = useState<{ task: string; score: string }[]>(() => [0, 1, 2].map((i) => ({ task: rec[i]?.task ?? '', score: rec[i] ? String(rec[i].score) : '' })));
  const commit = (next: typeof rows) => {
    setRows(next);
    const valid = next.filter((r) => r.task.trim() && r.score !== '' && Number(r.score) >= 0 && Number(r.score) <= 10).map((r) => ({ task: r.task.trim(), score: Number(r.score) }));
    if (valid.length) onChange(valid);
  };
  return (
    <div>
      <p className="muted">{tr('bl.psfs.hint')}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid2" style={{ marginBottom: 6 }}>
          <input type="text" lang={lang} list="psfs-tasks" aria-label={`${tr('bl.psfs.task')} ${i + 1}`} placeholder={tr('bl.psfs.task')} value={r.task} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, task: e.target.value } : x)))} onBlur={() => commit(rows)} />
          <input type="number" inputMode="numeric" min={0} max={10} aria-label={`${tr('bl.psfs.score')} ${i + 1}`} placeholder={tr('bl.psfs.score')} value={r.score} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, score: e.target.value } : x)))} onBlur={() => commit(rows)} />
        </div>
      ))}
      <datalist id="psfs-tasks">{LOCAL_TASKS.map((k) => <option key={k} value={tr(k)} />)}</datalist>
    </div>
  );
}

export function SafetyList({ complaint, ev, onOpen }: { complaint: Complaint; ev: ComplaintEval; onOpen: (nodeId: string) => void }) {
  const { tr, lang } = useApp();
  if (!ev.pathway) return null;
  return (
    <table>
      <tbody>
        {protocol.pathways[ev.pathway].safetyChecks.map((id) => {
          const n = protocol.nodes[id];
          const a = complaint.answers[id];
          const inc = ev.safety.incomplete.find((i) => i.checkId === id);
          const state = !a ? 'not_asked' : a.status === 'present' ? 'present' : inc ? 'incomplete' : 'denied';
          return (
            <tr key={id}>
              <td style={{ width: '3rem' }}><strong>{n.source.code}</strong></td>
              <td><Loc v={nodeTitle(n, lang)} /><br /><span className={`chip ${state}`}>{tr(`st.${state}`)}</span>{a?.reason && <span className="muted"> {a.reason}</span>}</td>
              <td style={{ width: '5.5rem' }}><button type="button" className="small" onClick={() => onOpen(id)}>{a ? tr('app.edit') : tr('as.ask')}</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function AssessTab({ enc, patient, update, go }: { enc: Encounter; patient: Patient; update: Update; go: (tab: string) => void }) {
  const { tr, lang, actor } = useApp();
  const evals = useMemo(() => evaluateEncounterComplaints(protocol, enc.complaints, patient.age), [enc.complaints, patient.age]);
  const active = enc.complaints.filter((c) => !c.withdrawn);
  const [cidState, setCid] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const cid = cidState && active.some((c) => c.id === cidState) ? cidState : active[0]?.id;
  if (enc.consent?.status !== 'given') return <div className="notice warn">{tr('consent.blocked')}</div>;
  if (!cid) return <div className="notice info">{tr('cmp.none')}</div>;
  const complaint = active.find((c) => c.id === cid)!;
  const ev = evals.get(cid)!;
  const editNode = editing ? protocol.nodes[editing] : null;
  const open = (id: string, asLate = false) => { setEditing(id); setLate(asLate); window.scrollTo({ top: 0 }); };

  return (
    <div>
      {active.length > 1 && (
        <Card title={tr('as.pick')}>
          <div className="stack">
            {active.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === cid} onClick={() => { setCid(c.id); setEditing(null); }}>
                {complaintLabel(c, tr)}
                {evals.get(c.id)!.alerts.length > 0 && <span className="chip emergency">{tr('alert.title')}</span>}
              </button>
            ))}
          </div>
        </Card>
      )}
      <p><strong>{patient.name}</strong> · {complaintLabel(complaint, tr)}{complaint.origin && <span className="chip switch">{tr('cmp.linked')}</span>}</p>

      {ev.alerts.map((a) => (
        <AlertCard key={a.key} alert={a} acked={enc.alertAcks[a.key]} onAck={() => update((e) => acknowledgeAlert(e, actor, a.key))} />
      ))}

      {ev.pathway && (
        <div aria-label={tr('as.safety.progress')}>
          <div className="muted">{tr('as.safety.progress')}: {ev.safety.answered}/{ev.safety.total} · {tr(`safety.${ev.safety.state}`)}</div>
          <div className="progress"><i style={{ width: `${ev.safety.total ? (100 * ev.safety.answered) / ev.safety.total : 0}%` }} /></div>
          {ev.safety.state === 'no_concern_reported' && <p className="muted">{tr('safety.no_concern.note')}</p>}
        </div>
      )}
      {ev.eligibility === 'unclear' && <div className="notice warn">{tr('as.elig.unclear')}</div>}
      {ev.contradictions.map((x, i) => (
        <div key={i} className="notice err"><strong>{tr('sum.contradiction')}:</strong> {protocol.nodes[x.nodeId]?.source.code} — <span lang="en">{x.detail}</span></div>
      ))}

      {editNode ? (
        <>
          <NodeStep node={editNode} complaint={complaint} update={update} late={late} onDone={() => setEditing(null)} />
          <button type="button" onClick={() => setEditing(null)}>{tr('app.cancel')}</button>
        </>
      ) : ev.current?.type === 'eligibility' ? (
        <EligibilityStep complaint={complaint} update={update} />
      ) : ev.current?.type === 'ask' ? (
        <NodeStep key={ev.current.nodeId} node={protocol.nodes[ev.current.nodeId]} complaint={complaint} update={update} />
      ) : ev.current?.type === 'switch' ? (
        <SwitchStep outcome={protocol.nodes[ev.current.nodeId]} complaint={complaint} update={update} />
      ) : ev.current?.type === 'baseline' && ev.pathway ? (
        <Card className="step" title={tr('bl.title')}>
          {ev.candidate && <p><span className="kicker">{tr('sum.candidate')}</span><br /><Loc v={nodeTitle(protocol.nodes[ev.candidate.diagnosisId], lang)} /></p>}
          {ev.doseNodeId && <Source label={`${tr('bl.dose')} · ${protocol.nodes[ev.doseNodeId].title}`} text={protocol.nodes[ev.doseNodeId].sourceText.split('\n').slice(1).join('\n')} />}
          <MeasuresForm complaint={complaint} ev={ev} update={update} pathway={ev.pathway} doseLevel={ev.doseLevel} />
          <button type="button" className="primary" onClick={() => go('summary')}>{tr('halt.toSummary')}</button>
        </Card>
      ) : null}
      {ev.halt && !editNode && <HaltCard ev={ev} complaint={complaint} update={update} onSelect={(id) => setCid(id)} goSummary={() => go('summary')} />}

      <Card title={tr('as.answered')}>
        {complaint.eligibility && (
          <div className="rowwrap"><span>{tr('as.elig.title')} → <strong>{tr(`as.elig.${complaint.eligibility.basis}`)}</strong></span></div>
        )}
        <table>
          <tbody>
            {ev.trace.filter((s) => s.answer && s.kind !== 'safety_check').map((s) => {
              const n = protocol.nodes[s.nodeId];
              const opt = n.options.find((o) => o.id === s.optionId);
              return (
                <tr key={s.nodeId}>
                  <td style={{ width: '3.5rem' }}><strong>{n.source.code}</strong></td>
                  <td><Loc v={nodeTitle(n, lang)} /><br /><span className="muted">→ {opt ? <Loc v={optionLabel(opt, lang)} /> : `${tr(`st.${s.answer!.status}`)}${s.answer!.reason ? ` (${s.answer!.reason})` : ''}`}</span></td>
                  <td style={{ width: '5.5rem' }}><button type="button" className="small" onClick={() => open(s.nodeId)}>{tr('app.edit')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ev.staleAnswers.length > 0 && (
          <p className="muted">{tr('as.stale')}: {ev.staleAnswers.map((id) => protocol.nodes[id]?.source.code ?? id).join(', ')}</p>
        )}
      </Card>

      {ev.pathway && (
        <Card title={tr('as.safetyList')}>
          <p className="muted">{tr('as.lateConcern.hint')}</p>
          <SafetyList complaint={complaint} ev={ev} onOpen={(id) => open(id, true)} />
        </Card>
      )}
    </div>
  );
}
