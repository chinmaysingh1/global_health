import { describe, expect, it } from 'vitest';
import { protocol } from '../src/protocol';
import type { Pathway } from '../src/protocol/schema';
import { applicableMeasures, compareMeasures, evaluateFollowUp } from '../src/engine/followup';
import { answerRecord, createFollowUp, setMeasure } from '../src/store/encounter';
import type { MeasureRecord } from '../src/store/types';
import { patient, PHYSIO, ROUTINE, routine, sourceLabels, ev } from './helpers';

const BOARD: Record<Pathway, 'hip_knee' | 'spine'> = { knee: 'hip_knee', hip: 'hip_knee', low_back: 'spine', neck: 'spine' };
const rec = (measureId: string, extra: Partial<MeasureRecord>): MeasureRecord => ({ measureId, status: 'recorded', author: PHYSIO, at: 'x', ...extra });

describe('follow-up rules follow the source arrows (oracle = connector labels)', () => {
  for (const pathway of Object.keys(ROUTINE) as Pathway[]) {
    const board = BOARD[pathway];
    const labels = sourceLabels(board);
    for (const visit of ['week1', 'week4', 'week12'] as const) {
      const qId = protocol.pathways[pathway].followUp[visit];
      const q = protocol.nodes[qId];
      it(`${pathway} ${visit} (${q.source.code}): every answer leads where the board says`, () => {
        expect(q.options.length).toBe(2);
        for (const o of q.options) {
          const code = o.id.split(':')[1];
          const arrow = labels.find((l) => l.from === code);
          const out = evaluateFollowUp(protocol, pathway, visit, answerRecord(PHYSIO, qId, 'present', { optionId: o.id }));
          expect(out.state).toBe('resolved');
          expect(out.actionNode?.source.code ?? null).toBe(arrow?.to ?? null);
        }
      });
    }
    it(`${pathway}: proposals — week 4 improving => level up needs approval; not improving => re-check + safety re-screen`, () => {
      const qId = protocol.pathways[pathway].followUp.week4;
      const q = protocol.nodes[qId];
      const up = q.options.find((o) => protocol.nodes[o.next!].title === 'LEVEL UP')!;
      const no = q.options.find((o) => o.id !== up.id)!;
      const a = evaluateFollowUp(protocol, pathway, 'week4', answerRecord(PHYSIO, qId, 'present', { optionId: up.id }));
      expect(a).toMatchObject({ proposal: 'level_up', requiresClinician: true });
      const b = evaluateFollowUp(protocol, pathway, 'week4', answerRecord(PHYSIO, qId, 'present', { optionId: no.id }));
      expect(b).toMatchObject({ proposal: 'recheck_before_continuing', requiresClinician: true, rerunSafetyScreen: true });
    });
    it(`${pathway}: week 12 — no change => revise or refer (clinician); unknown answer => review, never a default`, () => {
      const qId = protocol.pathways[pathway].followUp.week12;
      const q = protocol.nodes[qId];
      const no = q.options.find((o) => /no change/i.test(o.label))!;
      expect(evaluateFollowUp(protocol, pathway, 'week12', answerRecord(PHYSIO, qId, 'present', { optionId: no.id }))).toMatchObject({ proposal: 'revise_or_refer', requiresClinician: true });
      expect(evaluateFollowUp(protocol, pathway, 'week12', answerRecord(PHYSIO, qId, 'unknown', { reason: 'x' }))).toMatchObject({ state: 'needs_review', proposal: null });
      expect(evaluateFollowUp(protocol, pathway, 'week12', undefined).state).toBe('unanswered');
    });
  }
  it('week 1 "not settled" proposes stepping down and points back to the direction check (spine)', () => {
    const qId = protocol.pathways.low_back.followUp.week1;
    const out = evaluateFollowUp(protocol, 'low_back', 'week1', answerRecord(PHYSIO, qId, 'present', { optionId: 'spine:LS4-5b' }));
    expect(out).toMatchObject({ proposal: 'step_down_and_recheck', requiresClinician: true });
    expect(out.refs).toContain('spine:LT1');
  });
});

