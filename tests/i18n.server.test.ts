import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UI } from '../src/i18n/ui';
import { PROTOCOL_TEXT } from '../src/i18n/protocolText';
import { nodeTitle, optionLabel, t, translationCoverage } from '../src/i18n';
import { protocol } from '../src/protocol';
import { createApp } from '../server/index';
import { readAiConfig } from '../server/anthropicAdapter';
import { MockIntelehealth } from '../server/mockIntelehealth';

const DEVANAGARI = /[ऀ-ॿ]/;
const OTHER_SCRIPTS = /[ঀ-෿؀-ۿ一-鿿Ѐ-ӿ]/; // Bengali..Sinhala, Arabic, CJK, Cyrillic

describe('localisation: English, Hindi and Marathi only', () => {
  it('every UI key has all three languages; Hindi and Marathi are in Devanagari; no other scripts', () => {
    for (const [k, row] of Object.entries(UI)) {
      expect(row.length, k).toBe(3);
      expect(row.every((s) => s.trim().length > 0), k).toBe(true);
      expect(DEVANAGARI.test(row[1]), `${k} hi`).toBe(true);
      expect(DEVANAGARI.test(row[2]), `${k} mr`).toBe(true);
      expect(OTHER_SCRIPTS.test(row.join('')), k).toBe(false);
      expect(DEVANAGARI.test(row[0]), `${k} en`).toBe(false);
    }
  });
  it('every key used by the UI exists (no silent fallbacks); dynamic key families are complete', () => {
    const dir = join(__dirname, '..', 'src', 'ui');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\btr\('([a-zA-Z0-9_.]+)'\)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(120);
    expect([...used].filter((k) => !UI[k])).toEqual([]);
    const families: Record<string, string[]> = {
      'halt.': ['ESCALATED', 'SWITCHED', 'SWITCH_LOOP', 'NEEDS_REVIEW', 'EXAM_PENDING', 'REOPEN_SAFETY', 'CYCLE', 'NO_SOURCE_BRANCH', 'REFERRAL_END', 'AGE_UNKNOWN'],
      'bk.': ['CONSENT_MISSING', 'ELIGIBILITY_UNVERIFIED', 'SAFETY_NOT_FINISHED', 'SAFETY_INCOMPLETE', 'ALERT_UNRESOLVED', 'ALERT_UNACKNOWLEDGED', 'PATHWAY_HALTED', 'EXAM_PENDING', 'CONTRADICTION', 'NO_CANDIDATE', 'DIAGNOSIS_NOT_CONFIRMED', 'DOSE_NOT_SET', 'PAEDIATRIC_REVIEW', 'MODIFIER_SIGNOFF', 'MODIFIERS_NOT_ASKED'],
      'st.': ['present', 'denied', 'unknown', 'declined', 'not_performed', 'not_applicable', 'not_asked', 'incomplete'],
      'sync.': ['saved_on_device', 'awaiting_review', 'queued_for_sync', 'received_by_server', 'sync_conflict', 'auth_expired', 'sync_failed'],
      'alert.': ['emergency', 'urgent', 'soon', 'refer', 'switch'],
      'alert.ex.': ['no_exercise', 'hold_loading_until_cleared', 'medical_review_first', 'gentle_only_pending_review', 'not_stated'],
      'safety.': ['not_started', 'in_progress', 'concern_raised', 'incomplete', 'no_concern_reported'],
      'ai.status.': ['ok', 'disabled', 'limit_reached', 'timeout', 'cancelled', 'refused', 'failed', 'stale', 'invalid_output', 'input_too_long'],
      'fu.p.': ['keep_level', 'step_down_and_recheck', 'level_up', 'recheck_before_continuing', 'continue_self_management', 'revise_or_refer'],
    };
    for (const [prefix, keys] of Object.entries(families)) for (const k of keys) expect(UI[prefix + k], prefix + k).toBeDefined();
    for (const m of protocol.measures) expect(UI[m.labelKey], m.labelKey).toBeDefined();
    for (const n of Object.values(protocol.nodes)) for (const o of n.outcome?.switchOptions ?? []) expect(UI[o.labelKey], o.labelKey).toBeDefined();
    for (const n of Object.values(protocol.nodes)) for (const o of n.options) if (!o.source) expect(UI[o.label], o.label).toBeDefined();
    expect(t('no.such.key', 'hi')).toBe('⟦no.such.key⟧'); // a missing key is visible, never silently English
  });
  it('protocol translations point at real nodes/options and are always marked as drafts', () => {
    const optionIds = new Set(Object.values(protocol.nodes).flatMap((n) => n.options.map((o) => o.id)));
    for (const [id, row] of Object.entries(PROTOCOL_TEXT)) {
      expect(protocol.nodes[id] || optionIds.has(id), id).toBeTruthy();
      expect(DEVANAGARI.test(row[0]) && DEVANAGARI.test(row[1]), id).toBe(true);
    }
    const k3 = protocol.nodes['hip_knee:K3'];
    expect(nodeTitle(k3, 'en')).toMatchObject({ fallback: false, draft: false });
    expect(nodeTitle(k3, 'mr')).toMatchObject({ fallback: false, draft: true });
    expect(nodeTitle(k3, 'mr').text).toMatch(DEVANAGARI);
  });
  it('a missing clinical translation is shown as English WITH a marker, never silently substituted', () => {
    const kt1 = protocol.nodes['hip_knee:KT1'];
    expect(nodeTitle(kt1, 'hi')).toMatchObject({ fallback: true, draft: false, text: expect.stringMatching(/^Test the ACL/) });
    expect(optionLabel(kt1.options[0], 'mr').fallback).toBe(true);
    expect(optionLabel(protocol.nodes['hip_knee:KQ1'].options[0], 'mr')).toMatchObject({ fallback: false, draft: true });
  });
  it('coverage is reported honestly: all 49 safety titles; knee Stage 2 answers', () => {
    const safety = Object.values(protocol.nodes).filter((n) => n.kind === 'safety_check');
    expect(safety).toHaveLength(49);
    expect(safety.every((n) => PROTOCOL_TEXT[n.id])).toBe(true);
    const cov = translationCoverage(Object.values(protocol.nodes));
    expect(cov.titlesTranslated).toBeLessThan(cov.titles);
    expect(cov.optionsTranslated).toBeLessThan(cov.options);
    expect(cov.titlesTranslated).toBe(56);
  });
});

