// The phone build (VITE_STANDALONE=1) has no server. It must never touch the network, must
// keep an encounter queued rather than claim it was sent, and must report AI as unavailable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('phone build without a server', () => {
  const fetchSpy = vi.fn(async () => {
    throw new Error('fetch must not be called in the phone build');
  });

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_STANDALONE', '1');
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('flags the build as standalone', async () => {
    const { STANDALONE } = await import('../src/platform');
    expect(STANDALONE).toBe(true);
  });

  it('keeps a queued encounter queued, with its idempotency key, and sends nothing', async () => {
    const { SyncClient, fetchTransport } = await import('../src/integration/sync');
    const { NO_SERVER } = await import('../src/platform');
    const { createEncounter } = await import('../src/store/encounter');
    const { DEMO_PATIENTS } = await import('../src/store/fixtures');
    const actor = { id: 'chw-1', name: 'Demo CHW', role: 'chw' as const, capabilities: ['trained' as const] };
    const client = new SyncClient(fetchTransport);
    const queued = client.queue(createEncounter(DEMO_PATIENTS[0], actor as any, 'test'), actor as any);
    const after = await client.submit(queued, actor as any, {} as any);
    expect(after.sync.state).toBe('queued_for_sync');
    expect(after.sync.idempotencyKey).toBe(queued.sync.idempotencyKey);
    expect(after.sync.receiptId).toBeUndefined();
    expect(after.sync.lastError).toContain(NO_SERVER);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports the server AI as unavailable without calling it', async () => {
    const { fetchAiStatus, httpProvider } = await import('../src/ai/httpProvider');
    const status = await fetchAiStatus();
    expect(status.enabled).toBe(false);
    const res = await httpProvider.extract({} as any, new AbortController().signal);
    expect(res.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
