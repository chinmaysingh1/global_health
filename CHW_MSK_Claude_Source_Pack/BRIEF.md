# Claude Code master prompt: Intelehealth musculoskeletal assessment app

Prepared 15 November 2026. Required languages: English, Hindi, and Marathi.

Copy everything below the divider into Claude Code, or place this file beside the supplied source pack and ask Claude to read it. This is an implementation brief, not a clinically approved protocol.

---

Act as the lead engineer for a CHW-supervised musculoskeletal assessment application that fits the Intelehealth workflow. Build the actual application in the current repository. Produce a working, tested system that a community health worker and reviewing clinician can evaluate end to end, with traceable protocol logic and useful, bounded AI assistance.

Optimize for verified functionality per unit of development usage. A large codebase, long report, or impressive demo is not success by itself. Do not stop at a plan, mockup, or scaffold. Continue through implementation and verification, while accurately identifying external dependencies and clinical decisions that remain unresolved.

## 1. Product outcome and boundaries

Support four pathways: low back, neck/upper back, hip, and knee. Preserve the supplied boards' examination, referral, exercise-group, baseline, progression, and follow-up content in a reviewable representation. The primary flow is:

Patient identification and consent → complaint/history capture → applicable safety screening → permitted observations/examinations → clinician review → approved plan and patient instructions → follow-up/reassessment → reliable handoff to Intelehealth.

Build a fully functioning evaluation application using synthetic patients by default. Separate software completion from clinical approval, verified integration, and readiness for real patient data. Do not describe working code or passing synthetic tests as clinical validation.

The CHW guides the encounter. A deterministic, versioned protocol engine controls permitted questions and transitions. AI proposes supported history fields and drafts notes. A clinician reviews working diagnoses, uncertain findings, and treatment/exercise plans. AI must not autonomously diagnose, prescribe, invent clinical rules, or modify an active protocol.

Use English, Hindi, and Marathi only. Default clinical summaries to English while retaining original patient wording and its language. Support multiple complaints and laterality without mixing findings from different body regions.

## 2. Sources and efficient inspection

Primary boards:

- Spine: https://www.figma.com/board/rWECNSFkKrOGuJkRPvsQdP/Spine-Assessment-Flowchart-%E2%80%94-Low-Back-%C2%B7-Neck---Upper-Back?node-id=0-1&p=f
- Hip/knee: https://www.figma.com/board/cNyP7TFyrcoIYVPUoQlMgw/Hip---Knee-Assessment-Flowchart?node-id=0-1&p=f

Additional references:

- https://github.com/Intelehealth/intelehealth-ayu-protocols.git ; inspect `protocols/v3.1/`, verifying the directory rather than assuming a release tag.
- https://github.com/nehaintelehealth/190-teaching-cases.git ; an optional source of evaluation coverage ideas, subject to its actual reuse permissions. Do not begin fine-tuning or copy textbook narratives as a shortcut.
- The actual target Intelehealth application, deployment documentation, and API/schema, when available. Identify and pin the relevant repository version instead of guessing the integration contract.

If the companion source pack is present, start with `sources/manifest.json` and `SOURCE_AUDIT.md`. It contains a 15 November 2026 snapshot, one JSON file per section, a complete connector index for each board, page-level connectors, and raw XML for verification. Resolve these paths relative to the pack location. Read relevant sections selectively; use local parsing to inventory all files. A connector can be stored under one section while pointing into another. Do not dump both complete boards into the conversation or load them again in every agent.

The snapshot inventory is:

| Board | Sections | Shape/text nodes | Connectors |
|---|---:|---:|---:|
| Spine | 11 | 249 | 273 |
| Hip/knee | 10 | 274 | 285 |

These counts include legends, citations, and other nonclinical material. They are not counts of questions, clinical decisions, or test coverage. Reconcile all content, including the separate eight-group exercise section. Check for source changes once when access permits; freeze a specific snapshot for the build and record its hashes and retrieval date. Do not silently combine revisions.

With Figma access, inspect actual node text, connectors, visual conventions, and relevant screenshots. If access is blocked, use the supplied snapshot and state that live freshness is unverified. If neither snapshot nor board access is available, request readable exports, identify precisely which pathways are blocked, and continue independent engineering work. Never fabricate missing branches.

