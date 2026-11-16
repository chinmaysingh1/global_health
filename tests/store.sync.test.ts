import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { protocol } from '../src/protocol';
import { EncounterStore, IdbPersistence, MemoryPersistence } from '../src/store/persistence';
import { buildSummary } from '../src/engine/summary';
import { buildHandoff, zHandoffBundle, FIELD_MAPPINGS, INTEGRATION_STATUS } from '../src/integration/adapter';
import { SyncClient, type Transport } from '../src/integration/sync';
import { MockIntelehealth } from '../server/mockIntelehealth';
import { renderNote } from '../src/ai/note';
import { ans, CHW, patient, PHYSIO, routine, start } from './helpers';
import type { Encounter } from '../src/store/types';

const bundleOf = (enc: Encounter) => buildHandoff(protocol, buildSummary(protocol, patient(), enc));
function harness(ttl = 900) {
  let now = 1_000_000;
  const server = new MockIntelehealth(ttl, () => now);
  let online = true;
  const calls: string[] = [];
  const transport: Transport = {
    async request(method, path, headers, body) {
      calls.push(`${method} ${path}`);
      if (!online) throw new Error('Failed to fetch');
      const r = server.handle({ method, path: path.replace('/mock-intelehealth', ''), headers, body });
      return { status: r.status, body: r.body };
    },
  };
  return { server, transport, calls, setOnline: (v: boolean) => (online = v), advance: (ms: number) => (now += ms), client: new SyncClient(transport) };
}

describe('autosave and reload (IndexedDB)', () => {
  it('every mutation is persisted; a new store instance restores the same revision', async () => {
    const factory = new IDBFactory();
    const store = new EncounterStore(new IdbPersistence(factory));
    await store.load();
    let { enc, cid } = start('knee');
    await store.put(enc);
    enc = ans(enc, cid, 'hip_knee:K1', 'denied');
    enc = ans(enc, cid, 'hip_knee:K2', 'unknown');
    await store.put(enc);
    expect(store.saveState.status).toBe('saved');
    const reopened = new EncounterStore(new IdbPersistence(factory)); // "app restart"
    await reopened.load();
    const back = reopened.get(enc.id)!;
    expect(back.revision).toBe(enc.revision);
    expect(back.complaints[0].answers['hip_knee:K2']).toMatchObject({ status: 'unknown', reason: 'test reason' });
    expect(back.events.length).toBe(enc.events.length); // audit trail survives
  });
  it('a storage failure is surfaced, not swallowed; the in-memory copy is kept', async () => {
    const mem = new MemoryPersistence();
    const store = new EncounterStore(mem);
    const { enc } = start('knee');
    mem.failNextSave = true;
    await store.put(enc);
    expect(store.saveState).toMatchObject({ status: 'error' });
    expect(store.saveState.error).toMatch(/Quota/);
    expect(store.get(enc.id)).not.toBeNull();
    await store.put(ans(enc, enc.complaints[0].id, 'hip_knee:K1', 'denied'));
    expect(store.saveState.status).toBe('saved');
  });
  it('an older revision can never overwrite a newer one (late async writers)', async () => {
    const store = new EncounterStore(new MemoryPersistence());
    const { enc, cid } = start('knee');
    const newer = ans(enc, cid, 'hip_knee:K1', 'present');
    await store.put(newer);
    await store.put(enc); // stale write arrives late
    expect(store.get(enc.id)!.revision).toBe(newer.revision);
    expect(store.get(enc.id)!.complaints[0].answers['hip_knee:K1'].status).toBe('present');
  });
});

