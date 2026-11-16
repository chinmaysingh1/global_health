import { describe, expect, it } from 'vitest';
import { protocol } from '../src/protocol';
import { evaluateComplaint } from '../src/engine/evaluate';
import { answerRecord } from '../src/store/encounter';
import type { Complaint } from '../src/store/types';
import { ans, ev, PHYSIO, CHW, ROUTINE, routine, sourceLabels, start, denyAllSafety } from './helpers';
import type { Pathway } from '../src/protocol/schema';

const ANSWER = /^[KHLN](?:[QT]\d+|S[34]-\d+)[a-z]$/;
const elig = { status: 'established' as const, basis: 'clinician_assessed' as const, author: PHYSIO, at: 'x' };

function stepFrom(board: 'spine' | 'hip_knee', parent: string, option: string, age: number | null = 50) {
  const c: Complaint = {
    id: 'c', board, region: 'knee', laterality: 'left', entryNode: `${board}:${parent}`, eligibility: elig,
    answers: { [`${board}:${parent}`]: answerRecord(PHYSIO, `${board}:${parent}`, 'present', { optionId: `${board}:${option}` }) },
    measures: {},
  };
  return evaluateComplaint(protocol, c, { patientAge: age, originChain: [] });
}

describe('every source answer arrow is executed as drawn (oracle = connector labels in the snapshot)', () => {
  for (const board of ['hip_knee', 'spine'] as const) {
    const labels = sourceLabels(board);
    const parentOf = new Map(labels.filter((l) => ANSWER.test(l.to)).map((l) => [l.to, l.from]));
    const arrows = labels.filter((l) => ANSWER.test(l.from));
    it(`${board}: ${arrows.length} answer arrows`, () => {
      expect(arrows.length).toBeGreaterThan(60);
      for (const a of arrows) {
        const parent = parentOf.get(a.from)!;
        const parentNode = protocol.nodes[`${board}:${parent}`];
        if (parentNode.kind === 'followup_question') continue; // covered in followup.test.ts
        const e = stepFrom(board, parent, a.from);
        const target = protocol.nodes[`${board}:${a.to}`];
        const where = `${a.from}>${a.to}`;
        if (target.kind === 'safety_check') {
          expect(e.halt, where).toMatchObject({ reason: 'REOPEN_SAFETY' });
          expect(e.halt!.refs, where).toContain(target.id);
          expect(e.candidate, where).toBeNull();
        } else {
          expect(e.trace[1]?.nodeId, where).toBe(target.id);
          if (target.kind === 'diagnosis') expect(e.candidate?.diagnosisId, where).toBe(target.id);
          if (target.kind === 'dose') expect(e.doseLevel, where).toBe(target.doseLevel);
          if (target.kind === 'escalation' && target.outcome!.urgency !== 'switch') expect(e.alerts[0]?.outcomeId, where).toBe(target.id);
        }
      }
    });
  }
  it('answers with only a text redirect ("back to K10") stop and point at the check; nothing is released', () => {
    for (const [parent, opt, ref] of [['KT5', 'KT5b', 'K10'], ['HQ2', 'HQ2c', 'H3'], ['HT1', 'HT1c', 'H5'], ['HT2', 'HT2e', 'H9'], ['HT4', 'HT4b', 'H11']]) {
      const e = stepFrom('hip_knee', parent, opt, parent === 'HQ2' ? 12 : 50);
      expect(e.halt).toMatchObject({ reason: 'REOPEN_SAFETY', refs: [`hip_knee:${ref}`] });
      expect(e.candidate).toBeNull();
    }
    const e = stepFrom('spine', 'LT2', 'LT2c');
    expect(e.halt!.refs.sort()).toEqual(['spine:L1', 'spine:L5']); // text says L1 / L5; arrow only L5
  });
});

describe('unanswered, unknown and unavailable examination', () => {
  it('unknown or declined on a branching question goes to review, never to a default branch', () => {
    for (const status of ['unknown', 'declined'] as const) {
      let { enc, cid } = start('knee', PHYSIO);
      enc = denyAllSafety(enc, cid, 'knee');
      enc = ans(enc, cid, 'hip_knee:KQ1', status, PHYSIO);
      const e = ev(enc, cid);
      expect(e.halt).toMatchObject({ reason: 'NEEDS_REVIEW', nodeId: 'hip_knee:KQ1' });
      expect(e.candidate).toBeNull();
    }
  });
  it('examination not performed: no result inferred, no candidate, pathway waits', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee');
    enc = ans(enc, cid, 'hip_knee:KQ1', 'hip_knee:KQ1a', CHW);
    enc = ans(enc, cid, 'hip_knee:KQ2', 'hip_knee:KQ2a', CHW);
    enc = ans(enc, cid, 'hip_knee:KT1', 'not_performed', CHW);
    const e = ev(enc, cid);
    expect(e.halt).toMatchObject({ reason: 'EXAM_PENDING', nodeId: 'hip_knee:KT1' });
    expect(e.candidate).toBeNull();
    expect(e.doseLevel).toBeNull();
  });
  it('a physio-level test result recorded by someone without that capability does not count', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee');
    enc = ans(enc, cid, 'hip_knee:KQ1', 'hip_knee:KQ1a', CHW);
    enc = ans(enc, cid, 'hip_knee:KQ2', 'hip_knee:KQ2a', CHW);
    enc = ans(enc, cid, 'hip_knee:KT1', 'hip_knee:KT1a', CHW); // Lachman positive claimed by CHW
    expect(ev(enc, cid).halt?.reason).toBe('EXAM_PENDING');
    expect(ev(enc, cid).candidate).toBeNull();
    enc = ans(enc, cid, 'hip_knee:KT1', 'hip_knee:KT1a', PHYSIO);
    expect(ev(enc, cid).candidate?.diagnosisId).toBe('hip_knee:KD1');
  });
  it('single-result tests offer no negative arrow in the source: "none of these" goes to review', () => {
    const e = stepFrom('hip_knee', 'KT11', 'KT11#none');
    expect(e.halt?.reason).toBe('NO_SOURCE_BRANCH');
  });
});

