# STATUS — continuation checkpoint

Last updated: 2026-11-17, session 3 (iPhone app added). Build milestone complete; remaining work needs people or external access.
Languages: English, Hindi, Marathi only.

## Status by track (do not blur these)

| Track | Status |
|---|---|
| Software | Working evaluation build, synthetic patients only. `npm test`: 9 files, 185/185 passed. `npm run build`: exit 0. iPhone app installed and launched on one physical iPhone. |
| Clinical review | NONE. Source boards are drafts. All 16 amendments (A01–A16) are engineering proposals, `proposed_unreviewed`. |
| Language review | NONE. Hindi/Marathi UI strings and protocol titles are machine-authored drafts. |
| Live AI | NEVER exercised. Disabled by default; no credentials, no spend authorised. Only the MOCK keyword matcher was run. |
| Intelehealth | SIMULATED only (bundled mock server). No sandbox, schema, concept dictionary or credentials. Every field mapping is `null`. |

## Source snapshot (frozen)

- `CHW_MSK_Claude_Source_Pack/`, snapshot 2026-11-15, `source_revision` null (live freshness unverified; Figma not re-checked).
- Raw hashes verified at build: spine `3d674a7c…`, hip_knee `bc0ee1d0…`.
- Inventory: spine 249 nodes / 273 connectors; hip_knee 274 / 285. Ledger: 1022 implemented, 59 supporting reference, 0 blocked.
- 8 structural findings in `protocol/compiled/issues.json`; cycles KT6↔KT7 and KT1→KN1→KT1 halt for review.
- Ayu reference inspected once, not a contract: `Intelehealth/intelehealth-ayu-protocols` commit `8172eab`, `protocols/v3.1/All Protocols (JSON)/ chiefComplaints/` (leading space in dir name), MPL-2.0.

## Commands

- `npm run dev` — API/mock server on `API_PORT` (8787) + Vite on `PORT` (5173).
- `npm run build` then `npm start` — typecheck, client build, server bundle; serves app + API on 8787 (fast start).
- `npm test` — vitest, under a second in this location.
- Location: the project lives in `~/Developer/cbid/global_health`. It was moved out of `~/Documents`, which iCloud Drive syncs; iCloud evicted files there, which made cold starts take minutes (an earlier full test run took 166 s) and broke `git push` with `mmap failed`. Keep it out of iCloud-synced folders.
- `npm run protocol:build` — re-import pack + overlay → `protocol/compiled/*`, `protocol/generated/source-graph.json`. A test fails if the committed output is stale.
- `npm run protocol:diff -- <old source-graph.json>` — compare two source snapshots.
- `npm run build:ios` — phone build (`VITE_STANDALONE=1`) into `dist-ios/`, copied into the Capacitor project `ios/`. `npm run ios:install` — that, plus a signed Xcode build and install on a connected iPhone (`scripts/ios-install.mjs`).
- `.claude/launch.json` has `msk-dev`, `msk-prod` and `msk-phone-web` (serves `dist-ios/` on 4174) preview configs.

## iPhone app (session 3)

- Capacitor 8.6.2, Swift Package Manager (no CocoaPods), bundle id `io.github.chinmaysingh1.mskassess`, signed with the free Personal Team `3U248BM8K5` (profile expires every 7 days; reinstall with `npm run ios:install`).
- Phone build has no server (`src/platform.ts`): sync throws before any network call so the encounter stays queued with its idempotency key; server AI reports unavailable; no service worker; a visible "Phone build: no server" notice on Home and Export (new UI key `app.standalone`, hi/mr drafts). Mock AI still works on the phone.
- Verified: `npm test` 9 files / 185 passed (3 new in `tests/standalone.test.ts`); `xcodebuild` for the simulator SDK and a signed device build both succeeded; the phone web build checked at 375×812 in the browser pane (notice shown, sync stays queued, zero network requests, no service worker).
- Installed and launched on a physical iPhone 13 (iOS 27.2) with `npm run ios:install`; the app process started. First launch needs the developer certificate trusted on the phone (Settings > General > VPN & Device Management). NOT verified: a full assessment walkthrough inside the native app, and any iOS Simulator run (no simulator runtime installed; about 8 GB needed).
- Known gaps in the phone build: "Download JSON handoff" and "Print readable note" rely on browser downloads and printing, which the iOS app shell does not provide; app icon only (no splash screen design).

## Done

- Importer, compiler, ledger: `src/protocol/`, `scripts/build-protocol.ts`, `protocol/overlay/overlay.json`
- Engine: `src/engine/` (evaluate, plan gating with basis-hash staleness, followup, summary, validateGraph)
- Store: `src/store/` (audited mutations, IndexedDB persistence, fixtures)
- AI: `src/ai/` (strict validation, mock provider, orchestrator, deterministic note, lint); `server/anthropicAdapter.ts` (official SDK, lazy-loaded, off by default, model from `AI_MODEL` only)
- Integration: `src/integration/` (handoff bundle, sync client), `server/mockIntelehealth.ts`, `server/index.ts`
- UI: `src/ui/` all screens (home, consent, pain location, history, assessment, summary, clinician review, plan, follow-up, export/sync, protocol review); PWA shell cache `public/sw.js`
- i18n: `src/i18n/ui.ts` (all keys ×3), `protocolText.ts` (49 safety titles + knee Stage 2 = 56 titles; rest shown in English with a visible marker)
- Tests: `tests/*.test.ts` (engine safety, transitions vs source-connector oracle, plan gating, follow-up, store/sync, AI, i18n, server HTTP, extraction eval → `docs/generated/extraction-eval.json`)

## Browser walkthrough actually performed (built-in browser pane only)

- 375×812 emulation and ~800×600 pane: create encounter, consent, pain location, full knee route, edit an answer (decisions correctly voided), clinician confirm + approve, reload (state restored), Marathi display with draft/untranslated markers, export, sync incl. conflict and expired sign-in, follow-up week 4 with like-for-like comparison, low-back emergency route.
- Offline: server stopped, page reloaded from service-worker cache, drafts intact, sync stayed "queued"; after restart sync was acknowledged.
- NOT tested: any real Android device or other browser, a full keyboard-only pass, screen readers, printing, persistent-storage grant (was `false`).

## Docs

`README.md`, `docs/PROTOCOL_REVIEW.md` (coverage, findings, amendments A01–A16, approval status), `docs/INTEGRATION.md`, `docs/VALIDATION.md` (exact commands and results), `docs/generated/extraction-eval.json`.

## Open engineering items (none block the demo)

1. Translate remaining Stage 2 / plan text for hip, low back, neck (currently English with a marker): 237 of 293 titles and 144 of 171 answer options.
2. Mock extraction misses symptoms phrased with a negation (`mr-2`); a real provider has never been run.
3. Main JS bundle 1.1 MB (protocol JSON inlined); could be split.
4. Speech input not implemented (typing only). No real-patient mode, authentication or encryption, by design.
5. Git: `main` tracks `origin` (`github.com/chinmaysingh1/global_health`); the initial commit is pushed. `room/` (MindrianOS plugin session state) is ignored.
6. Not tested on a physical Android device, other browsers, keyboard-only, or with a screen reader.

## Needs people, not code

- Clinician decisions on amendments A01–A16 and on every outcome policy marked `derived_default`.
- Translator/clinician review of Hindi and Marathi.
- Intelehealth target repo/version, sandbox and concept dictionary.
- Provider choice and spending authorisation before any live AI call.
