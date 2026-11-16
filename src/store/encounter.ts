// Encounter mutations. Every change goes through `mutate`, which bumps the revision and
// appends an audit event that includes the superseded value. Nothing is silently deleted.
import type { Capability, Pathway, Protocol } from '../protocol/schema';
import type {
  Actor,
  AiProposal,
  AnswerRecord,
  AnswerStatus,
  Complaint,
  Eligibility,
  Encounter,
  Evidence,
  HistoryField,
  InfoSource,
  Lang,
  Laterality,
  MeasureRecord,
  Patient,
  Region,
  ReviewDecision,
} from './types';
import { basisHash } from '../engine/plan';

let counter = 0;
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const who = (a: Actor) => ({ id: a.id, name: a.name, role: a.role });

export const REGION_ENTRY: Record<Region, { board: Complaint['board']; option: string }> = {
  knee: { board: 'hip_knee', option: 'hip_knee:G-A0K' },
  hip: { board: 'hip_knee', option: 'hip_knee:G-A0H' },
  hip_knee_unsure: { board: 'hip_knee', option: 'hip_knee:G-A0B' },
  low_back: { board: 'spine', option: 'spine:G-A0L' },
  neck: { board: 'spine', option: 'spine:G-A0N' },
  back_unsure: { board: 'spine', option: 'spine:G-A0B' },
};
const PATHWAY_REGION: Record<Pathway, Region> = { knee: 'knee', hip: 'hip', low_back: 'low_back', neck: 'neck' };

function mutate(enc: Encounter, actor: Actor, type: string, detail: Record<string, unknown>, fn: (draft: Encounter) => void, now = new Date().toISOString()): Encounter {
  const draft: Encounter = structuredClone(enc);
  fn(draft);
  draft.revision += 1;
  draft.updatedAt = now;
  draft.events.push({ seq: draft.events.length + 1, at: now, actor: who(actor), type, detail });
  // any clinical change after submission means the server copy is behind
  if (!['sync', 'ai_usage'].includes(type) && ['received_by_server', 'queued_for_sync'].includes(draft.sync.state)) {
    draft.sync = { ...draft.sync, state: 'saved_on_device' };
  }
  return draft;
}

export function createEncounter(patient: Patient, actor: Actor, protocolVersion: string, opts: Partial<Pick<Encounter, 'type' | 'followUpOf' | 'visit'>> = {}): Encounter {
  const now = new Date().toISOString();
  return {
    id: newId('enc'),
    schema: 1,
    patientId: patient.id,
    synthetic: true,
    type: opts.type ?? 'initial',
    followUpOf: opts.followUpOf,
    visit: opts.visit,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    protocolVersion,
    patientLanguage: patient.preferredLanguage,
    complaints: [],
    history: {},
    narratives: [],
    proposals: [],
    alertAcks: {},
    decisions: [],
    aiUsage: { calls: 0, log: [] },
    events: [{ seq: 1, at: now, actor: who(actor), type: 'encounter_created', detail: { type: opts.type ?? 'initial', followUpOf: opts.followUpOf ?? null } }],
    sync: { state: 'saved_on_device' },
  };
}

export function setConsent(enc: Encounter, actor: Actor, status: 'given' | 'declined', by: 'patient' | 'caregiver'): Encounter {
  return mutate(enc, actor, 'consent', { status, by, previous: enc.consent ?? null }, (d) => {
    d.consent = { status, by, at: new Date().toISOString(), author: actor.id };
  });
}

export function setPatientLanguage(enc: Encounter, actor: Actor, lang: Lang): Encounter {
  return mutate(enc, actor, 'patient_language', { lang, previous: enc.patientLanguage }, (d) => {
    d.patientLanguage = lang;
  });
}

export function answerRecord(actor: Actor, nodeId: string, status: AnswerStatus, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    nodeId,
    status,
    infoSource: actor.role === 'clinician' ? 'clinician_finding' : 'patient_report',
    author: who(actor),
    capabilities: actor.capabilities,
    at: new Date().toISOString(),
    evidence: { kind: 'structured_input' },
    via: 'manual',
    ...extra,
  };
}

