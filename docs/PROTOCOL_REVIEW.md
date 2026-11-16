# Protocol review

**Approval status: none.** No clinician, physiotherapist or translator has reviewed or approved any protocol content, policy, amendment or translation in this repository. Nothing below is a clinical review; it is an engineering account of what the source says, how it is represented, and what a reviewer must decide. No reviewer names or sign-offs exist.

## 1. Source versions

| Board | Figma file key | Raw XML sha256 | Revision |
|---|---|---|---|
| Spine (low back · neck & upper back) | `rWECNSFkKrOGuJkRPvsQdP` | `3d674a7cf06144fb0051439a171033cfa2cc0f684ff2bc75b019b672989d040e` | not provided |
| Hip & knee | `cNyP7TFyrcoIYVPUoQlMgw` | `bc0ee1d02a783df42c1d336db1919c7af9420778efa9f851d156ccb1c2c58acf` | not provided |

Snapshot date 2026-11-15, taken from `CHW_MSK_Claude_Source_Pack/`. The live boards were **not** re-checked in this build (no Figma access was used), so freshness is unverified. The build refuses to run if a raw hash does not match the manifest. Protocol version: `0.1.0-draft+snapshot.2026-11-15`.

Reproducible import: `npm run protocol:build` regenerates `protocol/compiled/protocol.json`, `ledger.json`, `issues.json` and `protocol/generated/source-graph.json`; a test fails if the committed output differs from a fresh build. `npm run protocol:diff -- <old source-graph.json>` lists added, removed, re-worded, moved and re-wired elements between two snapshots.

## 2. Coverage against the audited inventory

Every source element has exactly one row in `protocol/compiled/ledger.json` (board/file/node → canonical id → implementation → tests → review status).

| Board | Nodes | Connectors | Implemented | Supporting reference | Duplicate | Blocked |
|---|---:|---:|---:|---:|---:|---:|
| Spine | 249 | 273 | 217 nodes + 273 connectors | 32 | 0 | 0 |
| Hip/knee | 274 | 285 | 247 nodes + 285 connectors | 27 | 0 | 0 |
| Total | 523 | 558 | 1022 | 59 | 0 | 0 |

- "Implemented" means the element is represented and executed as drawn. It does **not** mean it is clinically right.
- "Supporting reference" = legends, glossary, citations, "why the label matters" notes, safety-modifier and pain-rule boxes. They are searchable in the app's Protocol review tool; modifiers and pain rules also feed history fields and the plan.
- Review status: 1070 rows `source_draft_unreviewed`, 11 rows `proposed_amendment_unreviewed` (connectors whose meaning comes from the overlay). Zero rows carry any approved status; the schema has none.
- Executable content: 49 safety checks and 49 outcome boxes, 15 questions, 29 hands-on tests, 51 diagnosis boxes, 4 Stage-2 escalations, 20 exercise groups, 2 core programmes, 12 dose boxes, 12 follow-up questions, 8 follow-up actions.

## 3. What the representation keeps separate

- Seven answer states: not asked, unknown, declined, not applicable, not performed, explicitly denied, present. None is converted into another.
- Who the information came from (patient, caregiver, CHW observation, clinician finding) versus who recorded it and with which capability.
- Engine candidate versus clinician-confirmed working assessment. The engine never sets "confirmed".
- Proposed plan versus approved plan. Approval is a clinician decision bound to a hash of the clinical state; any later change voids it (kept in the record, no longer counted).
- For each outcome box: referral timing, whether assessment continues, exercise restriction.

## 4. Structural findings (from `protocol/compiled/issues.json`)

1. `LT2c` text says "back to L1 / L5" but its arrow goes only to L5.
2. Five answers redirect in text only, with no arrow: `KT5b`→K10, `HQ2c`→H3, `HT1c`→H5, `HT2e`→H9, `HT4b`→H11.
3. `KT11` and `KT12` have a positive result box only; a negative result has no branch.
4. Cycles: `KT6b→KT7`, `KT7b→KT6` (no exit); `KT1b→KN1→KT1` ("re-test in 1–2 weeks").
5. Section-anchored connectors `10:1317` and `10:1321`.
6. Five diagnosis boxes have no exercise-group arrow: KD6, KD7, KD14, HD8, HD11.
7. The hip pathway header says "12 working diagnoses"; the board has HD1–HD11 plus the HX1 switch box.
8. Buttock pain is an entry on both boards.

## 5. Consequence a reviewer should see first

25 of the 29 hands-on tests and 11 of the 49 safety checks (L5, L11, N6, N7, H3, H4, H5, H10, H11, K8, K12) name a physio-level examination. Under the rule "not performed is not negative", **a CHW working alone can rarely reach a released candidate or a clear safety screen**; most encounters will stop at "examination pending" or "safety screen incomplete" and wait for a clinician. The boards' own guidance ("note the test as not done and keep going — the pathway still works, with a little less certainty") would let them through. This is the central policy decision for the programme: either a skilled examiner is in the loop for every patient, or specific checks are re-authored with a CHW-performable version and validated.

