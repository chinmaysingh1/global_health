# Intelehealth integration

**Status: SIMULATED / UNVERIFIED. Not connected to Intelehealth.**

No target application repository or version, deployment documentation, API schema, OpenMRS version, concept dictionary, sandbox or credentials were available. Nothing was sent to any Intelehealth or OpenMRS system. No UUID, endpoint or concept id in this repository refers to a real one; a test fails if a UUID-shaped string appears in the mapping table.

## What was inspected

`https://github.com/Intelehealth/intelehealth-ayu-protocols`, commit `8172eabe7381605ac401197a10a6ed99b012c42d` (14 Oct 2026), licence MPL-2.0. The directory `protocols/v3.1/` exists and contains `All Protocols (Excel)`, `All Protocols (JSON)` and `physicalExamAssets`. Only the directory listing and the key structure of one file (`Knee pain.json`) were read. The teaching-cases repository was not opened.

Observations relevant to compatibility (to be re-checked against the real app parser):

- The complaint files live in a directory whose name starts with a space: `All Protocols (JSON)/ chiefComplaints/`. Path handling must not trim it.
- Files matching our four regions by **name only**: `Knee pain.json`, `Hip pain.json`, `Back pain.json`, `Neck pain.json`. Content was not compared with the boards.
- Node shape: nested `options[]` with `id` (`ID_<uuid>`), `text`, `display`, `display-hi`, `display-mr`, and on some nodes `index`, `isRequired`, `input-type`, `multi-choice`, `exclude-from-multi-choice`, `havingNestedQuestion`, `language`, `perform-physical-exam`.
- Type inconsistency seen in one file: `exclude-from-multi-choice` is the string `"true"` once and a boolean six times; `index` is an integer 18 times and a float 3 times. A strict parser must tolerate or normalise this.
- `isRequired: true` appears on top-level questions only; Ayu has no representation for "unknown", "declined" or "not performed", which this app must keep distinct.
- `perform-physical-exam` is a single semicolon-separated string of exam names, not structured data.
- Ayu carries `display-hi` and `display-mr`; whether those translations are reviewed is unknown.

Not audited: age eligibility rules, nested-condition semantics, identifier collisions across files, and how the Android/web app actually parses these files. Those need the target app's source.

## What is implemented

| Piece | File | Notes |
|---|---|---|
| Handoff bundle + schema | `src/integration/adapter.ts` | `zHandoffBundle`; labelled `SIMULATED_UNVERIFIED`, `synthetic: true`, `notForPatientCare: true` |
| Field mapping + unmapped report | `FIELD_MAPPINGS` in the same file | 15 fields, every `target` is `null` with the specific blocker; shown on the Export tab and included in each bundle as `unmapped` |
| Sync client | `src/integration/sync.ts` | queue → submit → acknowledged; idempotency key per revision; `If-Match` version; one re-login on 401; conflict never overwrites |
| Mock server | `server/mockIntelehealth.ts` | in-memory; accepts synthetic bundles only; **not** an implementation of any Intelehealth API |
| JSON export, printable note | Export tab | `handoff-<id>-r<rev>.json`; deterministic English note |

### Bundle contents

`patient` (synthetic), `encounter` (type, visit, revision, language, consent), per complaint: region, side, pathway, origin of a pathway switch, eligibility, every safety check with its status / information source / author / time / examiner capability, alerts (urgency, referral timing, may-continue, exercise restriction, acknowledgment), pathway trace, stop reason, contradictions, engine candidate vs clinician-confirmed assessment, measures, plan (groups and dose **only when approved**), missing items. Plus history fields, original-language narratives, the deterministic note, review decisions, open items, protocol version and source hashes.

### Mock contract (for tests and demo only)

```
POST /mock-intelehealth/session            {username}            -> {token, expiresAt}
PUT  /mock-intelehealth/encounters/:id     Authorization, Idempotency-Key, If-Match: <serverVersion|0>
       201/200 {receiptId, serverVersion, receivedAt}   same key again -> 200 {…, replay: true}
       401 token missing/expired · 409 {serverVersion, lastModifiedBy} · 422 schema / id mismatch / non-synthetic
GET  /mock-intelehealth/encounters/:id
POST /mock-intelehealth/_test/expire-tokens | _test/clinician-edit/:id | _test/reset     (demo controls)
```

### Device states shown to the user

`saved_on_device` → `awaiting_review` → `queued_for_sync` → `received_by_server` (only after a receipt), plus `sync_conflict`, `auth_expired`, `sync_failed`. Any clinical change after an acknowledgment returns the encounter to `saved_on_device`.

## Verified by test or walkthrough (against the mock only)

Acknowledgment required before "received"; duplicate submission replayed, stored once; expired sign-in re-authenticates once; failed sign-in marks nothing sent; server-side newer version → conflict, local copy not sent; offline → stays queued with the same key, completes after reconnection; malformed / mismatched / unauthenticated requests rejected. See `docs/VALIDATION.md`.

## Remaining dependencies (minimum next actions)

1. Name the target Intelehealth application repository and pin a version; identify the OpenMRS version and concept dictionary in use.
2. Obtain a sandbox with synthetic-only data and credentials supplied through the environment.
3. Decide the carrier for non-standard states (unknown / declined / not performed), provenance, and the clinician-side write path; then fill `FIELD_MAPPINGS` with verified targets and replace the mock transport.
4. Run one synthetic encounter through the sandbox and record exactly what was confirmed. Until then this stays "simulated".
