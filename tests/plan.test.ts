import { describe, expect, it } from 'vitest';
import { protocol } from '../src/protocol';
import type { Pathway } from '../src/protocol/schema';
import { planBlockers, proposePlan } from '../src/engine/plan';
import { buildSummary } from '../src/engine/summary';
import { addComplaint, addLinkedComplaint, setEligibility, setHistoryField } from '../src/store/encounter';
import { ackAll, addDecision, ans, CHW, denyAllSafety, denyModifiers, ev, patient, PHYSIO, ROUTINE, routine, start } from './helpers';
import type { Encounter } from '../src/store/types';

const codes = (enc: Encounter, cid: string, age: number | null = 52) => planBlockers(protocol, enc, enc.complaints.find((c) => c.id === cid)!, ev(enc, cid, age)).map((b) => b.code);
const plan = (enc: Encounter, cid: string, age: number | null = 52) => proposePlan(protocol, enc, enc.complaints.find((c) => c.id === cid)!, ev(enc, cid, age));
function approved(pathway: Pathway) {
  let { enc, cid } = routine(pathway);
  enc = denyModifiers(enc);
  enc = addDecision(enc, PHYSIO, { type: 'confirm_diagnosis', complaintId: cid, targetId: ROUTINE[pathway].diagnosis, reason: 'test' });
  enc = addDecision(enc, PHYSIO, { type: 'approve_plan', complaintId: cid, reason: 'test' });
  return { enc, cid };
}

describe('an exercise plan is never released silently', () => {
  for (const pathway of Object.keys(ROUTINE) as Pathway[]) {
    it(`${pathway}: a complete routine route is still blocked until a clinician confirms and approves`, () => {
      let { enc, cid } = routine(pathway);
      expect(codes(enc, cid)).toEqual(['DIAGNOSIS_NOT_CONFIRMED', 'MODIFIERS_NOT_ASKED']);
      enc = denyModifiers(enc);
      expect(plan(enc, cid).status).toBe('blocked');
      enc = addDecision(enc, PHYSIO, { type: 'confirm_diagnosis', complaintId: cid, targetId: ROUTINE[pathway].diagnosis, reason: 'test' });
      expect(plan(enc, cid).status).toBe('awaiting_approval');
      enc = addDecision(enc, PHYSIO, { type: 'approve_plan', complaintId: cid, reason: 'test' });
      const p = plan(enc, cid);
      expect(p.status).toBe('approved_demo_only');
      expect(p.demoOnly).toBe(true);
      expect(p.exerciseGroups.map((g) => g.id)).toEqual(protocol.nodes[ROUTINE[pathway].diagnosis].exerciseGroups);
      expect(p.followUp.map((f) => f.visit)).toEqual(['week1', 'week4', 'week12']);
    });
  }
  it('the CHW role cannot record review decisions', () => {
    const { enc, cid } = routine('knee');
    expect(() => addDecision(enc, CHW, { type: 'approve_plan', complaintId: cid, reason: 'x' })).toThrow();
  });
  it('missing safety evidence blocks: unknown answer, skipped specialist exam, missing kit', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee', PHYSIO, ['hip_knee:K4']);
    enc = ans(enc, cid, 'hip_knee:K4', 'unknown', PHYSIO);
    for (const [q, o] of ROUTINE.knee.steps) enc = ans(enc, cid, q, o, PHYSIO);
    enc = ans(enc, cid, ...ROUTINE.knee.irritability, PHYSIO);
    enc = denyModifiers(enc);
    enc = addDecision(enc, PHYSIO, { type: 'confirm_diagnosis', complaintId: cid, targetId: 'hip_knee:KD8', reason: 'x' });
    expect(codes(enc, cid)).toEqual(['SAFETY_INCOMPLETE']);
    expect(plan(enc, cid).status).toBe('blocked');
    // CHW-only screen: K8 and K12 need a physio-level examination
    let b = start('knee', CHW);
    b.enc = denyAllSafety(b.enc, b.cid, 'knee', CHW);
    expect(codes(b.enc, b.cid)).toContain('SAFETY_INCOMPLETE');
  });
  it('a skipped specialist examination blocks and produces no candidate', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee');
    enc = ans(enc, cid, 'hip_knee:KQ1', 'hip_knee:KQ1a', CHW);
    enc = ans(enc, cid, 'hip_knee:KQ2', 'hip_knee:KQ2a', CHW);
    enc = ans(enc, cid, 'hip_knee:KT1', 'not_performed', CHW);
    expect(codes(enc, cid)).toEqual(expect.arrayContaining(['EXAM_PENDING', 'NO_CANDIDATE', 'DIAGNOSIS_NOT_CONFIRMED', 'DOSE_NOT_SET']));
  });
  it('a late concern voids an approved plan immediately; clearance needs ack + clinician decision', () => {
    let { enc, cid } = approved('low_back');
    expect(plan(enc, cid).status).toBe('approved_demo_only');
    enc = ans(enc, cid, 'spine:L1', 'present', CHW, { via: 'late_concern' });
    const p = plan(enc, cid);
    expect(p.status).toBe('blocked');
    expect(p.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['ALERT_UNACKNOWLEDGED', 'ALERT_UNRESOLVED', 'PATHWAY_HALTED', 'DIAGNOSIS_NOT_CONFIRMED']));
    expect(p.approval).toBeNull(); // the earlier approval was made on a different clinical state
    enc = ackAll(enc, ev(enc, cid));
    expect(codes(enc, cid)).not.toContain('ALERT_UNACKNOWLEDGED');
    expect(codes(enc, cid)).toContain('ALERT_UNRESOLVED');
  });
  it('a corrected answer makes earlier decisions stale (kept, not counted)', () => {
    let { enc, cid } = approved('knee');
    enc = ans(enc, cid, 'hip_knee:KS3-1', 'hip_knee:KS3-1a', PHYSIO); // irritability changed
    expect(plan(enc, cid).status).toBe('blocked');
    expect(enc.decisions).toHaveLength(2);
    const s = buildSummary(protocol, patient(), enc);
    expect(s.pending.filter((p) => p.code === 'STALE_DECISION')).toHaveLength(2);
  });
  it('contradictory answers block (recorded age 30 with "45 or older" selected)', () => {
    let { enc, cid } = routine('knee');
    expect(codes(enc, cid, 30)).toContain('CONTRADICTION');
  });
  it('unclear eligibility never passes automatically; an unreviewed safety modifier needs sign-off', () => {
    let { enc, cid } = routine('knee');
    enc = setEligibility(enc, PHYSIO, cid, 'unclear', 'not_established');
    expect(codes(enc, cid)).toContain('ELIGIBILITY_UNVERIFIED');
    enc = denyModifiers(enc);
    enc = setHistoryField(enc, CHW, 'mod.exertional_symptoms', 'present');
    expect(codes(enc, cid)).toContain('MODIFIER_SIGNOFF');
    enc = setHistoryField(enc, CHW, 'mod.exertional_symptoms', 'unknown');
    expect(codes(enc, cid)).toContain('MODIFIER_SIGNOFF'); // unknown is not "no"
  });
  it('unsupported population: under 18 requires documented clinician review', () => {
    const { enc, cid } = routine('knee');
    expect(codes(enc, cid, 14)).toEqual(expect.arrayContaining(['PAEDIATRIC_REVIEW', 'CONTRADICTION']));
    expect(codes(enc, cid, 52)).not.toContain('PAEDIATRIC_REVIEW');
  });
  it('kneecap dislocation/instability carries the doctor-clearance precaution from group E2', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee');
    enc = ans(enc, cid, 'hip_knee:KQ1', 'hip_knee:KQ1a', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:KQ2', 'hip_knee:KQ2e', PHYSIO);
    const p = plan(enc, cid);
    expect(p.diagnosis?.id).toBe('hip_knee:KD5');
    expect(p.precautions.map((x) => x.code)).toContain('DOCTOR_CLEARANCE');
  });
});

