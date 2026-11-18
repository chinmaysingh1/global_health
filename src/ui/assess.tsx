// Assessment flow: one question or closely related group at a time, driven entirely by the
// engine. This component records answers; it never decides a branch itself.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { protocol } from '../protocol';
import type { ProtocolNode } from '../protocol/schema';
import type { AnswerStatus, Complaint, Encounter, Patient } from '../store/types';
import { evaluateEncounterComplaints, missingCapabilities, type ComplaintEval } from '../engine/evaluate';
import { applicableMeasures } from '../engine/followup';
import { acknowledgeAlert, addLinkedComplaint, answerRecord, clearAnswer, setAnswer, setEligibility, setMeasure } from '../store/encounter';
import { LOCAL_TASKS } from '../store/historyFields';
import { nodeTitle, optionLabel } from '../i18n';
import { AlertCard, Card, Choice, Icon, Loc, Notice, Pill, RadioGroup, Source, StatusButtons, prefersReducedMotion, useTapLock } from './common';
import { useApp, type Update } from './ctx';

const HANDLED = new Set(['ASK', 'WATCH', 'DO', 'FIRST', 'CHECK', 'BODY', 'POSITIVE IF', 'WHO']);
const NP_REASONS = ['as.np.no_skilled_examiner', 'as.np.no_equipment', 'as.np.patient_declined', 'as.np.too_painful', 'as.np.other'];

export function complaintLabel(c: Complaint, tr: (k: string) => string): string {
  return `${tr(`region.${c.region}`)} · ${tr(`side.${c.laterality}`)}`;
}