describe('server boundary (real HTTP on an ephemeral port)', () => {
  let base = '';
  let server: ReturnType<typeof createApp>;
  const calls: unknown[] = [];
  beforeAll(async () => {
    server = createApp({ aiConfig: readAiConfig({}), mock: new MockIntelehealth(), distDir: '/nonexistent' });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('AI endpoints answer "disabled" with no credentials; status explains why', async () => {
    const st = await (await fetch(base + '/api/ai/status')).json();
    expect(st).toMatchObject({ enabled: false, provider: 'disabled', model: null });
    const r = await post('/api/ai/extract', { narrative: 'x', lang: 'en', permitted: [] });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ ok: false, error: 'disabled' });
  });
  it('mock Intelehealth is reachable over HTTP and requires a session', async () => {
    const noAuth = await fetch(base + '/mock-intelehealth/encounters/abc');
    expect(noAuth.status).toBe(401);
    const s = await (await post('/mock-intelehealth/session', { username: 'demo' })).json();
    expect(s.mock).toBe(true);
    const r = await fetch(base + '/mock-intelehealth/encounters/abc', { headers: { authorization: `Bearer ${s.token}` } });
    expect(r.status).toBe(404);
  });
  it('with a stub adapter the proxy validates input and passes through refusals without leaking content', async () => {
    const stub = createApp({
      aiConfig: { enabled: true, provider: 'anthropic', model: 'stub', timeoutMs: 1000, maxOutputTokens: 256 },
      adapter: { extract: async (req) => { calls.push(req); return { ok: false, error: 'refused', retryable: false }; }, draftNote: async () => ({ ok: true, data: { text: 'ok' }, usage: {} }) },
      distDir: '/nonexistent',
    });
    await new Promise<void>((r) => stub.listen(0, r));
    const b = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    const bad = await fetch(b + '/api/ai/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ narrative: '', lang: 'fr', permitted: [] }) });
    expect(bad.status).toBe(400);
    const ok = await fetch(b + '/api/ai/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ narrative: 'I fell', lang: 'mr', permitted: [] }) });
    expect(await ok.json()).toMatchObject({ ok: false, error: 'refused' });
    expect(calls).toHaveLength(1);
    await new Promise<void>((r) => stub.close(() => r()));
  });
});
