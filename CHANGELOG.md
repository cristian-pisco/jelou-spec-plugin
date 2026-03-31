# Changelog

## [0.3.7]

### Changed

- **Auto-detect spec templates**: `/jlu:new-task` no longer asks users to pick a template. The interview automatically detects which domains the task involves and merges all applicable templates. Cross-cutting tasks get combined FR/NFR scaffolding and interview hints from multiple templates.
- Domain-aware gap detection as fallback for tasks not covered by any template (API, UI, DB, events)

## [0.3.6]

### Added

- **Spec compliance review** in `/jlu:create-pr`: new `jlu-spec-reviewer` agent checks code diff against SPEC.md requirements before PR creation
- **Requirements coverage table** (COVERED / PARTIALLY_COVERED / UNTESTED / MISSING) with file:line evidence
- **Scope creep detection** flags code changes not mentioned in spec or proposal
- **Compliance report** included in PR description as a collapsible `<details>` section
- Non-blocking gate: user can proceed with known gaps or abort to implement missing requirements

## [0.3.5]

### Added

- **Incremental codebase analysis**: `/jlu:map-codebase` auto-detects changes since last analysis and only re-analyzes affected docs
- **`.last-analysis.json` marker** tracks the commit SHA of the last analysis
- **File categorization heuristic** maps changed files to the docs they affect
- Structural and operational analyzer agents support **incremental update mode**

## [0.3.4]

### Added

- **Conflict detection** in `/jlu:new-task`: warns when a new task overlaps with active tasks on the same services
- Requires explicit user confirmation to proceed when conflicts are found

## [0.3.3]

### Added

- **Automatic spec versioning**: SPEC.md snapshots saved to `versions/SPEC-v<N>.md` after each interview or refinement
- **Human-readable spec changelog** at `versions/SPEC-changelog.md` with Added/Changed/Removed sections
- **Retroactive first version** creation if versioning is added to an existing task via `/jlu:refine-task`

## [0.3.2]

### Added

- **`/jlu:rollback-phase` command**: manually reset service worktrees to the last known-good phase state
- **Commit SHA tracking** per phase in TASKS.md (recorded during `/jlu:execute-task`)
- **Pre-execution commit baseline** for rolling back to before any phase started

## [0.3.1]

### Added

- **Spec templates**: 4 built-in templates (REST API, UI component, database migration, event consumer) pre-fill SPEC.md sections and guide the interview
- **Template registry** at `<WORKSPACE_PATH>/templates/` supports custom user-defined templates
- **Template selection step** in `/jlu:new-task` workflow (Step 2c) — templates are auto-copied from plugin on first use

## [0.3.0]

### Changed

- **9 skill launchers now execute workflows directly** instead of spawning a redundant Opus sub-agent. Saves 10-30s latency per command invocation. Affected commands: close-task, create-pr, report-task, refresh-skills, post-slack, load-context, sync-clickup, refine-task, extend-phase.
- **map-codebase uses 2 Sonnet agents instead of 7 Opus agents.** Two consolidated analyzers (structural + operational) replace six individual researchers plus a cross-validator. ~7x reduction in token cost per codebase analysis.
- **Proposal agent downgraded from Opus to Sonnet.** Structured document generation doesn't need Opus-level reasoning.
- **User stories generated during sync-clickup** instead of execute-task. Stories are only consumed by ClickUp, so they're created at sync time.
- **Model tiers are now configurable** via `models` section in `.spec-workspace.json`. Users can override per agent group (orchestrator, research, code, proposal, operational).

### Added

- **Update notifications** — Every `/jlu:*` command silently checks for newer versions on GitHub (cached 4h, 2s timeout). Prints a one-line banner if an update is available. Skips in CI environments.

### Removed

- **CONTEXT.md generation** — duplicated information already in phase files and codebase knowledge files.
- **Observability events** in close-task — write-only artifact with no consumer.
- **Cross-validator agent** — consolidated agents see the full codebase, eliminating contradictions.
- **6 individual research agents** — replaced by 2 consolidated analyzers.

## [Unreleased — pre-0.3.0]

- Merge spec interview into `/jlu:new-task` — interview runs inline immediately after service confirmation, worktrees created in background
- Introduce `/jlu:refine-task` — apply last-minute targeted changes to an approved spec via structured agent interview
- Remove `/jlu:refine-spec` (replaced by inline interview in `new-task` and targeted `refine-task`)
- Add agent spawning feedback pattern to all modified workflows (orchestrator notifies user before spawning any agent)
- Fix AskUserQuestion enforcement in `jlu-concerns-researcher` — Phase 2 now uses explicit round-based AskUserQuestion calls instead of plain text output
- Add AskUserQuestion mandate to all 7 workflow files (new-task, refine-task, execute-task, close-task, create-pr, extend-phase, map-codebase)
- Migrate `/jlu:sync-clickup` to ClickUp MCP server — no API key needed, auto-discovers custom fields, adds time_estimate as required field
- Remove `/jlu:publish-uh` (functionality merged into `sync-clickup`)
- Deprecate `jlu-pm-agent` and `/jlu:setup-clickup` (replaced by direct ClickUp MCP calls)
- Update `/jlu:close-task` to use ClickUp MCP tools directly for status updates

## [0.2.2]

- Add status summary (Current Status + Next Step) to `/jlu:load-context` command
- Add architecture diagrams to documentation

## [0.2.1]

- Add `/jlu:load-context` command for resuming task context in fresh sessions
- Remove `/jlu:new-project` command (replaced by workspace auto-creation in `new-task`)

## [0.2.0]

- Add `/jlu:create-pr` skill for automated pull request creation across all affected services
- Add auto version bump hook on commits via `PostToolUse` hook
- Improve integrations researcher HTTP client tracing

## [0.1.x]

- Fix marketplace.json source path for Claude Code plugin schema
- Fix plugin install commands and enhance plugin manifest

## [0.1.0]

- Initial commit: Jelou Spec Plugin for Claude Code
