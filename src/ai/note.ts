// Deterministic baseline note. Renders only recorded facts and engine output: it never
// fills in normal findings, absent allergies, values or diagnoses to look complete.
import type { Protocol } from '../protocol/schema';
import type { EncounterSummary } from '../engine/summary';

const STATUS_WORD: Record<string, string> = {
  present: 'reported present',
  denied: 'explicitly denied',
  unknown: 'unknown (patient not sure)',
  declined: 'patient declined to answer',
  not_applicable: 'not applicable',
  not_performed: 'not performed',
};
const SOURCE_WORD: Record<string, string> = {
  patient_report: 'patient report',
  caregiver_report: 'caregiver report',
  chw_observation: 'CHW observation',
  clinician_finding: 'clinician finding',
};

export const NOTE_DISCLAIMER =
  'EVALUATION BUILD — SYNTHETIC DATA. Protocol content is an unreviewed draft with no clinical approval. Not for patient care.';

export function renderNote(protocol: Protocol, s: EncounterSummary): string {
  const { patient, encounter: enc } = s;
  const L: string[] = [];
  L.push(NOTE_DISCLAIMER, '');
  L.push(`Patient (synthetic): ${patient.name}, ${patient.age ?? 'age not recorded'} y, ${patient.sex}. Local id ${patient.id}.`);
  L.push(`Encounter ${enc.id} (${enc.type}${enc.visit ? `, ${enc.visit}` : ''}), revision ${enc.revision}, protocol ${enc.protocolVersion}.`);
  L.push(`Consent: ${enc.consent ? `${enc.consent.status} by ${enc.consent.by}` : 'NOT RECORDED'}. Patient language: ${enc.patientLanguage}.`);
  if (s.alerts.length) {
    L.push('', 'SAFETY CONCERNS RAISED');
    for (const a of s.alerts) {
      const ack = enc.alertAcks[a.key];
      L.push(`- [${a.headline}] ${protocol.nodes[a.checkId ?? a.outcomeId].title}${a.late ? ' (disclosed late)' : ''}`);
      L.push(`  Source action: ${a.actionText.replace(/\n/g, ' ')}`);
      L.push(`  Exercise: ${a.exerciseRestriction.replace(/_/g, ' ')}. ${ack ? `Acknowledged by ${ack.by.name} at ${ack.at}.` : 'NOT YET ACKNOWLEDGED.'}`);
    }
  }
  for (const c of s.complaints) {
    const cp = c.complaint;
    L.push('', `COMPLAINT: ${cp.region.replace(/_/g, ' ')} — side: ${cp.laterality.replace(/_/g, ' ')}${c.ev.pathway ? ` — pathway: ${c.ev.pathway.replace('_', ' ')}` : ''}`);
    if (cp.origin) L.push(`Opened by pathway switch from ${protocol.nodes[cp.origin.nodeId]?.source.code ?? cp.origin.nodeId}.`);
    if (cp.patientWords) L.push(`Patient's words (${enc.patientLanguage}, original): "${cp.patientWords}"`);
    L.push(`Musculoskeletal eligibility: ${cp.eligibility ? `${cp.eligibility.status} (${cp.eligibility.basis.replace(/_/g, ' ')}; recorded by ${cp.eligibility.author.name})` : 'NOT RECORDED'}.`);
    const pos = c.safetyRows.filter((r) => r.state === 'present');
    const neg = c.safetyRows.filter((r) => r.state === 'denied');
    const inc = c.safetyRows.filter((r) => r.state === 'incomplete');
    const na = c.safetyRows.filter((r) => r.state === 'not_asked');
    L.push(`Safety screen (${c.safetyRows.length} checks): status ${c.ev.safety.state.replace(/_/g, ' ')}.`);
    if (pos.length) L.push(`  Positive: ${pos.map((r) => `${r.code} ${r.title}`).join('; ')}`);
    if (neg.length) L.push(`  Explicitly denied: ${neg.map((r) => r.code).join(', ')}`);
    if (inc.length) L.push(`  INCOMPLETE (not negative): ${inc.map((r) => `${r.code} — ${String(r.reason).replace(/_/g, ' ')}`).join('; ')}`);
    if (na.length) L.push(`  Not asked: ${na.map((r) => r.code).join(', ')}`);
    const steps = c.trace.filter((t) => t.answerLabel || t.status);
    if (steps.length) {
      L.push('Pathway trace:');
      for (const t of steps) {
        L.push(`  ${t.code} ${t.title.replace(/^[A-Z0-9-]+ · /, '')} -> ${t.answerLabel ? t.answerLabel.replace(/\n/g, ' ') : STATUS_WORD[t.status ?? ''] ?? t.status} [${SOURCE_WORD[t.infoSource ?? ''] ?? ''}; ${t.author ?? ''}]`);
      }
    }
    if (c.ev.halt) L.push(`Pathway stopped: ${c.ev.halt.reason.replace(/_/g, ' ')} at ${protocol.nodes[c.ev.halt.nodeId]?.source.code ?? c.ev.halt.nodeId}${c.ev.halt.refs.length ? ` (refers to ${c.ev.halt.refs.map((r) => protocol.nodes[r]?.source.code ?? r).join(', ')})` : ''}.`);
    for (const x of c.ev.contradictions) L.push(`Contradiction to resolve: ${protocol.nodes[x.nodeId]?.source.code ?? x.nodeId} — ${x.detail}.`);
    if (c.confirmed) {
      L.push(`Working assessment CONFIRMED BY CLINICIAN (${c.confirmed.by.name}): ${protocol.nodes[c.confirmed.targetId!]?.title ?? c.confirmed.targetId}. Reason: ${c.confirmed.reason}`);
    } else if (c.ev.candidate) {
      L.push(`Engine candidate (NOT a diagnosis; awaiting clinician review): ${protocol.nodes[c.ev.candidate.diagnosisId].title}`);
    } else L.push('No candidate assessment has been produced.');
    const measures = Object.values(cp.measures);
    if (measures.length) {
      L.push('Measurements:');
      for (const m of measures) {
        const v = m.status !== 'recorded' ? `${m.status.replace(/_/g, ' ')}${m.reason ? ` (${m.reason})` : ''}` : m.psfs ? m.psfs.map((t) => `${t.task} ${t.score}/10`).join('; ') : m.left !== undefined || m.right !== undefined ? `L ${m.left ?? '—'} / R ${m.right ?? '—'}` : String(m.value);
        L.push(`  ${m.measureId}: ${v}`);
      }
    }
    L.push(`Exercise plan status: ${c.plan.status.replace(/_/g, ' ')}${c.plan.blockers.length ? ` — blocked by ${c.plan.blockers.map((b) => b.code).join(', ')}` : ''}.`);
    if (c.plan.status === 'approved_demo_only' && c.plan.approval) {
      L.push(`  Approved in DEMO mode by ${c.plan.approval.by.name}: ${c.plan.exerciseGroups.map((g) => g.title).join('; ')}; start level ${c.plan.doseLevel}.`);
    }
  }
  const hx = Object.values(enc.history);
  if (hx.length) {
    L.push('', 'HISTORY (as recorded)');
    for (const f of hx) {
      const v = f.items?.length ? f.items.join(', ') : f.value ?? '';
      L.push(`- ${f.code}: ${STATUS_WORD[f.status]}${v ? ` — ${v}` : ''} [${SOURCE_WORD[f.infoSource]}]`);
    }
  }
  if (enc.narratives.length) {
    L.push('', 'PATIENT NARRATIVE (original wording, unedited)');
    for (const n of enc.narratives) L.push(`- (${n.lang}) "${n.text}"`);
  }
  if (s.pending.length) {
    L.push('', `OPEN ITEMS (${s.pending.length})`);
    for (const p of s.pending) L.push(`- ${p.code}${p.ref ? ` ${protocol.nodes[p.ref]?.source.code ?? p.ref}` : ''}${p.detail ? ` (${String(p.detail).replace(/_/g, ' ')})` : ''}`);
  }
  if (enc.decisions.length) {
    L.push('', 'REVIEW DECISIONS');
    for (const d of enc.decisions) L.push(`- ${d.at} ${d.by.name} (${d.by.role}): ${d.type}${d.targetId ? ` ${protocol.nodes[d.targetId]?.source.code ?? d.targetId}` : ''} — ${d.reason}`);
  }
  return L.join('\n');
}

