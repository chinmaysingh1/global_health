import { describe, expect, it } from 'vitest';
import { protocol } from '../src/protocol';
import type { Pathway } from '../src/protocol/schema';
import { ans, CHW, CHW_NO_KIT, denyAllSafety, ev, PHYSIO, ROUTINE, routine, start } from './helpers';

// Hand-transcribed from the source boards (headline of each "YES" box), NOT from the compiled
// protocol. C = the box says the checklist continues.
const EXPECTED: Record<Pathway, Record<string, string>> = {
  knee: { K1: 'emergency', K2: 'emergency', K3: 'emergency', K4: 'emergency', K5: 'urgent', K6: 'urgent', K7: 'soon+C', K8: 'emergency', K9: 'urgent', K10: 'refer', K11: 'refer', K12: 'switch', K13: 'refer' },
  hip: { H1: 'emergency', H2: 'emergency', H3: 'emergency', H4: 'emergency', H5: 'urgent', H6: 'urgent', H7: 'refer', H8: 'refer', H9: 'switch', H10: 'switch', H11: 'urgent', H12: 'refer' },
  low_back: { L1: 'emergency', L2: 'emergency', L3: 'emergency', L4: 'emergency', L5: 'urgent', L6: 'urgent', L7: 'urgent', L8: 'urgent', L9: 'soon', L10: 'refer', L11: 'switch', L12: 'refer' },
  neck: { N1: 'emergency', N2: 'emergency', N3: 'emergency', N4: 'emergency', N5: 'emergency', N6: 'urgent', N7: 'urgent', N8: 'urgent', N9: 'urgent', N10: 'soon', N11: 'refer', N12: 'switch' },
};
const BOARD: Record<Pathway, string> = { knee: 'hip_knee', hip: 'hip_knee', low_back: 'spine', neck: 'spine' };

describe('Stage 1 safety screen: every check, all four pathways', () => {
  for (const pathway of Object.keys(EXPECTED) as Pathway[]) {
    const codes = Object.keys(EXPECTED[pathway]);
    it(`${pathway}: source order and count`, () => {
      expect(protocol.pathways[pathway].safetyChecks.map((id) => id.split(':')[1])).toEqual(codes);
    });
    for (const code of codes) {
      const id = `${BOARD[pathway]}:${code}`;
      const [urgency, cont] = EXPECTED[pathway][code].split('+');
      it(`${pathway} ${code} = YES -> ${urgency}${cont ? ' (continues)' : ''}`, () => {
        let { enc, cid } = start(ROUTINE[pathway].region, PHYSIO);
        enc = denyAllSafety(enc, cid, pathway, PHYSIO, [id]);
        enc = ans(enc, cid, id, 'present', PHYSIO);
        const e = ev(enc, cid);
        expect(e.safety.state).toBe('concern_raised');
        expect(e.safety.positives).toEqual([id]);
        if (urgency === 'switch') {
          // multi-action box: an explicit follow-up choice is required before anything happens
          expect(e.current).toEqual({ type: 'switch', nodeId: `${id}Y`, checkId: id });
          expect(e.candidate).toBeNull();
        } else {
          expect(e.alerts).toHaveLength(1);
          expect(e.alerts[0].urgency).toBe(urgency);
          expect(e.alerts[0].outcomeId).toBe(`${id}Y`);
          if (cont) {
            expect(e.halt).toBeNull();
            expect(e.current).toEqual({ type: 'ask', nodeId: protocol.pathways[pathway].stage2Start.replace(/S2$/, 'Q1') });
          } else {
            expect(e.halt?.reason).toBe('ESCALATED');
            expect(e.current).toBeNull();
            expect(e.candidate).toBeNull();
          }
        }
      });
    }
    it(`${pathway}: all checks denied by a capable examiner -> no concern reported, Stage 2 starts`, () => {
      let { enc, cid } = start(ROUTINE[pathway].region, PHYSIO);
      enc = denyAllSafety(enc, cid, pathway, PHYSIO);
      const e = ev(enc, cid);
      expect(e.safety.state).toBe('no_concern_reported');
      expect(e.safety.incomplete).toEqual([]);
      expect(e.alerts).toEqual([]);
      expect(e.current?.type).toBe('ask');
    });
  }
});