Read repository instructions and inspect existing implementation before choosing architecture. Preserve existing work. Establish a compact source-to-implementation ledger: board/file/node → canonical rule or field → implementation → tests → review status. Preserve source wording alongside simplified CHW wording. Use file-qualified identifiers; short codes and node IDs can repeat across boards.

The boards define the draft clinical scope; Ayu and the target application provide workflow and compatibility references. Do not silently merge conflicting clinical rules. Audit Ayu requiredness, nested conditions, field types, age eligibility, and identifier collisions against the application's actual parser. Preserve ambiguous cases for review instead of guessing their semantics.

## 3. Source issues that require explicit handling

Both boards call themselves drafts for clinical review. Fidelity to a draft is not proof that it is safe to execute. Preserve original content, but keep proposed corrections in a separate reviewed layer.

Address these observed issues before enabling affected patient-care behavior:

- The hip/knee entry assumes non-musculoskeletal causes have already been excluded. Record who established eligibility and how; do not assume every patient presenting with pain meets that prerequisite. An unclear entry condition needs review, not automatic passage.
- Both boards allow progression when a skilled examination is unavailable. Record `not_performed` and its reason. Continue unrelated history capture, but do not infer a negative test or release a dependent diagnosis, safety clearance, or exercise plan. Implement capability and supervision requirements, with escalation to an appropriate reviewer.
- Negative safety screens and improvement at four weeks must not be translated into definitive proof of an exercise-responsive diagnosis. Preserve uncertainty and review the wording and decision rules.
- Hip/knee connectors `10:1317` and `10:1321` originate from sections `7:538` and `7:541`. These are section-level links, not ordinary clinical decisions. Resolve their intended semantics explicitly.
- Hip/knee section `34:1341`, “Exercises by Group,” contains E1–E8 with textual condition associations and 22 incoming connectors stored elsewhere in the board. Preserve those links through the full connector index; reconcile their meanings with diagnosis-specific plans and group text. Do not mistake an absence of locally stored arrows for an unconnected exercise library.
- Local thresholds, unavailable examination skills, eligibility for special populations, exercise clearance, referral urgency, and ambiguous multi-action boxes require explicit policy. Preserve the source's separate concepts of referral timing, whether assessment may continue, and whether exercise is restricted.
- Accuracy statistics, outcome tools, internal population statistics, and source citations require verification before clinical use. Do not calculate an individual's diagnostic probability from sensitivity/specificity alone. Check instrument scoring and reuse rights before reproducing questionnaires or translations.

Use authoritative clinical sources to investigate high-consequence discrepancies. Report the exact issue and proposed resolution. Do not present an AI-generated clinical review as clinician sign-off. No reviewer names, approvals, or validation outcomes may be invented.

## 4. Development usage and execution discipline

Honor the selected Fable 5.2 session. Ultracode is not permission for an unlimited agent swarm. Default to one lead; use at most two concurrent workers and four delegated tasks during the initial implementation. Delegate only bounded, independent work with a clear output and stopping condition. No recursive delegation or duplicate full-repository reviews. Further delegation needs a concrete reason tied to an unresolved defect, not a desire to consume the allowance.

Use focused searches, selective reads, local parsers, and concise tool output. Cache source extraction and preserve stable schemas. Maintain a short `docs/STATUS.md` with completed work, current commands, source versions, unresolved issues, and next steps. Resume from it after context compaction instead of rediscovering the project. Keep project-wide instructions compact.

Give one brief implementation plan and proceed without routine approval pauses. Make reversible engineering decisions yourself. Ask only for information that materially blocks clinical interpretation, source access, deployment, or the integration contract; continue work that does not depend on the answer.

Distinguish three budgets: Claude Code development usage, any separately configured usage/API credits, and the application's runtime inference/hosting costs. Do not infer my plan, remaining balance, or billing mode. Report only usage actually available to you; otherwise say it is unknown. Do not enable paid overage, auto-reload, fast paid modes, new subscriptions, or paid external services. A prompt cannot enforce an account-level spending cap; do not claim that it can.

