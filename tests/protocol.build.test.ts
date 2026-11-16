import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSourcePack } from '../src/protocol/sourcePack';
import { compileProtocol, type Overlay } from '../src/protocol/compile';
import { zProtocol, zLedgerEntry } from '../src/protocol/schema';
import { validateGraph } from '../src/engine/validateGraph';
import { protocol } from '../src/protocol';
import { PACK } from './helpers';

const root = join(__dirname, '..');
const pack = loadSourcePack(PACK);
const overlay = JSON.parse(readFileSync(join(root, 'protocol/overlay/overlay.json'), 'utf8')) as Overlay;
const built = compileProtocol(pack, overlay);
const ledger = JSON.parse(readFileSync(join(root, 'protocol/compiled/ledger.json'), 'utf8'));

describe('source snapshot and reproducible import', () => {
  it('raw XML hashes match the manifest (frozen snapshot)', () => {
    expect(pack.boards.every((b) => b.rawShaVerified)).toBe(true);
    expect(pack.snapshotDate).toBe('2026-11-15');
  });
  it('inventory matches the audited counts: spine 249/273, hip_knee 274/285', () => {
    const n = (b: string) => pack.nodes.filter((x) => x.board === b).length;
    const e = (b: string) => pack.edges.filter((x) => x.board === b).length;
    expect([n('spine'), e('spine'), n('hip_knee'), e('hip_knee')]).toEqual([249, 273, 274, 285]);
    expect(pack.sections.length).toBe(21);
  });
  it('the committed compiled protocol and ledger equal a fresh build from pack + overlay', () => {
    expect(JSON.parse(JSON.stringify(built.protocol))).toEqual(JSON.parse(readFileSync(join(root, 'protocol/compiled/protocol.json'), 'utf8')));
    expect(JSON.parse(JSON.stringify(built.ledger))).toEqual(ledger);
  });
  it('compiled protocol validates against the schema and never claims approval', () => {
    const p = zProtocol.parse(protocol);
    expect(p.clinicalApproval).toBe('none');
    expect(Object.values(p.nodes).every((n) => n.reviewStatus !== undefined && !/approved/.test(n.reviewStatus))).toBe(true);
  });
});

describe('ledger: every source element is accounted for', () => {
  it('one entry per source node and per connector, all schema-valid', () => {
    for (const l of ledger) zLedgerEntry.parse(l);
    const ids = new Set(ledger.map((l: any) => `${l.elementType}|${l.sourceId}`));
    expect(ids.size).toBe(ledger.length);
    expect(ledger.filter((l: any) => l.elementType === 'node').length).toBe(523);
    expect(ledger.filter((l: any) => l.elementType === 'connector').length).toBe(558);
  });
  it('classification totals: 1022 implemented, 59 supporting reference, 0 blocked', () => {
    const c = (k: string) => ledger.filter((l: any) => l.classification === k).length;
    expect([c('implemented'), c('supporting_reference'), c('duplicate'), c('blocked')]).toEqual([1022, 59, 0, 0]);
  });
});

describe('issues named in the source audit are represented explicitly', () => {
  it('section-anchored connectors 10:1317 and 10:1321 become the Stage 2 -> Stage 3 rule', () => {
    const l = (id: string) => ledger.find((x: any) => x.nodeId === id);
    expect(l('10:1317').canonical).toBe('pathways.knee.measureStart');
    expect(l('10:1321').canonical).toBe('pathways.hip.measureStart');
    expect(protocol.pathways.knee.measureStart).toBe('hip_knee:KS3');
    expect(protocol.pathways.hip.measureStart).toBe('hip_knee:HS3');
  });
  it('all 22 unlabeled page-level connectors into E1-E8 are preserved as diagnosis -> group links', () => {
    const links = Object.values(protocol.nodes).filter((n) => n.source.board === 'hip_knee' && n.kind === 'diagnosis').flatMap((n) => n.exerciseGroups.map((g) => `${n.source.code}>${g.split(':')[1]}`));
    expect(links.length).toBe(22);
    expect(links.sort()).toEqual(
      ['KD8>E1', 'KD12>E1', 'KD13>E1', 'KD15>E1', 'HD1>E1', 'KD5>E2', 'KD9>E2', 'KD11>E2', 'KD16>E2', 'HD2>E3', 'KD10>E4', 'HD7>E5', 'HD9>E6', 'HD10>E6', 'HD3>E7', 'HD4>E7', 'HD5>E7', 'HD6>E7', 'KD1>E8', 'KD2>E8', 'KD3>E8', 'KD4>E8'].sort(),
    );
  });
  it('diagnoses without a group arrow get no invented group', () => {
    for (const c of ['KD6', 'KD7', 'KD14', 'HD8', 'HD11']) expect(protocol.nodes[`hip_knee:${c}`].exerciseGroups).toEqual([]);
  });
  it('draft-status and "skilled test not available" nodes are kept as reference, with amendments', () => {
    expect(protocol.nodes['spine:n1_6343'].sourceText).toMatch(/note the test as “not done” and keep going/);
    expect(protocol.nodes['hip_knee:n3_5'].sourceText).toMatch(/Draft for clinical review/);
    expect(protocol.amendments.map((a) => a.id)).toEqual(expect.arrayContaining(['A01-eligibility-gate', 'A02-not-performed-is-not-negative', 'A03-exclusion-is-not-confirmation', 'A04-section-level-connectors', 'A05-exercise-group-links']));
    expect(protocol.amendments.every((a) => a.status === 'proposed_unreviewed')).toBe(true);
  });
  it('gated post-clearance arrows are never ordinary transitions', () => {
    expect(protocol.nodes['spine:L6Y'].outcome!.gatedNext).toEqual(['spine:LD12']);
    expect(protocol.nodes['spine:L6Y'].next).toBeNull();
  });
});

describe('graph validation', () => {
  const g = validateGraph(protocol);
  it('no missing endpoints and no unreachable executable nodes', () => {
    expect(g.missingEndpoints).toEqual([]);
    expect(g.unreachable).toEqual([]);
  });
  it('cycles are known and handled by the engine (halt, never spin)', () => {
    const sig = g.cycles.map((c) => c.map((x) => x.split(':')[1]).sort().join(','));
    expect(sig).toEqual(expect.arrayContaining(['KT6,KT7', 'KN1,KT1']));
  });
  it('structural findings match the committed list', () => {
    expect(built.issues).toEqual(JSON.parse(readFileSync(join(root, 'protocol/compiled/issues.json'), 'utf8')));
    expect(built.issues.length).toBe(8);
  });
  it('cross-pathway edges exist only through explicit switch handling', () => {
    expect(g.crossPathway).toEqual([]);
  });
});