describe('handoff bundle (simulated integration)', () => {
  it('validates against the bundle schema and is labelled simulated, synthetic, not for patient care', () => {
    const { enc } = routine('knee');
    const b = zHandoffBundle.parse(bundleOf(enc));
    expect(b.integrationStatus).toBe(INTEGRATION_STATUS);
    expect(b).toMatchObject({ synthetic: true, notForPatientCare: true, generator: { clinicalApproval: 'none' } });
    expect(b.generator.sources.map((s) => s.rawSha256.length)).toEqual([64, 64]);
  });
  it('no field claims a verified Intelehealth mapping; the unmapped report lists them all', () => {
    expect(FIELD_MAPPINGS.every((m) => m.target === null && m.blocker.length > 10)).toBe(true);
    expect(JSON.stringify(FIELD_MAPPINGS)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); // no invented UUIDs
    const { enc } = routine('knee');
    expect(bundleOf(enc).unmapped).toHaveLength(FIELD_MAPPINGS.length);
  });
  it('keeps answer states distinct and separates engine candidate from clinician assessment', () => {
    let { enc, cid } = start('knee', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K1', 'denied', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K2', 'unknown', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K3', 'declined', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K4', 'not_performed', PHYSIO);
    enc = ans(enc, cid, 'hip_knee:K5', 'present', PHYSIO);
    const checks = bundleOf(enc).complaints[0].safety.checks;
    expect(checks.slice(0, 6).map((c: any) => c.status)).toEqual(['denied', 'unknown', 'declined', 'not_performed', 'present', 'not_asked']);
    const r = routine('knee');
    const a = bundleOf(r.enc).complaints[0].assessment;
    expect(a.engineCandidate).toMatchObject({ code: 'KD8', status: 'candidate_not_a_diagnosis' });
    expect(a.clinicianConfirmed).toBeNull();
    expect(bundleOf(r.enc).complaints[0].plan.exerciseGroups).toEqual([]); // unapproved plans are not exported as plans
  });
  it('deterministic note states only recorded facts and keeps the patient\'s words unedited', () => {
    let { enc, cid } = start('knee', CHW);
    enc.complaints[0].patientWords = 'डावा गुडघा दुखतो';
    enc = ans(enc, cid, 'hip_knee:K1', 'denied');
    enc = ans(enc, cid, 'hip_knee:K2', 'unknown');
    const note = renderNote(protocol, buildSummary(protocol, patient(), enc));
    expect(note).toContain('डावा गुडघा दुखतो');
    expect(note).toMatch(/Explicitly denied: K1/);
    expect(note).toMatch(/Not asked: K3, K4/);
    expect(note).not.toMatch(/no known allergies|examination normal|unremarkable/i);
    expect(note).toMatch(/No candidate assessment has been produced/);
    expect(note).toMatch(/Not for patient care/);
  });
});

