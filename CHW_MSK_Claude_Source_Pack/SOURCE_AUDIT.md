# Source snapshot and implementation review notes

Snapshot date: 15 November 2026. Required project languages: English, Hindi, Marathi.

The two user-supplied FigJam boards were retrieved through the connected Figma account. Their text and connector structures were parsed, and the spine orientation section was visually inspected. This is a source inventory and engineering review, not a clinical validation or independent verification of every citation, statistic, test, or exercise prescription.

## What is included

| Board | File key | Sections | Shape/text nodes | Connectors |
|---|---|---:|---:|---:|
| Spine | `rWECNSFkKrOGuJkRPvsQdP` | 11 | 249 | 273 |
| Hip/knee | `cNyP7TFyrcoIYVPUoQlMgw` | 10 | 274 | 285 |
| Total | | 21 | 523 | 558 |

Counts include legends, citations, action boxes, answer boxes, and other supporting material. They are not question counts. The spine board has four stages for each regional pathway; hip and knee have three stages plus a separate exercise-group section. A connector's containing section need not contain both of its endpoints. Each board therefore has a complete connector index as well as its section files and page-level connectors.

Read `sources/manifest.json` first. Each section entry points to one JSON file. Every extracted shape and connector retains its source attributes, text, and a file-qualified identity. The full connector index duplicates the edges for convenient graph reconstruction; do not count those copies as extra source connectors. Original XML is in `sources/raw/`, with SHA-256 hashes in the manifest. No authoritative revision or last-modified timestamp was returned, so `source_revision` is null. Do not infer current freshness from this snapshot.

These are source records, not executable clinical protocol JSON. Connector direction and endpoints are available; the extraction does not preserve a complete Figma document or every visual styling property. Use the boards and targeted screenshots when color, dashed arrows, grouping, or other visual semantics matter. Raw XML preserves the original tool response; normalized JSON text removes surrounding whitespace only.

## Observed issues to preserve in the build brief

1. **Draft status.** The orientation nodes (`1:6327` in spine; `3:5` in hip/knee) explicitly require clinical review before patient use. A reproduced diagram does not establish approval.
2. **Entry assumption.** Hip/knee start/orientation nodes (`3:81`, `3:9`) assume the pain has been established as musculoskeletal. The app needs an explicit eligibility process, not a hidden assumption.
3. **Unavailable examinations.** Spine node `1:6343` and hip/knee node `3:21` describe proceeding when a skilled test is not available. The application must distinguish missing evidence from a negative finding and prevent dependent conclusions from being silently released. Further history capture can still continue.
4. **Interpretation of safety and follow-up.** Examples include spine `1:6555`, `1:6987` and hip/knee `5:165`, `5:715`. Review the claims about passing the safety screen and confirming a label through improvement. Do not elevate them into proof of a diagnosis.
5. **Section-level connectors.** Hip/knee connector `10:1317` starts at knee Stage 2 section `7:538` and ends at baseline/plan node `5:527`. Connector `10:1321` starts at hip Stage 2 section `7:541` and ends at node `5:921`. All connector endpoints resolve to existing source elements, but these two begin at sections rather than shape/text nodes. They require semantic interpretation; they are not simply dangling references to repair.
6. **Exercise links stored outside their destination section.** Hip/knee section `34:1341` contains eight groups (E1–E8). Their associations are expressed both in text and through 22 incoming connectors stored elsewhere. Those connectors have empty text labels. Preserve their endpoints and inspect source diagnoses and destination groups to interpret them. A section-only scan would miss these connections.
7. **Clinical and local-policy details.** Referral timing and exercise restrictions, missing test results, skill levels, local thresholds, special-population eligibility, dose/progression rules, and consent for any media capture need explicit implementation requirements and review.
8. **Evidence provenance.** Board references and accuracy figures have been preserved, not independently verified. Internal NAS statistics lack a supplied underlying dataset. Do not generalize them to individual patients. Check standardized outcome-instrument scoring, permitted reproduction, and translations before implementing them in patient care.

## Scope of the structural checks

- Parsed both XML responses successfully.
- Counted all sections, shape/text nodes, and connectors.
- Checked connector endpoint identities against all source elements.
- Identified the two section-anchored links described above.
- Preserved every shape/text node and connector across the section files and page-level connector files, with a complete connector index for each board.
- Checked the 22 incoming links to the eight exercise-group nodes against the entire board.

These checks do not establish logical correctness, complete branch semantics, safe clinical operation, or the appropriateness of a hands-on test for a CHW. Those are separate requirements in `BRIEF.md`.

## Efficient use

Use local parsing and the manifest for the complete inventory. Read only the relevant section files while implementing a pathway. Keep the original-to-canonical mapping and exceptions in a compact ledger. Avoid repeatedly sending the raw XML to an LLM. Check source changes once at the start, then use one recorded snapshot consistently.
