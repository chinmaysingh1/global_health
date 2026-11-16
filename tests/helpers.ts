import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { protocol } from '../src/protocol';
import type { Pathway } from '../src/protocol/schema';
import type { Actor, AnswerStatus, Encounter, Patient, Region } from '../src/store/types';
import { addComplaint, addDecision, answerRecord, createEncounter, setAnswer, setConsent, setEligibility, setHistoryField, acknowledgeAlert } from '../src/store/encounter';
import { evaluateEncounterComplaints, type ComplaintEval } from '../src/engine/evaluate';
import { MODIFIER_CODES } from '../src/engine/plan';

export const PACK = join(__dirname, '..', 'CHW_MSK_Claude_Source_Pack');
export const CHW: Actor = { id: 'chw-1', name: 'Demo CHW', role: 'chw', capabilities: ['trained', 'basic_kit'] };
export const CHW_NO_KIT: Actor = { id: 'chw-2', name: 'Demo CHW (no kit)', role: 'chw', capabilities: ['trained'] };
export const PHYSIO: Actor = { id: 'clin-1', name: 'Demo Clinician', role: 'clinician', capabilities: ['trained', 'basic_kit', 'physio'] };

export const patient = (age: number | null = 52): Patient => ({ id: 'pt-test', synthetic: true, name: 'Test Patient', age, sex: 'female', village: 'Test', preferredLanguage: 'en', demoNote: '' });

export function start(region: Region, actor: Actor = CHW, laterality: 'left' | 'right' | 'central' = 'left'): { enc: Encounter; cid: string } {
  let enc = createEncounter(patient(), actor, protocol.protocolVersion);
  enc = setConsent(enc, actor, 'given', 'patient');
  enc = addComplaint(enc, actor, region, laterality);
  const cid = enc.complaints[0].id;
  enc = setEligibility(enc, actor, cid, 'established', 'clinician_assessed');
  return { enc, cid };
}
export const ev = (enc: Encounter, cid: string, age: number | null = 52): ComplaintEval => evaluateEncounterComplaints(protocol, enc.complaints, age).get(cid)!;

export function ans(enc: Encounter, cid: string, nodeId: string, statusOrOption: AnswerStatus | string, actor: Actor = CHW, extra: Record<string, unknown> = {}): Encounter {
  const isStatus = ['present', 'denied', 'unknown', 'declined', 'not_applicable', 'not_performed'].includes(statusOrOption);
  const rec = isStatus
    ? answerRecord(actor, nodeId, statusOrOption as AnswerStatus, { reason: ['unknown', 'declined', 'not_performed'].includes(statusOrOption) ? 'test reason' : undefined, ...extra })
    : answerRecord(actor, nodeId, 'present', { optionId: statusOrOption, ...extra });
  return setAnswer(enc, actor, cid, rec);
}
export function denyAllSafety(enc: Encounter, cid: string, pathway: Pathway, actor: Actor = PHYSIO, except: string[] = []): Encounter {
  for (const id of protocol.pathways[pathway].safetyChecks) if (!except.includes(id)) enc = ans(enc, cid, id, 'denied', actor);
  return enc;
}
export function denyModifiers(enc: Encounter, actor: Actor = CHW): Encounter {
  for (const c of MODIFIER_CODES) enc = setHistoryField(enc, actor, c, 'denied');
  return enc;
}
export function ackAll(enc: Encounter, e: ComplaintEval, actor: Actor = CHW): Encounter {
  for (const a of e.alerts) enc = acknowledgeAlert(enc, actor, a.key);
  return enc;
}
export { addDecision };

/** Source connector labels ("A>B") straight from the snapshot: the test oracle for transitions. */
export function sourceLabels(board: 'spine' | 'hip_knee'): { from: string; to: string }[] {
  const j = JSON.parse(readFileSync(join(PACK, 'sources', board, 'all_connectors.json'), 'utf8'));
  return j.elements
    .map((e: any) => String(e.text).replace(/&gt;/g, '>'))
    .filter((t: string) => t.includes('>'))
    .map((t: string) => ({ from: t.split('>')[0], to: t.split('>')[1] }));
}

/** Routine routes used across tests: answers from Stage 2 start to a working diagnosis + irritability. */
export const ROUTINE: Record<Pathway, { region: Region; steps: [string, string][]; diagnosis: string; irritability: [string, string]; dose: 'HI' | 'MD' | 'LO' }> = {
  knee: { region: 'knee', steps: [['hip_knee:KQ1', 'hip_knee:KQ1b'], ['hip_knee:KQ3', 'hip_knee:KQ3c'], ['hip_knee:KT5', 'hip_knee:KT5a']], diagnosis: 'hip_knee:KD8', irritability: ['hip_knee:KS3-1', 'hip_knee:KS3-1b'], dose: 'MD' },
  hip: { region: 'hip', steps: [['hip_knee:HQ1', 'hip_knee:HQ1a'], ['hip_knee:HQ2', 'hip_knee:HQ2a'], ['hip_knee:HT1', 'hip_knee:HT1a']], diagnosis: 'hip_knee:HD1', irritability: ['hip_knee:HS3-1', 'hip_knee:HS3-1c'], dose: 'LO' },
  low_back: { region: 'low_back', steps: [['spine:LQ1', 'spine:LQ1a'], ['spine:LT1', 'spine:LT1a']], diagnosis: 'spine:LD1', irritability: ['spine:LS4-1', 'spine:LS4-1a'], dose: 'HI' },
  neck: { region: 'neck', steps: [['spine:NQ1', 'spine:NQ1a'], ['spine:NQ2', 'spine:NQ2c'], ['spine:NT2', 'spine:NT2a']], diagnosis: 'spine:ND1', irritability: ['spine:NS4-1', 'spine:NS4-1b'], dose: 'MD' },
};
export function routine(pathway: Pathway, actor: Actor = PHYSIO): { enc: Encounter; cid: string } {
  const r = ROUTINE[pathway];
  let { enc, cid } = start(r.region, actor);
  enc = denyAllSafety(enc, cid, pathway, actor);
  for (const [q, o] of r.steps) enc = ans(enc, cid, q, o, actor);
  enc = ans(enc, cid, r.irritability[0], r.irritability[1], actor);
  return { enc, cid };
}
