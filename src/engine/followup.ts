// Follow-up: like-for-like measurement comparison and the source's week 1 / 4 / 12 rules.
// The engine reports what the source says should happen next; it never declares a diagnosis
// "confirmed" from improvement (amendment A03).
import type { Measure, Pathway, Protocol, ProtocolNode } from '../protocol/schema';
import type { AnswerRecord, MeasureRecord } from '../store/types';

export interface MeasureComparison {
  measureId: string;
  side?: 'left' | 'right';
  item?: string; // PSFS task
  baseline: number | boolean | string | null;
  current: number | boolean | string | null;
  delta: number | null;
  percent: number | null;
  direction: Measure['direction'];
  trend: 'better' | 'worse' | 'same' | 'not_comparable';
  reason?: string;
}

function cmp(def: Measure, base: number | undefined, cur: number | undefined, extra: Partial<MeasureComparison>): MeasureComparison {
  if (typeof base !== 'number' || typeof cur !== 'number') {
    return { measureId: def.id, baseline: base ?? null, current: cur ?? null, delta: null, percent: null, direction: def.direction, trend: 'not_comparable', reason: 'missing at one visit', ...extra };
  }
  const delta = cur - base;
  const percent = base !== 0 ? Math.round((delta / Math.abs(base)) * 1000) / 10 : null;
  let trend: MeasureComparison['trend'] = 'same';
  if (def.direction === 'none') trend = 'not_comparable';
  else if (delta !== 0) trend = (delta < 0) === (def.direction === 'lower_better') ? 'better' : 'worse';
  return { measureId: def.id, baseline: base, current: cur, delta, percent, direction: def.direction, trend, ...extra };
}

/** Only identical measures recorded at both visits are compared. PSFS is compared task by task. */
export function compareMeasures(
  defs: Measure[],
  baseline: Record<string, MeasureRecord>,
  current: Record<string, MeasureRecord>,
): MeasureComparison[] {
  const out: MeasureComparison[] = [];
  for (const def of defs) {
    const b = baseline[def.id];
    const c = current[def.id];
    if (def.type === 'not_captured') continue;
    if (!b || !c || b.status !== 'recorded' || c.status !== 'recorded') {
      out.push({ measureId: def.id, baseline: null, current: null, delta: null, percent: null, direction: def.direction, trend: 'not_comparable', reason: !b || b.status !== 'recorded' ? 'no baseline value' : 'not recorded at this visit' });
      continue;
    }
    if (def.type === 'psfs') {
      for (const task of b.psfs ?? []) {
        const match = (c.psfs ?? []).find((t) => t.task.trim().toLowerCase() === task.task.trim().toLowerCase());
        out.push(cmp(def, task.score, match?.score, { item: task.task, reason: match ? undefined : 'task not rated at this visit' }));
      }
      continue;
    }
    if (def.bilateral) {
      out.push(cmp(def, b.left, c.left, { side: 'left' }));
      out.push(cmp(def, b.right, c.right, { side: 'right' }));
      continue;
    }
    if (def.type === 'number' || def.type === 'external_score') {
      out.push(cmp(def, typeof b.value === 'number' ? b.value : undefined, typeof c.value === 'number' ? c.value : undefined, {}));
      continue;
    }
    out.push({ measureId: def.id, baseline: b.value ?? null, current: c.value ?? null, delta: null, percent: null, direction: 'none', trend: b.value === c.value ? 'same' : 'not_comparable' });
  }
  return out;
}

export interface FollowUpOutcome {
  visit: 'week1' | 'week4' | 'week12';
  questionId: string;
  state: 'unanswered' | 'needs_review' | 'resolved';
  optionId?: string;
  optionLabel?: string;
  actionNode: ProtocolNode | null;
  /** What the source says to do. Any dose change is a proposal for the clinician. */
  proposal: 'keep_level' | 'step_down_and_recheck' | 'level_up' | 'recheck_before_continuing' | 'continue_self_management' | 'revise_or_refer' | null;
  rerunSafetyScreen: boolean;
  requiresClinician: boolean;
  refs: string[];
}

export function evaluateFollowUp(
  protocol: Protocol,
  pathway: Pathway,
  visit: 'week1' | 'week4' | 'week12',
  answer: AnswerRecord | undefined,
): FollowUpOutcome {
  const q = protocol.nodes[protocol.pathways[pathway].followUp[visit]];
  const base: FollowUpOutcome = { visit, questionId: q.id, state: 'unanswered', actionNode: null, proposal: null, rerunSafetyScreen: false, requiresClinician: false, refs: [] };
  if (!answer) return base;
  if (answer.status !== 'present' || !answer.optionId) return { ...base, state: 'needs_review', requiresClinician: true };
  const opt = q.options.find((o) => o.id === answer.optionId);
  if (!opt) return { ...base, state: 'needs_review', requiresClinician: true };
  const next = opt.next ? protocol.nodes[opt.next] : null;
  const out: FollowUpOutcome = { ...base, state: 'resolved', optionId: opt.id, optionLabel: opt.label, actionNode: next, refs: opt.textRefs.map((r) => `${q.source.board}:${r}`) };
  const text = `${opt.label}\n${next?.kind === 'followup_action' ? next.sourceText : ''}`;
  if (visit === 'week1') {
    const stepDown = /step down|hold or step down/i.test(opt.label);
    out.proposal = stepDown ? 'step_down_and_recheck' : 'keep_level';
    out.requiresClinician = stepDown;
  } else if (visit === 'week4') {
    if (next?.kind === 'followup_action' && /LEVEL UP/.test(next.title)) {
      out.proposal = 'level_up';
      out.requiresClinician = true; // a dose increase is approved, not automatic
    } else {
      out.proposal = 'recheck_before_continuing';
      out.requiresClinician = true;
    }
  } else {
    const better = /^Yes/i.test(opt.label);
    out.proposal = better ? 'continue_self_management' : 'revise_or_refer';
    out.requiresClinician = !better;
  }
  out.rerunSafetyScreen = /re-run the Stage 1 safety screen|re-screen|Stage 1 checks/i.test(text);
  return out;
}

/** Measures that apply at a visit given the dose level (HIGH irritability => reduced set, per source). */
export function applicableMeasures(protocol: Protocol, pathway: Pathway, doseLevel: 'HI' | 'MD' | 'LO' | null): { def: Measure; applicable: boolean }[] {
  return protocol.measures
    .filter((m) => m.pathway === pathway)
    .map((def) => ({ def, applicable: doseLevel !== 'HI' || def.inLimitedSet }));
}
