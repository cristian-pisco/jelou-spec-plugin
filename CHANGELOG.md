# Changelog

## [0.3.111] — 2026-04-26

### Internal
- keep workflow body untouched until Task 7 rewrite

## [0.3.110] — 2026-04-26

### Internal
- rename post-slack to daily-slack

## [0.3.109] — 2026-04-26

### Internal
- add daily-slack sprint implementation plan + clarify FR-5 ownership

## [0.3.108] — 2026-04-26

### Internal
- add 2026-04-26 daily-slack sprint redesign spec

## [0.3.107] — 2026-04-26

### Internal
- skills/refresh-skills/SKILL.md
- jelou/workflows/refresh-skills.md
- .opencode/commands/jlu-refresh-skills.md
- README.md Core Commands row
- AGENTS.md Phase 1 scope reference
- new-task.md staleness check (dead consumer)
- bin/install.sh post-install help line

## [0.3.106] — 2026-04-26

### Internal
- expand architecture-review coverage

## [0.3.105] — 2026-04-26

### Fixed
- use @jelou shorthand in OpenCode + read fragment before delete

## [0.3.104] — 2026-04-26

### Internal
- add /jlu-architecture-review to core commands

## [0.3.103] — 2026-04-26

### Added
- add OpenCode command

## [0.3.102] — 2026-04-26

### Added
- add SKILL.md launcher

## [0.3.101] — 2026-04-26

### Added
- add orchestrator workflow

## [0.3.100] — 2026-04-26

### Added
- add grill agent (opus)

## [0.3.99] — 2026-04-26

### Added
- add explorer agent (sonnet)

## [0.3.98] — 2026-04-26

### Added
- add report-shape template

## [0.3.97] — 2026-04-26

### Added
- add ADR file-shape template

## [0.3.96] — 2026-04-26

### Added
- add vocabulary contract reference

## [0.3.95] — 2026-04-26

### Internal
- cover multi-candidate, flags, cross-service

## [0.3.94] — 2026-04-26

### Added
- green — render single-candidate report

## [0.3.93] — 2026-04-26

### Internal
- red — single-candidate happy path

## [0.3.92] — 2026-04-26

### Internal
- cover gaps and non-ADR files

## [0.3.91] — 2026-04-26

### Added
- green — return next zero-padded ADR id

## [0.3.90] — 2026-04-26

### Internal
- red — returns 0001 for missing decisions dir

## [0.3.89] — 2026-04-26

### Internal
- add architecture-review implementation plan

## [0.3.88] — 2026-04-26

### Changed
- map-codebase Step 9 summary now reports both added and skipped counts
- ubiquitous-language workflow Step 3 explicitly creates .tmp/
- curator now receives PLUGIN_ROOT for template path resolution

## [0.3.87] — 2026-04-26

### Internal
- add architecture-review skill design

## [0.3.86] — 2026-04-26

### Internal
- mirror Phase 0 changes and mention command in README

## [0.3.85] — 2026-04-26

### Added
- consult canonical glossary in Step 14 (read-only)

## [0.3.84] — 2026-04-26

### Added
- hook glossary candidate extraction after codebase docs

## [0.3.83] — 2026-04-26

### Added
- add /jlu-ubiquitous-language SKILL launcher

## [0.3.82] — 2026-04-26

### Added
- add /jlu-ubiquitous-language orchestrator workflow

## [0.3.81] — 2026-04-26

### Added
- add jlu-glossary-curator agent

## [0.3.80] — 2026-04-26

### Added
- add jlu-glossary-extractor agent

## [0.3.79] — 2026-04-26

### Added
- add UBIQUITOUS_LANGUAGE.md template

## [0.3.78] — 2026-04-26

### Fixed
- write candidates.json before deleting fragments

## [0.3.77] — 2026-04-26

### Internal
- fragment cleanup after successful merge

## [0.3.76] — 2026-04-26

### Internal
- exclusion-list behavior for dropped/promoted terms

## [0.3.75] — 2026-04-26

### Internal
- lock in multi-service union behavior

## [0.3.74] — 2026-04-26

### Added
- green — merge fragments into candidates.json

## [0.3.73] — 2026-04-26

### Internal
- red — happy path merge into fresh candidates.json

## [0.3.72] — 2026-04-26

### Internal
- add ubiquitous-language implementation plan

## [0.3.71] — 2026-04-26

### Internal
- correct Hook B target to new-task workflow

