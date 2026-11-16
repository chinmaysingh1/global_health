// Deterministic protocol engine. A pure function of (protocol, complaint state, context):
// it never mutates, never calls AI, and never defaults an unanswered branch to "no".
import type { Capability, Pathway, Protocol, ProtocolNode, Urgency } from '../protocol/schema';
import type { AnswerRecord, Complaint } from '../store/types';

export type HaltReason =
  | 'ESCALATED' // a safety outcome stops routine progression
  | 'SWITCHED' // pathway switch to a linked complaint
  | 'SWITCH_LOOP' // would re-enter a pathway already in the referral chain
  | 'NEEDS_REVIEW' // unknown / declined answer on a branching question
  | 'EXAM_PENDING' // examination not performed, or performed without the required capability
  | 'REOPEN_SAFETY' // the source points back to a Stage 1 check
  | 'CYCLE' // the walk returned to a node it already passed
  | 'NO_SOURCE_BRANCH' // the source has no arrow for this situation
  | 'REFERRAL_END' // ends in a referral box that is not a working diagnosis
  | 'AGE_UNKNOWN';

export interface Alert {
  key: string; // `${complaintId}|${outcomeNodeId}|${variant}`
  complaintId: string;
  checkId: string | null;
  outcomeId: string;
  urgency: Urgency | 'emergency';
  headline: string;
  timing: string;
  actionText: string;
  exerciseRestriction: string;
  assessmentMayContinue: boolean;
  late: boolean; // disclosed outside the normal order
  gatedNext: string[];
}

export interface TraceStep {
  nodeId: string;
  kind: ProtocolNode['kind'];
  answer?: AnswerRecord;
  optionId?: string;
}

export interface SafetyItem {
  checkId: string;
  reason: 'not_asked' | 'unknown' | 'declined' | 'not_performed' | 'history_only_exam_capability_missing';
  missingCapabilities: Capability[];
}

export interface ComplaintEval {
  complaintId: string;
  pathway: Pathway | null;
  trace: TraceStep[];
  current:
    | { type: 'eligibility' }
    | { type: 'ask'; nodeId: string }
    | { type: 'switch'; nodeId: string; checkId: string }
    | { type: 'baseline' }
    | null;
  halt: { reason: HaltReason; nodeId: string; refs: string[]; detail?: string } | null;
  alerts: Alert[];
  safety: {
    state: 'not_started' | 'in_progress' | 'concern_raised' | 'incomplete' | 'no_concern_reported';
    incomplete: SafetyItem[];
    positives: string[];
    answered: number;
    total: number;
  };
  eligibility: 'not_recorded' | 'established' | 'unclear';
  candidate: { diagnosisId: string; workingDiagnosis: boolean; exerciseGroups: string[] } | null;
  doseLevel: 'HI' | 'MD' | 'LO' | null;
  doseNodeId: string | null;
  switchRequests: { target: Pathway; from: string; optionId: string }[];
  unsupportedReferrals: { from: string; optionId: string; note?: string }[];
  contradictions: { code: 'AGE_MISMATCH' | 'DENIED_BUT_REDIRECTED'; nodeId: string; detail: string }[];
  staleAnswers: string[];
  paediatric: boolean;
}

const URGENCY_RANK: Record<string, number> = { emergency: 0, urgent: 1, soon: 2, refer: 3, switch: 4 };
const CHOICE_KINDS = new Set(['triage_question', 'triage_decision', 'question', 'exam', 'irritability']);

/** Capabilities a check/exam needs beyond basic training. */
export function requiredCapabilities(node: ProtocolNode): Capability[] {
  return node.capabilities.filter((c) => c !== 'trained');
}
export function missingCapabilities(node: ProtocolNode, held: Capability[]): Capability[] {
  return requiredCapabilities(node).filter((c) => !held.includes(c));
}

export interface EvalContext {
  patientAge: number | null;
  /** Pathways already visited along the referral chain that led to this complaint. */
  originChain: Pathway[];
}

