// Bounded context for the model: only the targets that are currently askable, with short
// labels. The full protocol and transcript are never sent.
import type { Protocol } from '../protocol/schema';
import type { Encounter } from '../store/types';
import type { ComplaintEval } from '../engine/evaluate';
import { ALL_HISTORY_CODES } from '../store/historyFields';
import type { PermittedTarget } from './types';

const HISTORY_LABELS: Record<string, string> = {
  'hx.onset_duration': 'How long the problem has been present (duration in the patient\'s words)',
  'hx.onset_mode': 'How it started',
  'hx.aggravating': 'What makes it worse',
  'hx.easing': 'What eases it',
  'hx.previous_episodes': 'Previous similar episodes',
  'hx.occupation': 'Work and daily physical demands',
  'hx.beliefs_mood_sleep': 'Worries, mood and sleep related to the pain',
  'hx.medications': 'Medicines the patient currently takes',
  'hx.allergies': 'Allergies',
  'hx.comorbidities': 'Other health conditions',
  'hx.functional_limits': 'Activities the patient finds hard',
  'hx.goals': 'What the patient wants to be able to do',
  'mod.exertional_symptoms': 'Chest pain, breathlessness or fainting with effort',
  'mod.bp_uncontrolled': 'Blood pressure known to be uncontrolled',
  'mod.diabetes': 'Diabetes',
  'mod.pregnancy': 'Current pregnancy',
  'mod.osteoporosis': 'Known osteoporosis or osteoporosis risk',
  'mod.falls': 'Recent falls or poor balance',
};

export function permittedTargets(protocol: Protocol, enc: Encounter, evals: Map<string, ComplaintEval>): PermittedTarget[] {
  const out: PermittedTarget[] = ALL_HISTORY_CODES.map((code) => ({ kind: 'history_field', id: code, label: HISTORY_LABELS[code] ?? code }));
  for (const c of enc.complaints) {
    if (c.withdrawn) continue;
    const pathway = evals.get(c.id)?.pathway;
    if (!pathway) continue;
    for (const id of protocol.pathways[pathway].safetyChecks) {
      const n = protocol.nodes[id];
      out.push({ kind: 'safety_check', id, complaintId: c.id, label: n.title.replace(/^[A-Z]+\d+ · /, '') });
    }
  }
  return out;
}
