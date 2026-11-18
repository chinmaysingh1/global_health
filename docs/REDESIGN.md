# UI/UX redesign (session 4, 2026-11-17)

Branch `ui-redesign`, checkpoint tag `pre-redesign` (the last commit before this work). Nothing in the engine, protocol, store, integration or server changed; the redesign is presentation, navigation and the small adapters they need.

## Direction

A calm clinical field tool: warm pearl surfaces (`#f7f5f0`), deep ink type (`#16181d`), one indigo action colour (`#3540b8`), and clinical colours (emergency, urgent, soon, refer, pain-from-elsewhere, OK, attention) that are never used as decoration. System fonts only (San Francisco / Roboto, Kohinoor / Noto Devanagari); no web fonts, icon fonts or CDNs, so the demo works offline. Light theme only (the app had no dark theme). Tokens live at the top of `src/ui/styles.css`.

Three recognisable elements:

1. **Body-region selector** (`BodyMap` in `src/ui/encounter.tsx`): a front-view figure with tappable zones for neck, low back, both hips and both knees, explicit "← Patient's right / Patient's left →" labels and the caption "Front view, facing the patient". It stays in sync with an equally usable list of all six regions and a separate side choice. Locations already recorded are outlined in green.
2. **Visit progress** (`src/ui/flow.ts`): the eight old tabs are grouped into four stages: Intake (Consent, Where it hurts, History), Assessment, Review (Summary, Clinician review) and Plan & handoff (Plan, Export & sync). Follow-up visits use Intake, Follow-up, Review and Handoff. A compact four-segment stepper in the sticky header shows done / in progress / needs attention with an icon as well as colour. A **Visit overview** sheet (and a persistent side rail on screens 1024 px and wider) lists every section with its real status.
3. **Composed summary** (`SummaryTab`): a status board (safety screen, open items, plan status, sync status), the safety alerts, the open items each with a **Resolve** button that opens the exact place to fix it (a safety item opens that check), then findings per pain location.

## Navigation

- One **next action** in a fixed bottom bar, always in the same place, beside a labelled **Overview** button. When the next step is an answer, the bar says "Answer the question above to continue" instead of offering a button; with an unacknowledged safety concern it says "Resolve the alert first". Answers always stay in the content. This adds no prerequisite: every section stays reachable from the stepper, the overview and the sub-navigation, as before.
- Hash routes are unchanged (`#/enc/<id>/<section>`), so reload, Back and old links work; `#/enc/<id>/assess/<nodeId>` opens one check for editing (used by Resolve) and is then removed from the address.
- Sheets are native `<dialog>` elements: Escape, the Close button, a tap outside and the system Back gesture all close them, and focus returns to the button that opened them. Navigating from inside a sheet replaces its history entry so Back returns to the previous screen.
- Home leads with the patients and their visits (new / in progress / follow-up status from real state), the app language and the active demo role. Role, basic kit, AI mode, storage notes and the protocol review tool are in **Settings**; inside a visit the same panel opens from the header's language-and-role button.
- Assessment: one question card at a time from the engine's current node; balanced answer choices (no answer is styled as recommended; "Yes" turns red only after it is chosen); "If you cannot get an answer" groups Not sure / Prefers not to answer / Not performed with their required reasons; a short tap lock prevents double submission; after an answer, focus moves to the next question's heading and the card is brought into view, except that a newly raised alert is brought into view first. "Change previous answer" re-opens the last answer. Safety progress shows answered/total; pathway progress shows only a count, because the branching route has no known total.

## What was preserved

Engine, protocol content, consent behaviour, the seven answer states and their reasons, safety checks and escalation, role and capability rules, clinician approval gates, stale-decision invalidation, audit history, IndexedDB persistence and storage keys, the app identifier, sync contract and mock server. Draft and "not translated" markers stay attached to the text they describe. Evaluation disclosures appear on Home, in Settings, in the overview, on Protocol review and on the approved plan.

## Verification actually performed

Environment: the Claude desktop app's built-in browser pane (Chromium) on macOS, emulated viewports. **Not** Safari/WebKit in a browser (no WebKit engine was installed here), **not** Android hardware, **no** iOS Simulator (runtime not installed). The iPhone app was rebuilt, installed and launched on a physical iPhone 13 (iOS 27.2); the owner looked at it and confirmed the header, notch spacing and bottom bar look right. No full walkthrough was done on the phone.