Keep external runtime AI disabled by default. Implement offline/manual and clearly labeled mock-provider paths without requiring a paid account. Make an optional real provider adapter ready for credentials supplied through the environment. Do not send paid test calls until the provider and spending authorization are established. Never ask me to paste secrets into chat.

Prioritize source fidelity, patient-state correctness, safety behavior, a usable end-to-end workflow, and verification before secondary features. Avoid a visual protocol editor, new model training, an unrelated patient portal, elaborate analytics, or multiple competing stacks in this build. Do not skip essential tests to save tokens, but do not repeatedly rerun unchanged successful suites or endlessly polish working screens.

## 5. Architecture and protocol representation

Extend the existing application when a suitable repository is supplied. If no target codebase exists, build a mobile-first, offline-capable web application/PWA with a modular TypeScript implementation and a small server boundary for optional integrations and AI secrets. Use maintained, compatible dependencies and a lockfile. Document this as a companion application until its actual host integration is proven. Choose the simplest stack that meets the requirements; explain it briefly and implement it.

Separate the protocol engine, encounter store, UI, AI adapter, localization, and Intelehealth adapter. Protocol definitions must be versioned data validated against a schema, not clinical logic scattered through UI components or free-form prompts. Do not evaluate arbitrary code from imported protocol files.

Represent at least:

- Node identity, source reference, protocol version, review status, node type, eligibility, and required capabilities/equipment.
- Original and localized question text; typed answers, options, bounds, units, and applicable requiredness.
- Explicit branch conditions, safe handling of unanswered/unknown responses, escalation actions, and stopping conditions.
- Examination findings and who performed them; diagnosis candidates separated from clinician-confirmed assessments.
- Proposed versus approved exercise mappings, doses, precautions, progression, outcome measures, and follow-up rules.

Do not collapse these states: not asked, unknown, declined, not applicable, not performed, explicitly denied, and present. Preserve patient/caregiver reports separately from CHW observations and clinician findings. Each accepted fact needs its source, time, author/reviewer, and available evidence reference.

Validate graph reachability, missing endpoints, ambiguous edges, terminal actions, cycles, and cross-pathway references. An unanswered branch must not default to “no.” When an earlier answer changes, recompute applicability and mark dependent findings, notes, and plans stale. Keep prior versions auditable rather than silently deleting history. Prevent asynchronous AI responses from overwriting newer corrections or another patient's encounter.

Apply accepted safety-relevant facts immediately, including facts disclosed late. An urgent pathway cannot wait for a note-generation call or completion of routine questions. Incomplete or contradictory information must not produce clearance. Handle multiple simultaneous concerns using a reviewed priority policy. Preserve context across referred-pain pathway switches and prevent loops.

## 6. CHW experience

Build a calm, practical interface for small Android phones and intermittent connectivity. Use plain wording, large touch targets, clear focus states, accessible contrast, labeled icons, and progressive disclosure. Test the smallest supported viewport. Show one manageable question or closely related group at a time; keep technical provenance and detailed evidence in a review view.

Implement:

1. Synthetic demo patients and new/resumed encounters, with patient identity and laterality always clear.
2. Consent and language selection; structured entry with optional typed patient narrative.
3. Complaint-specific history, relevant medications/allergies/comorbidities, functional limitations, and goals. Ask applicable questions rather than an indiscriminate questionnaire.
4. A simple body-location selection with an accessible text alternative and support for more than one pain location.
5. Safety alerts with a clear action and urgency, an acknowledgment trail, and a visible route to clinician review.
6. Role/capability-aware examination cards with permitted steps, equipment needs, stop criteria, and explicit “not performed” handling. Do not imply a CHW can perform a specialist test merely because instructions are displayed.
7. Back/edit, autosave, interruption recovery, incomplete-encounter review, and visible pending items.
8. A concise clinician handoff showing supported history, relevant positives/negatives, missing findings, pathway trace, candidate assessment, and unresolved concerns.
9. Review and approval of source-derived exercise plans, patient instructions, baseline measures, progression, and follow-up. Keep the plan usable in synthetic demo mode while clinical activation remains gated.
10. A follow-up encounter that compares like-for-like measurements, records adherence and adverse responses, and applies reviewed reassessment rules.

