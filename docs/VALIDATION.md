# Validation

What was actually run, with real results. Passing software tests on synthetic data are **not** clinical validation, language validation, speech validation or proof that live AI or Intelehealth integration works.

## Commands and outcomes (2026-11-15, macOS, Node 26.8.2)

| Command | Result |
|---|---|
| `npm test` (vitest 5.1) | **8 files, 182 tests, 182 passed**, 166 s (85% of that is module import; file reads in this folder were slow on first touch) |
| `npm run build` (`tsc --noEmit`, `vite build`, server bundle) | **exit 0**; client JS 1,145 kB (266 kB gzip), CSS 6.7 kB, lazy ledger chunk 423 kB |
| `npm run protocol:build` | spine 249/249 nodes, 273/273 connectors; hip_knee 274/274, 285/285; 1022 implemented, 59 reference, 0 blocked; 8 structural findings |
| `npm run protocol:diff -- <altered copy>` | reported the 3 deliberate changes (1 added node, 1 re-worded node, 1 re-wired connector) |

During the session one earlier full run was 181/182; the failure was a weak check in the AI-draft lint (substring number matching), fixed and re-run. Tests also caught two real defects that were fixed: the "assess and treat both" flag was dropped by the schema, and two add-on module nodes were unreachable in the graph.

## What the tests cover

| File | Scope | Where expected results come from |
|---|---|---|
| `engine.safety.test.ts` | All 49 Stage 1 checks in 4 pathways: YES → urgency and stop/continue; all NO; unanswered; unknown / declined / not performed; capability missing; late and simultaneous concerns | Urgency table hand-transcribed from the board text, not from the compiled protocol |
| `engine.transitions.test.ts` | Every answer arrow in both boards (hip/knee and spine) executed from its parent; text-only redirects; unknown/declined; unavailable or unqualified examination; cycles; corrected answer → stale; age boundaries 15/16/44/45; KN2 routing; routine route per region | Connector labels (`A>B`) read straight from the snapshot files |
| `plan.test.ts` | Plan gating for all 4 regions; CHW cannot decide; missing safety evidence, skipped specialist exam, late concern, corrected answer, contradiction, unclear eligibility, safety modifier, under-18; E2 doctor-clearance precaution; referred-pain switch, emergency sub-choice, loop guard, "treat both", unsupported shoulder; two complaints isolated; unsure hip-or-knee | Reviewed-layer rules in `overlay.json` (amendments A01–A16) |
| `followup.test.ts` | Week 1/4/12 rules for 4 pathways; like-for-like comparison (direction, bilateral, PSFS by task, not-performed ≠ 0); reduced baseline for HIGH irritability; follow-up encounter carry-over | Connector labels; board battery text |
| `store.sync.test.ts` | IndexedDB autosave + reload (fake-indexeddb); storage failure surfaced; stale write cannot regress; bundle schema; no invented identifiers; distinct answer states; note fidelity; ack-before-success, duplicate, expired sign-in, conflict, offline queue + reconnection; mock rejects bad input | Mock server contract |
| `ai.test.ts` | Disabled by default; malformed / oversized output; hallucinated targets, evidence, values; injection cannot clear a safety check; proposals pending until confirmed, urgent first; timeout, cancel, bounded retry, refusal, thrown error; stale response; older AI reading cannot overwrite a newer answer; call limit; bounded context; draft lint; per-language extraction | Hand-labelled fixtures |
| `protocol.build.test.ts` | Hashes; inventory; committed output equals fresh build; schema; ledger completeness and totals; section connectors; 22 exercise links; no invented groups; amendments; gated arrows; graph validation | Manifest and audit |
| `i18n.server.test.ts` | Every UI key in 3 languages, Devanagari for hi/mr, no other scripts; every `tr('…')` key used by the UI exists; draft/untranslated markers; honest coverage; real HTTP: AI disabled → 503, mock needs a session, proxy validates input | — |

Not claimed: exhaustive coverage of every path through a cyclic graph. Each drawn transition and terminal is exercised at least once; combinations are sampled.

## Extraction evaluation by language

Provider under test: **MOCK keyword matcher** (`mock-keyword-v1`), not a language model. Input: 12 short synthetic *typed* texts (4 per language, including one Hindi–English and one Marathi–English code-switched case), hand-labelled. Raw output: `docs/generated/extraction-eval.json`.

| Language | Cases | Expected facts | Found | Missed | Polarity errors | Unsupported proposals | Negation / remote-past / other-person errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| English | 4 | 10 | 10 | 0 | 0 | 0 | 0 |
| Hindi | 4 | 11 | 11 | 0 | 0 | 0 | 0 |
| Marathi | 4 | 11 | 10 | 1 | 0 | 0 | 0 |

The Marathi miss (`mr-2`): "लघवी थांबवता येत नाही" (cannot hold urine) is a symptom expressed *with* a negation word, and the matcher skips negated clauses for safety checks. That is a real limitation of keyword matching and exactly the kind of case where a missed red flag matters; the manual safety question still asks it. Every proposal carried a literal evidence span.

These numbers describe the stub on a tiny synthetic set. They say nothing about a real model, real patients, dialects, spelling variation, transliterated text, or speech. **Correction burden, note fidelity of an AI-drafted note, and any live-provider behaviour were not measured**: no live call was made.

## Browser walkthrough (performed)

Environment: the Claude desktop app's built-in browser pane (Chromium-based) on macOS, production build served by `npm start`, plus the dev server for the first pass. Viewports: emulated 375×812 and the pane's ~800×600. Interactions were scripted clicks and typed values, with screenshots at key screens.

Done and observed working: create encounter → consent → pain location (list and figure) → history → all 13 knee safety checks → Stage 2 → baseline with an out-of-range value rejected → summary → clinician role: re-examine K8/K12, confirm, approve → plan → **edit an earlier answer (approval voided, decisions listed as stale)** → re-approve → **reload (state restored)** → Marathi UI (Devanagari wraps; draft and "not translated" markers visible) → export → sync (ack, simulated conflict, adopt, expired sign-in) → follow-up week 4 (like-for-like table, "level up proposed") → low-back L1 emergency alert and acknowledgment → **server stopped: app reloaded from the service-worker cache, drafts intact, sync stayed queued** → server restarted: sync acknowledged.

Found and fixed during the walkthrough: a pre-filled answer shown as "no longer applies" before eligibility was recorded; qualified labels such as "CHECK — Ottawa Knee Rule…" folded into the wrong field; some source instructions not displayed; follow-up limiting measures to the reduced set; the API server and web dev server colliding on one port; the AI SDK being loaded even when AI is disabled.

**Not tested — do not assume:** any physical Android phone; Chrome on Android, Firefox, Safari; installation as a PWA; a keyboard-only pass (controls are native buttons/inputs and the figure zones are focusable, but no full traversal was done); screen readers; contrast measurement; printing; low-storage eviction (`navigator.storage.persist()` returned `false` here); slow networks; long sessions; concurrent tabs.

## Unresolved risks

1. Clinical: draft source, 16 unreviewed amendments, 32 outcome policies on class defaults, unverified statistics and instruments. See `PROTOCOL_REVIEW.md`, especially §5 (most hands-on tests are physio-level).
2. Language: all Hindi and Marathi is unreviewed machine output; most Stage 2 clinical text is English-only.
3. AI: only the stub was run. The real adapter compiles and its configuration gate is tested, but no request was ever sent.
4. Integration: mock only.
5. Security: no authentication, no encryption at rest, role switch is a demo toggle. Real patient data must not be entered.
6. Engineering: 1.1 MB main bundle; no speech input; slow cold starts were observed in this particular folder.