/** One protocol node with its permitted answers. */
export function NodeStep({ node, complaint, update, onDone, late }: { node: ProtocolNode; complaint: Complaint; update: Update; onDone?: () => void; late?: boolean }) {
  const { tr, lang, actor, announce } = useApp();
  const [locked, lock] = useTapLock();
  const [picked, setPicked] = useState<string | null>(null);
  const existing = complaint.answers[node.id];
  const missing = missingCapabilities(node, actor.capabilities);
  const isSafety = node.kind === 'safety_check';
  const isExam = node.kind === 'exam' || node.kind === 'triage_decision';
  const examLocked = isExam && missing.length > 0;

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
    announce(tr('as.saved'));
    onDone?.();
  };

  /** Shows the chosen answer for a moment before the next question appears. A "present" safety
   * answer is recorded at once so that any alert it raises is never delayed. */
  const settle = (fn: () => void, urgent = false) => {
    if (urgent || prefersReducedMotion()) return fn();
    window.setTimeout(fn, 150);
  };

  const f = node.fields;
  const more = ['NOTE', 'EVIDENCE', 'TEAM DATA', 'WHY', 'RULE', 'HALLMARKS', 'HISTORY'].filter((k) => f[k]);
  return (
    <section className="card qcard" data-question={node.id} aria-labelledby={`q-${node.id}`}>
      <div className="qh">
        <Pill tone={isSafety ? 'attn' : isExam ? 'accent' : ''} icon={isSafety ? 'shield' : isExam ? 'pulse' : undefined}>{isSafety ? tr('as.safety') : isExam ? tr('as.exam') : tr('as.question')}</Pill>
        <span className="code">{node.source.code}</span>
      </div>
      <h2 id={`q-${node.id}`} tabIndex={-1}><Loc v={nodeTitle(node, lang)} /></h2>
      <Source label={tr('as.ask')} text={f['ASK']} />
      <Source label={tr('as.watchDo')} text={[f['WATCH'], f['DO'], f['FIRST']].filter(Boolean).join('\n') || undefined} />
      <Source label={tr('as.check')} text={f['CHECK'] ?? (isExam ? f['BODY'] : undefined)} />
      {!isExam && f['BODY'] && <Source label={tr('app.source')} text={f['BODY']} />}
      <Source label={tr('as.positiveIf')} text={f['POSITIVE IF']} />
      {/* any other source instruction on this box is shown too, so nothing is silently dropped */}
      {Object.keys(f).filter((k) => !HANDLED.has(k) && !more.includes(k)).map((k) => <Source key={k} label={k} text={f[k]} />)}
      {node.whoText && (
        <p className="who"><strong>{tr('as.who')}:</strong> <span lang="en">{node.whoText}</span>{node.equipment.length > 0 && <span lang="en"> · {node.equipment.join(', ')}</span>}</p>
      )}
      {isSafety && missing.includes('physio') && <Notice tone="warn">{tr('as.needsSkill')}</Notice>}
      {isSafety && missing.includes('basic_kit') && <Notice tone="warn">{tr('as.needsKit')}</Notice>}
      {examLocked && <Notice tone="err">{tr('as.examLocked')}</Notice>}

      {isSafety ? (
        <>
          <p className="decision">{tr('as.decision')}: <span lang="en">{node.decision}</span></p>
          <StatusButtons options={['present', 'denied', 'unknown', 'declined', 'not_performed']} current={existing?.status} onPick={(s, reason) => settle(() => record(s, { reason }), s === 'present')} reasons={NP_REASONS} />
        </>
      ) : (
        <div className="mt-4">
          {!examLocked && (
            <div className="choices" role="group" aria-labelledby={`q-${node.id}`}>
              {node.options.map((o) => (
                <Choice key={o.id} pressed={(picked ?? existing?.optionId) === o.id} disabled={locked} onClick={() => lock(() => { setPicked(o.id); settle(() => record('present', { optionId: o.id })); })}>
                  <Loc v={optionLabel(o, lang)} />
                </Choice>
              ))}
              {node.kind === 'exam' && node.options.length === 1 && (
                <Choice pressed={(picked ?? existing?.optionId) === `${node.id}#none`} disabled={locked} onClick={() => lock(() => { setPicked(`${node.id}#none`); settle(() => record('present', { optionId: `${node.id}#none` })); })}>{tr('as.noneOfThese')}</Choice>
              )}
            </div>
          )}
          <div className={examLocked ? '' : 'choices-sub'}>
            {!examLocked && <span className="eyebrow">{tr('as.cantAnswer')}</span>}
            <StatusButtons options={isExam ? ['not_performed'] : ['unknown', 'declined']} current={existing?.optionId ? undefined : existing?.status} onPick={(s, reason) => record(s, { reason })} reasons={NP_REASONS} />
          </div>
        </div>
      )}

      {more.length > 0 && (
        <details className="disclose">
          <summary>{tr('as.more')}<Icon name="chevron-down" /></summary>
          <div className="dbody">{more.map((k) => <Source key={k} label={k} text={f[k]} />)}</div>
        </details>
      )}
    </section>
  );
}

function EligibilityStep({ complaint, update }: { complaint: Complaint; update: Update }) {
  const { tr, actor, announce } = useApp();
  const [locked, lock] = useTapLock();
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (basis: 'clinician_assessed' | 'referral_document' | 'chw_screen_local_protocol' | 'not_established') =>
    lock(() => {
      setPicked(basis);
      const save = () => { update((enc) => setEligibility(enc, actor, complaint.id, basis === 'not_established' ? 'unclear' : 'established', basis)); announce(tr('as.saved')); };
      if (prefersReducedMotion()) save(); else window.setTimeout(save, 150);
    });
  return (
    <section className="card qcard" data-question="eligibility" aria-labelledby="q-elig">
      <div className="qh"><Pill>{tr('as.question')}</Pill></div>
      <h2 id="q-elig" tabIndex={-1}>{tr('as.elig.title')}</h2>
      <p className="muted">{tr('as.elig.why')}</p>
      <div className="choices mt-4" role="group" aria-labelledby="q-elig">
        {(['clinician_assessed', 'referral_document', 'chw_screen_local_protocol', 'not_established'] as const).map((b) => (
          <Choice key={b} pressed={(picked ?? complaint.eligibility?.basis) === b} disabled={locked} onClick={() => pick(b)}>{tr(`as.elig.${b}`)}</Choice>
        ))}
      </div>
    </section>
  );
}

