// Plan gating and source-derived plan proposals. A plan is only ever PROPOSED by the engine;
// release requires explicit clinician decisions made on the current clinical state.
import type { Protocol, ProtocolNode } from '../protocol/schema';
import type { Complaint, Encounter, ReviewDecision } from '../store/types';
import type { ComplaintEval } from './evaluate';

/** Small stable hash (FNV-1a) of the clinically relevant state a decision was based on. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const MODIFIER_CODES = ['mod.exertional_symptoms', 'mod.bp_uncontrolled', 'mod.diabetes', 'mod.pregnancy', 'mod.osteoporosis', 'mod.falls'] as const;

/** Hash of everything a review decision depends on for one complaint. */
export function basisHash(enc: Encounter, complaint: Complaint): string {
  const answers = Object.values(complaint.answers)
    .map((a) => [a.nodeId, a.status, a.optionId ?? null, a.value ?? null, a.capabilities.join('+')])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const modifiers = MODIFIER_CODES.map((c) => [c, enc.history[c]?.status ?? null]);
  return fnv1a(
    stableStringify({
      answers,
      eligibility: complaint.eligibility ? [complaint.eligibility.status, complaint.eligibility.basis] : null,
      laterality: complaint.laterality,
      modifiers,
      consent: enc.consent?.status ?? null,
    }),
  );
}

export type BlockerCode =
  | 'CONSENT_MISSING'
  | 'ELIGIBILITY_UNVERIFIED'
  | 'SAFETY_NOT_FINISHED'
  | 'SAFETY_INCOMPLETE'
  | 'ALERT_UNRESOLVED'
  | 'ALERT_UNACKNOWLEDGED'
  | 'PATHWAY_HALTED'
  | 'EXAM_PENDING'
  | 'CONTRADICTION'
  | 'NO_CANDIDATE'
  | 'DIAGNOSIS_NOT_CONFIRMED'
  | 'DOSE_NOT_SET'
  | 'PAEDIATRIC_REVIEW'
  | 'MODIFIER_SIGNOFF'
  | 'MODIFIERS_NOT_ASKED';

export interface Blocker {
  code: BlockerCode;
  refs: string[];
}

/** Decisions still valid for the current clinical state (stale ones are ignored, not deleted). */
export function validDecisions(enc: Encounter, complaint: Complaint): ReviewDecision[] {
  const h = basisHash(enc, complaint);
  return enc.decisions.filter((d) => d.complaintId === complaint.id && d.basisHash === h);
}
export function staleDecisions(enc: Encounter, complaint: Complaint): ReviewDecision[] {
  const h = basisHash(enc, complaint);
  return enc.decisions.filter((d) => d.complaintId === complaint.id && d.basisHash !== h);
}

export function confirmedDiagnosis(enc: Encounter, complaint: Complaint): ReviewDecision | undefined {
  const v = validDecisions(enc, complaint).filter((d) => d.type === 'confirm_diagnosis');
  return v[v.length - 1];
}

/**
 * Everything that currently prevents an exercise plan from being released for this complaint.
 * `forApproval` lists blockers before the approve_plan decision itself.
 */
export function planBlockers(protocol: Protocol, enc: Encounter, complaint: Complaint, ev: ComplaintEval): Blocker[] {
  const out: Blocker[] = [];
  const valid = validDecisions(enc, complaint);
  const has = (type: ReviewDecision['type'], targetId?: string) => valid.some((d) => d.type === type && (targetId === undefined || d.targetId === targetId));

  if (enc.consent?.status !== 'given') out.push({ code: 'CONSENT_MISSING', refs: [] });
  if (ev.eligibility !== 'established' && !has('resolve_eligibility')) out.push({ code: 'ELIGIBILITY_UNVERIFIED', refs: [] });

  if (ev.safety.state === 'not_started' || ev.safety.state === 'in_progress') out.push({ code: 'SAFETY_NOT_FINISHED', refs: [] });
  if (ev.safety.incomplete.length) out.push({ code: 'SAFETY_INCOMPLETE', refs: ev.safety.incomplete.map((i) => i.checkId) });

  const unack = ev.alerts.filter((a) => !enc.alertAcks[a.key]);
  if (unack.length) out.push({ code: 'ALERT_UNACKNOWLEDGED', refs: unack.map((a) => a.key) });
  const uncleared = ev.alerts.filter((a) => !has('clear_alert', a.key));
  if (uncleared.length) out.push({ code: 'ALERT_UNRESOLVED', refs: uncleared.map((a) => a.key) });

  if (ev.halt) {
    if (ev.halt.reason === 'EXAM_PENDING') out.push({ code: 'EXAM_PENDING', refs: [ev.halt.nodeId] });
    else out.push({ code: 'PATHWAY_HALTED', refs: [ev.halt.reason, ev.halt.nodeId, ...ev.halt.refs] });
  }
  if (ev.contradictions.length) out.push({ code: 'CONTRADICTION', refs: ev.contradictions.map((c) => c.nodeId) });

  const confirmed = valid.filter((d) => d.type === 'confirm_diagnosis').pop();
  if (!ev.candidate && !confirmed) out.push({ code: 'NO_CANDIDATE', refs: [] });
  if (!confirmed) out.push({ code: 'DIAGNOSIS_NOT_CONFIRMED', refs: ev.candidate ? [ev.candidate.diagnosisId] : [] });
  if (!ev.doseLevel && !(confirmed?.value?.doseLevel)) out.push({ code: 'DOSE_NOT_SET', refs: [] });

  if (ev.paediatric && !has('ack_paediatric')) out.push({ code: 'PAEDIATRIC_REVIEW', refs: [] });

  const mods = MODIFIER_CODES.map((c) => enc.history[c]);
  const notAsked = MODIFIER_CODES.filter((c) => !enc.history[c]);
  if (notAsked.length) out.push({ code: 'MODIFIERS_NOT_ASKED', refs: [...notAsked] });
  const flagged = mods.filter((m) => m && m.status !== 'denied' && m.status !== 'not_applicable');
  if (flagged.length && !has('ack_modifiers')) out.push({ code: 'MODIFIER_SIGNOFF', refs: flagged.map((m) => m!.code) });
  void protocol;
  return out;
}