describe('sync: acknowledgment, duplicates, expired sign-in, conflict, offline queue', () => {
  it('success is recorded only after a server receipt', async () => {
    const h = harness();
    let { enc } = routine('knee');
    expect(enc.sync.state).toBe('saved_on_device');
    enc = h.client.queue(enc, CHW);
    expect(enc.sync.state).toBe('queued_for_sync');
    expect(enc.sync.receiptId).toBeUndefined();
    enc = await h.client.submit(enc, CHW, bundleOf(enc));
    expect(enc.sync).toMatchObject({ state: 'received_by_server', serverVersion: 1 });
    expect(enc.sync.receiptId).toMatch(/^mock-rcpt-/);
    expect(h.server.count()).toBe(1);
  });
  it('duplicate submission with the same idempotency key is replayed, not stored twice', async () => {
    const h = harness();
    let { enc } = routine('knee');
    const queued = h.client.queue(enc, CHW);
    const first = await h.client.submit(queued, CHW, bundleOf(queued));
    const again = await h.client.submit(queued, CHW, bundleOf(queued)); // e.g. double tap or retry after a lost response
    expect(again.sync.receiptId).toBe(first.sync.receiptId);
    expect(again.sync.serverVersion).toBe(1);
    expect(h.server.count()).toBe(1);
  });
  it('expired sign-in: re-authenticates once and completes; if sign-in fails nothing is marked sent', async () => {
    const h = harness(60);
    let { enc } = routine('knee');
    enc = h.client.queue(enc, CHW);
    const sent = await h.client.submit(enc, CHW, bundleOf(enc));
    h.advance(61_000); // token expires
    let again = h.client.queue(ans(sent, sent.complaints[0].id, 'hip_knee:KS3-1', 'hip_knee:KS3-1a', PHYSIO), CHW);
    again = await h.client.submit(again, CHW, bundleOf(again));
    expect(again.sync).toMatchObject({ state: 'received_by_server', serverVersion: 2 });
    expect(h.calls.filter((c) => c === 'POST /mock-intelehealth/session')).toHaveLength(2);
    // sign-in itself fails
    const broken: Transport = { request: async (m, p) => (p.endsWith('/session') ? { status: 500, body: null } : { status: 401, body: null }) };
    const c2 = new SyncClient(broken);
    let e2 = c2.queue(routine('hip').enc, CHW);
    e2 = await c2.submit(e2, CHW, bundleOf(e2));
    expect(e2.sync.state).toBe('auth_expired');
    expect(e2.sync.receiptId).toBeUndefined();
  });
  it('conflict: a newer server-side record is never overwritten', async () => {
    const h = harness();
    let { enc, cid } = routine('knee');
    enc = h.client.queue(enc, CHW);
    enc = await h.client.submit(enc, CHW, bundleOf(enc));
    h.server.handle({ method: 'POST', path: `/_test/clinician-edit/${enc.id}`, headers: {} }); // clinician changes the server copy
    enc = ans(enc, cid, 'hip_knee:KS3-1', 'hip_knee:KS3-1a', PHYSIO);
    expect(enc.sync.state).toBe('saved_on_device'); // local change after ack => no longer "received"
    enc = h.client.queue(enc, CHW);
    enc = await h.client.submit(enc, CHW, bundleOf(enc));
    expect(enc.sync.state).toBe('sync_conflict');
    expect(enc.sync.lastError).toMatch(/server has version 2/);
    const server = h.server.handle({ method: 'GET', path: `/encounters/${enc.id}`, headers: { authorization: 'Bearer x' } });
    expect(server.status).toBe(401); // and reads need auth too
  });
  it('offline: stays queued with the same key; completes after reconnection without duplication', async () => {
    const h = harness();
    let { enc } = routine('neck');
    enc = h.client.queue(enc, CHW);
    const key = enc.sync.idempotencyKey;
    h.setOnline(false);
    enc = await h.client.submit(enc, CHW, bundleOf(enc));
    expect(enc.sync).toMatchObject({ state: 'queued_for_sync', idempotencyKey: key });
    expect(enc.sync.lastError).toMatch(/network/);
    expect(h.server.count()).toBe(0);
    h.setOnline(true);
    enc = await h.client.submit(enc, CHW, bundleOf(enc));
    expect(enc.sync.state).toBe('received_by_server');
    expect(h.server.count()).toBe(1);
  });
  it('mock server rejects malformed or non-synthetic bundles and missing idempotency keys', () => {
    const s = new MockIntelehealth();
    const token = (s.handle({ method: 'POST', path: '/session', headers: {}, body: { username: 't' } }).body as any).token;
    const auth = { authorization: `Bearer ${token}` };
    expect(s.handle({ method: 'PUT', path: '/encounters/x', headers: auth, body: {} }).status).toBe(400);
    expect(s.handle({ method: 'PUT', path: '/encounters/x', headers: { ...auth, 'idempotency-key': 'k' }, body: { junk: true } }).status).toBe(422);
    const { enc } = routine('knee');
    const b = bundleOf(enc);
    expect(s.handle({ method: 'PUT', path: '/encounters/other-id', headers: { ...auth, 'idempotency-key': 'k2', 'if-match': '0' }, body: b }).status).toBe(422);
    expect(s.handle({ method: 'PUT', path: `/encounters/${enc.id}`, headers: { 'idempotency-key': 'k3' }, body: b }).status).toBe(401);
  });
});