| Check | Result |
|---|---|
| `npm test` | 11 files, 251 tests passed (the earlier 185, plus 15 navigation tests in `tests/flow.test.ts` and 51 contrast measurements in `tests/contrast.test.ts`) |
| `npm run build` | passed; JS 1,200 kB (281 kB gzip, +15 kB), CSS 36 kB (8 kB gzip); no new dependencies |
| `npm run build:ios`, `npm run ios:install` | passed; installed and launched on the iPhone 13 |
| Contrast | 37 text pairs ≥ 4.5:1 and 15 control/state pairs ≥ 3:1, measured from the stylesheet tokens |
| Widths | 320, 360, 375, 390 px, landscape 844×390, 1280×800: no horizontal page scrolling; no control under 44×44 px at 320 px (Marathi) |
| 200% text | root font size doubled at 390 px: header and bottom bar wrap, the header stops sticking when it would take over a third of the screen, content is never covered |
| Knee route | consent → left knee on the figure → history → 13 safety checks → Gradually → 45 or older → Fits → Moderate → baseline (out-of-range value rejected beside the field) → summary |
| Roles and gates | CHW "No" on K8/K12 left the screen incomplete; Resolve opened K8; clinician re-answered K8/K12 and health points; empty reason refused; confirm → awaiting approval → approved (demo) |
| Correction | changing KQ3 blocked the plan, listed both decisions as no longer counted, kept downstream answers as no longer applying; restoring the answer did not revive the approval |
| Urgent route | low back, L1 Yes: emergency alert shown and focused, bar says "Resolve the alert first", acknowledgment recorded with name and time, pathway stopped for review |
| Follow-up | Week 4 visit: adherence, adverse response, like-for-like comparison with dates, units, deltas and "Not recorded" |
| Languages | English, Hindi (360 px) and Marathi (320 px) mid-visit; patient, section and answers retained |
| Sync | saved → queued → received (simulated receipt), simulated server edit → conflict (local copy not sent) → adopt → received |
| Offline | production build on a separate port; server stopped; page reloaded from the service-worker cache with the visit intact; Sync now kept it queued |
| Update | a newer service worker activated, removed both older caches, and the saved visit remained |
| Drafts | text typed but not saved survived leaving and returning to the screen; the bottom bar hides while a field has focus |

## Limits that matter for the demo

- Safe areas: the iPhone wrapper now leaves insets to the CSS (`contentInset: "never"` plus `env(safe-area-inset-*)`). Confirmed by eye on the iPhone 13 only; other iPhone shapes and Android were not checked.
- Android: no native Android project exists. Android is served as the web app (Chrome / PWA); it was not tested on a phone.
- Large text: the stepper breaks long words at 200% rather than overlapping.
- The "Change previous answer" link re-opens a safety check in the same late-concern mode the old safety list used.
- Hindi and Marathi remain unreviewed machine drafts; most clinical text below the titles is shown in English with a marker.

## Two-to-three-minute showcase (synthetic data)

Before: `npm run build`, then `npm start` and open http://localhost:8787 (or open the iPhone app). Use the demo patients; nothing needs to be pre-filled.

1. **Home** (15 s): patients first, language switch, "Working as" role chip, evaluation notice.
2. **Start first visit** for Sunita Pawar (30 s): Agrees → tap the left knee on the figure (point at the side labels) → Add → Next: History → Next: Assessment.
3. **Assessment** (45 s): show one question at a time, the "If you cannot get an answer" group, and the bottom-bar hint. Answer the knee checks, then Gradually → 45 or older → Fits → Moderate; enter two pain scores.
4. **Summary** (20 s): status board, open items with Resolve.
5. **Clinician review** (30 s): Switch to clinician role (demo) → re-answer K8 and K12 through Resolve → record health points in History → Record decision → Approve plan (demo only). Show the Plan's "demo only" caveat.
6. **Export & sync** (15 s): Queue → Sync now → simulated receipt.

Optional urgent path (30 s): Ramesh Yadav → low back → eligibility → L1 Yes: emergency card, "Resolve the alert first", acknowledge.

Offline and sync expectations: in the browser served by `npm start`, sync reaches the bundled **mock** server and shows a simulated receipt; without the server, visits stay saved on the device and sync stays queued. In the iPhone app there is no server at all: sync always stays queued, server AI is unavailable, and file download and printing are replaced by an explanation.
