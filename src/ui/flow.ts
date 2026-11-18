// Visit navigation model. Groups the existing sections (the old tabs, whose hash routes are
// unchanged) into four visible stages and derives each section's status and the next action
// from real encounter state. It never decides anything clinical: it only reads the engine's
// summary, and it adds no prerequisite that the old free tab navigation did not have.
import type { Encounter } from '../store/types';
import type { EncounterSummary, PendingItem } from '../engine/summary';

export type StageId = 'intake' | 'assess' | 'review' | 'handoff';
export type Section = 'start' | 'complaints' | 'history' | 'assess' | 'followup' | 'summary' | 'review' | 'plan' | 'export';
export type Status = 'done' | 'progress' | 'attention' | 'todo';

export const STAGES: StageId[] = ['intake', 'assess', 'review', 'handoff'];

const INITIAL: Record<StageId, Section[]> = {
  intake: ['start', 'complaints', 'history'],
  assess: ['assess'],
  review: ['summary', 'review'],
  handoff: ['plan', 'export'],
};
const FOLLOWUP: Record<StageId, Section[]> = {
  intake: ['start'],
  assess: ['followup'],
  review: ['summary', 'review'],
  handoff: ['export'],
};

export const stageSections = (type: Encounter['type']): Record<StageId, Section[]> => (type === 'followup' ? FOLLOWUP : INITIAL);
export const allSections = (type: Encounter['type']): Section[] => STAGES.flatMap((s) => stageSections(type)[s]);

/** Maps any hash segment to a section this visit has. Old links keep working. */
export function normalizeSection(type: Encounter['type'], raw: string | undefined): Section {
  const list = allSections(type);
  if (raw && (list as string[]).includes(raw)) return raw as Section;
  if (type === 'followup' && raw === 'assess') return 'followup';
  if (type === 'initial' && raw === 'followup') return 'assess';
  if (type === 'followup' && (raw === 'complaints' || raw === 'history')) return 'start';
  if (type === 'followup' && raw === 'plan') return 'export';
  return 'start';
}

export const stageOf = (type: Encounter['type'], section: Section): StageId => STAGES.find((s) => stageSections(type)[s].includes(section))!;

export function stageLabelKey(type: Encounter['type'], stage: StageId): string {
  if (type === 'followup' && stage === 'assess') return 'stage.followup';
  if (type === 'followup' && stage === 'handoff') return 'stage.handoffOnly';
  return `stage.${stage}`;
}
export const sectionLabelKey = (section: Section) => `tab.${section}`;

const ASSESS_CODES: PendingItem['code'][] = ['ELIGIBILITY', 'QUESTION', 'SWITCH_CHOICE', 'SAFETY_ITEM', 'HALT', 'ALERT_ACK', 'CONTRADICTION', 'MEASURE', 'LINKED_COMPLAINT'];
const ATTENTION_CODES: PendingItem['code'][] = ['ALERT_ACK', 'CONTRADICTION', 'HALT'];

/** Where an open item can be resolved. */
export function sectionForPending(type: Encounter['type'], p: PendingItem): Section {
  if (p.code === 'CONSENT') return 'start';
  if (p.code === 'AI_PROPOSAL') return type === 'followup' ? 'followup' : 'history';
  if (p.code === 'STALE_DECISION') return 'review';
  return type === 'followup' ? 'followup' : 'assess';
}

