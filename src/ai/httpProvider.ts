// Client side of the optional real provider. Credentials live on the server only; the
// browser never sees a key. If the server reports "disabled", the manual path is used.
import type { AiProvider, ExtractRequest, NoteRequest, ProviderResult } from './types';
import { NO_SERVER, STANDALONE } from '../platform';

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<ProviderResult<T>> {
  if (STANDALONE) return { ok: false, error: 'network', retryable: false, detail: NO_SERVER };
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e) {
    return { ok: false, error: 'network', retryable: true, detail: String((e as Error).message) };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: 'http_error', retryable: res.status >= 500, detail: `status ${res.status}, non-JSON body` };
  }
  if (res.ok && json?.ok) return { ok: true, data: json.data as T, usage: json.usage ?? {} };
  const error = json?.error ?? 'http_error';
  return { ok: false, error, retryable: res.status >= 500 || res.status === 429, detail: json?.detail, usage: json?.usage };
}

export const httpProvider: AiProvider = {
  id: 'server-configured',
  label: 'Server-configured provider',
  isMock: false,
  extract: (req: ExtractRequest, signal) => post<unknown>('/api/ai/extract', req, signal),
  draftNote: (req: NoteRequest, signal) => post<{ text: string }>('/api/ai/note', req, signal),
};

export interface AiServerStatus {
  enabled: boolean;
  provider: string;
  model: string | null;
  reason?: string;
}
export async function fetchAiStatus(): Promise<AiServerStatus> {
  if (STANDALONE) return { enabled: false, provider: 'disabled', model: null, reason: NO_SERVER };
  try {
    const res = await fetch('/api/ai/status');
    return (await res.json()) as AiServerStatus;
  } catch {
    return { enabled: false, provider: 'disabled', model: null, reason: 'server unreachable' };
  }
}