export interface ProposedPlan {
  complaintId: string;
  status: 'blocked' | 'awaiting_approval' | 'approved_demo_only';
  blockers: Blocker[];
  diagnosis: ProtocolNode | null;
  diagnosisSource: 'clinician_confirmed' | 'engine_candidate' | null;
  exerciseGroups: ProtocolNode[];
  coreProgramme: ProtocolNode | null;
  doseLevel: 'HI' | 'MD' | 'LO' | null;
  doseNode: ProtocolNode | null;
  addOnModule: string | null;
  precautions: { code: string; text: string; sourceNode: string }[];
  painRule: ProtocolNode | null;
  followUp: { visit: 'week1' | 'week4' | 'week12'; nodeId: string; offsetDays: number }[];
  approval: ReviewDecision | null;
  /** Always true in this build: the protocol has no clinical approval. */
  demoOnly: true;
}

export function proposePlan(protocol: Protocol, enc: Encounter, complaint: Complaint, ev: ComplaintEval): ProposedPlan {
  const blockers = planBlockers(protocol, enc, complaint, ev);
  const confirmed = confirmedDiagnosis(enc, complaint);
  const dxId: string | null = confirmed?.targetId ?? ev.candidate?.diagnosisId ?? null;
  const dx = dxId ? protocol.nodes[dxId] ?? null : null;
  const pathway = dx?.pathway ?? ev.pathway;
  const def = pathway ? protocol.pathways[pathway] : null;
  const groups = (dx?.exerciseGroups ?? []).map((g) => protocol.nodes[g]);
  const core = groups.length && groups[0].next && protocol.nodes[groups[0].next]?.kind === 'core_programme' ? protocol.nodes[groups[0].next] : null;
  const doseLevel = ev.doseLevel ?? confirmed?.value?.doseLevel ?? null;
  const doseNode = def && doseLevel ? Object.values(protocol.nodes).find((n) => n.kind === 'dose' && n.pathway === def.pathway && n.doseLevel === doseLevel) ?? null : null;
  const precautions: ProposedPlan['precautions'] = [];
  if (dx) {
    for (const [k, v] of Object.entries(dx.fields)) {
      if (/^(AVOID|AVOID EARLY|REFER IF|REFER \(.*|RED FLAG|DANGER SIGN|DANGER)$/.test(k)) precautions.push({ code: k, text: v, sourceNode: dx.id });
    }
    if (groups.some((g) => /after clearance from doctor/i.test(g.sourceText))) {
      precautions.push({ code: 'DOCTOR_CLEARANCE', text: groups.find((g) => /after clearance from doctor/i.test(g.sourceText))!.sourceText.split('\n')[1], sourceNode: groups[0].id });
    }
  }
  for (const a of ev.alerts) precautions.push({ code: `ALERT:${a.urgency}`, text: `${a.headline} — ${a.actionText}`, sourceNode: a.outcomeId });
  const approval = validDecisions(enc, complaint).filter((d) => d.type === 'approve_plan').pop() ?? null;
  const status: ProposedPlan['status'] = blockers.length ? 'blocked' : approval ? 'approved_demo_only' : 'awaiting_approval';
  return {
    complaintId: complaint.id,
    status,
    blockers,
    diagnosis: dx,
    diagnosisSource: confirmed ? 'clinician_confirmed' : dx ? 'engine_candidate' : null,
    exerciseGroups: groups,
    coreProgramme: core,
    doseLevel,
    doseNode,
    addOnModule: dx ? dx.fields['STAGE 3 ADD-ON'] ?? dx.fields['STAGE 4 MODULE'] ?? null : null,
    precautions,
    painRule: def?.painRuleNode ? protocol.nodes[def.painRuleNode] : null,
    followUp: def
      ? [
          { visit: 'week1', nodeId: def.followUp.week1, offsetDays: 7 },
          { visit: 'week4', nodeId: def.followUp.week4, offsetDays: 28 },
          { visit: 'week12', nodeId: def.followUp.week12, offsetDays: 84 },
        ]
      : [],
    approval,
    demoOnly: true,
  };
}