/** Lines given to an AI drafter: accepted facts only. */
export function factLines(protocol: Protocol, s: EncounterSummary): string[] {
  return renderNote(protocol, s).split('\n').filter((l) => l.trim() && l !== NOTE_DISCLAIMER);
}

/**
 * Lints an AI-drafted note against the facts it was given. Flags numbers and diagnosis
 * labels that do not appear in the fact lines. Warnings are shown to the reviewer; the
 * deterministic note always remains available.
 */
export function lintDraft(protocol: Protocol, draft: string, facts: string[]): string[] {
  const warnings: string[] = [];
  const factText = facts.join('\n').toLowerCase();
  const factNumbers = new Set(factText.match(/\b\d+(?:\.\d+)?\b/g) ?? []);
  for (const num of new Set(draft.match(/\b\d+(?:\.\d+)?\b/g) ?? [])) {
    if (!factNumbers.has(num)) warnings.push(`Number "${num}" does not appear in the recorded facts.`);
  }
  for (const n of Object.values(protocol.nodes)) {
    if (n.kind !== 'diagnosis') continue;
    const name = n.title.replace(/^.*?:\s*/, '').split('(')[0].trim().toLowerCase();
    if (name.length > 6 && draft.toLowerCase().includes(name) && !factText.includes(name)) warnings.push(`Mentions "${name}", which is not in the recorded facts.`);
  }
  if (/\b(no known allergies|nkda|examination normal|unremarkable)\b/i.test(draft) && !/allerg.*explicitly denied/i.test(facts.join(' '))) {
    warnings.push('States a normal/absent finding that was not recorded.');
  }
  return warnings;
}