function SwitchStep({ outcome, complaint, update }: { outcome: ProtocolNode; complaint: Complaint; update: Update }) {
  const { tr, actor, announce } = useApp();
  const [locked, lock] = useTapLock();
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <section className="card qcard" data-question={outcome.id} aria-labelledby="q-switch">
      <div className="qh"><Pill tone="switch" icon="arrow-right">{tr('alert.switch')}</Pill><span className="code">{outcome.source.code}</span></div>
      <h2 id="q-switch" tabIndex={-1}>{tr('as.switch.title')}</h2>
      <p className="faint" lang="en">{outcome.outcome!.headline}</p>
      <Source label={tr('app.source')} text={outcome.sourceText.split('\n').slice(1).join('\n')} />
      <div className="choices mt-4" role="group" aria-labelledby="q-switch">
        {outcome.outcome!.switchOptions.map((o) => (
          <Choice key={o.id} pressed={picked === o.id} disabled={locked} onClick={() => lock(() => {
            setPicked(o.id);
            const save = () => { update((enc) => setAnswer(enc, actor, complaint.id, answerRecord(actor, outcome.id, 'present', { optionId: o.id }))); announce(tr('as.saved')); };
            // the emergency choice is recorded at once; animation never delays an escalation
            if (o.target === 'emergency' || prefersReducedMotion()) save(); else window.setTimeout(save, 150);
          })}>
            {tr(o.labelKey)}
            {o.target === 'emergency' && <> <Pill tone="emergency">{tr('alert.emergency')}</Pill></>}
          </Choice>
        ))}
      </div>
    </section>
  );
}