describe('missing safety evidence never becomes a negative', () => {
  it('unanswered check stops the screen at that check (no default to "no")', () => {
    let { enc, cid } = start('knee');
    enc = ans(enc, cid, 'hip_knee:K1', 'denied');
    const e = ev(enc, cid);
    expect(e.current).toEqual({ type: 'ask', nodeId: 'hip_knee:K2' });
    expect(e.safety.state).toBe('in_progress');
  });
  for (const status of ['unknown', 'declined', 'not_performed'] as const) {
    it(`${status} on one check: history capture continues, clearance stays incomplete`, () => {
      let { enc, cid } = start('knee', PHYSIO);
      enc = denyAllSafety(enc, cid, 'knee', PHYSIO, ['hip_knee:K4']);
      enc = ans(enc, cid, 'hip_knee:K4', status, PHYSIO);
      const e = ev(enc, cid);
      expect(e.safety.state).toBe('incomplete');
      expect(e.safety.incomplete).toEqual([{ checkId: 'hip_knee:K4', reason: status, missingCapabilities: [] }]);
      expect(e.current).toEqual({ type: 'ask', nodeId: 'hip_knee:KQ1' });
    });
  }
  it('CHW "no" on a check that needs a physio-level examination is history-only, not clearance', () => {
    let { enc, cid } = start('knee', CHW);
    enc = denyAllSafety(enc, cid, 'knee', CHW);
    const e = ev(enc, cid);
    expect(e.safety.state).toBe('incomplete');
    expect(e.safety.incomplete.map((i) => i.checkId)).toEqual(['hip_knee:K8', 'hip_knee:K12']);
    expect(e.safety.incomplete[0]).toMatchObject({ reason: 'history_only_exam_capability_missing', missingCapabilities: ['physio'] });
  });
  it('a check that needs basic kit is incomplete when the kit is not available', () => {
    let { enc, cid } = start('knee', CHW_NO_KIT);
    enc = ans(enc, cid, 'hip_knee:K1', 'denied', CHW_NO_KIT);
    enc = ans(enc, cid, 'hip_knee:K2', 'denied', CHW_NO_KIT);
    enc = ans(enc, cid, 'hip_knee:K3', 'denied', CHW_NO_KIT);
    enc = denyAllSafety(enc, cid, 'knee', PHYSIO, ['hip_knee:K1', 'hip_knee:K2', 'hip_knee:K3']);
    const e = ev(enc, cid);
    expect(e.safety.incomplete).toEqual([{ checkId: 'hip_knee:K3', reason: 'history_only_exam_capability_missing', missingCapabilities: ['basic_kit'] }]);
  });
});

describe('late and simultaneous concerns', () => {
  it('a concern disclosed after Stage 2 has started applies immediately', () => {
    let { enc, cid } = routine('knee');
    expect(ev(enc, cid).doseLevel).toBe('MD');
    enc = ans(enc, cid, 'hip_knee:K3', 'present', CHW, { via: 'late_concern' });
    const e = ev(enc, cid);
    expect(e.alerts[0]).toMatchObject({ urgency: 'emergency', outcomeId: 'hip_knee:K3Y', late: true });
    expect(e.halt?.reason).toBe('ESCALATED');
    expect(e.current).toBeNull();
    expect(e.doseLevel).toBeNull();
    expect(e.candidate).toBeNull();
  });
  it('several concerns are all raised, most urgent first (proposed priority policy)', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee', PHYSIO, ['hip_knee:K10', 'hip_knee:K5', 'hip_knee:K4']);
    enc = ans(enc, cid, 'hip_knee:K10', 'present', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K5', 'present', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K4', 'present', PHYSIO);
    const e = ev(enc, cid);
    expect(e.alerts.map((a) => a.urgency)).toEqual(['emergency', 'urgent', 'refer']);
    expect(e.alerts.map((a) => a.checkId)).toEqual(['hip_knee:K4', 'hip_knee:K5', 'hip_knee:K10']);
  });
  it('K7 (SOON) continues but a later urgent check still halts', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = denyAllSafety(enc, cid, 'knee', PHYSIO, ['hip_knee:K7', 'hip_knee:K9']);
    enc = ans(enc, cid, 'hip_knee:K7', 'present', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K9', 'present', PHYSIO);
    const e = ev(enc, cid);
    expect(e.alerts.map((a) => a.urgency)).toEqual(['urgent', 'soon']);
    expect(e.halt).toMatchObject({ reason: 'ESCALATED', nodeId: 'hip_knee:K9Y' });
  });
});
