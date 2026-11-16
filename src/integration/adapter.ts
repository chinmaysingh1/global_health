// Typed handoff adapter. STATUS: SIMULATED / UNVERIFIED. No Intelehealth deployment, OpenMRS
// version, concept dictionary or API schema was available, so every field mapping below has
// target = null. Nothing here invents a UUID, endpoint or concept id.
import { z } from 'zod';
import type { Protocol } from '../protocol/schema';
import type { EncounterSummary } from '../engine/summary';
import { renderNote } from '../ai/note';

export const INTEGRATION_STATUS = 'SIMULATED_UNVERIFIED' as const;

/** Reference inspected for workflow shape only (not a verified contract). */
export const AYU_REFERENCE = {
  repo: 'https://github.com/Intelehealth/intelehealth-ayu-protocols',
  commit: '8172eabe7381605ac401197a10a6ed99b012c42d',
  path: 'protocols/v3.1/All Protocols (JSON)/ chiefComplaints/', // the leading space is in the repo
  licence: 'MPL-2.0',
  complaintFilesByName: { knee: 'Knee pain.json', hip: 'Hip pain.json', low_back: 'Back pain.json', neck: 'Neck pain.json' } as Record<string, string>,
};

export interface FieldMapping {
  field: string;
  description: string;
  target: null; // would be an OpenMRS concept / encounter / obs reference once verified
  candidate?: string; // name-level hint only; never an identifier
  blocker: string;
}

export const FIELD_MAPPINGS: FieldMapping[] = [
  { field: 'patient.localId', description: 'Patient identifier', target: null, blocker: 'Intelehealth patient identifier type and OpenMRS patient UUID lookup not available' },
  { field: 'encounter.type', description: 'Encounter type (initial / follow-up)', target: null, blocker: 'Encounter type UUIDs depend on the deployment (visit note / adult initial etc.)' },
  { field: 'complaints[].region', description: 'Chief complaint', target: null, candidate: 'Ayu v3.1 chief complaint files matched by NAME only: Knee pain, Hip pain, Back pain, Neck pain', blocker: 'Current-complaint concept and Ayu node ids not verified against the target app parser' },
  { field: 'complaints[].laterality', description: 'Side', target: null, candidate: 'Ayu "Location" options (e.g. Left knee / Right knee / Both knees)', blocker: 'Option ids not verified' },
  { field: 'complaints[].safety.checks[]', description: 'Stage 1 safety screen answers with status', target: null, blocker: 'No observation concepts exist for board checks; status values (unknown / declined / not performed) need a coded representation' },
  { field: 'complaints[].alerts[]', description: 'Referral urgency and action', target: null, blocker: 'Referral / priority representation in the target workflow not inspected' },
  { field: 'complaints[].trace[]', description: 'Stage 2 questions, tests and results', target: null, blocker: 'No concepts; physical-exam obs format (Ayu perform-physical-exam strings) not verified' },
  { field: 'complaints[].assessment', description: 'Engine candidate and clinician-confirmed working assessment', target: null, blocker: 'Diagnosis concept / coded diagnosis list not available; clinician-side write semantics unknown' },
  { field: 'complaints[].measures[]', description: 'Baseline and follow-up measurements', target: null, blocker: 'No numeric obs concepts or units verified' },
  { field: 'complaints[].plan', description: 'Approved exercise plan, dose level, follow-up schedule', target: null, blocker: 'Advice / follow-up obs structure in the target app not inspected' },
  { field: 'history[]', description: 'Medications, allergies, comorbidities, goals, modifiers', target: null, candidate: 'Ayu history protocols: Past Medical History, Social & Family History', blocker: 'Not verified' },
  { field: 'narratives[]', description: 'Original patient wording with language', target: null, blocker: 'Free-text obs target unknown' },
  { field: 'note.text', description: 'Readable clinical summary', target: null, blocker: 'Visit note / text obs target unknown' },
  { field: 'review.decisions[]', description: 'Clinician review trail', target: null, blocker: 'Doctor-side data model not inspected' },
  { field: 'provenance', description: 'Protocol version, source snapshot hashes, authors, timestamps', target: null, blocker: 'No agreed metadata carrier' },
];

export const zHandoffBundle = z.object({
  bundleVersion: z.literal(1),
  integrationStatus: z.literal(INTEGRATION_STATUS),
  synthetic: z.literal(true),
  notForPatientCare: z.literal(true),
  generator: z.object({ app: z.string(), protocolVersion: z.string(), snapshotDate: z.string(), clinicalApproval: z.literal('none'), sources: z.array(z.object({ board: z.string(), fileKey: z.string(), rawSha256: z.string() })) }),
  patient: z.object({ localId: z.string(), name: z.string(), age: z.number().nullable(), sex: z.string() }),
  encounter: z.object({
    localId: z.string(),
    type: z.enum(['initial', 'followup']),
    visit: z.string().nullable(),
    followUpOf: z.string().nullable(),
    revision: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    patientLanguage: z.enum(['en', 'hi', 'mr']),
    consent: z.object({ status: z.string(), by: z.string(), at: z.string() }).nullable(),
  }),
  complaints: z.array(z.any()),
  history: z.array(z.any()),
  narratives: z.array(z.object({ lang: z.enum(['en', 'hi', 'mr']), text: z.string(), infoSource: z.string(), at: z.string() })),
  note: z.object({ generatedBy: z.literal('deterministic_renderer'), lang: z.literal('en'), text: z.string() }),
  review: z.object({ decisions: z.array(z.any()), openItems: z.array(z.any()) }),
  unmapped: z.array(z.object({ field: z.string(), blocker: z.string() })),
});
export type HandoffBundle = z.infer<typeof zHandoffBundle>;

