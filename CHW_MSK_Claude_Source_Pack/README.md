# CHW musculoskeletal app: Claude Code build pack

This pack contains the implementation prompt and a section-by-section extraction of both FigJam boards. It does not contain an implemented app or a clinically approved protocol. Project languages are English, Hindi, and Marathi.

## Start

1. Extract this folder inside the application repository, or into a new project directory if no application exists yet. Preserve the existing repository and its instructions.
2. Open Claude Code in that project. Select Fable 5.2 using the supported model picker. Current documentation lists Claude Code 2.1.321 or later for this model.
3. Check your actual usage/billing settings. Fable inclusion depends on your plan; included development usage does not automatically fund the app's future inference calls. Disable or cap separately billed usage in the account if you want a firm spending boundary. The prompt itself is not a billing control.
4. Use the launcher below, adjusting the folder path if needed. The full prompt is `BRIEF.md`. Keep the source snapshot alongside it.

```text
Read CHW_MSK_Claude_Source_Pack/BRIEF.md, then its SOURCE_AUDIT.md and sources/manifest.json. Follow the brief and build the application in this repository. Use English, Hindi, and Marathi. Inspect section files selectively, preserve the source-review issues, and proceed through implementation and verification rather than stopping at a plan. Maintain docs/STATUS.md for continuation.
```

## Model and workflow controls

For a current supported Claude Code version, these are separate commands entered into Claude Code, not a shell script:

```text
/model claude-fable-5-2
/effort high
/effort ultracode
/usage
```

Ultracode enables dynamic workflow orchestration; it is separate from the reasoning effort setting. The brief bounds delegation because extra agents can increase consumption. `high` is a starting choice for this complex build, not a measured optimum. Use observed progress and defects to decide whether deeper effort is justified. Avoid repeatedly changing models or reloading all sources during a single implementation milestone.

The exact account entitlements and current controls take precedence over this dated setup note. See the official references below.

## Contents

- `BRIEF.md`: complete implementation instructions.
- `SOURCE_AUDIT.md`: observed issues and boundaries of the source inspection.
- `sources/manifest.json`: board inventory, source URLs/hashes, and paths.
- `sources/spine/` and `sources/hip_knee/`: section JSON, page-level connectors, and a complete connector index.
- `sources/raw/`: the original FigJam XML responses for verification.

The standalone `Claude_CHW_MSK_App_Master_Prompt.md` download contains the same brief. You only need one copy of that prompt in the coding session.

## Continuation launcher

```text
Continue the CHW musculoskeletal app build. Read docs/STATUS.md and the relevant acceptance criteria in the build brief. Inspect the current repository and resume the next incomplete milestone. Reuse the frozen source snapshot and prior verified results. Do not restart completed work or claim blocked clinical/integration items are finished. Keep English, Hindi, and Marathi as the only project languages.
```

## Official setup references

Checked 15 November 2026:

- Model configuration and Ultracode: https://code.claude.com/docs/en/model-config
- Usage monitoring and costs: https://code.claude.com/docs/en/costs
- Dynamic workflow usage: https://code.claude.com/docs/en/workflows
- Fable availability by plan: https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- Intelehealth's description of Ayu workflow: https://intelehealth.org/ayu-2-0-ai-for-clinical-care-assistance/

These references support setup and workflow context. They do not certify the clinical content of either board.