describe('referred pain, multiple complaints, loops', () => {
  it('K12 "from the hip" opens a linked hip assessment that carries origin and side; findings stay separate', () => {
    let { enc, cid } = start('knee', PHYSIO, 'right');
    enc = denyAllSafety(enc, cid, 'knee', PHYSIO, ['hip_knee:K12']);
    enc = ans(enc, cid, 'hip_knee:K12', 'present', PHYSIO);
    expect(ev(enc, cid).current).toMatchObject({ type: 'switch', nodeId: 'hip_knee:K12Y' });
    enc = ans(enc, cid, 'hip_knee:K12Y', 'from_hip', PHYSIO);
    const e = ev(enc, cid);
    expect(e.halt).toMatchObject({ reason: 'SWITCHED', detail: 'hip' });
    expect(e.switchRequests).toEqual([{ target: 'hip', from: 'hip_knee:K12Y', optionId: 'from_hip' }]);
    enc = addLinkedComplaint(enc, PHYSIO, protocol, cid, 'hip', 'hip_knee:K12Y', 'from_hip');
    enc = addLinkedComplaint(enc, PHYSIO, protocol, cid, 'hip', 'hip_knee:K12Y', 'from_hip'); // idempotent
    expect(enc.complaints).toHaveLength(2);
    const hip = enc.complaints[1];
    expect(hip).toMatchObject({ region: 'hip', laterality: 'right', origin: { complaintId: cid } });
    expect(hip.eligibility).toEqual(enc.complaints[0].eligibility);
    expect(Object.keys(hip.answers)).toEqual([]); // knee findings are not copied into the hip record
    const he = ev(enc, hip.id);
    expect(he.pathway).toBe('hip');
    expect(he.current).toEqual({ type: 'ask', nodeId: 'hip_knee:H1' });
    enc = ans(enc, hip.id, 'hip_knee:H1', 'present', PHYSIO);
    expect(ev(enc, hip.id).alerts).toHaveLength(1);
    expect(ev(enc, cid).alerts).toHaveLength(0); // the hip alert does not leak into the knee complaint
  });
  it('the bladder/bowel/saddle choice on a switch box is a same-day emergency', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee', PHYSIO, ['hip_knee:K12']);
    enc = ans(enc, cid, 'hip_knee:K12', 'present', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K12Y', 'cauda_signs', PHYSIO);
    const e = ev(enc, cid);
    expect(e.alerts[0]).toMatchObject({ urgency: 'emergency', exerciseRestriction: 'no_exercise' });
    expect(e.halt?.reason).toBe('ESCALATED');
  });
  it('loop guard: hip (opened from knee->back?) cannot bounce back into a pathway already in the chain', () => {
    // low back -> hip (L11) -> low back again (H10) must stop for review
    let { enc, cid } = start('low_back', PHYSIO, 'central');
    enc = denyAllSafety(enc, cid, 'low_back', PHYSIO, ['spine:L11']);
    enc = ans(enc, cid, 'spine:L11', 'present', PHYSIO);
    enc = ans(enc, cid, 'spine:L11Y', 'from_hip', PHYSIO);
    enc = addLinkedComplaint(enc, PHYSIO, protocol, cid, 'hip', 'spine:L11Y', 'from_hip');
    const hip = enc.complaints[1];
    enc = denyAllSafety(enc, hip.id, 'hip', PHYSIO, ['hip_knee:H10']);
    enc = ans(enc, hip.id, 'hip_knee:H10', 'present', PHYSIO);
    enc = ans(enc, hip.id, 'hip_knee:H10Y', 'from_back', PHYSIO);
    const he = ev(enc, hip.id);
    expect(he.halt).toMatchObject({ reason: 'SWITCH_LOOP', detail: 'low_back' });
    expect(he.switchRequests).toEqual([]);
  });
  it('"both hip and back" keeps the back pathway going and requests a hip assessment too', () => {
    let { enc, cid } = start('low_back', PHYSIO, 'central');
    enc = denyAllSafety(enc, cid, 'low_back', PHYSIO, ['spine:L11']);
    enc = ans(enc, cid, 'spine:L11', 'present', PHYSIO);
    enc = ans(enc, cid, 'spine:L11Y', 'both', PHYSIO);
    const e = ev(enc, cid);
    expect(e.halt).toBeNull();
    expect(e.switchRequests.map((s) => s.target)).toEqual(['hip']);
    expect(e.current).toEqual({ type: 'ask', nodeId: 'spine:LQ1' }); // back assessment carries on into Stage 2
  });
  it('shoulder (not in the boards) becomes a referral item, not a pathway', () => {
    let { enc, cid } = start('neck', PHYSIO, 'central');
    enc = denyAllSafety(enc, cid, 'neck', PHYSIO, ['spine:N12']);
    enc = ans(enc, cid, 'spine:N12', 'present', PHYSIO);
    enc = ans(enc, cid, 'spine:N12Y', 'shoulder', PHYSIO);
    const e = ev(enc, cid);
    expect(e.unsupportedReferrals).toHaveLength(1);
    expect(e.alerts[0].urgency).toBe('refer');
    expect(e.switchRequests).toEqual([]);
  });
  it('two complaints with different sides are evaluated independently', () => {
    let { enc, cid } = routine('knee');
    enc = addComplaint(enc, PHYSIO, 'low_back', 'central');
    const back = enc.complaints[1];
    enc = setEligibility(enc, PHYSIO, back.id, 'established', 'clinician_assessed');
    enc = ans(enc, back.id, 'spine:L1', 'present', PHYSIO);
    expect(ev(enc, back.id).alerts).toHaveLength(1);
    expect(ev(enc, cid).alerts).toHaveLength(0);
    expect(ev(enc, cid).candidate?.diagnosisId).toBe('hip_knee:KD8');
    const s = buildSummary(protocol, patient(), enc);
    expect(s.complaints.map((c) => [c.complaint.region, c.complaint.laterality, c.ev.pathway])).toEqual([['knee', 'left', 'knee'], ['low_back', 'central', 'low_back']]);
  });
  it('"not sure hip or knee" goes through the movement decision, which needs a physio-level hip test', () => {
    let { enc, cid } = start('hip_knee_unsure', CHW);
    const e = ev(enc, cid);
    expect(e.current).toEqual({ type: 'ask', nodeId: 'hip_knee:G-N0B' });
    enc = ans(enc, cid, 'hip_knee:G-N0B', 'hip_knee:G-N0B#hip_reproduces', CHW);
    expect(ev(enc, cid).halt?.reason).toBe('EXAM_PENDING'); // CHW cannot record this result
    enc = ans(enc, cid, 'hip_knee:G-N0B', 'hip_knee:G-N0B#hip_reproduces', PHYSIO);
    expect(ev(enc, cid).pathway).toBe('hip');
  });
});