function HaltCard({ ev, complaint, update, onSelect }: { ev: ComplaintEval; complaint: Complaint; update: Update; onSelect: (cid: string) => void }) {
  const { tr, actor, lang } = useApp();
  const h = ev.halt!;
  const node = protocol.nodes[h.nodeId];
  return (
    <section className="card" aria-labelledby="halt-h">
      <div className="qh row"><Pill tone="attn" icon="flag">{tr('pend.HALT')}</Pill>{node && <span className="code">{node.source.code}</span>}</div>
      <h2 id="halt-h" className="mt-2" style={{ fontSize: '1.125rem' }}>{tr(`halt.${h.reason}`)}</h2>
      {node && h.reason !== 'ESCALATED' && <Source label={tr('app.source')} text={node.sourceText} />}
      <div className="stack mt-3">
        {h.reason === 'REOPEN_SAFETY' &&
          h.refs.map((r) => (
            <button key={r} type="button" className="btn btn-primary btn-block btn-start" onClick={() => update((enc) => clearAnswer(enc, actor, complaint.id, r, `re-opened from ${node?.source.code}`))}>
              <span className="grow">{tr('halt.reopen')}: {protocol.nodes[r].source.code} — <Loc v={nodeTitle(protocol.nodes[r], lang)} /></span>
            </button>
          ))}
        {ev.switchRequests.map((s) => (
          <button
            key={s.target}
            type="button"
            className="btn btn-primary btn-block"
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
      </div>
    </section>
  );
}

export function MeasuresForm({ complaint, update, pathway, doseLevel }: { complaint: Complaint; ev?: ComplaintEval; update: Update; pathway: NonNullable<ComplaintEval['pathway']>; doseLevel: 'HI' | 'MD' | 'LO' | null }) {
  const { tr, actor, lang } = useApp();
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const items = applicableMeasures(protocol, pathway, doseLevel);
  const save = (rec: Parameters<typeof setMeasure>[3]) => update((enc) => setMeasure(enc, actor, complaint.id, rec));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return (
    <div>
      {doseLevel === 'HI' && <Notice tone="info">{tr('bl.limited')}</Notice>}
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
        const unitText = def.unit === '0-10' ? '0–10' : def.unit ? `${def.unit}${def.min !== undefined ? ` (${def.min}–${def.max})` : ''}` : '';
        const errId = `m-${def.id}-err`;
        return (
          <div key={def.id} className="measure">
            <div className="row between">
              <label className="lbl" htmlFor={`m-${def.id}`} style={{ margin: 0 }}>{tr(def.labelKey)}</label>
              {rec?.status === 'recorded' && <Pill tone="ok" icon="check">{tr('fu.recorded')}</Pill>}
            </div>
            {def.note && <p className="hint mt-2" lang="en">{def.note}</p>}
            <div className="mt-2">
              {!applicable ? (
                <Pill tone="todo">{tr('st.not_applicable')}</Pill>
              ) : def.type === 'not_captured' ? (
                <Pill tone="todo">{tr('bl.notCaptured')}</Pill>
              ) : rec?.status === 'not_performed' ? (
                <div className="row">
                  <Pill tone="incomplete">{tr('st.not_performed')}: {rec.reason}</Pill>
                  <button type="button" className="btn btn-quiet" onClick={() => save({ measureId: def.id, status: 'recorded' })}>{tr('app.edit')}</button>
                </div>
              ) : (
                <>
                  {def.type === 'psfs' ? (
                    <Psfs rec={rec?.psfs ?? []} onChange={(psfs) => save({ measureId: def.id, status: 'recorded', psfs })} />
                  ) : def.type === 'boolean' ? (
                    <RadioGroup legend={tr(def.labelKey)} hideLegend value={rec?.value === true ? 'yes' : rec?.value === false ? 'no' : null} onChange={(v) => save({ measureId: def.id, status: 'recorded', value: v === 'yes' })} options={[{ value: 'yes', label: tr('st.present') }, { value: 'no', label: tr('st.denied') }]} />
                  ) : def.type === 'text' ? (
                    <input id={`m-${def.id}`} type="text" lang={lang} defaultValue={(rec?.value as string) ?? ''} onBlur={(e) => e.target.value.trim() && save({ measureId: def.id, status: 'recorded', value: e.target.value.trim() })} />
                  ) : def.bilateral ? (
                    <div className="grid2">
                      {(['left', 'right'] as const).map((side) => (
                        <div key={side}>
                          <label className="lbl" htmlFor={`m-${def.id}-${side}`} style={{ fontSize: '0.875rem' }}>{tr(`bl.${side}`)} ({def.unit})</label>
                          <input id={`m-${def.id}-${side}`} type="number" inputMode="decimal" min={def.min} max={def.max} aria-invalid={errors[def.id] || undefined} aria-describedby={errors[def.id] ? errId : undefined} defaultValue={rec?.[side] ?? ''} onBlur={(e) => setNum({ [side]: num(e.target.value) })} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input id={`m-${def.id}`} className="narrow" type="number" inputMode="decimal" min={def.min} max={def.max} aria-invalid={errors[def.id] || undefined} aria-describedby={`u-${def.id}${errors[def.id] ? ` ${errId}` : ''}`} defaultValue={(rec?.value as number) ?? ''} onBlur={(e) => setNum({ value: num(e.target.value) })} />
                      {unitText && <span id={`u-${def.id}`} className="unit">{unitText}</span>}
                    </div>
                  )}
                  {errors[def.id] && <div id={errId} className="err" role="alert">{tr('bl.outOfRange')} ({def.min}–{def.max})</div>}
                  <div className="mt-2">
                    <StatusButtons compact options={['not_performed']} onPick={(_s, reason) => save({ measureId: def.id, status: 'not_performed', reason })} reasons={NP_REASONS} />
                  </div>
                </>
              )}
            </div>
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
      <p className="hint">{tr('bl.psfs.hint')}</p>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 6.5rem', gap: 8, marginBottom: 8 }}>
          <input type="text" lang={lang} list="psfs-tasks" aria-label={`${tr('bl.psfs.task')} ${i + 1}`} placeholder={tr('bl.psfs.task')} value={r.task} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, task: e.target.value } : x)))} onBlur={() => commit(rows)} />
          <input type="number" inputMode="numeric" min={0} max={10} aria-label={`${tr('bl.psfs.score')} ${i + 1}`} placeholder="0–10" value={r.score} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, score: e.target.value } : x)))} onBlur={() => commit(rows)} />
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
    <div className="safetygrid">
      {protocol.pathways[ev.pathway].safetyChecks.map((id) => {
        const n = protocol.nodes[id];
        const a = complaint.answers[id];
        const inc = ev.safety.incomplete.find((i) => i.checkId === id);
        const state = !a ? 'not_asked' : a.status === 'present' ? 'present' : inc ? 'incomplete' : 'denied';
        return (
          <div key={id} className="srow">
            <span className="code">{n.source.code}</span>
            <span className="body">
              <Loc v={nodeTitle(n, lang)} />
              <span className="s"><Pill tone={state}>{tr(`st.${state}`)}</Pill>{a?.reason && <> {a.reason}</>}</span>
            </span>
            <button type="button" className="btn" onClick={() => onOpen(id)}>{a ? tr('app.edit') : tr('as.ask')}</button>
          </div>
        );
      })}
    </div>
  );
}

