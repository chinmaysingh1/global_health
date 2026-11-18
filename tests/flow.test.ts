// The redesigned visit navigation groups the old tabs into four stages and derives status and the
// next action from engine state. These tests pin that it keeps every destination and old link,
// never adds a clinical prerequisite, and reports state honestly.
import { describe, expect, it } from 'vitest';
import { protocol } from '../src/protocol';
import { buildSummary } from '../src/engine/summary';
import { createEncounter, setConsent, addComplaint, setSync, createFollowUp } from '../src/store/encounter';
import { allSections, nextAction, normalizeSection, sectionForPending, sectionStatus, stageOf, stageStatus, STAGES, fill } from '../src/ui/flow';
import { resumeSection } from '../src/ui/home';
import { CHW, PHYSIO, ROUTINE, addDecision, ans, denyModifiers, patient, routine, start } from './helpers';

const OLD_INITIAL_TABS = ['start', 'complaints', 'history', 'assess', 'summary', 'review', 'plan', 'export'];
const OLD_FOLLOWUP_TABS = ['start', 'followup', 'summary', 'review', 'export'];
const sum = (enc: ReturnType<typeof createEncounter>) => buildSummary(protocol, patient(), enc);

describe('stages keep every existing destination and old link', () => {
  it('initial visits: all eight old tabs are reachable sections, in the old order', () => {
    expect(allSections('initial')).toEqual(OLD_INITIAL_TABS);
    for (const t of OLD_INITIAL_TABS) expect(normalizeSection('initial', t)).toBe(t);
  });
  it('follow-up visits: all five old tabs are reachable sections', () => {
    expect(allSections('followup')).toEqual(OLD_FOLLOWUP_TABS);
    for (const t of OLD_FOLLOWUP_TABS) expect(normalizeSection('followup', t)).toBe(t);
  });
  it('unknown or cross-type links land somewhere sensible instead of failing', () => {
    expect(normalizeSection('initial', undefined)).toBe('start');
    expect(normalizeSection('initial', 'nonsense')).toBe('start');
    expect(normalizeSection('followup', 'assess')).toBe('followup');
    expect(normalizeSection('initial', 'followup')).toBe('assess');
  });
  it('four stages in the agreed grouping', () => {
    expect(STAGES).toEqual(['intake', 'assess', 'review', 'handoff']);
    expect(['start', 'complaints', 'history'].map((s) => stageOf('initial', s as never))).toEqual(['intake', 'intake', 'intake']);
    expect(stageOf('initial', 'assess')).toBe('assess');
    expect(['summary', 'review'].map((s) => stageOf('initial', s as never))).toEqual(['review', 'review']);
    expect(['plan', 'export'].map((s) => stageOf('initial', s as never))).toEqual(['handoff', 'handoff']);
    expect(stageOf('followup', 'followup')).toBe('assess');
  });
  it('placeholders are filled, unknown ones stay visible', () => {
    expect(fill('Step {n} of {total}', { n: 2, total: 4 })).toBe('Step 2 of 4');
    expect(fill('{x} {y}', { x: 'a' })).toBe('a {y}');
  });
});

describe('next action follows real state and never answers anything', () => {
  it('consent first, then location, history and assessment', () => {
    let enc = createEncounter(patient(), CHW, protocol.protocolVersion);
    expect(nextAction(enc, sum(enc), 'start')).toEqual({ kind: 'hint', key: 'flow.consentToContinue' });
    enc = setConsent(enc, CHW, 'given', 'patient');
    expect(nextAction(enc, sum(enc), 'start')).toMatchObject({ kind: 'go', to: 'complaints' });
    expect(nextAction(enc, sum(enc), 'complaints')).toEqual({ kind: 'hint', key: 'flow.addLocation' });
    enc = addComplaint(enc, CHW, 'knee', 'left');
    expect(nextAction(enc, sum(enc), 'complaints')).toMatchObject({ kind: 'go', to: 'history' });
    expect(nextAction(enc, sum(enc), 'history')).toMatchObject({ kind: 'go', to: 'assess' });
  });
  it('while the engine has a question waiting, the bar asks for the answer instead of moving on', () => {
    const { enc } = start('knee');
    expect(nextAction(enc, sum(enc), 'assess')).toEqual({ kind: 'hint', key: 'flow.answerToContinue' });
  });
  it('an unacknowledged emergency points at the alert; other navigation is untouched', () => {
    let { enc, cid } = start('low_back');
    enc = ans(enc, cid, 'spine:L1', 'present');
    const s = sum(enc);
    expect(s.alerts[0].urgency).toBe('emergency');
    expect(nextAction(enc, s, 'assess')).toEqual({ kind: 'hint', key: 'flow.resolveFirst' });
    // every section is still a valid destination
    for (const t of OLD_INITIAL_TABS) expect(normalizeSection('initial', t)).toBe(t);
  });
  it('a finished route moves on to the summary; the summary sends to review once', () => {
    const { enc } = routine('knee');
    expect(nextAction(enc, sum(enc), 'assess')).toMatchObject({ kind: 'go', to: 'summary' });
    expect(nextAction(enc, sum(enc), 'summary')).toEqual({ kind: 'markReady' });
    const ready = setSync(enc, CHW, { ...enc.sync, state: 'awaiting_review' });
    expect(nextAction(ready, sum(ready), 'summary')).toMatchObject({ kind: 'go', to: 'review' });
  });
});