export function buildHandoff(protocol: Protocol, s: EncounterSummary): HandoffBundle {
  const { patient, encounter: enc } = s;
  const code = (id: string) => protocol.nodes[id]?.source.code ?? id;
  const src = (id: string) => {
    const n = protocol.nodes[id];
    return n ? { board: n.source.board, fileKey: n.source.fileKey, nodeId: n.source.nodeId, code: n.source.code } : null;
  };
  const bundle: HandoffBundle = {
    bundleVersion: 1,
    integrationStatus: INTEGRATION_STATUS,
    synthetic: true,
    notForPatientCare: true,
    generator: {
      app: 'chw-msk-assessment/0.1.0',
      protocolVersion: enc.protocolVersion,
      snapshotDate: protocol.snapshotDate,
      clinicalApproval: 'none',
      sources: protocol.sources.map((x) => ({ board: x.board, fileKey: x.fileKey, rawSha256: x.rawSha256 })),
    },
    patient: { localId: patient.id, name: patient.name, age: patient.age, sex: patient.sex },
    encounter: {
      localId: enc.id,
      type: enc.type,
      visit: enc.visit ?? null,
      followUpOf: enc.followUpOf ?? null,
      revision: enc.revision,
      createdAt: enc.createdAt,
      updatedAt: enc.updatedAt,
      patientLanguage: enc.patientLanguage,
      consent: enc.consent ? { status: enc.consent.status, by: enc.consent.by, at: enc.consent.at } : null,
    },
    complaints: s.complaints.map((c) => ({
      id: c.complaint.id,
      region: c.complaint.region,
      laterality: c.complaint.laterality,
      pathway: c.ev.pathway,
      origin: c.complaint.origin ?? null,
      patientWords: c.complaint.patientWords ?? null,
      eligibility: c.complaint.eligibility ?? null,
      safety: {
        state: c.ev.safety.state,
        checks: c.safetyRows.map((r) => ({
          code: r.code,
          source: src(r.checkId),
          state: r.state,
          incompleteReason: r.reason ?? null,
          status: r.answer?.status ?? 'not_asked',
          infoSource: r.answer?.infoSource ?? null,
          author: r.answer?.author ?? null,
          at: r.answer?.at ?? null,
          performerCapabilities: r.answer?.capabilities ?? null,
          via: r.answer?.via ?? null,
        })),
      },
      alerts: c.alerts.map((a) => ({
        check: a.checkId ? code(a.checkId) : null,
        outcome: code(a.outcomeId),
        urgency: a.urgency,
        referralTiming: a.timing,
        assessmentMayContinue: a.assessmentMayContinue,
        exerciseRestriction: a.exerciseRestriction,
        sourceAction: a.actionText,
        disclosedLate: a.late,
        acknowledged: enc.alertAcks[a.key] ?? null,
      })),
      trace: c.trace.map((t) => ({ code: t.code, kind: t.kind, title: t.title, answer: t.answerLabel ?? null, status: t.status ?? null, infoSource: t.infoSource ?? null, author: t.author ?? null, source: src(t.nodeId) })),
      stopped: c.ev.halt ? { reason: c.ev.halt.reason, at: code(c.ev.halt.nodeId), refs: c.ev.halt.refs.map(code) } : null,
      contradictions: c.ev.contradictions,
      assessment: {
        engineCandidate: c.ev.candidate ? { code: code(c.ev.candidate.diagnosisId), title: protocol.nodes[c.ev.candidate.diagnosisId].title, status: 'candidate_not_a_diagnosis' } : null,
        clinicianConfirmed: c.confirmed ? { code: code(c.confirmed.targetId!), title: protocol.nodes[c.confirmed.targetId!]?.title ?? null, by: c.confirmed.by, at: c.confirmed.at, reason: c.confirmed.reason } : null,
      },
      measures: Object.values(c.complaint.measures),
      plan: {
        status: c.plan.status,
        demoOnly: true,
        blockers: c.plan.blockers,
        exerciseGroups: c.plan.status === 'approved_demo_only' ? c.plan.exerciseGroups.map((g) => ({ code: g.source.code, title: g.title, source: src(g.id) })) : [],
        doseLevel: c.plan.status === 'approved_demo_only' ? c.plan.doseLevel : null,
        followUp: c.plan.status === 'approved_demo_only' ? c.plan.followUp : [],
        approval: c.plan.approval ? { by: c.plan.approval.by, at: c.plan.approval.at, reason: c.plan.approval.reason } : null,
      },
      missing: c.pending,
    })),
    history: Object.values(enc.history),
    narratives: enc.narratives.map((n) => ({ lang: n.lang, text: n.text, infoSource: n.infoSource, at: n.at })),
    note: { generatedBy: 'deterministic_renderer', lang: 'en', text: renderNote(protocol, s) },
    review: { decisions: enc.decisions, openItems: s.pending },
    unmapped: FIELD_MAPPINGS.map((m) => ({ field: m.field, blocker: m.blocker })),
  };
  return bundle;
}
