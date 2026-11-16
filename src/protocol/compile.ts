// Compiles the frozen source snapshot + the reviewed overlay into the executable protocol
// and a ledger that accounts for every source node and connector. Pure: no file access.
import type { SourcePack, SourceNode, SourceEdge } from './sourcePack';
import {
  zProtocol,
  type Board,
  type Capability,
  type LedgerEntry,
  type NodeKind,
  type Option,
  type OutcomePolicy,
  type Pathway,
  type Protocol,
  type ProtocolNode,
  type ReviewStatus,
} from './schema';

export interface Overlay {
  protocolVersion: string;
  outcomeOverrides: Record<string, Partial<OutcomePolicy> & { note?: string }>;
  switches: Record<string, { id: string; labelKey: string; target: string; note?: string; continueCurrent?: boolean }[]>;
  triageDecisions: Record<string, { id: string; labelKey: string; next: string }[]>;
  triageCapabilities: Record<string, Capability[]>;
  ageRules: Record<string, { min?: number; max?: number }>;
  noteRouting: Record<string, { kind: 'age'; threshold: number; gte: string; lt: string }>;
  paediatricAgeBelow: number;
  measures: any[];
  amendments: any[];
}

export interface CompileResult {
  protocol: Protocol;
  ledger: LedgerEntry[];
  issues: string[]; // structural findings worth a reviewer's attention
}

const PREFIX_PATHWAY: Record<string, Pathway> = { K: 'knee', H: 'hip', L: 'low_back', N: 'neck' };
const DRAFT: ReviewStatus = 'source_draft_unreviewed';
const PROPOSED: ReviewStatus = 'proposed_amendment_unreviewed';

