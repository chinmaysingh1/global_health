// Versioned protocol representation. Protocol definitions are DATA validated against this
// schema. Nothing here evaluates code from protocol files.
import { z } from 'zod';

export const PATHWAYS = ['knee', 'hip', 'low_back', 'neck'] as const;
export type Pathway = (typeof PATHWAYS)[number];
export const zPathway = z.enum(PATHWAYS);

export const BOARDS = ['spine', 'hip_knee'] as const;
export type Board = (typeof BOARDS)[number];

/** Source review status. Nothing in this build is clinically approved. */
export const zReviewStatus = z.enum([
  'source_draft_unreviewed', // faithful to the draft board, no clinical sign-off
  'proposed_amendment_unreviewed', // engineering proposal layered on top of the source
  'blocked_needs_clinical_decision',
]);
export type ReviewStatus = z.infer<typeof zReviewStatus>;

export const zCapability = z.enum(['trained', 'basic_kit', 'physio']);
export type Capability = z.infer<typeof zCapability>;

export const zNodeKind = z.enum([
  'start',
  'pathway_header',
  'stage_header',
  'triage_question',
  'triage_decision',
  'safety_check',
  'safety_outcome',
  'safety_pass',
  'question',
  'exam',
  'diagnosis',
  'note',
  'escalation',
  'exercise_group',
  'core_programme',
  'irritability',
  'dose',
  'risk_tool',
  'battery',
  'module',
  'followup_question',
  'followup_action',
]);
export type NodeKind = z.infer<typeof zNodeKind>;

export const zSourceRef = z.object({
  board: z.enum(BOARDS),
  fileKey: z.string(),
  nodeId: z.string(), // Figma node id, unique only within its file
  sectionId: z.string(),
  code: z.string().nullable(), // short code such as K3 (can repeat across boards)
});
export type SourceRef = z.infer<typeof zSourceRef>;

export const zUrgency = z.enum(['emergency', 'urgent', 'soon', 'refer', 'switch']);
export type Urgency = z.infer<typeof zUrgency>;

export const zExerciseRestriction = z.enum([
  'no_exercise',
  'hold_loading_until_cleared',
  'medical_review_first',
  'gentle_only_pending_review',
  'not_stated',
]);

export const zOutcomePolicy = z.object({
  urgency: zUrgency,
  headline: z.string(), // source headline verbatim, e.g. "EMERGENCY — SAME DAY"
  timing: z.string(), // referral timing as stated by the source
  assessmentMayContinue: z.boolean(),
  exerciseRestriction: zExerciseRestriction,
  policyBasis: z.enum(['source_text', 'derived_default', 'overlay_override']),
  gatedNext: z.array(z.string()).default([]), // source arrows that need medical clearance first
  switchOptions: z
    .array(
      z.object({
        id: z.string(),
        labelKey: z.string(),
        target: z.union([zPathway, z.literal('unsupported'), z.literal('emergency')]),
        note: z.string().optional(),
        /** true => the current pathway also continues (source: 'assess and treat both') */
        continueCurrent: z.boolean().optional(),
      }),
    )
    .default([]),
});
export type OutcomePolicy = z.infer<typeof zOutcomePolicy>;

export const zOption = z.object({
  id: z.string(), // file-qualified, e.g. hip_knee:KQ1a
  source: zSourceRef.nullable(), // null => synthesized in the reviewed layer
  label: z.string(), // source wording
  next: z.string().nullable(), // target node id from the source connector
  textRefs: z.array(z.string()).default([]), // codes mentioned in the label text
  redirect: z.array(z.string()).default([]), // text-only "back to X" jumps with no connector
  reviewStatus: zReviewStatus,
  ageRule: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
});
export type Option = z.infer<typeof zOption>;

