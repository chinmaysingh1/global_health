// MOCK Intelehealth-style endpoint for contract tests and the demo. It is NOT Intelehealth,
// does not implement its API, and stores synthetic bundles in memory only.
import { randomUUID } from 'node:crypto';
import { zHandoffBundle } from '../src/integration/adapter';

export interface MockRequest {
  method: string;
  path: string; // path after /mock-intelehealth
  headers: Record<string, string | undefined>;
  body?: unknown;
}
export interface MockResponse {
  status: number;
  body: unknown;
}

interface Stored {
  version: number;
  bundle: unknown;
  receivedAt: string;
  lastModifiedBy: string;
}

export class MockIntelehealth {
  private tokens = new Map<string, { user: string; expiresAt: number }>();
  private encounters = new Map<string, Stored>();
  private idempotency = new Map<string, MockResponse>();
  constructor(private ttlSeconds = 900, private now: () => number = Date.now) {}

  private auth(headers: MockRequest['headers']): string | null {
    const h = headers['authorization'] ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const t = this.tokens.get(token);
    if (!t || t.expiresAt <= this.now()) return null;
    return t.user;
  }

  handle(req: MockRequest): MockResponse {
    const { method, path } = req;
    if (method === 'POST' && path === '/session') {
      const user = String((req.body as any)?.username ?? '');
      if (!user) return { status: 400, body: { error: 'username required' } };
      const token = randomUUID();
      const expiresAt = this.now() + this.ttlSeconds * 1000;
      this.tokens.set(token, { user, expiresAt });
      return { status: 200, body: { token, expiresAt: new Date(expiresAt).toISOString(), mock: true } };
    }
    // ---- test/demo controls (would not exist on a real server) ----
    if (method === 'POST' && path === '/_test/expire-tokens') {
      this.tokens.clear();
      return { status: 200, body: { ok: true } };
    }
    if (method === 'POST' && path === '/_test/reset') {
      this.tokens.clear();
      this.encounters.clear();
      this.idempotency.clear();
      return { status: 200, body: { ok: true } };
    }
    let m = path.match(/^\/_test\/clinician-edit\/([^/]+)$/);
    if (method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      const e = this.encounters.get(id);
      if (!e) return { status: 404, body: { error: 'not found' } };
      e.version += 1;
      e.lastModifiedBy = 'clinician (server side)';
      return { status: 200, body: { serverVersion: e.version } };
    }

    m = path.match(/^\/encounters\/([^/]+)$/);
    if (m) {
      const user = this.auth(req.headers);
      if (!user) return { status: 401, body: { error: 'token missing or expired' } };
      const id = decodeURIComponent(m[1]);
      if (method === 'GET') {
        const e = this.encounters.get(id);
        if (!e) return { status: 404, body: { error: 'not found' } };
        return { status: 200, body: { serverVersion: e.version, receivedAt: e.receivedAt, lastModifiedBy: e.lastModifiedBy, bundle: e.bundle } };
      }
      if (method === 'PUT') {
        const key = req.headers['idempotency-key'];
        if (!key) return { status: 400, body: { error: 'Idempotency-Key header required' } };
        const replay = this.idempotency.get(`${id}|${key}`);
        if (replay) return { status: 200, body: { ...(replay.body as object), replay: true } };
        const parsed = zHandoffBundle.safeParse(req.body);
        if (!parsed.success) return { status: 422, body: { error: 'bundle failed schema validation', issues: parsed.error.issues.slice(0, 5) } };
        if (parsed.data.encounter.localId !== id) return { status: 422, body: { error: 'encounter id does not match the URL' } };
        if (!parsed.data.synthetic) return { status: 422, body: { error: 'mock server accepts synthetic data only' } };
        const existing = this.encounters.get(id);
        const ifMatch = Number(req.headers['if-match'] ?? '0');
        const currentVersion = existing?.version ?? 0;
        if (ifMatch !== currentVersion) {
          return { status: 409, body: { error: 'version conflict', serverVersion: currentVersion, lastModifiedBy: existing?.lastModifiedBy ?? null } };
        }
        const stored: Stored = { version: currentVersion + 1, bundle: parsed.data, receivedAt: new Date(this.now()).toISOString(), lastModifiedBy: user };
        this.encounters.set(id, stored);
        const res: MockResponse = { status: existing ? 200 : 201, body: { receiptId: `mock-rcpt-${randomUUID()}`, serverVersion: stored.version, receivedAt: stored.receivedAt, mock: true } };
        this.idempotency.set(`${id}|${key}`, res);
        return res;
      }
    }
    return { status: 404, body: { error: 'unknown mock route' } };
  }

  count(): number {
    return this.encounters.size;
  }
}
