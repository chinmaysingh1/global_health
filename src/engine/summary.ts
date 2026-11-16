// Structured clinician handoff built only from recorded facts and engine output. Used by the
// summary screen, the deterministic note, and the Intelehealth adapter.
import type { Protocol } from '../protocol/schema';
import type { AnswerRecord, Complaint, Encounter, Patient } from '../store/types';
import { evaluateEncounterComplaints, type Alert, type ComplaintEval } from './evaluate';
import { applicableMeasures } from './followup';
import { confirmedDiagnosis, proposePlan, staleDecisions, type ProposedPlan } from './plan';

export interface PendingItem {
  code:
    | 'CONSENT'
    | 'ELIGIBILITY'
    | 'QUESTION'
    | 'SWITCH_CHOICE'
    | 'SAFETY_ITEM'
    | 'HALT'
    | 'ALERT_ACK'
    | 'MEASURE'
    | 'AI_PROPOSAL'
    | 'LINKED_COMPLAINT'
    | 'CONTRADICTION'
    | 'STALE_DECISION';
  complaintId?: string;
  ref?: string;
  detail?: string;
}

export interface TraceLine {
  nodeId: string;
  code: string;
  title: string;
  kind: string;
  answerLabel?: string;
  status?: AnswerRecord['status'];
  author?: string;
  infoSource?: string;
}

export interface ComplaintSummary {
  complaint: Complaint;
  ev: ComplaintEval;
  safetyRows: { checkId: string; code: string; title: string; state: 'present' | 'denied' | 'incomplete' | 'not_asked'; reason?: string; answer?: AnswerRecord }[];
  trace: TraceLine[];
  alerts: Alert[];
  confirmed: ReturnType<typeof confirmedDiagnosis>;
  plan: ProposedPlan;
  pending: PendingItem[];
}

export interface EncounterSummary {
  patient: Patient;
  encounter: Encounter;
  complaints: ComplaintSummary[];
  pending: PendingItem[];
  alerts: Alert[];
}

export function buildSummary(protocol: Protocol, patient: Patient, enc: Encounter): EncounterSummary {
  const evals = evaluateEncounterComplaints(protocol, enc.complaints, patient.age);
  const complaints: ComplaintSummary[] = [];
  const allPending: PendingItem[] = [];
  if (enc.consent?.status !== 'given') allPending.push({ code: 'CONSENT' });
  for (const p of enc.proposals) if (p.state === 'pending') allPending.push({ code: 'AI_PROPOSAL', complaintId: p.complaintId, ref: p.id, detail: p.urgentFlag ? 'urgent' : undefined });

  for (const c of enc.complaints) {
    if (c.withdrawn) continue;
    const ev = evals.get(c.id)!;
    const pending: PendingItem[] = [];
    if (ev.eligibility === 'not_recorded') pending.push({ code: 'ELIGIBILITY', complaintId: c.id });
    if (ev.eligibility === 'unclear') pending.push({ code: 'ELIGIBILITY', complaintId: c.id, detail: 'unclear' });
    if (ev.current?.type === 'ask') pending.push({ code: 'QUESTION', complaintId: c.id, ref: ev.current.nodeId });
    if (ev.current?.type === 'switch') pending.push({ code: 'SWITCH_CHOICE', complaintId: c.id, ref: ev.current.nodeId });
    for (const i of ev.safety.incomplete) pending.push({ code: 'SAFETY_ITEM', complaintId: c.id, ref: i.checkId, detail: i.reason });
    if (ev.halt) pending.push({ code: 'HALT', complaintId: c.id, ref: ev.halt.nodeId, detail: ev.halt.reason });
    for (const a of ev.alerts) if (!enc.alertAcks[a.key]) pending.push({ code: 'ALERT_ACK', complaintId: c.id, ref: a.key });
    for (const x of ev.contradictions) pending.push({ code: 'CONTRADICTION', complaintId: c.id, ref: x.nodeId, detail: x.detail });
    for (const s of ev.switchRequests) {
      const linked = enc.complaints.some((o) => o.origin?.complaintId === c.id && o.entryNode === protocol.pathways[s.target].header && !o.withdrawn);
      if (!linked) pending.push({ code: 'LINKED_COMPLAINT', complaintId: c.id, ref: s.target });
    }
    if (ev.current?.type === 'baseline' && ev.pathway) {
      for (const m of applicableMeasures(protocol, ev.pathway, ev.doseLevel)) {
        if (m.applicable && m.def.type !== 'not_captured' && !c.measures[m.def.id]) pending.push({ code: 'MEASURE', complaintId: c.id, ref: m.def.id });
      }
    }
    for (const d of staleDecisions(enc, c)) pending.push({ code: 'STALE_DECISION', complaintId: c.id, ref: d.id, detail: d.type });

    const safetyRows: ComplaintSummary['safetyRows'] = [];
    if (ev.pathway) {
      for (const checkId of protocol.pathways[ev.pathway].safetyChecks) {
        const n = protocol.nodes[checkId];
        const a = c.answers[checkId];
        const inc = ev.safety.incomplete.find((i) => i.checkId === checkId);
        safetyRows.push({
          checkId,
          code: n.source.code!,
          title: n.title.replace(/^[A-Z]+\d+ · /, ''),
          state: !a ? 'not_asked' : a.status === 'present' ? 'present' : inc ? 'incomplete' : 'denied',
          reason: inc?.reason,
          answer: a,
        });
      }
    }
    const trace: TraceLine[] = ev.trace
      .filter((t) => ['triage_question', 'triage_decision', 'question', 'exam', 'irritability', 'diagnosis', 'note', 'escalation', 'dose'].includes(t.kind))
      .map((t) => {
        const n = protocol.nodes[t.nodeId];
        const opt = t.optionId ? n.options.find((o) => o.id === t.optionId) : undefined;
        return {
          nodeId: t.nodeId,
          code: n.source.code ?? '',
          title: n.title,
          kind: t.kind,
          answerLabel: opt ? opt.label : undefined,
          status: t.answer?.status,
          author: t.answer ? `${t.answer.author.name} (${t.answer.author.role})` : undefined,
          infoSource: t.answer?.infoSource,
        };
      });
    complaints.push({ complaint: c, ev, safetyRows, trace, alerts: ev.alerts, confirmed: confirmedDiagnosis(enc, c), plan: proposePlan(protocol, enc, c, ev), pending });
    allPending.push(...pending);
  }
  return { patient, encounter: enc, complaints, pending: allPending, alerts: complaints.flatMap((c) => c.alerts) };
}