describe('like-for-like measurement comparison', () => {
  const defs = protocol.measures.filter((m) => m.pathway === 'knee');
  it('direction-aware trends; only measures recorded at both visits are compared', () => {
    const base = { 'knee.pain_avg': rec('knee.pain_avg', { value: 6 }), 'knee.chair_stand_30s': rec('knee.chair_stand_30s', { value: 9 }), 'knee.walk_40m': rec('knee.walk_40m', { value: 48 }), 'knee.rom_flexion': rec('knee.rom_flexion', { left: 100, right: 130 }), 'knee.stair_climb': rec('knee.stair_climb', { value: 20 }) };
    const cur = { 'knee.pain_avg': rec('knee.pain_avg', { value: 4 }), 'knee.chair_stand_30s': rec('knee.chair_stand_30s', { value: 11 }), 'knee.walk_40m': rec('knee.walk_40m', { value: 50 }), 'knee.rom_flexion': rec('knee.rom_flexion', { left: 110 }), 'knee.stair_climb': rec('knee.stair_climb', { status: 'not_performed', reason: 'no stairs' }) };
    const c = compareMeasures(defs, base, cur);
    const get = (id: string, side?: string) => c.find((x) => x.measureId === id && x.side === side)!;
    expect(get('knee.pain_avg')).toMatchObject({ delta: -2, trend: 'better' });
    expect(get('knee.chair_stand_30s')).toMatchObject({ delta: 2, trend: 'better' });
    expect(get('knee.walk_40m')).toMatchObject({ delta: 2, trend: 'worse' });
    expect(get('knee.rom_flexion', 'left')).toMatchObject({ delta: 10, trend: 'better' });
    expect(get('knee.rom_flexion', 'right').trend).toBe('not_comparable'); // right side missing now
    expect(get('knee.stair_climb').trend).toBe('not_comparable'); // not performed is not a zero
    expect(get('knee.single_leg_stance' as string)?.trend ?? 'not_comparable').toBe('not_comparable');
  });
  it('PSFS is compared task by task; a different task is not compared', () => {
    const base = { 'knee.psfs': rec('knee.psfs', { psfs: [{ task: 'Stairs', score: 3 }, { task: 'Squatting toilet', score: 2 }] }) };
    const cur = { 'knee.psfs': rec('knee.psfs', { psfs: [{ task: 'stairs ', score: 5 }, { task: 'Carrying water', score: 4 }] }) };
    const c = compareMeasures(defs, base, cur).filter((x) => x.measureId === 'knee.psfs');
    expect(c.find((x) => x.item === 'Stairs')).toMatchObject({ delta: 2, trend: 'better' });
    expect(c.find((x) => x.item === 'Squatting toilet')!.trend).toBe('not_comparable');
  });
  it('HIGH irritability limits the baseline to pain, PSFS and range of motion (source rule)', () => {
    const hi = applicableMeasures(protocol, 'knee', 'HI').filter((m) => m.applicable).map((m) => m.def.id);
    expect(hi).toEqual(['knee.pain_avg', 'knee.pain_worst', 'knee.psfs', 'knee.rom_flexion']);
    expect(applicableMeasures(protocol, 'knee', 'MD').every((m) => m.applicable)).toBe(true);
  });
  it('questionnaires are recorded as external totals only; no item text is reproduced', () => {
    const ext = protocol.measures.filter((m) => m.type === 'external_score');
    expect(ext.length).toBeGreaterThanOrEqual(6);
    expect(ext.every((m) => /NOT reproduced/.test(m.note ?? ''))).toBe(true);
  });
});

describe('follow-up encounter', () => {
  it('carries complaint identity, side, pathway and the confirmed plan; starts with no answers', () => {
    const { enc, cid } = routine('knee');
    const fu = createFollowUp(protocol, patient(), PHYSIO, enc, 'week4', { [cid]: { pathway: 'knee', diagnosisId: 'hip_knee:KD8', doseLevel: 'MD', exerciseGroups: ['hip_knee:E1'] } });
    expect(fu).toMatchObject({ type: 'followup', followUpOf: enc.id, visit: 'week4' });
    expect(fu.complaints[0]).toMatchObject({ id: cid, laterality: 'left', entryNode: 'hip_knee:G-KNEE', answers: {}, measures: {} });
    const e = ev(fu, cid);
    expect(e.pathway).toBe('knee');
    expect(e.current).toEqual({ type: 'ask', nodeId: 'hip_knee:K1' }); // safety re-check starts clean; nothing is assumed negative
    const withM = setMeasure(fu, PHYSIO, cid, { measureId: 'knee.pain_avg', status: 'recorded', value: 4 });
    expect(withM.complaints[0].measures['knee.pain_avg'].value).toBe(4);
  });
});