export function AssessTab({ enc, patient, update, go, focusNode }: { enc: Encounter; patient: Patient; update: Update; go: (tab: string) => void; focusNode?: string }) {
  const { tr, lang, actor } = useApp();
  const evals = useMemo(() => evaluateEncounterComplaints(protocol, enc.complaints, patient.age), [enc.complaints, patient.age]);
  const active = enc.complaints.filter((c) => !c.withdrawn);
  const [cidState, setCid] = useState<string | null>(() => (focusNode ? enc.complaints.find((c) => !c.withdrawn && evals.get(c.id)?.pathway && protocol.pathways[evals.get(c.id)!.pathway!].safetyChecks.includes(focusNode))?.id ?? null : null));
  const [editing, setEditing] = useState<string | null>(() => (focusNode && protocol.nodes[focusNode] ? focusNode : null));
  const [late, setLate] = useState(!!focusNode);
  const cid = cidState && active.some((c) => c.id === cidState) ? cidState : active[0]?.id;
  const ev = cid ? evals.get(cid) : undefined;
  const alertsRef = useRef<HTMLDivElement>(null);

  // drop the one-off node from the address so a reload or Back does not reopen the editor
  useEffect(() => {
    if (focusNode) window.history.replaceState(window.history.state, '', `#/enc/${enc.id}/assess`);
  }, [focusNode, enc.id]);

  // After an answer moves the engine on: keep any new alert in view first, otherwise bring the
  // next question to the top and move focus to its heading. Nothing moves on first arrival.
  const currentKey = editing ?? (ev?.current ? `${ev.current.type}:${'nodeId' in ev.current ? ev.current.nodeId : ''}` : 'none');
  const prevKey = useRef(currentKey);
  const prevAlerts = useRef(ev?.alerts.length ?? 0);
  useLayoutEffect(() => {
    const alerts = ev?.alerts.length ?? 0;
    const moved = prevKey.current !== currentKey;
    const newAlert = alerts > prevAlerts.current;
    prevKey.current = currentKey;
    prevAlerts.current = alerts;
    if (!moved && !newAlert) return;
    const bar = document.querySelector('.appbar')?.getBoundingClientRect().bottom ?? 0;
    if (newAlert && alertsRef.current) {
      window.scrollBy({ top: alertsRef.current.getBoundingClientRect().top - bar - 12 });
      alertsRef.current.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1');
      alertsRef.current.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
      return;
    }
    const card = document.querySelector<HTMLElement>('[data-question]');
    if (!card) return;
    const top = card.getBoundingClientRect().top;
    if (top < bar + 8 || top > window.innerHeight * 0.55) window.scrollBy({ top: top - bar - 12, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    card.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [currentKey, ev?.alerts.length]);

  if (enc.consent?.status !== 'given') return <Notice tone="warn">{tr('consent.blocked')}</Notice>;
  if (!cid || !ev) return <Notice tone="info">{tr('cmp.none')} <button type="button" className="linkbtn" onClick={() => go('complaints')}>{tr('tab.complaints')}</button></Notice>;
  const complaint = active.find((c) => c.id === cid)!;
  const editNode = editing ? protocol.nodes[editing] : null;
  const open = (id: string, asLate = false) => { setEditing(id); setLate(asLate); };
  const answeredSteps = ev.trace.filter((s) => s.answer);
  // the region entry answer comes from "Where it hurts"; it is changed there, not here
  const changeable = answeredSteps.filter((s) => !s.nodeId.endsWith(':G-Q0'));
  const lastAnswered = changeable[changeable.length - 1];
  const pathwayAnswered = changeable.filter((s) => s.kind !== 'safety_check').length;
  const safetyDone = ev.safety.answered >= ev.safety.total;

  return (
    <div>
      {active.length > 1 && (
        <Card>
          <RadioGroup legend={tr('as.pick')} variant="list" value={cid} onChange={(id: string) => { setCid(id); setEditing(null); }} options={active.map((c) => ({ value: c.id, label: <>{complaintLabel(c, tr)}{evals.get(c.id)!.alerts.length > 0 && <> <Pill tone="emergency" icon="alert">{tr('alert.title')}</Pill></>}</> }))} />
        </Card>
      )}
      <div className="ctxbar">
        <Pill tone="accent">{complaintLabel(complaint, tr)}</Pill>
        {complaint.origin && <Pill tone="switch">{tr('cmp.linked')}</Pill>}
      </div>

      <div ref={alertsRef}>
        {ev.alerts.map((a) => (
          <AlertCard key={a.key} alert={a} acked={enc.alertAcks[a.key]} onAck={() => update((e) => acknowledgeAlert(e, actor, a.key))} />
        ))}
      </div>

      {ev.pathway && (
        <div className="progressline">
          <div className="row">
            <span>{safetyDone ? `${tr('as.pathwayAnswered')}: ${pathwayAnswered}` : `${tr('as.safety.progress')}: ${ev.safety.answered} / ${ev.safety.total}`}</span>
            <span>{tr(`safety.${ev.safety.state}`)}</span>
          </div>
          {!safetyDone && <div className="meter" role="progressbar" aria-label={tr('as.safety.progress')} aria-valuemin={0} aria-valuemax={ev.safety.total} aria-valuenow={ev.safety.answered}><i style={{ width: `${ev.safety.total ? (100 * ev.safety.answered) / ev.safety.total : 0}%` }} /></div>}
          {ev.safety.state === 'no_concern_reported' && <p className="faint mt-2">{tr('safety.no_concern.note')}</p>}
          {lastAnswered && !editNode && (
            <button type="button" className="btn btn-ghost mt-2" style={{ marginLeft: -12 }} onClick={() => open(lastAnswered.nodeId, lastAnswered.kind === 'safety_check')}>
              <Icon name="edit" size={18} />{tr('as.changePrevious')} · {protocol.nodes[lastAnswered.nodeId]?.source.code}
            </button>
          )}
        </div>
      )}
      {ev.eligibility === 'unclear' && <Notice tone="warn">{tr('as.elig.unclear')}</Notice>}
      {ev.contradictions.map((x, i) => (
        <Notice key={i} tone="err"><strong>{tr('sum.contradiction')}:</strong> {protocol.nodes[x.nodeId]?.source.code} — <span lang="en">{x.detail}</span></Notice>
      ))}

      {editNode ? (
        <>
          <div className="edit-banner" role="status">
            <span><Icon name="edit" size={18} /> {tr('as.editing')} · {editNode.source.code}</span>
            <button type="button" className="btn" onClick={() => setEditing(null)}>{tr('app.cancel')}</button>
          </div>
          <NodeStep key={`edit-${editNode.id}`} node={editNode} complaint={complaint} update={update} late={late} onDone={() => setEditing(null)} />
        </>
      ) : ev.current?.type === 'eligibility' ? (
        <EligibilityStep complaint={complaint} update={update} />
      ) : ev.current?.type === 'ask' ? (
        <NodeStep key={ev.current.nodeId} node={protocol.nodes[ev.current.nodeId]} complaint={complaint} update={update} />
      ) : ev.current?.type === 'switch' ? (
        <SwitchStep outcome={protocol.nodes[ev.current.nodeId]} complaint={complaint} update={update} />
      ) : ev.current?.type === 'baseline' && ev.pathway ? (
        <section className="card" data-question="baseline" aria-labelledby="q-baseline">
          <h2 id="q-baseline" tabIndex={-1} style={{ marginBottom: 12 }}>{tr('bl.title')}</h2>
          {ev.candidate && <div className="dx candidate"><span className="k">{tr('sum.candidate')}</span><Loc v={nodeTitle(protocol.nodes[ev.candidate.diagnosisId], lang)} /></div>}
          {ev.doseNodeId && <Source label={`${tr('bl.dose')} · ${protocol.nodes[ev.doseNodeId].title}`} text={protocol.nodes[ev.doseNodeId].sourceText.split('\n').slice(1).join('\n')} />}
          <MeasuresForm complaint={complaint} ev={ev} update={update} pathway={ev.pathway} doseLevel={ev.doseLevel} />
        </section>
      ) : null}
      {ev.halt && !editNode && <HaltCard ev={ev} complaint={complaint} update={update} onSelect={(id) => setCid(id)} />}

      {(answeredSteps.some((s) => s.kind !== 'safety_check') || complaint.eligibility) && (
        <Card title={tr('as.answered')}>
          {complaint.eligibility && (
            <div className="answered-row">
              <span className="body"><span>{tr('as.elig.title')}</span><span className="a">→ {tr(`as.elig.${complaint.eligibility.basis}`)}</span></span>
            </div>
          )}
          <ul className="list">
            {ev.trace.filter((s) => s.answer && s.kind !== 'safety_check').map((s) => {
              const n = protocol.nodes[s.nodeId];
              const opt = n.options.find((o) => o.id === s.optionId);
              return (
                <li key={s.nodeId} className="answered-row">
                  <span className="code">{n.source.code}</span>
                  <span className="body"><Loc v={nodeTitle(n, lang)} /><span className="a">→ {opt ? <Loc v={optionLabel(opt, lang)} /> : `${tr(`st.${s.answer!.status}`)}${s.answer!.reason ? ` (${s.answer!.reason})` : ''}`}</span></span>
                  <button type="button" className="btn" onClick={() => open(s.nodeId)}>{tr('app.edit')}</button>
                </li>
              );
            })}
          </ul>
          {ev.staleAnswers.length > 0 && <p className="faint mt-2">{tr('as.stale')}: {ev.staleAnswers.map((id) => protocol.nodes[id]?.source.code ?? id).join(', ')}</p>}
        </Card>
      )}

      {ev.pathway && (
        <Card title={tr('as.safetyList')}>
          <p className="muted">{tr('as.lateConcern.hint')}</p>
          <details className="disclose" open={!safetyDone || ev.safety.state !== 'no_concern_reported'}>
            <summary>{tr('as.safetyList')} ({ev.safety.answered} / {ev.safety.total})<Icon name="chevron-down" /></summary>
            <div className="dbody"><SafetyList complaint={complaint} ev={ev} onOpen={(id) => open(id, true)} /></div>
          </details>
        </Card>
      )}
    </div>
  );
}
