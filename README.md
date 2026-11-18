# CHW musculoskeletal assessment — evaluation build

Companion web app (PWA) for a CHW-guided, clinician-reviewed assessment of low back, neck/upper back, hip and knee pain, built from two draft FigJam boards. English, Hindi and Marathi.

**Not for patient care.** Synthetic patients only. The protocol is an unreviewed draft, translations are unreviewed drafts, the Intelehealth connection is a bundled mock, and live AI has never been run. See `docs/STATUS.md` for the exact state and what is unfinished.

## Run

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:8787. For development use `npm run dev` (Vite on 5173, API/mock on 8787).

## iPhone app (no server)

A standalone iOS app built with Capacitor from the same code. Every file ships inside the app, so it runs with no Mac and no network. In this build, sync stays "queued" (there is nothing to send to), server AI is unavailable (the mock AI still works), and data lives only on that phone.

Needs Xcode signed in with an Apple ID (Settings > Accounts) and an iPhone in Developer Mode. Connect the iPhone by cable, unlock it, then:

```bash
npm run ios:install
```

With a free Apple ID the app stops opening after 7 days; run the command again to reinstall. `npm run build:ios` only rebuilds the web files into `ios/`; open `ios/App/App.xcodeproj` in Xcode to build there instead. Not available in the phone build: downloading the JSON handoff and printing the note.

## Demonstration route

The redesigned visit flow and a timed 2–3 minute showcase are in `docs/REDESIGN.md`. In short: Home → Start first visit (Sunita Pawar) → Agrees → tap the left knee → Next: History → Next: Assessment → answer the checks and the knee route → Summary → switch to the clinician role (demo) → Resolve K8/K12 → confirm and approve → Plan → Export & sync. Urgent route: Ramesh Yadav, low back, L1 "Yes".

## Test

```bash
npm test
```

```bash
npm run protocol:build
```

## Optional AI provider

Off by default. Copy `.env.example` to `.env` and set `AI_PROVIDER=anthropic`, `AI_MODEL` and `ANTHROPIC_API_KEY` in the server environment only. No model is assumed suitable for clinical text; nothing has been evaluated live.

## Layout

- `CHW_MSK_Claude_Source_Pack/` frozen source snapshot · `protocol/overlay/overlay.json` reviewed-layer proposals · `protocol/compiled/` generated protocol and source ledger
- `src/engine/` deterministic engine · `src/store/` encounter model · `src/ai/` bounded AI layer · `src/integration/` handoff adapter and sync · `src/ui/` screens · `server/` API proxy and mock Intelehealth · `tests/`