describe('status is reported honestly', () => {
  it('nothing looks finished before it is', () => {
    let enc = createEncounter(patient(), CHW, protocol.protocolVersion);
    enc = setConsent(enc, CHW, 'given', 'patient');
    const s = sum(enc);
    expect(sectionStatus(enc, s, 'start')).toBe('done');
    expect(sectionStatus(enc, s, 'summary')).toBe('todo'); // no pain location yet: an empty list is not "done"
    expect(stageStatus(enc, s, 'review')).toBe('todo');
    expect(stageStatus(enc, s, 'handoff')).toBe('todo');
  });
  it('declined consent is flagged, not hidden', () => {
    const enc = setConsent(createEncounter(patient(), CHW, protocol.protocolVersion), CHW, 'declined', 'patient');
    expect(sectionStatus(enc, sum(enc), 'start')).toBe('attention');
  });
  it('review is done only after approval; a corrected answer flags it again until re-approved', () => {
    let { enc, cid } = routine('knee');
    enc = denyModifiers(enc);
    expect(sectionStatus(enc, sum(enc), 'review')).not.toBe('done');
    enc = addDecision(enc, PHYSIO, { type: 'confirm_diagnosis', complaintId: cid, targetId: ROUTINE.knee.diagnosis, reason: 't' });
    enc = addDecision(enc, PHYSIO, { type: 'approve_plan', complaintId: cid, reason: 't' });
    expect(sectionStatus(enc, sum(enc), 'review')).toBe('done');
    expect(sectionStatus(enc, sum(enc), 'plan')).toBe('done');
    // correct an earlier answer: the approval no longer counts, and the stage says so
    enc = ans(enc, cid, 'hip_knee:KQ1', 'hip_knee:KQ1a', PHYSIO);
    const s = sum(enc);
    expect(s.complaints[0].plan.status).toBe('blocked');
    expect(sectionStatus(enc, s, 'review')).toBe('attention');
    expect(sectionStatus(enc, s, 'plan')).not.toBe('done');
  });
  it('sync failures are attention, a receipt is done, queued is in progress', () => {
    const enc = createEncounter(patient(), CHW, protocol.protocolVersion);
    const at = (state: typeof enc.sync.state) => { const e = setSync(enc, CHW, { ...enc.sync, state }); return sectionStatus(e, sum(e), 'export'); };
    expect(at('saved_on_device')).toBe('todo');
    expect(at('queued_for_sync')).toBe('progress');
    expect(at('received_by_server')).toBe('done');
    expect(at('sync_conflict')).toBe('attention');
    expect(at('sync_failed')).toBe('attention');
    expect(at('auth_expired')).toBe('attention');
  });
});

describe('open items link to where they are resolved', () => {
  it('maps every pending code to an existing section', () => {
    const codes = ['CONSENT', 'ELIGIBILITY', 'QUESTION', 'SWITCH_CHOICE', 'SAFETY_ITEM', 'HALT', 'ALERT_ACK', 'MEASURE', 'AI_PROPOSAL', 'LINKED_COMPLAINT', 'CONTRADICTION', 'STALE_DECISION'] as const;
    for (const type of ['initial', 'followup'] as const) {
      for (const code of codes) expect(allSections(type)).toContain(sectionForPending(type, { code }));
    }
    expect(sectionForPending('initial', { code: 'CONSENT' })).toBe('start');
    expect(sectionForPending('initial', { code: 'STALE_DECISION' })).toBe('review');
    expect(sectionForPending('followup', { code: 'SAFETY_ITEM' })).toBe('followup');
  });
  it('resume opens the first section that still needs work', () => {
    let enc = createEncounter(patient(), CHW, protocol.protocolVersion);
    expect(resumeSection(enc, sum(enc))).toBe('start');
    enc = setConsent(enc, CHW, 'given', 'patient');
    expect(resumeSection(enc, sum(enc))).toBe('complaints');
    enc = addComplaint(enc, CHW, 'knee', 'left');
    expect(resumeSection(enc, sum(enc))).toBe('assess');
    const fu = createFollowUp(protocol, patient(), CHW, enc, 'week4', {});
    expect(resumeSection(fu, buildSummary(protocol, patient(), fu))).toBe('start');
  });
});
