// Strict validation of model output. Nothing reaches the encounter unless it names a
// permitted target and carries an evidence span that literally exists in the narrative.
import type { AiProposal } from '../store/types';
import { newId } from '../store/encounter';
import { AI_LIMITS, zRawExtraction, type PermittedTarget, type RawFact } from './types';

export type RejectReason =
  | 'not_json'
  | 'schema_invalid'
  | 'response_too_large'
  | 'unsupported_target'
  | 'evidence_not_found'
  | 'safety_denial_not_allowed'
  | 'value_not_in_narrative'
  | 'duplicate';

export interface ValidationResult {
  proposals: AiProposal[];
  rejected: { reason: RejectReason; fact?: RawFact; detail?: string }[];
  contradictions: { note: string; quotes: string[] }[];
  ignoredKeys: string[];
}

const ALLOWED_TOP_KEYS = new Set(['facts', 'contradictions']);

function locate(narrative: string, quote: string, start: number | null | undefined): number {
  if (typeof start === 'number' && narrative.slice(start, start + quote.length) === quote) return start;
  const first = narrative.indexOf(quote);
  if (first === -1) return -1;
  // ambiguous quotes are accepted at their first occurrence only when unique
  return narrative.indexOf(quote, first + 1) === -1 ? first : first;
}

export function validateExtraction(
  raw: unknown,
  narrative: string,
  narrativeId: string,
  permitted: PermittedTarget[],
  meta: { providerId: string; basedOnRevision: number },
): ValidationResult {
  const out: ValidationResult = { proposals: [], rejected: [], contradictions: [], ignoredKeys: [] };
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > AI_LIMITS.maxResponseChars) {
      out.rejected.push({ reason: 'response_too_large' });
      return out;
    }
    try {
      obj = JSON.parse(raw);
    } catch {
      out.rejected.push({ reason: 'not_json' });
      return out;
    }
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    out.ignoredKeys = Object.keys(obj as object).filter((k) => !ALLOWED_TOP_KEYS.has(k));
  }
  const parsed = zRawExtraction.safeParse(obj);
  if (!parsed.success) {
    out.rejected.push({ reason: 'schema_invalid', detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return out;
  }
  const lowerNarrative = narrative.toLowerCase();
  const seen = new Set<string>();
  for (const f of parsed.data.facts) {
    const target = permitted.find((p) => p.kind === f.target_kind && p.id === f.target_id && (p.kind === 'history_field' || !f.complaint_id || p.complaintId === f.complaint_id));
    if (!target) {
      out.rejected.push({ reason: 'unsupported_target', fact: f });
      continue;
    }
    const start = locate(narrative, f.quote, f.start);
    if (start === -1) {
      out.rejected.push({ reason: 'evidence_not_found', fact: f });
      continue;
    }
    // An AI proposal may raise a safety concern for review; it may never clear one.
    if (f.target_kind === 'safety_check' && f.status !== 'present') {
      out.rejected.push({ reason: 'safety_denial_not_allowed', fact: f });
      continue;
    }
    // Values (durations, medicine names, numbers) must come from the patient's words.
    if (f.value && !lowerNarrative.includes(f.value.toLowerCase())) {
      out.rejected.push({ reason: 'value_not_in_narrative', fact: f });
      continue;
    }
    const key = `${f.target_kind}|${f.target_id}|${target.complaintId ?? ''}|${f.status}`;
    if (seen.has(key)) {
      out.rejected.push({ reason: 'duplicate', fact: f });
      continue;
    }
    seen.add(key);
    out.proposals.push({
      id: newId('prop'),
      narrativeId,
      complaintId: target.complaintId,
      target: f.target_kind === 'safety_check' ? { kind: 'safety_check', nodeId: f.target_id } : { kind: 'history_field', code: f.target_id },
      status: f.status,
      value: f.value ?? undefined,
      quote: f.quote,
      start,
      end: start + f.quote.length,
      urgentFlag: f.target_kind === 'safety_check',
      providerId: meta.providerId,
      basedOnRevision: meta.basedOnRevision,
      state: 'pending',
    });
  }
  for (const c of parsed.data.contradictions ?? []) {
    if (c.quotes.every((q) => narrative.includes(q))) out.contradictions.push(c);
  }
  // urgent proposals first so they are never buried
  out.proposals.sort((a, b) => Number(b.urgentFlag) - Number(a.urgentFlag));
  return out;
}