export const zNode = z.object({
  id: z.string(), // file-qualified: `${board}:${code}` or `${board}:n${nodeId}`
  source: zSourceRef,
  kind: zNodeKind,
  pathway: zPathway.nullable(),
  stage: z.number().int().min(0).max(4),
  title: z.string(),
  sourceText: z.string(),
  fields: z.record(z.string(), z.string()).default({}), // ASK / CHECK / POSITIVE IF / NOTE / ...
  decision: z.string().optional(), // closing yes/no question of a safety check
  capabilities: z.array(zCapability).default([]),
  whoText: z.string().optional(),
  equipment: z.array(z.string()).default([]),
  reviewStatus: zReviewStatus,
  // transitions
  next: z.string().nullable().default(null),
  yes: z.string().nullable().default(null),
  no: z.string().nullable().default(null),
  options: z.array(zOption).default([]),
  // kind-specific
  outcome: zOutcomePolicy.optional(),
  exerciseGroups: z.array(z.string()).default([]),
  workingDiagnosis: z.boolean().optional(),
  doseLevel: z.enum(['HI', 'MD', 'LO']).optional(),
  visit: z.enum(['week1', 'week4', 'week12']).optional(),
  textRefs: z.array(z.string()).default([]),
  /** source arrows to nodes shown alongside this one (e.g. risk tool -> add-on module) */
  related: z.array(z.string()).default([]),
});
export type ProtocolNode = z.infer<typeof zNode>;

export const zMeasure = z.object({
  id: z.string(),
  pathway: zPathway,
  sourceNode: z.string(),
  sourceItem: z.number().int(),
  labelKey: z.string(),
  type: z.enum(['number', 'boolean', 'psfs', 'text', 'external_score', 'not_captured']),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  bilateral: z.boolean().default(false),
  direction: z.enum(['lower_better', 'higher_better', 'none']).default('none'),
  inLimitedSet: z.boolean().default(false), // part of the reduced baseline for HIGH irritability
  capability: zCapability.default('trained'),
  note: z.string().optional(),
  reviewStatus: zReviewStatus,
});
export type Measure = z.infer<typeof zMeasure>;

export const zAmendment = z.object({
  id: z.string(),
  targets: z.array(z.string()),
  issue: z.string(),
  proposal: z.string(),
  implementedAs: z.string(),
  status: z.literal('proposed_unreviewed'),
});
export type Amendment = z.infer<typeof zAmendment>;

export const zPathwayDef = z.object({
  pathway: zPathway,
  board: z.enum(BOARDS),
  header: z.string(),
  safetyStart: z.string(),
  safetyChecks: z.array(z.string()),
  safetyPass: z.string(),
  stage2Start: z.string(),
  measureStart: z.string(),
  diagnoses: z.array(z.string()),
  followUp: z.object({ week1: z.string(), week4: z.string(), week12: z.string() }),
  modifiersNode: z.string().nullable(),
  painRuleNode: z.string().nullable(),
});
export type PathwayDef = z.infer<typeof zPathwayDef>;

export const zProtocol = z.object({
  schemaVersion: z.literal(1),
  protocolVersion: z.string(),
  clinicalApproval: z.literal('none'), // this build can never claim approval
  snapshotDate: z.string(),
  sources: z.array(
    z.object({ board: z.enum(BOARDS), fileKey: z.string(), rawSha256: z.string(), revision: z.null() }),
  ),
  nodes: z.record(z.string(), zNode),
  pathways: z.record(zPathway, zPathwayDef),
  triage: z.record(z.enum(BOARDS), z.object({ start: z.string(), question: z.string() })),
  measures: z.array(zMeasure),
  amendments: z.array(zAmendment),
});
export type Protocol = z.infer<typeof zProtocol>;

// ---- Ledger: every source element accounted for -------------------------------------------

export const zLedgerClass = z.enum(['implemented', 'supporting_reference', 'duplicate', 'blocked']);
export const zLedgerEntry = z.object({
  sourceId: z.string(), // `${fileKey}:${nodeId}`
  board: z.enum(BOARDS),
  nodeId: z.string(),
  section: z.string(),
  elementType: z.enum(['node', 'connector']),
  code: z.string().nullable(),
  classification: zLedgerClass,
  canonical: z.string().nullable(), // protocol node / option / edge it became
  implementation: z.string(),
  tests: z.string(),
  reviewStatus: zReviewStatus,
  note: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof zLedgerEntry>;