Preserve relevant local goals already reflected in the boards, such as floor sitting, squatting toilets, field work, carrying water, and head-loads. Present them as choices, not assumptions about every patient. Never infer weight-loss advice or other individual recommendations from aggregate local data.

Separate “saved on this device,” “awaiting review,” “queued for sync,” and “received by server.” Never display success before acknowledgment. All primary controls must work; no decorative buttons pretending to implement a feature.

## 7. English, Hindi, and Marathi

Use stable language-independent field/option codes and localized display strings. Support Devanagari, text wrapping, and switching languages without losing answers. Preserve original text alongside normalized clinical fields. Include Hindi-English and Marathi-English code-switching in evaluation.

Reuse reviewed translations where available; missing or generated translations remain visibly marked as drafts in review tools. Do not silently substitute another language for a missing clinical instruction or pretend machine translation is approved. A declared model language capability is not evidence of adequate medical accuracy.

Typing and structured controls are required in all three languages. Add optional speech capture only through a supported adapter, after the manual workflow works. Require consent, visible recording controls, editable transcripts, and a confirmation step before clinical fields change. If a speech provider is absent or unsupported, preserve the complete manual workflow and report the limitation. Do not claim browser speech recognition works offline or supports Marathi without testing that environment. Do not retain raw audio or record in the background by default.

## 8. AI responsibilities and runtime costs

There are two separate AI uses:

**During development:** help extract source content, identify ambiguities, draft translations, propose protocol mappings, and generate candidate tests. These outputs enter review; they do not establish clinical truth.

**During an encounter:** extract proposed typed facts from patient text or an editable transcript, flag detectable contradictions or uncertainty, and help draft a clinician-readable history from accepted facts. Clarifications must map to permitted question intents. The engine owns clinical branching.

Implement a provider interface, a deterministic baseline note renderer, a clearly labeled mock provider for tests, and at least one real provider adapter with validated configuration. A mock is not evidence that live AI works. Keep model selection replaceable; do not hard-code the development model as the clinical runtime model or claim any model is best without task-specific results.

Validate model output against a strict schema. Every proposed fact needs a matching evidence span or explicit structured-input reference. Treat quotations as provenance, not proof that speech recognition was correct. Resolve negation, timing, experiencer, laterality, and corrections carefully. Do not invent normal examinations, absent allergies, medication identities, numeric values, diagnoses, or missing history to make a note look complete.

Show proposed changes for CHW review before acceptance. Highlight potentially urgent statements promptly for review rather than burying them in a pending summary; do not let unconfirmed AI text silently clear or alter clinical state. Treat patient text and imported source content as untrusted data, not instructions that can alter permissions or protocols.

Use bounded relevant context instead of sending the full protocol and transcript on every keystroke. Add timeouts, bounded retries, cancellation, response-size limits, and a manual fallback. Regenerate notes only on explicit action or meaningful accepted changes. Do not share patient-output caches across encounters. Record model/configuration and observable latency/token usage without logging identifiable clinical content. Provide configurable call limits and clearly label any cost estimate and its assumptions.

## 9. Intelehealth integration and offline behavior

Inspect the target workflow and schema before claiming integration. Verify patient identifiers, encounter types, complaint mappings, observation/concept IDs, required metadata, authentication, and update semantics. If the deployment uses OpenMRS, inspect its actual version and concept dictionary. Do not invent UUIDs, endpoints, or presume a FHIR export is compatible.

Build a typed adapter with explicit mappings and a report of unmapped fields. Support the appropriate encounter handoff: history, observations, completed/missing assessment items, review status, referral actions, approved plan, and follow-up. Preserve provenance and version information. Implement idempotency, retry handling, duplicate prevention, conflict detection, and visible server acknowledgment. Do not blindly overwrite a clinician's newer record.

Without a verified sandbox and credentials, deliver a runnable mock server, contract tests, documented payload examples, a structured JSON export, and a readable print/export note. Label integration as simulated or unverified, never “connected.” With an authorized sandbox, test an actual synthetic encounter through it and report what was confirmed. Do not write to a production clinical system as a development test.