## 6. Proposed amendments (all `proposed_unreviewed`)

Full text of each issue and proposal is in `protocol/overlay/overlay.json` and in the app's Protocol review tool. The original wording is always preserved; proposals sit in a separate layer.

| Id | Source issue | Proposal as implemented | Decision needed |
|---|---|---|---|
| A01 | START boxes assume/“seem” musculoskeletal; nobody is named as having established it | Explicit eligibility step; "unclear" continues history but blocks clearance and plan | Who may establish eligibility, and by what screen |
| A02 | "Not done — keep going" for skilled tests | `not_performed` + reason; never negative; dependent result and plan held | Capability and supervision model (see §5) |
| A03 | PASS box says "exercise-responsive (by exclusion)… confirmed by improvement at week 4" | UI says "No listed safety concern reported"; improvement is recorded as a response only | Acceptable wording; what improvement may be taken to mean |
| A04 | Section-level connectors 10:1317, 10:1321 | Every WORKING DIAGNOSIS in the section proceeds to Stage 3; referral-only ends do not | Confirm intended meaning |
| A05 | E1–E8 linked by 22 unlabeled arrows plus condition text; "Stage 3 add-on" named separately | Arrows = diagnosis→group map (they agree with the text); add-on = measurement module; no arrow = no proposed group; E2 "after clearance from doctor" becomes a precaution | Groups for KD6/KD7/KD14/HD8/HD11; whether E-groups replace or supplement each diagnosis's "next step" text |
| A06 | Outcome boxes mix timing, continuation and exercise advice | Three fields per box; 19 policies read from explicit phrases, 32 are class defaults, 2 overlay overrides (HX1, NX1); every raised outcome blocks the plan until a clinician records clearance | Review all 32 `derived_default` rows |
| A07 | SWITCH boxes bundle several actions; shoulder pathway does not exist | Explicit follow-up choice; bladder/bowel/saddle choice = same-day emergency; linked complaint with origin; loop guard; shoulder/non-MSK become referral items | Priority and wording of the follow-up choice |
| A08 | Text-only or arrowed jumps back to Stage 1 checks | Stop, name the check, re-ask or send to clinician; contradiction flagged if the check stays denied | Whether a re-ask is enough or review is mandatory |
| A09 | Cycles and missing negative branches | Walk halts for review on revisiting a node; "none of these" goes to review | Intended exits |
| A10 | Age bands overlap/gap (HQ2), KN2 routes by age in text only | Never auto-answer from age; mismatch flagged as contradiction; KN2: 45+ → KT5, else KT6; unknown age → review | Band edges; handling of ages 45–49 and inactive adults |
| A11 | Dashed "after clearance" arrows L6Y→LD12, L9Y→LD4, N8Y→ND11, N10Y→ND11 | Never followed automatically; shown to the clinician | What counts as documented clearance |
| A12 | Children handled by single checks; plans written for adults | Under 18 requires documented clinician review | Threshold (16 vs 18) and paediatric scope |
| A13 | Safety modifiers have no thresholds ("use the local cut-off") | Asked as recorded fields; present **or unknown** needs clinician sign-off; no blood-pressure number invented | Local cut-offs |
| A14 | Accuracy figures, NAS statistics, named questionnaires | Evidence lines shown only as unverified provenance; no individual probability computed; questionnaire items not reproduced, external totals only | Citation verification; licences and validated Hindi/Marathi versions |
| A15 | Buttock in both boards | CHW picks either entry; each pathway screens for the other | Preferred default |
| A16 | SOON outcomes allow gentle exercise; only K7Y says the list continues | Only K7Y continues; all SOON exercise needs clinician clearance | Confirm |

Multiple simultaneous concerns are all raised and ordered emergency → urgent → soon → refer; this ordering is itself a proposal.

## 7. Not verified

- No citation, sensitivity/specificity figure, guideline reference or NAS statistic was checked against its source.
- No outcome instrument's scoring, licence or translation was checked. The PSFS scoring direction shown in the UI is a placeholder to be confirmed.
- Exercise descriptions, doses and progression rules are reproduced from the boards without clinical appraisal.
- Hindi and Marathi wording (UI: 395 keys; protocol: 56 of 293 titles, 27 of 171 answer options) is machine-authored and unreviewed. All other clinical text is shown in English with a visible "not translated" marker.

## 8. Before any patient use

Clinical sign-off on the boards and on each amendment; resolution of §5; reviewed translations of every CHW-facing instruction; verified instruments; authentication, data protection and retention policy; a verified Intelehealth contract. None of these exist today.