export function evaluateComplaint(protocol: Protocol, complaint: Complaint, ctx: EvalContext): ComplaintEval {
  const nodes = protocol.nodes;
  const answers = complaint.answers;
  const paedBelow = (protocol as any).paediatricAgeBelow ?? 18;
  const ev: ComplaintEval = {
    complaintId: complaint.id,
    pathway: null,
    trace: [],
    current: null,
    halt: null,
    alerts: [],
    safety: { state: 'not_started', incomplete: [], positives: [], answered: 0, total: 0 },
    eligibility: complaint.eligibility ? complaint.eligibility.status : 'not_recorded',
    candidate: null,
    doseLevel: null,
    doseNodeId: null,
    switchRequests: [],
    unsupportedReferrals: [],
    contradictions: [],
    staleAnswers: [],
    paediatric: ctx.patientAge !== null && ctx.patientAge < paedBelow,
  };
  const visited = new Set<string>();
  const onPath = new Set<string>();
  let passedSafety = false;

  const pushAlert = (outcome: ProtocolNode, checkId: string | null, late: boolean, variant = '', override?: Partial<Alert>) => {
    const o = outcome.outcome!;
    const key = `${complaint.id}|${outcome.id}|${variant}`;
    if (ev.alerts.some((a) => a.key === key)) return;
    ev.alerts.push({
      key,
      complaintId: complaint.id,
      checkId,
      outcomeId: outcome.id,
      urgency: o.urgency,
      headline: o.headline,
      timing: o.timing,
      actionText: outcome.sourceText.split('\n').slice(1).join('\n'),
      exerciseRestriction: o.exerciseRestriction,
      assessmentMayContinue: o.assessmentMayContinue,
      late,
      gatedNext: o.gatedNext,
      ...override,
    });
  };

  /** Resolve a SWITCH outcome. Returns 'continue' when the current pathway may go on. */
  const handleSwitch = (outcome: ProtocolNode, checkId: string | null): 'ask' | 'halt' | 'continue' => {
    const sw = answers[outcome.id];
    if (!sw || !sw.optionId) {
      ev.current = { type: 'switch', nodeId: outcome.id, checkId: checkId ?? outcome.id };
      return 'ask';
    }
    onPath.add(outcome.id);
    const opt = outcome.outcome!.switchOptions.find((o) => o.id === sw.optionId) as any;
    if (!opt) {
      ev.halt = { reason: 'NO_SOURCE_BRANCH', nodeId: outcome.id, refs: [] };
      return 'halt';
    }
    if (opt.target === 'emergency') {
      pushAlert(outcome, checkId, false, opt.id, {
        urgency: 'emergency',
        headline: 'EMERGENCY — SAME DAY',
        timing: 'SAME DAY',
        exerciseRestriction: 'no_exercise',
        assessmentMayContinue: false,
      });
      ev.halt = { reason: 'ESCALATED', nodeId: outcome.id, refs: [] };
      return 'halt';
    }
    if (opt.target === 'unsupported') {
      ev.unsupportedReferrals.push({ from: outcome.id, optionId: opt.id, note: opt.note });
      pushAlert(outcome, checkId, false, opt.id, { urgency: 'refer', assessmentMayContinue: !!opt.continueCurrent });
      if (opt.continueCurrent) return 'continue';
      ev.halt = { reason: 'ESCALATED', nodeId: outcome.id, refs: [] };
      return 'halt';
    }
    const target = opt.target as Pathway;
    if (ctx.originChain.includes(target) || ev.pathway === target) {
      ev.halt = { reason: 'SWITCH_LOOP', nodeId: outcome.id, refs: [], detail: target };
      return 'halt';
    }
    ev.switchRequests.push({ target, from: outcome.id, optionId: opt.id });
    if (opt.continueCurrent) return 'continue';
    ev.halt = { reason: 'SWITCHED', nodeId: outcome.id, refs: [], detail: target };
    return 'halt';
  };

  let cur: string | null = complaint.entryNode ?? protocol.triage[complaint.board].start;
  walk: while (cur) {
    const node: ProtocolNode | undefined = nodes[cur];
    if (!node) {
      ev.halt = { reason: 'NO_SOURCE_BRANCH', nodeId: cur, refs: [], detail: 'unknown node' };
      break;
    }
    if (visited.has(cur)) {
      ev.halt = { reason: 'CYCLE', nodeId: cur, refs: [] };
      break;
    }
    visited.add(cur);
    onPath.add(cur);
    const step: TraceStep = { nodeId: cur, kind: node.kind };
    ev.trace.push(step);
    if (node.pathway && !ev.pathway) ev.pathway = node.pathway;

    if (node.kind === 'start' || (complaint.entryNode === cur && node.kind === 'pathway_header')) {
      // Amendment A01: eligibility is asked explicitly, never assumed.
      if (!complaint.eligibility) {
        ev.current = { type: 'eligibility' };
        break;
      }
      cur = node.next;
      continue;
    }

    if (CHOICE_KINDS.has(node.kind)) {
      const ans = answers[cur];
      if (!ans) {
        ev.current = { type: 'ask', nodeId: cur };
        break;
      }
      step.answer = ans;
      if (ans.status === 'not_performed') {
        ev.halt = { reason: 'EXAM_PENDING', nodeId: cur, refs: [], detail: ans.reason };
        break;
      }
      if (ans.status !== 'present' || !ans.optionId) {
        ev.halt = { reason: 'NEEDS_REVIEW', nodeId: cur, refs: [], detail: ans.status };
        break;
      }
      if ((node.kind === 'exam' || node.kind === 'triage_decision') && missingCapabilities(node, ans.capabilities).length) {
        ev.halt = { reason: 'EXAM_PENDING', nodeId: cur, refs: [], detail: 'result recorded without the required capability' };
        break;
      }
      const opt = node.options.find((o) => o.id === ans.optionId);
      step.optionId = ans.optionId;
      if (!opt) {
        ev.halt = { reason: 'NO_SOURCE_BRANCH', nodeId: cur, refs: [] };
        break;
      }
      if (opt.ageRule && ctx.patientAge !== null) {
        const { min, max } = opt.ageRule;
        if ((min !== undefined && ctx.patientAge < min) || (max !== undefined && ctx.patientAge > max)) {
          ev.contradictions.push({ code: 'AGE_MISMATCH', nodeId: cur, detail: `recorded age ${ctx.patientAge} does not fit the selected answer` });
        }
      }
      const targetIsSafety = opt.next ? nodes[opt.next]?.kind === 'safety_check' : false;
      if (opt.redirect.length || targetIsSafety) {
        const refs = [...new Set([...(targetIsSafety ? [opt.next!] : []), ...opt.redirect])];
        for (const r of refs) {
          if (answers[r]?.status === 'denied') {
            ev.contradictions.push({ code: 'DENIED_BUT_REDIRECTED', nodeId: r, detail: `${cur} points back to this check, which is recorded as denied` });
          }
        }
        ev.halt = { reason: 'REOPEN_SAFETY', nodeId: cur, refs };
        break;
      }
      if (!opt.next) {
        ev.halt = { reason: 'NO_SOURCE_BRANCH', nodeId: cur, refs: [] };
        break;
      }
      cur = opt.next;
      continue;
    }

    switch (node.kind) {
      case 'safety_check': {
        ev.safety.state = 'in_progress';
        const ans = answers[cur];
        if (!ans) {
          ev.current = { type: 'ask', nodeId: cur };
          break walk;
        }
        step.answer = ans;
        if (ans.status === 'present') {
          const outcome = nodes[node.yes!];
          if (outcome.outcome!.urgency === 'switch') {
            const r = handleSwitch(outcome, cur);
            if (r !== 'continue') break walk;
            cur = node.no;
            continue;
          }
          pushAlert(outcome, cur, false);
          if (outcome.outcome!.assessmentMayContinue) {
            cur = node.no;
            continue;
          }
          ev.halt = { reason: 'ESCALATED', nodeId: outcome.id, refs: [cur] };
          break walk;
        }
        cur = node.no;
        continue;
      }
      case 'safety_pass':
        passedSafety = true;
        cur = node.next;
        continue;
      case 'note': {
        const routing = (node as any).ageRouting as { threshold: number; gte: string; lt: string } | undefined;
        if (routing) {
          if (ctx.patientAge === null) {
            ev.halt = { reason: 'AGE_UNKNOWN', nodeId: cur, refs: [] };
            break walk;
          }
          cur = ctx.patientAge >= routing.threshold ? routing.gte : routing.lt;
          continue;
        }
        if (!node.next) {
          ev.halt = { reason: 'NO_SOURCE_BRANCH', nodeId: cur, refs: [] };
          break walk;
        }
        cur = node.next;
        continue;
      }
      case 'diagnosis': {
        ev.candidate = { diagnosisId: cur, workingDiagnosis: !!node.workingDiagnosis, exerciseGroups: node.exerciseGroups };
        if (!node.workingDiagnosis) {
          ev.halt = { reason: 'REFERRAL_END', nodeId: cur, refs: [] };
          break walk;
        }
        cur = protocol.pathways[node.pathway!].measureStart; // amendment A04
        continue;
      }
      case 'escalation': {
        if (node.outcome!.urgency === 'switch') {
          const r = handleSwitch(node, null);
          if (r === 'continue') ev.halt = { reason: 'NO_SOURCE_BRANCH', nodeId: cur, refs: [] };
          break walk;
        }
        pushAlert(node, null, false);
        ev.halt = { reason: 'ESCALATED', nodeId: cur, refs: [] };
        break walk;
      }
      case 'dose':
        ev.doseLevel = node.doseLevel!;
        ev.doseNodeId = cur;
        ev.current = { type: 'baseline' };
        break walk;
      default:
        if (!node.next) {
          ev.halt = { reason: 'NO_SOURCE_BRANCH', nodeId: cur, refs: [] };
          break walk;
        }
        cur = node.next;
    }
  }

  // ---- Safety facts apply immediately, wherever the walk currently is (late disclosures). ----
  if (ev.pathway) {
    const def = protocol.pathways[ev.pathway];
    ev.safety.total = def.safetyChecks.length;
    for (const checkId of def.safetyChecks) {
      const node = nodes[checkId];
      const ans = answers[checkId];
      onPath.add(checkId);
      if (!ans) {
        if (passedSafety) ev.safety.incomplete.push({ checkId, reason: 'not_asked', missingCapabilities: [] });
        continue;
      }
      ev.safety.answered++;
      if (ans.status === 'present') {
        ev.safety.positives.push(checkId);
        const outcome = nodes[node.yes!];
        const already = ev.alerts.some((a) => a.outcomeId === outcome.id);
        if (!already && outcome.outcome!.urgency !== 'switch') pushAlert(outcome, checkId, !visited.has(checkId) || ans.via === 'late_concern');
        if (!already && outcome.outcome!.urgency === 'switch' && !visited.has(checkId)) {
          // late switch concern: needs the follow-up choice before anything else proceeds
          const r = handleSwitch(outcome, checkId);
          if (r === 'ask') ev.halt = null;
        }
        if (visited.has(checkId) && ans.via === 'late_concern') ev.alerts.forEach((a) => a.checkId === checkId && (a.late = true));
      } else if (ans.status === 'denied') {
        const missing = missingCapabilities(node, ans.capabilities);
        if (missing.length) ev.safety.incomplete.push({ checkId, reason: 'history_only_exam_capability_missing', missingCapabilities: missing });
      } else if (ans.status === 'unknown' || ans.status === 'declined' || ans.status === 'not_performed') {
        ev.safety.incomplete.push({ checkId, reason: ans.status, missingCapabilities: [] });
      } else {
        ev.safety.incomplete.push({ checkId, reason: 'unknown', missingCapabilities: [] });
      }
    }
    // A late positive on a check the walk already passed must stop routine progression too.
    const blocking = ev.alerts.find((a) => !a.assessmentMayContinue);
    if (blocking && (!ev.halt || !['ESCALATED', 'SWITCHED', 'SWITCH_LOOP'].includes(ev.halt.reason))) {
      ev.halt = { reason: 'ESCALATED', nodeId: blocking.outcomeId, refs: blocking.checkId ? [blocking.checkId] : [] };
      if (ev.current?.type !== 'switch') ev.current = null;
    }
    if (ev.safety.positives.length) ev.safety.state = 'concern_raised';
    else if (passedSafety) ev.safety.state = ev.safety.incomplete.length ? 'incomplete' : 'no_concern_reported';
    else ev.safety.state = ev.safety.answered ? 'in_progress' : 'not_started';
  }
  ev.alerts.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);

  // Answers that are no longer on the active path are kept for audit but marked stale.
  // (Before eligibility is recorded nothing has been walked yet, so nothing can be stale.)
  ev.staleAnswers = ev.current?.type === 'eligibility' ? [] : Object.keys(answers).filter((id) => !onPath.has(id));
  return ev;
}

/** Pathways already visited along the chain of pathway switches that led to this complaint. */
export function originChain(complaints: Complaint[], complaint: Complaint, evals: Map<string, ComplaintEval>): Pathway[] {
  const chain: Pathway[] = [];
  let c: Complaint | undefined = complaint;
  const seen = new Set<string>();
  while (c?.origin && !seen.has(c.id)) {
    seen.add(c.id);
    const parent = complaints.find((x) => x.id === c!.origin!.complaintId);
    const p = parent ? evals.get(parent.id)?.pathway : null;
    if (p) chain.push(p);
    c = parent;
  }
  return chain;
}

export function evaluateEncounterComplaints(
  protocol: Protocol,
  complaints: Complaint[],
  patientAge: number | null,
): Map<string, ComplaintEval> {
  const evals = new Map<string, ComplaintEval>();
  // parents first so that origin chains can be resolved
  const ordered = [...complaints].sort((a, b) => Number(!!a.origin) - Number(!!b.origin));
  for (const c of ordered) {
    if (c.withdrawn) continue;
    evals.set(c.id, evaluateComplaint(protocol, c, { patientAge, originChain: originChain(complaints, c, evals) }));
  }
  return evals;
}