export function addComplaint(enc: Encounter, actor: Actor, region: Region, laterality: Laterality, patientWords?: string): Encounter {
  const entry = REGION_ENTRY[region];
  const id = newId('cmp');
  return mutate(enc, actor, 'complaint_added', { id, region, laterality }, (d) => {
    const board = entry.board;
    const q0 = `${board}:G-Q0`;
    d.complaints.push({
      id,
      board,
      region,
      laterality,
      patientWords,
      answers: { [q0]: answerRecord(actor, q0, 'present', { optionId: entry.option }) },
      measures: {},
    });
  });
}

/** Opens a linked complaint for a pathway switch. Carries origin, laterality and eligibility. */
export function addLinkedComplaint(enc: Encounter, actor: Actor, protocol: Protocol, fromComplaintId: string, target: Pathway, from: string, optionId: string): Encounter {
  const parent = enc.complaints.find((c) => c.id === fromComplaintId)!;
  const exists = enc.complaints.find((c) => c.origin?.complaintId === fromComplaintId && c.entryNode === protocol.pathways[target].header && !c.withdrawn);
  if (exists) return enc;
  const id = newId('cmp');
  return mutate(enc, actor, 'complaint_linked', { id, fromComplaintId, target, from, optionId }, (d) => {
    d.complaints.push({
      id,
      board: protocol.pathways[target].board,
      region: PATHWAY_REGION[target],
      laterality: target === 'low_back' || target === 'neck' ? 'not_recorded' : parent.laterality,
      entryNode: protocol.pathways[target].header,
      origin: { complaintId: fromComplaintId, nodeId: from, optionId },
      patientWords: parent.patientWords,
      eligibility: parent.eligibility,
      answers: {},
      measures: {},
    });
  });
}

export function withdrawComplaint(enc: Encounter, actor: Actor, complaintId: string, reason: string): Encounter {
  return mutate(enc, actor, 'complaint_withdrawn', { complaintId, reason }, (d) => {
    const c = d.complaints.find((x) => x.id === complaintId)!;
    c.withdrawn = { reason, at: new Date().toISOString() };
  });
}

export function setLaterality(enc: Encounter, actor: Actor, complaintId: string, laterality: Laterality): Encounter {
  const prev = enc.complaints.find((c) => c.id === complaintId)!.laterality;
  return mutate(enc, actor, 'laterality', { complaintId, laterality, previous: prev }, (d) => {
    d.complaints.find((c) => c.id === complaintId)!.laterality = laterality;
  });
}

export function setEligibility(enc: Encounter, actor: Actor, complaintId: string, status: Eligibility['status'], basis: Eligibility['basis'], note?: string): Encounter {
  const prev = enc.complaints.find((c) => c.id === complaintId)!.eligibility ?? null;
  return mutate(enc, actor, 'eligibility', { complaintId, status, basis, previous: prev }, (d) => {
    d.complaints.find((c) => c.id === complaintId)!.eligibility = { status, basis, note, author: who(actor), at: new Date().toISOString() };
  });
}

export function setAnswer(enc: Encounter, actor: Actor, complaintId: string, record: AnswerRecord): Encounter {
  const prev = enc.complaints.find((c) => c.id === complaintId)!.answers[record.nodeId] ?? null;
  return mutate(enc, actor, prev ? 'answer_changed' : 'answer', { complaintId, nodeId: record.nodeId, status: record.status, optionId: record.optionId ?? null, via: record.via, previous: prev }, (d) => {
    d.complaints.find((c) => c.id === complaintId)!.answers[record.nodeId] = record;
  });
}

/** Re-opens a question. The previous answer stays in the audit trail. */
export function clearAnswer(enc: Encounter, actor: Actor, complaintId: string, nodeId: string, reason: string): Encounter {
  const prev = enc.complaints.find((c) => c.id === complaintId)!.answers[nodeId] ?? null;
  if (!prev) return enc;
  return mutate(enc, actor, 'answer_reopened', { complaintId, nodeId, reason, previous: prev }, (d) => {
    delete d.complaints.find((c) => c.id === complaintId)!.answers[nodeId];
  });
}

