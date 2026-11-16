// Provider-neutral AI contract. The engine owns clinical branching; AI only PROPOSES typed
// facts (with an evidence span) and drafts text. Everything it returns is untrusted input.
import { z } from 'zod';
import type { Lang } from '../store/types';

/** A target the model is allowed to propose a fact for. Anything else is rejected. */
export interface PermittedTarget {
  kind: 'safety_check' | 'history_field';
  id: string; // node id or history field code
  complaintId?: string;
  label: string; // short English label; never the full protocol
}

export interface ExtractRequest {
  narrative: string; // patient text or an edited transcript. Untrusted DATA, never instructions.
  lang: Lang;
  permitted: PermittedTarget[];
}

export const zRawFact = z.object({
  target_kind: z.enum(['safety_check', 'history_field']),
  target_id: z.string().max(120),
  complaint_id: z.string().max(120).nullable().optional(),
  status: z.enum(['present', 'denied', 'unknown']),
  value: z.string().max(300).nullable().optional(),
  quote: z.string().min(1).max(400),
  start: z.number().int().min(0).nullable().optional(),
});
export const zRawExtraction = z.object({
  facts: z.array(zRawFact).max(40),
  contradictions: z.array(z.object({ note: z.string().max(300), quotes: z.array(z.string().max(400)).max(4) })).max(10).optional(),
});
export type RawFact = z.infer<typeof zRawFact>;
export type RawExtraction = z.infer<typeof zRawExtraction>;

export interface ProviderUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}
export type ProviderResult<T> =
  | { ok: true; data: T; usage: ProviderUsage }
  | { ok: false; error: 'disabled' | 'refused' | 'http_error' | 'network' | 'bad_config' | 'too_large'; retryable: boolean; detail?: string; usage?: ProviderUsage };

export interface NoteRequest {
  /** Accepted facts only, already rendered as plain lines by the deterministic renderer. */
  factLines: string[];
  lang: 'en';
}

export interface AiProvider {
  id: string;
  label: string;
  isMock: boolean;
  /** Returns the provider's raw output. The caller validates it; providers are not trusted. */
  extract(req: ExtractRequest, signal: AbortSignal): Promise<ProviderResult<unknown>>;
  draftNote(req: NoteRequest, signal: AbortSignal): Promise<ProviderResult<{ text: string }>>;
}

export const AI_LIMITS = {
  timeoutMs: 20000,
  maxRetries: 1,
  maxResponseChars: 20000,
  maxNarrativeChars: 6000,
  maxCallsPerEncounter: 10,
};