describe('cycles, corrected answers, age thresholds', () => {
  it('KT6 <-> KT7 loop in the source stops instead of spinning', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee');
    for (const [q, o] of [['KQ1', 'KQ1b'], ['KQ3', 'KQ3b'], ['KQ5', 'KQ5a'], ['KT6', 'KT6b'], ['KT7', 'KT7b']]) enc = ans(enc, cid, `hip_knee:${q}`, `hip_knee:${o}`, PHYSIO);
    const e = ev(enc, cid, 30);
    expect(e.halt).toMatchObject({ reason: 'CYCLE', nodeId: 'hip_knee:KT6' });
    expect(e.candidate).toBeNull();
  });
  it('KN1 ("re-test in 1-2 weeks") loops back to KT1 and is held for review', () => {
    const e = stepFrom('hip_knee', 'KT1', 'KT1b');
    expect(e.trace.map((t) => t.nodeId)).toEqual(['hip_knee:KT1', 'hip_knee:KN1']);
    expect(e.halt).toMatchObject({ reason: 'CYCLE', nodeId: 'hip_knee:KT1' });
    expect(e.candidate).toBeNull();
  });
  it('changing an earlier answer recomputes the path and marks dependent answers stale', () => {
    let { enc, cid } = routine('knee');
    expect(ev(enc, cid).candidate?.diagnosisId).toBe('hip_knee:KD8');
    enc = ans(enc, cid, 'hip_knee:KQ1', 'hip_knee:KQ1a', PHYSIO); // was "gradual", now "specific injury"
    const e = ev(enc, cid);
    expect(e.current).toEqual({ type: 'ask', nodeId: 'hip_knee:KQ2' });
    expect(e.candidate).toBeNull();
    expect(e.doseLevel).toBeNull();
    expect(e.staleAnswers.sort()).toEqual(['hip_knee:KQ3', 'hip_knee:KS3-1', 'hip_knee:KT5']);
    // history is kept: the superseded answer is in the audit trail
    const changed = enc.events.filter((x) => x.type === 'answer_changed' && x.detail.nodeId === 'hip_knee:KQ1');
    expect((changed[0].detail.previous as any).optionId).toBe('hip_knee:KQ1b');
  });
  it('KQ3 age answers: boundary ages 15/16/44/45 are checked against the recorded age', () => {
    const fits = (opt: string, age: number) => stepFrom('hip_knee', 'KQ3', opt, age).contradictions.length === 0;
    expect([fits('KQ3a', 15), fits('KQ3a', 16)]).toEqual([true, false]);
    expect([fits('KQ3b', 15), fits('KQ3b', 16), fits('KQ3b', 44), fits('KQ3b', 45)]).toEqual([false, true, true, false]);
    expect([fits('KQ3c', 44), fits('KQ3c', 45)]).toEqual([false, true]);
    // unknown age: nothing is assumed either way
    expect(stepFrom('hip_knee', 'KQ3', 'KQ3c', null).contradictions).toEqual([]);
  });
  it('KN2 routes by age as its text says (45+ -> KT5, younger -> KT6); unknown age is held', () => {
    expect(stepFrom('hip_knee', 'KQ6', 'KQ6d', 45).trace.map((t) => t.nodeId)).toEqual(['hip_knee:KQ6', 'hip_knee:KN2', 'hip_knee:KT5']);
    expect(stepFrom('hip_knee', 'KQ6', 'KQ6d', 44).trace.map((t) => t.nodeId)).toEqual(['hip_knee:KQ6', 'hip_knee:KN2', 'hip_knee:KT6']);
    expect(stepFrom('hip_knee', 'KQ6', 'KQ6d', null).halt?.reason).toBe('AGE_UNKNOWN');
  });
});

describe('routine route in each region reaches a candidate, exercise group and dose', () => {
  for (const pathway of Object.keys(ROUTINE) as Pathway[]) {
    it(pathway, () => {
      const { enc, cid } = routine(pathway);
      const e = ev(enc, cid);
      expect(e.pathway).toBe(pathway);
      expect(e.candidate?.diagnosisId).toBe(ROUTINE[pathway].diagnosis);
      expect(e.candidate!.exerciseGroups.length).toBeGreaterThan(0);
      expect(e.doseLevel).toBe(ROUTINE[pathway].dose);
      expect(e.current).toEqual({ type: 'baseline' });
      expect(e.halt).toBeNull();
      expect(e.staleAnswers).toEqual([]);
    });
  }
});