Cache the app shell, active protocols, and language assets so the manual workflow can run after initial installation without network access. Persist draft state across reloads and restarts; test queued synchronization after reconnection. Surface storage failures and stale protocol versions. Explain browser storage/eviction limits honestly. Do not cache identifiable API responses indiscriminately in a service worker.

Use synthetic data in the development environment. Keep credentials server-side and out of source control, logs, client bundles, and exports. A demo role switch is not authorization. Before enabling real patient mode, require authenticated access controls, appropriate local/server data protection and key handling, retention/deletion policy, and actual clinical/content approval. Do not claim compliance merely because these controls are planned. Keep video/media collection out of scope unless explicitly required and consented.

## 10. Build order and definition of done

Use this sequence, adapting only when repository evidence justifies it:

1. Inspect sources/repository; record gaps; establish schemas and source mapping. Keep this phase bounded and produce the first working code early.
2. Complete one representative pathway end to end, preferably knee, including a routine route, an escalation route, saving, review, and export. This is the implementation pattern, not the final scope.
3. Cover all four pathways and all source sections, including exercise groups, examination requirements, cross-pathway links, and follow-up. Represent blocked clinical mappings explicitly.
4. Finish localization, optional AI adapter, offline/recovery behavior, integration adapter, and clinician review.
5. Run meaningful verification, repair defects, and hand over a runnable result with an honest readiness report.

Required verification:

- Type checks, production build, and relevant automated tests pass; record exact commands and outcomes.
- Every source node is classified as implemented, supporting/reference material, duplicate, or blocked with a reason. Report coverage against the audited inventory, not selected examples.
- Test every executable clinical transition and terminal action, plus thresholds and eligibility boundaries. Do not claim exhaustive coverage of every possible path through a cyclic graph. Expected outcomes must be grounded in source/reviewed requirements, not simply generated by the same implementation under test.
- Cover all four regions with routine, urgent, unknown, contradictory, corrected-answer, and unavailable-examination scenarios. Include cross-region referred pain, multiple complaints, and relevant unsupported-population behavior.
- Verify that missing safety evidence, a skipped specialist examination, a late concern, or an unreviewed rule cannot silently release a dependent exercise plan.
- Verify autosave/reload, offline completion, reconnection, duplicate submission, expired authentication, and sync conflict behavior.
- Test AI malformed output, hallucinated fields, injection attempts, timeouts, stale responses, refusal, and failure. Preserve a usable manual path.
- Evaluate extraction and note fidelity separately in English, Hindi, and Marathi. Report unsupported facts, missed relevant facts, polarity/temporality errors, correction burden, and untested conditions. Generated text cases are software tests, not proof of speech or clinical performance.
- Perform a browser walkthrough at phone and desktop sizes: create encounter, complete assessment, edit an answer, review note/plan, reload, export, and resume follow-up. Check keyboard access and Devanagari display. Do not assert a device or browser was tested unless it was.

Do not hide failing tests, fabricate screenshots, or mark disabled features as complete. Re-run targeted checks after fixes and the relevant final suite once; broaden testing only for a reason. Avoid arbitrary test-count targets and cosmetic coverage metrics.

## 11. Deliverables and final handoff

Deliver runnable source, lockfile, setup/run/build/test commands, `.env.example` without secrets, synthetic fixtures, protocol definitions and schema, source mapping, and the implemented adapters. Include a reproducible source-import process so future board revisions can be compared rather than manually recopied.

Keep documentation useful and compact:

- `README.md`: install, run, demonstrate, test, and configure optional providers.
- `docs/PROTOCOL_REVIEW.md`: source versions, coverage, discrepancies, proposed amendments, and actual approval status.
- `docs/INTEGRATION.md`: verified contract, field mapping, simulated/connected status, and remaining dependencies.
- `docs/VALIDATION.md`: tests executed, real results, language/device limits, and unresolved risks.
- `docs/STATUS.md`: concise continuation checkpoint.

Finish with the working local URL or launch command; a short demonstration route; what works; tests actually run; exact remaining blockers; and separate statuses for software, clinical review, language review, live AI, and Intelehealth integration. If an external dependency blocks full completion, finish all independent work and identify the minimum next action without exaggerating readiness.

Start by inspecting the repository and the supplied source index. State the few assumptions that matter, outline the implementation briefly, and then build.