const CODE_RE = /\b(?:[KHLN](?:[QTDNX])?\d+[a-z]?|[LN]X-(?:[A-F]|CORE)|E[1-8])\b/g;
const QUALIFIED_RE = /^(ASK|CHECK|NEXT STEP|EVIDENCE|NOTE)\b([^:]{0,80}):\s*(.*)$/;
const FIELD_RE = /^([A-Z][A-Z0-9 ()\-—–,&/’'·]{1,44}?):\s*(.*)$/;

function kindForCode(code: string): { kind: NodeKind | 'option' | 'section_link'; pathway: Pathway | null; stage: number } {
  const p = PREFIX_PATHWAY[code[0]] ?? null;
  if (code === 'S2') return { kind: 'section_link', pathway: null, stage: 2 };
  if (code === 'G-START') return { kind: 'start', pathway: null, stage: 0 };
  if (code === 'G-Q0') return { kind: 'triage_question', pathway: null, stage: 0 };
  if (/^G-A0[A-Z]$/.test(code)) return { kind: 'option', pathway: null, stage: 0 };
  if (code === 'G-N0B') return { kind: 'triage_decision', pathway: null, stage: 0 };
  if (code === 'G-KNEE') return { kind: 'pathway_header', pathway: 'knee', stage: 1 };
  if (code === 'G-HIP') return { kind: 'pathway_header', pathway: 'hip', stage: 1 };
  if (code === 'G-LB') return { kind: 'pathway_header', pathway: 'low_back', stage: 1 };
  if (code === 'G-NK') return { kind: 'pathway_header', pathway: 'neck', stage: 1 };
  let m: RegExpMatchArray | null;
  if ((m = code.match(/^[KHLN]S([1-4])$/))) return { kind: 'stage_header', pathway: p, stage: Number(m[1]) };
  if (/^[KHLN]\d+$/.test(code)) return { kind: 'safety_check', pathway: p, stage: 1 };
  if (/^[KHLN]\d+Y$/.test(code)) return { kind: 'safety_outcome', pathway: p, stage: 1 };
  if (/^[KHLN]PASS$/.test(code)) return { kind: 'safety_pass', pathway: p, stage: 1 };
  if (/^[KHLN]Q\d+$/.test(code)) return { kind: 'question', pathway: p, stage: 2 };
  if (/^[KHLN]T\d+$/.test(code)) return { kind: 'exam', pathway: p, stage: 2 };
  if (/^[KHLN][QT]\d+[a-z]$/.test(code)) return { kind: 'option', pathway: p, stage: 2 };
  if (/^[KHLN]D\d+$/.test(code)) return { kind: 'diagnosis', pathway: p, stage: 2 };
  if (/^[KHLN]N\d+$/.test(code)) return { kind: 'note', pathway: p, stage: 2 };
  if (/^[KHLN]X\d+$/.test(code)) return { kind: 'escalation', pathway: p, stage: 2 };
  if (/^[LN]X-[A-F]$/.test(code)) return { kind: 'exercise_group', pathway: p, stage: 3 };
  if (/^[LN]X-CORE$/.test(code)) return { kind: 'core_programme', pathway: p, stage: 3 };
  if ((m = code.match(/^[KHLN]S([34])-(HI|MD|LO)$/))) return { kind: 'dose', pathway: p, stage: Number(m[1]) };
  if ((m = code.match(/^[KHLN]S([34])-(UP|NO)$/))) return { kind: 'followup_action', pathway: p, stage: Number(m[1]) };
  if ((m = code.match(/^[KHLN]S([34])-\d+[a-z]$/))) return { kind: 'option', pathway: p, stage: Number(m[1]) };
  if ((m = code.match(/^[KHLN]S([34])-\d+$/))) return { kind: 'battery', pathway: p, stage: Number(m[1]) }; // refined by title
  throw new Error(`Unrecognised source code pattern: ${code}`);
}

function refineMeasureKind(title: string): { kind: NodeKind; visit?: 'week1' | 'week4' | 'week12' } {
  if (/How irritable/i.test(title)) return { kind: 'irritability' };
  if (/CORE BASELINE BATTERY/i.test(title)) return { kind: 'battery' };
  if (/ADD-ON MODULE/i.test(title)) return { kind: 'module' };
  if (/WEEK 12/i.test(title)) return { kind: 'followup_question', visit: 'week12' };
  if (/WEEK 4/i.test(title)) return { kind: 'followup_question', visit: 'week4' };
  if (/WEEK 1\b/i.test(title)) return { kind: 'followup_question', visit: 'week1' };
  if (/STarT Back|Örebro/i.test(title)) return { kind: 'risk_tool' };
  throw new Error(`Cannot classify measure-stage node: ${title}`);
}

function parseFields(text: string): { title: string; fields: Record<string, string>; decision?: string } {
  const lines = text.split('\n');
  const title = lines[0].trim();
  const rest = lines.slice(1);
  let decision: string | undefined;
  const fields: Record<string, string> = {};
  let current = 'BODY';
  for (const raw of rest) {
    const line = raw.trimEnd();
    // "CHECK — Ottawa Knee Rule (any ONE item = positive): ..." keeps the base label as the key
    const q = line.match(QUALIFIED_RE);
    const m = q ? null : line.match(FIELD_RE);
    if (q) {
      current = q[1];
      const qualifier = q[2].trim();
      fields[current] = (fields[current] ? fields[current] + '\n' : '') + (qualifier ? `${qualifier}: ` : '') + q[3];
    } else if (m && !/^\d/.test(m[1])) {
      current = m[1].trim();
      fields[current] = (fields[current] ? fields[current] + '\n' : '') + m[2];
    } else if (line.trim() !== '') {
      fields[current] = (fields[current] ? fields[current] + '\n' : '') + line;
    }
  }
  return { title, fields, decision };
}

function parseWho(who: string | undefined): { capabilities: Capability[]; equipment: string[] } {
  const capabilities: Capability[] = [];
  const equipment: string[] = [];
  if (!who) return { capabilities, equipment };
  if (/anyone trained/i.test(who)) capabilities.push('trained');
  if (/basic kit/i.test(who)) {
    capabilities.push('basic_kit');
    const m = who.match(/basic kit\s*\(([^)]+)\)/i);
    if (m) equipment.push(...m[1].split(/,| and /).map((s) => s.trim()).filter(Boolean));
  }
  if (/physio-level/i.test(who)) capabilities.push('physio');
  return { capabilities, equipment };
}

function outcomePolicy(node: SourceNode, kind: NodeKind): OutcomePolicy {
  const lines = node.text.split('\n');
  const headline = lines[0].trim();
  const body = lines.slice(1).join('\n');
  let urgency: OutcomePolicy['urgency'];
  if (/^EMERGENCY/.test(headline)) urgency = 'emergency';
  else if (/^URGENT/.test(headline)) urgency = 'urgent';
  else if (/^SOON/.test(headline)) urgency = 'soon';
  else if (/^REFER/.test(headline)) urgency = 'refer';
  else if (/^SWITCH PATHWAY/.test(headline)) urgency = 'switch';
  else urgency = 'refer'; // overridden explicitly in the overlay (HX1, NX1)
  const timing = headline.includes('—') ? headline.split('—').slice(1).join('—').trim() : 'not stated';
  let exerciseRestriction: OutcomePolicy['exerciseRestriction'] = 'not_stated';
  let basis: OutcomePolicy['policyBasis'] = 'derived_default';
  if (/\bno (weight-bearing )?exercise\b/i.test(body)) {
    exerciseRestriction = 'no_exercise';
    basis = 'source_text';
  } else if (/(before any loading exercise|hold loading exercise|no loading exercise|no loaded|no running or impact)/i.test(body)) {
    exerciseRestriction = 'hold_loading_until_cleared';
    basis = 'source_text';
  } else if (urgency === 'emergency') exerciseRestriction = 'no_exercise'; // colour key: "no exercise"
  else if (urgency === 'urgent') exerciseRestriction = 'hold_loading_until_cleared';
  else if (urgency === 'refer') exerciseRestriction = 'medical_review_first';
  else if (urgency === 'soon') exerciseRestriction = 'gentle_only_pending_review';
  const assessmentMayContinue = /then continue down this list/i.test(body);
  void kind;
  return {
    urgency,
    headline,
    timing,
    assessmentMayContinue,
    exerciseRestriction,
    policyBasis: basis,
    gatedNext: [],
    switchOptions: [],
  };
}

export function compileProtocol(pack: SourcePack, overlay: Overlay): CompileResult {
  const issues: string[] = [];
  const ledger: LedgerEntry[] = [];
  const nodes: Record<string, ProtocolNode> = {};

  // ---- per-board code maps -----------------------------------------------------------------
  const codeOf = new Map<string, string>(); // `${board}|${nodeId}` -> code
  const sectionIds = new Set(pack.sections.map((s) => `${s.board}|${s.id}`));
  for (const e of pack.edges) {
    if (!e.label.includes('>')) continue;
    const [l, r] = e.label.split('>');
    for (const [nid, code] of [[e.from, l], [e.to, r]] as const) {
      if (sectionIds.has(`${e.board}|${nid}`)) continue; // section-anchored endpoint
      const key = `${e.board}|${nid}`;
      const prev = codeOf.get(key);
      if (prev && prev !== code) issues.push(`Code conflict for ${key}: ${prev} vs ${code}`);
      codeOf.set(key, code);
    }
  }
  const qid = (board: Board, nodeId: string): string => {
    const code = codeOf.get(`${board}|${nodeId}`);
    if (code) return `${board}:${code}`;
    return `${board}:n${nodeId.replace(':', '_')}`;
  };
  const srcByKey = new Map(pack.nodes.map((n) => [`${n.board}|${n.nodeId}`, n]));
  const outEdges = new Map<string, SourceEdge[]>();
  for (const e of pack.edges) {
    const k = `${e.board}|${e.from}`;
    if (!outEdges.has(k)) outEdges.set(k, []);
    outEdges.get(k)!.push(e);
  }

  // hip/knee exercise groups have no short code on the board; the text starts with E1..E8
  for (const n of pack.nodes) {
    const m = n.text.match(/^E([1-8]) /);
    if (n.board === 'hip_knee' && n.sectionName === 'Exercises by Group' && m) {
      codeOf.set(`${n.board}|${n.nodeId}`, `E${m[1]}`);
    }
  }

  const optionOwner = new Map<string, string>(); // option node key -> owner node id
  const implementedConnector = new Map<string, { canonical: string; note?: string; status: ReviewStatus }>();
  const markEdge = (e: SourceEdge, canonical: string, note?: string, status: ReviewStatus = DRAFT) =>
    implementedConnector.set(`${e.board}|${e.connectorId}`, { canonical, note, status });

  // ---- pass 1: build nodes -----------------------------------------------------------------
  for (const n of pack.nodes) {
    const key = `${n.board}|${n.nodeId}`;
    const code = codeOf.get(key) ?? null;
    const id = qid(n.board, n.nodeId);
    const source = { board: n.board, fileKey: n.fileKey, nodeId: n.nodeId, sectionId: n.sectionId, code };
    const { title, fields } = parseFields(n.text);
    const base = {
      id,
      source,
      title,
      sourceText: n.text,
      fields,
      reviewStatus: DRAFT,
      textRefs: [...new Set(n.text.split('\n').slice(1).join('\n').match(CODE_RE) ?? [])],
    };
    if (!code) {
      // supporting material: legends, glossary, citations, notes, safety modifiers, pain rules
      ledger.push({
        sourceId: `${n.fileKey}:${n.nodeId}`,
        board: n.board,
        nodeId: n.nodeId,
        section: n.sectionName,
        elementType: 'node',
        code: null,
        classification: 'supporting_reference',
        canonical: id,
        implementation: /SAFETY MODIFIERS/.test(title)
          ? 'history fields mod.* + blocker MODIFIER_SIGNOFF; shown in provenance view'
          : /PAIN RULE/.test(title)
            ? 'shown with the plan as source pain rule (pathway.painRuleNode)'
            : 'reference text available in the protocol review view (src/protocol/generated reference list)',
        tests: 'tests/protocol.build.test.ts (inventory + ledger completeness)',
        reviewStatus: DRAFT,
      });
      nodes[id] = { ...base, kind: 'note', pathway: null, stage: 0, capabilities: [], equipment: [], next: null, yes: null, no: null, options: [], exerciseGroups: [], related: [] } as ProtocolNode;
      (nodes[id] as any).reference = true;
      continue;
    }
    let k: ReturnType<typeof kindForCode>;
    if (/^E[1-8]$/.test(code)) k = { kind: 'exercise_group', pathway: null, stage: 3 };
    else k = kindForCode(code);
    if (k.kind === 'option') continue; // folded into the owner in pass 2
    let kind = k.kind as NodeKind;
    let visit: ProtocolNode['visit'];
    if (kind === 'battery') {
      const r = refineMeasureKind(title);
      kind = r.kind;
      visit = r.visit;
    }
    const who = parseWho(fields['WHO']);
    const node: ProtocolNode = {
      ...base,
      kind,
      pathway: k.pathway,
      stage: k.stage,
      capabilities: who.capabilities,
      whoText: fields['WHO']?.split('\n')[0],
      equipment: who.equipment,
      next: null,
      yes: null,
      no: null,
      options: [],
      exerciseGroups: [],
      related: [],
      visit,
    };
    if (kind === 'safety_check') {
      const lines = n.text.split('\n').map((l) => l.trim()).filter(Boolean);
      const last = lines[lines.length - 1];
      if (last.endsWith('?')) node.decision = last.replace(/^RULE:.*?\.\s*/, '');
      else issues.push(`${id}: safety check has no closing decision question`);
      // the WHO field swallowed the decision line as a continuation; keep only its first line
      if (node.fields['WHO']) node.fields['WHO'] = node.fields['WHO'].split('\n')[0];
    }
    if (kind === 'safety_outcome' || kind === 'escalation') {
      node.outcome = outcomePolicy(n, kind);
      const ov = overlay.outcomeOverrides[id];
      if (ov) {
        const { note: _n, ...rest } = ov;
        node.outcome = { ...node.outcome, ...rest, policyBasis: Object.keys(rest).length ? 'overlay_override' : node.outcome.policyBasis };
      }
      const sw = overlay.switches[id];
      if (sw) node.outcome.switchOptions = sw as any;
      else if (node.outcome.urgency === 'switch') issues.push(`${id}: SWITCH outcome without overlay switch options`);
    }
    if (kind === 'dose') node.doseLevel = code.slice(-2) as 'HI' | 'MD' | 'LO';
    if (kind === 'diagnosis') node.workingDiagnosis = /WORKING DIAGNOSIS/.test(title);
    if (kind === 'triage_decision') node.capabilities = overlay.triageCapabilities[id] ?? [];
    nodes[id] = node;
  }

  // ---- pass 2: transitions -----------------------------------------------------------------
  for (const n of pack.nodes) {
    const key = `${n.board}|${n.nodeId}`;
    const id = qid(n.board, n.nodeId);
    const node = nodes[id];
    if (!node || (node as any).reference) continue;
    const outs = outEdges.get(key) ?? [];
    const tgt = (e: SourceEdge) => qid(e.board, e.to);
    const tgtKind = (e: SourceEdge) => {
      const c = codeOf.get(`${e.board}|${e.to}`);
      if (!c) return 'reference';
      if (/^E[1-8]$/.test(c)) return 'exercise_group';
      return kindForCode(c).kind;
    };
    switch (node.kind) {
      case 'safety_check': {
        for (const e of outs) {
          if (tgtKind(e) === 'safety_outcome') { node.yes = tgt(e); markEdge(e, `${id}.yes`); }
          else { node.no = tgt(e); markEdge(e, `${id}.no`); }
        }
        if (!node.yes || !node.no) issues.push(`${id}: safety check missing yes/no edge`);
        break;
      }
      case 'triage_question':
      case 'question':
      case 'exam':
      case 'irritability':
      case 'followup_question': {
        for (const e of outs) {
          if (tgtKind(e) !== 'option') {
            issues.push(`${id}: outgoing edge to non-answer node ${tgt(e)}`);
            continue;
          }
          const on = srcByKey.get(`${e.board}|${e.to}`)!;
          const oid = tgt(e);
          const oOuts = outEdges.get(`${e.board}|${e.to}`) ?? [];
          const refs = [...new Set(on.text.match(CODE_RE) ?? [])];
          const opt: Option = {
            id: oid,
            source: { board: on.board, fileKey: on.fileKey, nodeId: on.nodeId, sectionId: on.sectionId, code: codeOf.get(`${on.board}|${on.nodeId}`)! },
            label: on.text,
            next: null,
            textRefs: refs,
            redirect: [],
            reviewStatus: DRAFT,
            ageRule: overlay.ageRules[oid],
          };
          if (oOuts.length === 1) {
            opt.next = tgt(oOuts[0]);
            markEdge(oOuts[0], `${oid}.next`);
            const targetCode = codeOf.get(`${oOuts[0].board}|${oOuts[0].to}`);
            const extra = refs.filter((r) => r !== targetCode);
            if (extra.length && /back to|STOP/i.test(on.text)) {
              issues.push(`${oid}: text mentions ${extra.join(', ')} but the connector goes only to ${targetCode}`);
              opt.redirect = extra.map((r) => `${on.board}:${r}`);
            }
          } else if (oOuts.length === 0) {
            if (refs.length && /→|back to/i.test(on.text)) {
              opt.redirect = refs.map((r) => `${on.board}:${r}`);
              issues.push(`${oid}: text-only redirect to ${refs.join(', ')} (no connector)`);
            }
          } else {
            issues.push(`${oid}: answer has ${oOuts.length} outgoing connectors`);
          }
          node.options.push(opt);
          optionOwner.set(`${e.board}|${e.to}`, id);
          markEdge(e, `${id}.options[${oid}]`);
        }
        node.options.sort((a, b) => a.id.localeCompare(b.id));
        if (node.kind === 'exam' && node.options.length === 1) {
          issues.push(`${id}: test has a single result box (no negative branch in source)`);
        }
        break;
      }
      case 'triage_decision': {
        const syn = overlay.triageDecisions[id] ?? [];
        const targets = new Set(outs.map(tgt));
        for (const s of syn) {
          if (!targets.has(s.next)) issues.push(`${id}: overlay option ${s.id} targets ${s.next} which has no source connector`);
          node.options.push({ id: `${id}#${s.id}`, source: null, label: s.labelKey, next: s.next, textRefs: [], redirect: [], reviewStatus: PROPOSED });
        }
        for (const e of outs) markEdge(e, `${id}.options`, 'target chosen by a synthesized option (overlay.triageDecisions)', PROPOSED);
        break;
      }
      case 'diagnosis': {
        for (const e of outs) {
          if (tgtKind(e) === 'exercise_group') { node.exerciseGroups.push(tgt(e)); markEdge(e, `${id}.exerciseGroups`); }
          else issues.push(`${id}: diagnosis edge to ${tgt(e)} not an exercise group`);
        }
        node.exerciseGroups.sort();
        break;
      }
      case 'safety_outcome':
      case 'escalation': {
        for (const e of outs) {
          if (node.outcome!.urgency === 'switch') markEdge(e, `${id}.outcome.switchOptions`, 'pathway switch handled by overlay.switches', PROPOSED);
          else { node.outcome!.gatedNext.push(tgt(e)); markEdge(e, `${id}.outcome.gatedNext`, 'requires documented medical clearance; never followed automatically', PROPOSED); }
        }
        break;
      }
      case 'note': {
        if (outs.length === 1) { node.next = tgt(outs[0]); markEdge(outs[0], `${id}.next`); }
        else if (outs.length > 1) issues.push(`${id}: note with ${outs.length} outgoing edges`);
        break;
      }
      default: {
        // linear nodes: start, headers, pass, dose, risk tool, battery, module, groups, core, actions
        if (node.kind === 'risk_tool') {
          // spine: risk tool points to both battery and module; battery carries the flow
          for (const e of outs) {
            if (nodes[tgt(e)]?.kind === 'battery') { node.next = tgt(e); markEdge(e, `${id}.next`); }
            else { node.related.push(tgt(e)); markEdge(e, `${id}.related`, 'add-on module shown alongside the battery'); }
          }
        } else if (node.kind === 'pathway_header' || outs.length <= 1) {
          for (const e of outs) { node.next = tgt(e); markEdge(e, `${id}.next`); }
        } else {
          issues.push(`${id}: ${node.kind} with ${outs.length} outgoing edges`);
        }
      }
    }
  }

  // note routing from overlay (e.g. KN2 by age)
  for (const [id, r] of Object.entries(overlay.noteRouting)) {
    if (!nodes[id]) throw new Error(`overlay.noteRouting: unknown node ${id}`);
    (nodes[id] as any).ageRouting = r;
  }

  // section-anchored connectors (hip/knee 10:1317, 10:1321)
  const measureStart: Partial<Record<Pathway, string>> = {};
  for (const e of pack.edges) {
    if (!sectionIds.has(`${e.board}|${e.from}`)) continue;
    const target = nodes[qid(e.board, e.to)];
    if (target?.kind === 'stage_header' && target.pathway) {
      measureStart[target.pathway] = target.id;
      markEdge(e, `pathways.${target.pathway}.measureStart`, 'section-level link: every working diagnosis in the section proceeds to this stage (amendment A04)', PROPOSED);
    } else issues.push(`Section-anchored connector ${e.connectorId} has an unexpected target`);
  }

  // ---- pathways ----------------------------------------------------------------------------
  const pathways: any = {};
  const byPathway = (p: Pathway, kind: NodeKind) => Object.values(nodes).filter((n) => n.pathway === p && n.kind === kind);
  const numeric = (id: string) => Number(id.replace(/\D+/g, ''));
  for (const p of ['knee', 'hip', 'low_back', 'neck'] as Pathway[]) {
    const header = byPathway(p, 'pathway_header')[0];
    const checks = byPathway(p, 'safety_check').sort((a, b) => numeric(a.source.code!) - numeric(b.source.code!));
    const pass = byPathway(p, 'safety_pass')[0];
    const stageHeaders = byPathway(p, 'stage_header');
    const stage2 = stageHeaders.find((h) => h.stage === 2)!;
    const ms = measureStart[p] ?? stageHeaders.find((h) => h.stage === 4)?.id;
    if (!ms) throw new Error(`No measure stage for ${p}`);
    const fu = byPathway(p, 'followup_question');
    const section = (title: RegExp) =>
      Object.values(nodes).find(
        (n) => (n as any).reference && title.test(n.title) && pack.nodes.find((s) => s.nodeId === n.source.nodeId && s.board === n.source.board)!.sectionName.toLowerCase().startsWith(header.title.split(' PATHWAY')[0].toLowerCase().replace('&', '&').slice(0, 4)),
      );
    pathways[p] = {
      pathway: p,
      board: header.source.board,
      header: header.id,
      safetyStart: checks[0].id,
      safetyChecks: checks.map((c) => c.id),
      safetyPass: pass.id,
      stage2Start: stage2.id,
      measureStart: ms,
      diagnoses: byPathway(p, 'diagnosis').sort((a, b) => numeric(a.source.code!) - numeric(b.source.code!)).map((d) => d.id),
      followUp: {
        week1: fu.find((f) => f.visit === 'week1')!.id,
        week4: fu.find((f) => f.visit === 'week4')!.id,
        week12: fu.find((f) => f.visit === 'week12')!.id,
      },
      modifiersNode: section(/^SAFETY MODIFIERS/)?.id ?? null,
      painRuleNode: section(/^PAIN RULES? FOR HOME EXERCISE/)?.id ?? null,
    };
    // safety check order must follow the no-chain
    for (let i = 0; i < checks.length; i++) {
      const expected = i + 1 < checks.length ? checks[i + 1].id : pass.id;
      if (checks[i].no !== expected) issues.push(`${checks[i].id}: 'no' edge goes to ${checks[i].no}, expected ${expected}`);
    }
  }

  // exercise-group pathways for the shared hip/knee library stay null (shared across pathways)
  const measures = overlay.measures.map((m) => {
    const { sourceCode, ...rest } = m;
    const board: Board = m.pathway === 'knee' || m.pathway === 'hip' ? 'hip_knee' : 'spine';
    const sourceNode = `${board}:${sourceCode}`;
    if (!nodes[sourceNode]) throw new Error(`overlay.measures: unknown source node ${sourceNode}`);
    return { ...rest, sourceNode, reviewStatus: PROPOSED };
  });

  const protocol = zProtocol.parse({
    schemaVersion: 1,
    protocolVersion: overlay.protocolVersion,
    clinicalApproval: 'none',
    snapshotDate: pack.snapshotDate,
    sources: pack.boards.map((b) => ({ board: b.board, fileKey: b.fileKey, rawSha256: b.rawSha256, revision: null })),
    nodes,
    pathways,
    triage: {
      hip_knee: { start: 'hip_knee:G-START', question: 'hip_knee:G-Q0' },
      spine: { start: 'spine:G-START', question: 'spine:G-Q0' },
    },
    measures,
    amendments: overlay.amendments,
  });
  // zod strips unknown keys; re-attach the two reviewed-layer extras kept outside the core schema
  for (const [id, r] of Object.entries(overlay.noteRouting)) (protocol.nodes[id] as any).ageRouting = r;
  for (const id of Object.keys(nodes)) if ((nodes[id] as any).reference) (protocol.nodes[id] as any).reference = true;
  (protocol as any).paediatricAgeBelow = overlay.paediatricAgeBelow;

  // ---- ledger for coded nodes and connectors -----------------------------------------------
  const testsFor = (kind: string) =>
    ({
      safety_check: 'tests/engine.safety.test.ts',
      safety_outcome: 'tests/engine.safety.test.ts',
      safety_pass: 'tests/engine.safety.test.ts',
      question: 'tests/engine.transitions.test.ts',
      exam: 'tests/engine.transitions.test.ts',
      option: 'tests/engine.transitions.test.ts',
      diagnosis: 'tests/engine.transitions.test.ts, tests/plan.test.ts',
      exercise_group: 'tests/plan.test.ts',
      followup_question: 'tests/followup.test.ts',
      followup_action: 'tests/followup.test.ts',
    })[kind] ?? 'tests/protocol.build.test.ts';
  for (const n of pack.nodes) {
    const key = `${n.board}|${n.nodeId}`;
    const code = codeOf.get(key);
    if (!code) continue;
    const id = qid(n.board, n.nodeId);
    const owner = optionOwner.get(key);
    const isOption = !nodes[id];
    const node = nodes[id];
    let classification: LedgerEntry['classification'] = 'implemented';
    let note: string | undefined;
    let implementation = isOption ? `option of ${owner}` : `protocol node (${node.kind}); src/engine/evaluate.ts`;
    if (isOption && !owner) {
      classification = 'blocked';
      note = 'answer box with no parent question connector';
      issues.push(`${id}: orphan answer node`);
    }
    if (!isOption && (node.kind === 'exercise_group' || node.kind === 'core_programme')) implementation = 'exercise library entry; src/engine/plan.ts (proposed plan, clinician approval required)';
    if (!isOption && (node.kind === 'module' || node.kind === 'battery' || node.kind === 'risk_tool')) implementation = 'measurement definition; overlay.measures + baseline screen';
    ledger.push({
      sourceId: `${n.fileKey}:${n.nodeId}`,
      board: n.board,
      nodeId: n.nodeId,
      section: n.sectionName,
      elementType: 'node',
      code,
      classification,
      canonical: id,
      implementation,
      tests: testsFor(isOption ? 'option' : node.kind),
      reviewStatus: DRAFT,
      note,
    });
  }
  for (const e of pack.edges) {
    const impl = implementedConnector.get(`${e.board}|${e.connectorId}`);
    const sec = pack.sections.find((s) => s.board === e.board && s.id === e.storedIn)?.name ?? 'page level';
    ledger.push({
      sourceId: `${e.fileKey}:${e.connectorId}`,
      board: e.board,
      nodeId: e.connectorId,
      section: sec,
      elementType: 'connector',
      code: e.label || null,
      classification: impl ? 'implemented' : 'blocked',
      canonical: impl?.canonical ?? null,
      implementation: impl ? 'transition in compiled protocol' : 'not mapped',
      tests: 'tests/engine.transitions.test.ts (source connector oracle)',
      reviewStatus: impl?.status ?? 'blocked_needs_clinical_decision',
      note: impl?.note,
    });
    if (!impl) issues.push(`Connector ${e.board}:${e.connectorId} (${e.label}) not mapped`);
  }
  return { protocol, ledger, issues };
}