## [0.3.70] — 2026-04-26

### Internal
- add ubiquitous-language skill design

## [0.3.69] — 2026-04-26

### Fixed
- Concatenate every *.trace and *.network entry instead of looking up by fixed name. Same "missing required entry" error path preserved when no trace stream is present (keeps the existing unit test behavior).
- Errors live on `after` events in real traces; their matching `before` (linked by callId or stepId) carries the params. Multiple `before`s exist per step (one per stream); prefer the candidate that has params.selector.
- Network events use the HAR-shaped resource-snapshot format with nested request/response. Parse both that and the legacy flat shape.
- Console errors use messageType: 'error' in real traces (not level/severity).
- test_title / test_file / test_line fall back to the leading context-options.title and the standalone error event's stack[0].

## [0.3.68] — 2026-04-26

### Added
- Add a Playwright project under frontend/ pinned to @playwright/test 1.49.1 (matches bin/extract-trace.mjs's trace.zip schema). One spec exercises login → dashboard → cancel via signInAs() helper using role-based locators.
- Serve the dashboard HTML inline from the API (/, /dashboard) instead of spinning up a Next.js or Vite dev server in CI. Same-origin avoids CORS, keeps install time near zero, and matches the API's existing "stdlib only" ethos.
- Forward BUG_MODE through docker-compose so the deliberate-bug job's job-level env var actually reaches the container — without this the variable was silently dropped and cancel always returned 200.
- Rewrite tests/sample-consumer/README.md to reflect the actual architecture (no Next.js, single-container API + Playwright project).

## [0.3.67] — 2026-04-26

### Fixed
- Author replay/transcript.json for the 4 v0.1.0 fixtures so the harness can run end-to-end (writer-agent/{001,002}, fix-loop/{001,002}).
- Add the missing input/ payloads for 002-undeclared-testid (SPEC + services.yaml + TASKS.md) and 002-same-hunk-twice (dispatch payload + trace summary).
- Use `npx --yes -p typescript@5 tsc` so the binary actually resolves — the previous form `npx --yes typescript@5 tsc` errored with "could not determine executable to run".

## [0.3.66] — 2026-04-25

### Added
- Add a pre-flight check in new-task.md Branch Creation step (worktree mode) that runs git check-ignore -q .worktrees and aborts the service setup if .worktrees/ is not git-ignored. Prevents the latent class of bug where worktree contents pollute the service repo's tracked state.
- Renumber the worktree-mode setup steps (was 1-3, now 1-4) to keep the pre-flight in front of git worktree add.
- Document the precondition at the top of jelou/references/worktree-resolution.md, including the explicit choice not to auto-modify a service repo's .gitignore — that requires user consent.

## [0.3.65] — 2026-04-25

### Internal
- Add jelou/references/parallel-dispatch.md adapted from superpowers:dispatching-parallel-agents for multi-service fan-out at per-phase steps (test-writer, implementer, qa-agent, build-validator). Documents the single-orchestrator-message pattern, scope-isolation rules, and post-return conflict detection via artifacts comparison.
- Cite from jelou/workflows/execute-task.md at 7d (TDD Red — Spawn Test Writer) and 7e (TDD Green — Spawn Implementer) so the orchestrator fans out per service when the phase affects multiple services without cross-service dependencies. Step 4f proposal-agent dispatch is already parallel by precedent.

## [0.3.64] — 2026-04-25

### Internal
- Add jelou/references/skill-development.md adapted from superpowers:writing-skills, covering the TDD-for-skills cycle (RED-GREEN-REFACTOR for agent prompts), the CSO description rule (triggers only, never workflow summary), skill type taxonomy, token targets, anti-patterns, and rationalization-closure techniques.
- Audit existing skill descriptions against the CSO rule (close-task, execute-task, new-task all violate it via post-em-dash workflow summaries) and document the compliant format. Cleanup of all 15 descriptions is left as a follow-up commit.
- Update tests/pressure/runner.mjs header to clarify the two modes (regression default, TDD when adding/editing agents) and reference the new methodology doc.
- Update tests/fixtures/INDEX.md with a link to the methodology.

## [0.3.63] — 2026-04-25

### Internal
- Add jelou/references/systematic-debugging.md adapted from superpowers:systematic-debugging for the orchestrator/subagent execution model, with the three-strike rule mapped to existing implementer (2 attempts) and build-validator (5 rounds) loop limits.
- Cite from agents/jlu-implementer.md (Step 4 Run Tests) and agents/jlu-build-validator.md (Limits) in both Claude and OpenCode mirrors.
- Cross-link from jelou/references/tdd-cycle.md Test Dispute Mediation to distinguish dispute (test wrong) from stuck (test right, implementer cannot pass it).

## [0.3.62] — 2026-04-25

### Added
- integrate UI QA workflow with Playwright E2E and bounded auto-fix loop

## [0.3.61] — 2026-04-24

### Fixed
- Add jelou/references/claude-code-runtime.md with the name mapping, mandatory ToolSearch preload step, and usage rules.
- Dispatch skills (new-task, execute-task, map-codebase) now prepend the contract to the subagent prompt before the workflow content.
- Inline skills (refine-task, close-task, create-pr, extend-phase, post-slack, rollback-phase, sync-clickup, load-context) load the contract in a new Phase 1b and replace `question` in allowed-tools with AskUserQuestion and ToolSearch.

## [0.3.60] — 2026-04-18

### Added
- add bin/changelog-entry.py: parses the commit message (HEREDOC, -m "...", -m '...'), bumps the patch version in all three manifests, and prepends a categorized entry to CHANGELOG.md
- route .claude/hooks/pre-commit-version-bump.sh through the new script, skip on --amend, and block the commit with exit 2 if the message cannot be parsed so CHANGELOG and version never drift

## [0.3.59] — 2026-04-15

### Fixed
- `close-task`: reads `## Branching → Mode` (not `Setup Mode`) so branch-mode cleanup dispatches correctly.
- `jlu-conflict-resolver`: binary-file detection uses `CHERRY_PICK_HEAD` instead of `MERGE_HEAD` — git populates the former during cherry-pick conflicts.
- `rollback-phase`: legacy fallback treats a missing `## Branching` section as `Mode: worktree`, so pre-upgrade tasks can still roll back.

### Changed
- `create-pr`: unified sync-marker format to a per-service map (`Sync markers: <service-id>: alpha=<sha>, production=<sha>`) in both Step 2 (read) and Step 5b.8 (write). Flat `Last-alpha`/`Last-cp` fields removed from the live schema; legacy flat fields are still honored on read for backwards compatibility.
- `new-task` Step 8c and `jlu-tasks-agent` TASKS.md template now describe the `Sync markers` block instead of the old flat fields.

## [0.3.57] — 2026-04-15

### Added
- Branch-only setup mode: `/jlu-new-task` asks (after spec approval) whether to use the full worktree+Docker setup or a lightweight branch-only setup.
- Dual-PR support: tasks can opt into producing a second PR targeting `alpha`. The `staging/<slug>` branch is synthesized on-demand at `/jlu-create-pr` time by cherry-picking production commits onto a fresh cut of `origin/alpha`.
- `jlu-conflict-resolver` sub-agent (sonnet): runs cherry-pick loops and resolves merge conflicts using SPEC + adjacent code as evidence.

### Changed
- Branch naming: `spec/<slug>` is replaced by `production/<slug>` (mandatory) and optional `staging/<slug>`. Old tasks continue to use the legacy name through close.
- `/jlu-new-task`: environment setup (worktree, Docker) is now deferred until after spec approval. Aborted or declined tasks leave no filesystem or Docker state behind.
- `/jlu-create-pr`: records two PRs in `TASKS.md` and `CLICKUP_TASK.json` when `DUAL_PR = yes`; cross-links sibling PR URLs in both PR bodies.
- `/jlu-close-task`: tears down the staging side (closes PR, removes remote/local `staging/<slug>`) regardless of whether the alpha PR was merged. Closure requires only the trunk PR to be merged.
- `/jlu-execute-task`: in branch mode, auto-checks out `production/<slug>` in each service repo before the first phase; aborts if the working tree is dirty or the branch does not exist locally.

### Internal
- Removed `new-task.md` Step 9 (background worktree subtask). Replaced with Step 15b (mode selection) and Step 15c (setup subtask) that run only after spec approval.
- `jlu-git-agent` simplified: operates only on `production/<slug>`; no paired pushes; no dual-PR awareness.
- `jlu-report-task` detects stale `.worktrees/<slug>-staging-tmp` directories older than 1 hour.

## [0.3.19]

### Added

- **OpenCode integration support**: Core workflows now support OpenCode runtime for faster code execution and generation within the spec-driven development environment

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