export function sectionStatus(enc: Encounter, s: EncounterSummary, section: Section): Status {
  const active = enc.complaints.filter((c) => !c.withdrawn);
  const assessPending = s.pending.filter((p) => ASSESS_CODES.includes(p.code));
  switch (section) {
    case 'start':
      return enc.consent?.status === 'given' ? 'done' : enc.consent?.status === 'declined' ? 'attention' : 'todo';
    case 'complaints':
      return active.length ? 'done' : 'todo';
    case 'history':
      return Object.keys(enc.history).length || enc.narratives.length ? 'done' : 'todo';
    case 'assess':
    case 'followup': {
      if (!active.length || enc.consent?.status !== 'given') return 'todo';
      if (assessPending.some((p) => ATTENTION_CODES.includes(p.code))) return 'attention';
      if (section === 'followup') {
        const answered = s.complaints.every((c) => Object.keys(c.complaint.answers).length > 0) && !!enc.followUp?.adverseStatus;
        return answered && !assessPending.length ? 'done' : 'progress';
      }
      // eligibility is the first recorded step of every assessment; pre-filled entry answers do not count
      const touched = active.some((c) => !!c.eligibility);
      return assessPending.length ? (touched ? 'progress' : 'todo') : 'done';
    }
    case 'summary':
      if (enc.consent?.status !== 'given' || !active.length) return 'todo';
      return s.pending.length === 0 ? 'done' : 'todo';
    case 'review': {
      // voided decisions stay in the record; they need attention only until a current decision replaces them
      if (enc.type === 'initial' && s.complaints.length && s.complaints.every((c) => c.plan.status === 'approved_demo_only')) return 'done';
      if (s.pending.some((p) => p.code === 'STALE_DECISION')) return 'attention';
      if (enc.type === 'followup') return enc.decisions.some((d) => d.type === 'followup_outcome') ? 'done' : 'todo';
      return enc.decisions.length || enc.sync.state === 'awaiting_review' ? 'progress' : 'todo';
    }
    case 'plan':
      if (s.complaints.length && s.complaints.every((c) => c.plan.status === 'approved_demo_only')) return 'done';
      return s.complaints.some((c) => c.plan.status !== 'blocked') ? 'progress' : 'todo';
    case 'export':
      if (enc.sync.state === 'received_by_server') return 'done';
      if (['sync_conflict', 'auth_expired', 'sync_failed'].includes(enc.sync.state)) return 'attention';
      return enc.sync.state === 'queued_for_sync' ? 'progress' : 'todo';
  }
}

export function stageStatus(enc: Encounter, s: EncounterSummary, stage: StageId): Status {
  const st = stageSections(enc.type)[stage].map((x) => sectionStatus(enc, s, x));
  if (st.includes('attention')) return 'attention';
  if (st.every((x) => x === 'done')) return 'done';
  if (st.some((x) => x !== 'todo')) return 'progress';
  return 'todo';
}

export type NextAction =
  | { kind: 'go'; to: Section; labelKey: string; sectionLabel?: boolean }
  | { kind: 'markReady' }
  | { kind: 'home' }
  | { kind: 'hint'; key: string };

/** The one primary action shown in the bottom bar. Answers themselves always stay in the content. */
export function nextAction(enc: Encounter, s: EncounterSummary, section: Section): NextAction {
  const active = enc.complaints.filter((c) => !c.withdrawn);
  const fu = enc.type === 'followup';
  switch (section) {
    case 'start':
      if (enc.consent?.status !== 'given') return { kind: 'hint', key: 'flow.consentToContinue' };
      return fu ? { kind: 'go', to: 'followup', labelKey: 'stage.followup', sectionLabel: true } : { kind: 'go', to: 'complaints', labelKey: 'tab.complaints', sectionLabel: true };
    case 'complaints':
      return active.length ? { kind: 'go', to: 'history', labelKey: 'tab.history', sectionLabel: true } : { kind: 'hint', key: 'flow.addLocation' };
    case 'history':
      return { kind: 'go', to: 'assess', labelKey: 'tab.assess', sectionLabel: true };
    case 'assess': {
      // an unacknowledged concern is the next thing to act on; other navigation stays available
      if (s.complaints.some((c) => c.alerts.some((a) => !enc.alertAcks[a.key]))) return { kind: 'hint', key: 'flow.resolveFirst' };
      const asking = s.complaints.some((c) => c.ev.current && ['ask', 'eligibility', 'switch'].includes(c.ev.current.type));
      return asking ? { kind: 'hint', key: 'flow.answerToContinue' } : { kind: 'go', to: 'summary', labelKey: 'tab.summary', sectionLabel: true };
    }
    case 'followup':
      return { kind: 'go', to: 'summary', labelKey: 'tab.summary', sectionLabel: true };
    case 'summary': {
      const reviewed = enc.sync.state !== 'saved_on_device' || enc.decisions.length > 0 || s.complaints.some((c) => c.plan.status === 'approved_demo_only');
      return reviewed ? { kind: 'go', to: 'review', labelKey: 'flow.openReview' } : { kind: 'markReady' };
    }
    case 'review':
      return fu ? { kind: 'go', to: 'export', labelKey: 'tab.export', sectionLabel: true } : { kind: 'go', to: 'plan', labelKey: 'flow.viewPlan' };
    case 'plan':
      return { kind: 'go', to: 'export', labelKey: 'tab.export', sectionLabel: true };
    case 'export':
      return { kind: 'home' };
  }
}

/** Fills {name} placeholders in a translated string. */
export const fill = (str: string, vars: Record<string, string | number>) => str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

/** "1 open item" / "3 open items" in the current language. */
export const itemsText = (n: number, tr: (k: string) => string) => (n === 1 ? tr('flow.item1') : fill(tr('flow.items'), { n }));