export function setHistoryField(enc: Encounter, actor: Actor, code: string, status: AnswerStatus, extra: { value?: string; items?: string[]; infoSource?: InfoSource; evidence?: Evidence } = {}): Encounter {
  const prev = enc.history[code] ?? null;
  const field: HistoryField = {
    code,
    status,
    value: extra.value,
    items: extra.items,
    infoSource: extra.infoSource ?? 'patient_report',
    author: who(actor),
    at: new Date().toISOString(),
    evidence: extra.evidence ?? { kind: 'structured_input' },
  };
  return mutate(enc, actor, 'history_field', { code, status, previous: prev }, (d) => {
    d.history[code] = field;
  });
}

export function addNarrative(enc: Encounter, actor: Actor, text: string, lang: Lang, infoSource: InfoSource = 'patient_report'): { enc: Encounter; narrativeId: string } {
  const id = newId('nar');
  const next = mutate(enc, actor, 'narrative_added', { id, lang, length: text.length }, (d) => {
    d.narratives.push({ id, text, lang, infoSource, author: who(actor), at: new Date().toISOString() });
  });
  return { enc: next, narrativeId: id };
}

export function setMeasure(enc: Encounter, actor: Actor, complaintId: string, rec: Omit<MeasureRecord, 'author' | 'at'>): Encounter {
  const prev = enc.complaints.find((c) => c.id === complaintId)!.measures[rec.measureId] ?? null;
  return mutate(enc, actor, 'measure', { complaintId, measureId: rec.measureId, status: rec.status, previous: prev }, (d) => {
    d.complaints.find((c) => c.id === complaintId)!.measures[rec.measureId] = { ...rec, author: who(actor), at: new Date().toISOString() };
  });
}

export function acknowledgeAlert(enc: Encounter, actor: Actor, alertKey: string): Encounter {
  if (enc.alertAcks[alertKey]) return enc;
  return mutate(enc, actor, 'alert_acknowledged', { alertKey }, (d) => {
    d.alertAcks[alertKey] = { by: who(actor), at: new Date().toISOString() };
  });
}

/** Review decisions are bound to the clinical state they were made on (basisHash). */
export function addDecision(enc: Encounter, actor: Actor, d0: Pick<ReviewDecision, 'type' | 'complaintId' | 'targetId' | 'value' | 'reason'>): Encounter {
  if (actor.role !== 'clinician') throw new Error('Only the clinician role can record review decisions');
  const complaint = enc.complaints.find((c) => c.id === d0.complaintId);
  const decision: ReviewDecision = {
    id: newId('dec'),
    ...d0,
    by: who(actor),
    at: new Date().toISOString(),
    basisHash: complaint ? basisHash(enc, complaint) : 'encounter',
  };
  return mutate(enc, actor, 'review_decision', { id: decision.id, type: decision.type, complaintId: decision.complaintId ?? null, targetId: decision.targetId ?? null, basisHash: decision.basisHash }, (d) => {
    d.decisions.push(decision);
  });
}

export function addProposals(enc: Encounter, actor: Actor, proposals: AiProposal[]): Encounter {
  if (!proposals.length) return enc;
  return mutate(enc, actor, 'ai_proposals_added', { count: proposals.length, provider: proposals[0].providerId }, (d) => {
    d.proposals.push(...proposals);
  });
}

/**
 * Accepting a proposal is the CHW's confirmation step. Safety checks can only be flagged
 * "present" this way; an AI proposal can never record a safety check as denied.
 */
