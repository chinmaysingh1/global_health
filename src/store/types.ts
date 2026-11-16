// Encounter data model. Language-independent codes only; display strings live in src/i18n.
import type { Board, Capability, Pathway } from '../protocol/schema';

export type Lang = 'en' | 'hi' | 'mr';
export const LANGS: Lang[] = ['en', 'hi', 'mr'];

/** These states are never collapsed into each other. "not asked" is the absence of a record. */
export type AnswerStatus = 'present' | 'denied' | 'unknown' | 'declined' | 'not_applicable' | 'not_performed';

export type Role = 'chw' | 'clinician';
export interface Actor {
  id: string;
  name: string;
  role: Role; // demo role switch only; NOT authorization
  capabilities: Capability[];
}

/** Who the information came from, kept separate from who typed it in. */
export type InfoSource = 'patient_report' | 'caregiver_report' | 'chw_observation' | 'clinician_finding';

export interface Evidence {
  kind: 'structured_input' | 'narrative_span' | 'ai_proposal';
  ref?: string; // narrative id or proposal id
  start?: number;
  end?: number;
  quote?: string;
}

export interface AnswerRecord {
  nodeId: string;
  status: AnswerStatus;
  optionId?: string;
  value?: string | number | boolean;
  infoSource: InfoSource;
  author: { id: string; name: string; role: Role };
  capabilities: Capability[]; // capabilities of whoever performed the check/exam
  at: string;
  reason?: string; // required for unknown / declined / not_performed
  evidence: Evidence;
  via: 'manual' | 'ai_accepted' | 'late_concern';
}

export type Region = 'knee' | 'hip' | 'hip_knee_unsure' | 'low_back' | 'neck' | 'back_unsure';
export type Laterality = 'left' | 'right' | 'both' | 'central' | 'not_recorded';

export interface Eligibility {
  status: 'established' | 'unclear';
  basis: 'clinician_assessed' | 'referral_document' | 'chw_screen_local_protocol' | 'not_established';
  note?: string;
  author: { id: string; name: string; role: Role };
  at: string;
}

export interface MeasureRecord {
  measureId: string;
  status: 'recorded' | 'not_performed' | 'not_applicable';
  value?: number | boolean | string;
  left?: number;
  right?: number;
  psfs?: { task: string; score: number }[];
  reason?: string;
  author: { id: string; name: string; role: Role };
  at: string;
}

export interface Complaint {
  id: string;
  board: Board;
  region: Region;
  laterality: Laterality;
  entryNode?: string; // set for linked complaints created by a pathway switch
  origin?: { complaintId: string; nodeId: string; optionId: string };
  withdrawn?: { reason: string; at: string };
  patientWords?: string; // original wording, in the patient's language
  eligibility?: Eligibility;
  answers: Record<string, AnswerRecord>;
  measures: Record<string, MeasureRecord>;
  fromPrevious?: { diagnosisId?: string; doseLevel?: string; exerciseGroups?: string[]; pathway?: Pathway };
}

export interface HistoryField {
  code: string;
  status: AnswerStatus;
  value?: string;
  items?: string[];
  infoSource: InfoSource;
  author: { id: string; name: string; role: Role };
  at: string;
  evidence: Evidence;
}

export interface Narrative {
  id: string;
  text: string; // original wording, never rewritten
  lang: Lang;
  infoSource: InfoSource;
  author: { id: string; name: string; role: Role };
  at: string;
}

export interface AiProposal {
  id: string;
  narrativeId: string;
  complaintId?: string;
  target: { kind: 'safety_check'; nodeId: string } | { kind: 'history_field'; code: string };
  status: AnswerStatus;
  value?: string;
  quote: string;
  start: number;
  end: number;
  urgentFlag: boolean;
  providerId: string;
  basedOnRevision: number;
  state: 'pending' | 'accepted' | 'rejected';
  decidedBy?: { id: string; name: string; role: Role };
  decidedAt?: string;
}

export type DecisionType =
  | 'confirm_diagnosis'
  | 'clear_alert'
  | 'ack_paediatric'
  | 'ack_modifiers'
  | 'resolve_eligibility'
  | 'approve_plan'
  | 'followup_outcome'
  | 'review_note';

export interface ReviewDecision {
  id: string;
  type: DecisionType;
  complaintId?: string;
  targetId?: string; // diagnosis id, alert key ...
  value?: any;
  reason: string;
  by: { id: string; name: string; role: Role };
  at: string;
  basisHash: string; // clinical state the decision was made on; mismatch => stale
}

export interface AuditEvent {
  seq: number;
  at: string;
  actor: { id: string; name: string; role: Role };
  type: string;
  detail: Record<string, unknown>; // includes the superseded value so history is never lost
}

export type SyncState =
  | 'saved_on_device'
  | 'awaiting_review'
  | 'queued_for_sync'
  | 'received_by_server'
  | 'sync_conflict'
  | 'auth_expired'
  | 'sync_failed';

export interface Encounter {
  id: string;
  schema: 1;
  patientId: string;
  synthetic: true; // this build accepts synthetic patients only
  type: 'initial' | 'followup';
  followUpOf?: string;
  visit?: 'week1' | 'week4' | 'week12';
  createdAt: string;
  updatedAt: string;
  revision: number;
  protocolVersion: string;
  patientLanguage: Lang;
  consent?: { status: 'given' | 'declined'; by: 'patient' | 'caregiver'; at: string; author: Actor['id'] };
  complaints: Complaint[];
  history: Record<string, HistoryField>;
  narratives: Narrative[];
  proposals: AiProposal[];
  alertAcks: Record<string, { by: { id: string; name: string; role: Role }; at: string }>;
  decisions: ReviewDecision[];
  followUp?: { adherence?: string; adverse?: string; adverseStatus?: AnswerStatus; visitAnswer?: Record<string, AnswerRecord> };
  aiNote?: { text: string; providerId: string; basedOnRevision: number; at: string };
  aiUsage: { calls: number; log: { at: string; providerId: string; model?: string; task: string; ms: number; inputTokens?: number; outputTokens?: number; outcome: string }[] };
  events: AuditEvent[];
  sync: { state: SyncState; serverVersion?: number; receiptId?: string; ackAt?: string; lastError?: string; idempotencyKey?: string; submittedRevision?: number };
}

export interface Patient {
  id: string;
  synthetic: true;
  name: string;
  age: number | null;
  sex: 'female' | 'male' | 'other';
  village: string;
  preferredLanguage: Lang;
  demoNote: string;
}
