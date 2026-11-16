// Bounded, cancellable AI calls with a manual fallback. A response is applied only if it
// still belongs to the same encounter and narrative it was requested for.
import type { Encounter } from '../store/types';
import { AI_LIMITS, type AiProvider, type PermittedTarget, type ProviderResult } from './types';
import { validateExtraction, type ValidationResult } from './validate';

export type RunStatus = 'ok' | 'disabled' | 'limit_reached' | 'timeout' | 'cancelled' | 'refused' | 'failed' | 'stale' | 'invalid_output' | 'input_too_long';

export interface ExtractionRun {
  status: RunStatus;
  result?: ValidationResult;
  usage: { providerId: string; model?: string; ms: number; inputTokens?: number; outputTokens?: number; attempts: number };
  detail?: string;
}

export interface RunOptions {
  provider: AiProvider | null; // null => runtime AI disabled (the default)
  encounter: Encounter;
  narrativeId: string;
  permitted: PermittedTarget[];
  /** Returns the encounter currently open in the UI/store at the moment the response arrives. */
  getCurrent: () => Encounter | null;
  signal?: AbortSignal;
  limits?: Partial<typeof AI_LIMITS>;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<{ value?: T; timedOut: boolean; cancelled: boolean; error?: unknown }> {
  const ctrl = new AbortController();
  let timedOut = false;
  const onOuter = () => ctrl.abort();
  outer?.addEventListener('abort', onOuter);
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, ms);
  try {
    const value = await Promise.race([
      fn(ctrl.signal),
      new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    ]);
    return { value, timedOut: false, cancelled: false };
  } catch (error) {
    return { timedOut, cancelled: !timedOut && !!outer?.aborted, error };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

export async function runExtraction(opts: RunOptions): Promise<ExtractionRun> {
  const limits = { ...AI_LIMITS, ...opts.limits };
  const started = Date.now();
  const usage = (extra: Partial<ExtractionRun['usage']> = {}): ExtractionRun['usage'] => ({ providerId: opts.provider?.id ?? 'none', ms: Date.now() - started, attempts: 0, ...extra });
  if (!opts.provider) return { status: 'disabled', usage: usage() };
  if (opts.encounter.aiUsage.calls >= limits.maxCallsPerEncounter) return { status: 'limit_reached', usage: usage() };
  const narrative = opts.encounter.narratives.find((n) => n.id === opts.narrativeId);
  if (!narrative) return { status: 'stale', usage: usage(), detail: 'narrative not found' };
  if (narrative.text.length > limits.maxNarrativeChars) return { status: 'input_too_long', usage: usage() };

  let attempts = 0;
  let last: ProviderResult<unknown> | undefined;
  while (attempts <= limits.maxRetries) {
    attempts++;
    const r = await withTimeout((signal) => opts.provider!.extract({ narrative: narrative.text, lang: narrative.lang, permitted: opts.permitted }, signal), limits.timeoutMs, opts.signal);
    if (r.cancelled) return { status: 'cancelled', usage: usage({ attempts }) };
    if (r.timedOut) return { status: 'timeout', usage: usage({ attempts }) }; // timeouts are not retried
    if (r.error) {
      last = { ok: false, error: 'network', retryable: true, detail: String((r.error as Error)?.message ?? r.error) };
    } else last = r.value!;
    if (last.ok || !last.retryable) break;
  }
  if (!last) return { status: 'failed', usage: usage({ attempts }) };
  const u = usage({ attempts, model: last.usage?.model, inputTokens: last.usage?.inputTokens, outputTokens: last.usage?.outputTokens });
  if (!last.ok) {
    if (last.error === 'disabled' || last.error === 'bad_config') return { status: 'disabled', usage: u, detail: last.detail };
    if (last.error === 'refused') return { status: 'refused', usage: u };
    return { status: 'failed', usage: u, detail: last.detail ?? last.error };
  }

  // Stale-response guard: never apply output to another encounter or to a narrative that is gone.
  const current = opts.getCurrent();
  if (!current || current.id !== opts.encounter.id || !current.narratives.some((n) => n.id === opts.narrativeId && n.text === narrative.text)) {
    return { status: 'stale', usage: u };
  }
  const result = validateExtraction(last.data, narrative.text, narrative.id, opts.permitted, { providerId: opts.provider.id, basedOnRevision: opts.encounter.revision });
  if (result.rejected.some((r) => ['not_json', 'schema_invalid', 'response_too_large'].includes(r.reason))) {
    return { status: 'invalid_output', result, usage: u, detail: result.rejected[0].detail ?? result.rejected[0].reason };
  }
  return { status: 'ok', result, usage: u };
}

export { proposalConflict } from '../store/encounter';
