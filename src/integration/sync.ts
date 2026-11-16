// Sync client for the handoff bundle. Success is only ever reported after the server has
// acknowledged with a receipt. Idempotent, conflict-aware, and never overwrites a newer
// server record.
import type { Actor, Encounter } from '../store/types';
import { setSync } from '../store/encounter';
import type { HandoffBundle } from './adapter';

export interface TransportResponse {
  status: number;
  body: any;
}
export interface Transport {
  /** Throws on network failure. */
  request(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<TransportResponse>;
}

export const fetchTransport: Transport = {
  async request(method, path, headers, body) {
    const res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* empty body */
    }
    return { status: res.status, body: json };
  },
};

const BASE = '/mock-intelehealth';

export class SyncClient {
  private token: string | null = null;
  constructor(private transport: Transport, private user = 'demo-chw') {}

  private async login(): Promise<boolean> {
    const r = await this.transport.request('POST', `${BASE}/session`, {}, { username: this.user });
    if (r.status === 200 && r.body?.token) {
      this.token = r.body.token;
      return true;
    }
    return false;
  }

  /** Marks the encounter as queued. Nothing is "sent" until submit() gets an acknowledgment. */
  queue(enc: Encounter, actor: Actor): Encounter {
    return setSync(enc, actor, {
      ...enc.sync,
      state: 'queued_for_sync',
      idempotencyKey: `${enc.id}:r${enc.revision + 1}`, // revision after this sync-state write
      submittedRevision: enc.revision + 1,
      lastError: undefined,
    });
  }

  async submit(enc: Encounter, actor: Actor, bundle: HandoffBundle): Promise<Encounter> {
    if (enc.sync.state !== 'queued_for_sync') return enc;
    const key = enc.sync.idempotencyKey!;
    const attempt = async (): Promise<TransportResponse> =>
      this.transport.request(
        'PUT',
        `${BASE}/encounters/${encodeURIComponent(enc.id)}`,
        { authorization: `Bearer ${this.token ?? ''}`, 'idempotency-key': key, 'if-match': String(enc.sync.serverVersion ?? 0) },
        bundle,
      );
    let res: TransportResponse;
    try {
      if (!this.token && !(await this.login())) return setSync(enc, actor, { ...enc.sync, state: 'auth_expired', lastError: 'login failed' });
      res = await attempt();
      if (res.status === 401) {
        // expired session: re-authenticate once, then retry the same idempotent request
        this.token = null;
        if (!(await this.login())) return setSync(enc, actor, { ...enc.sync, state: 'auth_expired', lastError: 'session expired; sign-in failed' });
        res = await attempt();
        if (res.status === 401) return setSync(enc, actor, { ...enc.sync, state: 'auth_expired', lastError: 'session expired' });
      }
    } catch (e) {
      // offline or server down: stay queued, keep the same idempotency key for the retry
      return setSync(enc, actor, { ...enc.sync, state: 'queued_for_sync', lastError: `network: ${(e as Error).message}` });
    }
    if ((res.status === 200 || res.status === 201) && res.body?.receiptId) {
      return setSync(enc, actor, { state: 'received_by_server', serverVersion: res.body.serverVersion, receiptId: res.body.receiptId, ackAt: res.body.receivedAt, idempotencyKey: key, submittedRevision: enc.sync.submittedRevision });
    }
    if (res.status === 409) {
      return setSync(enc, actor, { ...enc.sync, state: 'sync_conflict', lastError: `server has version ${res.body?.serverVersion} (last modified by ${res.body?.lastModifiedBy ?? 'unknown'}); local copy was not sent` });
    }
    return setSync(enc, actor, { ...enc.sync, state: 'sync_failed', lastError: `server responded ${res.status}${res.body?.error ? `: ${res.body.error}` : ''}` });
  }

  /** After a conflict the user reviews the server copy; this adopts its version for a deliberate re-send. */
  async fetchServerCopy(encId: string): Promise<TransportResponse> {
    if (!this.token) await this.login();
    return this.transport.request('GET', `${BASE}/encounters/${encodeURIComponent(encId)}`, { authorization: `Bearer ${this.token ?? ''}` });
  }
}