export function decideProposal(enc: Encounter, actor: Actor, proposalId: string, accept: boolean): Encounter {
  const p = enc.proposals.find((x) => x.id === proposalId);
  if (!p || p.state !== 'pending') return enc;
  if (accept && proposalConflict(enc, proposalId)) return enc; // re-ask instead of overwriting a newer answer
  let next = mutate(enc, actor, accept ? 'ai_proposal_accepted' : 'ai_proposal_rejected', { proposalId, target: p.target }, (d) => {
    const dp = d.proposals.find((x) => x.id === proposalId)!;
    dp.state = accept ? 'accepted' : 'rejected';
    dp.decidedBy = who(actor);
    dp.decidedAt = new Date().toISOString();
  });
  if (!accept) return next;
  const evidence: Evidence = { kind: 'ai_proposal', ref: p.id, start: p.start, end: p.end, quote: p.quote };
  if (p.target.kind === 'safety_check') {
    if (p.status !== 'present' || !p.complaintId) return next;
    next = setAnswer(next, actor, p.complaintId, answerRecord(actor, p.target.nodeId, 'present', { via: 'ai_accepted', evidence, capabilities: actor.capabilities as Capability[] }));
  } else {
    next = setHistoryField(next, actor, p.target.code, p.status, { value: p.value, evidence });
  }
  return next;
}

/**
 * A proposal must not overwrite a newer correction: if the target was answered after the
 * narrative was captured, the CHW has to re-ask instead of accepting the older AI reading.
 */
export function proposalConflict(enc: Encounter, proposalId: string): boolean {
  const p = enc.proposals.find((x) => x.id === proposalId);
  if (!p) return false;
  const narrative = enc.narratives.find((n) => n.id === p.narrativeId);
  if (!narrative) return true;
  if (p.target.kind === 'safety_check') {
    const nodeId = p.target.nodeId;
    const existing = enc.complaints.find((c) => c.id === p.complaintId)?.answers[nodeId];
    return !!existing && existing.at > narrative.at && existing.status !== p.status;
  }
  const existing = enc.history[p.target.code];
  return !!existing && existing.at > narrative.at && existing.status !== p.status;
}

export function setFollowUp(enc: Encounter, actor: Actor, patch: Partial<NonNullable<Encounter['followUp']>>): Encounter {
  return mutate(enc, actor, 'followup', { keys: Object.keys(patch), previous: enc.followUp ?? null }, (d) => {
    d.followUp = { ...(d.followUp ?? {}), ...patch };
  });
}

export function setAiNote(enc: Encounter, actor: Actor, note: Encounter['aiNote']): Encounter {
  return mutate(enc, actor, 'ai_note', { providerId: note?.providerId ?? null }, (d) => {
    d.aiNote = note;
  });
}

export function logAiUsage(enc: Encounter, actor: Actor, entry: Encounter['aiUsage']['log'][number]): Encounter {
  return mutate(enc, actor, 'ai_usage', { task: entry.task, outcome: entry.outcome, ms: entry.ms }, (d) => {
    d.aiUsage.calls += 1;
    d.aiUsage.log.push(entry);
  });
}

export function setSync(enc: Encounter, actor: Actor, sync: Encounter['sync']): Encounter {
  return mutate(enc, actor, 'sync', { state: sync.state, receiptId: sync.receiptId ?? null, error: sync.lastError ?? null }, (d) => {
    d.sync = sync;
  });
}

/** Creates a follow-up encounter that carries complaints, confirmed assessment and plan refs. */
export function createFollowUp(protocol: Protocol, patient: Patient, actor: Actor, previous: Encounter, visit: 'week1' | 'week4' | 'week12', carried: Record<string, Complaint['fromPrevious']>): Encounter {
  const enc = createEncounter(patient, actor, protocol.protocolVersion, { type: 'followup', followUpOf: previous.id, visit });
  enc.patientLanguage = previous.patientLanguage;
  for (const c of previous.complaints) {
    if (c.withdrawn) continue;
    enc.complaints.push({
      id: c.id, // same complaint identity across visits so measures compare like-for-like
      board: c.board,
      region: c.region,
      laterality: c.laterality,
      // follow-up visits start at the pathway already established at the first visit
      entryNode: carried[c.id]?.pathway ? protocol.pathways[carried[c.id]!.pathway!].header : c.entryNode,
      origin: c.origin,
      patientWords: c.patientWords,
      eligibility: c.eligibility,
      answers: {},
      measures: {},
      fromPrevious: carried[c.id],
    });
  }
  enc.events[0].detail.carriedComplaints = enc.complaints.map((c) => c.id);
  return enc;
}
