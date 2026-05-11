# Changelog

## [0.3.152] — 2026-05-10

### Fixed
- resolve task dirs from marker files

## [0.3.151] — 2026-05-10

### Fixed
- add global workflow fallbacks for jlu commands

## [0.3.150] — 2026-05-10

### Added
- add unified host installer command

## [0.3.149] — 2026-05-10

### Internal
- throttle test orchestration defaults

## [0.3.148] — 2026-05-07

### Fixed
- jlu-execute-task Step 7e (post-Green lint/format): scope the format command to the implementer's `Files Modified` + the test-writer's `Tests Written` artifacts. Previously ran `npx eslint --fix . && npx prettier --write .` against the whole repo, which reformatted unrelated files and then tripped Step 7j's scope check on imperfectly-formatted codebases.
- jlu-execute-task Step 7e: detect format command from CONVENTIONS.md / `package.json` scripts instead of hardcoding eslint+prettier; fall through to a `skipping post-Green format` log line when no command is detectable (Python/Go services).

### Internal
- jlu-implementer, jlu-test-writer, jlu-build-validator, jlu-qa-agent: add a Context Discipline section. Subagents Grep before Read for orientation, pipe verbose test/build output through `tail -200` / error-filters before consumption, bound `context7 query-docs` to narrow topics, and use the three-strike escalation as the overflow safety valve instead of accumulating fix-round output. Reduces the "Agent context overflowed" fresh-spawn fallback rate on long multi-phase tasks.

## [0.3.147] — 2026-05-06

### Internal
- reduce orchestrator token spend in execute-task and new-task

## [0.3.146] — 2026-05-05

### Added
- jlu-spec-interviewer: reject 'E2E not required for MVP' / 'manual QA covers it' / 'defer to follow-up' framing; require at least one Success Criterion describing a browser-level flow when a UI service is in scope.
- jlu-proposal-agent: forbid 'E2E not required for MVP' phrasing in proposals; Testing Strategy must list E2E flows traced to SCs and the phase plan must include a /jlu:ui-qa-run run.
- jlu-ui-e2e-writer: add MODE=derive-from-spec so the agent can generate user-flow.md from SPEC.md when the spec author skipped /jlu:refine-task. Document the derivation rules (Routes, Steps, Boot Order, Env Vars, Auth Precondition) and the NEEDS_CONTEXT escalations for ambiguous inputs.
- ui-qa-run workflow: harden the UI-service detection (stack OR description regex), refuse exit-0 when a UI service is missing a dev block in services.yaml, dispatch the e2e-writer in derive-from-spec mode when no user-flow.md exists, and commit the generated file to the task directory so it survives runs.

## [0.3.145] — 2026-05-05

### Added
- standard markdown output, status_percentages map, cutoff window, full-line strike, short-term status notes

## [0.3.144] — 2026-05-05

### Added
- daily-slack: new `bin/daily-slack-compose.mjs` performs deterministic placeholder substitution preserving Slack mrkdwn (`` `[N%]` ``, `` `[YYYY-MM-DD]` ``, `<url|text>`, `~strike~`) literally, replacing the prior LLM-driven substitution that silently rewrote those tokens out of the body
- daily-slack: channel template frontmatter accepts `closed_like_statuses` (case-insensitive name list) so ClickUp custom statuses like "pending to production" or "in review" are treated as 100%-done in `bin/daily-slack-bucket.mjs` (achieved bucket + percentage normalization + snapshot transition) and struck through in `{{short_term_goals}}` by `bin/daily-slack-render.mjs`
- daily-slack: channel template frontmatter accepts `preview_channel`; when set, Step 14b posts the composed body to that target with a `*[PREVIEW — sprint <N> for #<channel>]*` banner and asks the user to verify the live Slack rendering before publishing to the real channel
- daily-slack: shared `bin/lib/daily-slack-status.mjs` helper (`isClosedLike`, `loadClosedLikeStatuses`) used by both bucket and render so the closed-like rule has one source of truth

### Changed
- daily-slack: workflow Step 6c now captures `status.status` as `status_name` (in addition to `status.type`) and Step 6c also instructs the orchestrator to fan all per-task `clickup_get_task` calls in parallel from a single multi-tool message
- daily-slack: workflow Step 9 splits comments and PR-state fetches into two parallel batches (single multi-tool message for `clickup_get_task_comments`; `xargs -P` / background `&`+`wait` for `gh pr view`), targeting a 10-min → ~2-min wall-clock cut on full sprints
- daily-slack: workflow Step 13 runs `bin/daily-slack-compose.mjs` against `template-body.md` + `render-output.json` + `manual-fields.json` instead of in-line LLM substitution

## [0.3.143] — 2026-05-04

### Added
- Foundations for the JLU Dev Orchestrator (Phase 1 of a multi-phase TMUX-based dev environment plugin)
- `/jlu:register-service` (Claude Code) and `/jlu-register-service` (OpenCode) — interactive command to register or update a service in `jlu-services.json` with smart inference (lockfile detection for pnpm/yarn/bun/npm, `.env` files, docker-compose service detection)
- `bin/lib/dev-orchestrator/config.mjs` — JSON Schema validator + atomic write + defaults merge
- `bin/lib/dev-orchestrator/workspace.mjs` — workspace root resolver (walk-up + git fallback) + 12-char workspace-id (sha256)
- `bin/lib/dev-orchestrator/task-context.mjs` — 5-layer task slug resolver (override → worktree path → branch → TASKS.md scan → `_global`)
- `bin/lib/dev-orchestrator/state.mjs` — state directory primitives at `~/.jlu/workspaces/<id>/<slug>/`
- `bin/lib/dev-orchestrator/register.mjs` — pure helpers used by the workflow: `loadOrInitConfig`, `addOrUpdateService`, `inferDefaults`, `inferComposeServices`
- `jelou/references/jlu-services.schema.json` — JSON Schema Draft 2020-12 reference document for `jlu-services.json`
- 49 new unit tests across five suites covering schema validation, workspace + task-slug resolution, state primitives, and register helpers (full repo suite at 196/196)

### Internal
- Spec + Phase 1 plan documents under `docs/superpowers/specs/` and `docs/superpowers/plans/`
- Phase 2 (TMUX wrapper + minimal start-dev/stop-dev), Phase 3 (daemon + readiness probes + notifications), Phase 4 (diagnose + add-service + logs), and Phase 5 (polish + parity audit) deferred to subsequent plans

## [0.3.142] — 2026-05-04

### Added
- Collapse refine-task workflow from 9+2b+9b steps to 6 by removing redundant snapshot capture, context review no-op, interactive map-codebase prompt, and unconditional principles read
- Trim default context load to ARCHITECTURE/CONVENTIONS/INTEGRATIONS per service; STACK/STRUCTURE/CONCERNS load lazily on keyword match in the change request
- Load engineering principles only when the change request mentions architectural keywords (architecture, security, performance, scalability, auth, schema, contract, event, migration)
- Add Step 6b: propagate the SPEC.md delta into PROPOSAL.md and phase files so /jlu-execute-task only re-runs affected phases — Changed reqs trigger Modification blocks and reset done phases to pending; Added reqs extend the latest pending phase or create a new phase file; Removed reqs append a Removed note (immutable baseline preserved)
- Append a Refinement Log entry to PROPOSAL.md documenting modified/reset/extended/added phases per refinement
- Transition task status to implementing in Step 6c when phases are reset or added so execute-task can pick the work up
- Add Edit to refine-task SKILL.md allowed-tools for in-place phase file edits

## [0.3.141] — 2026-05-04

### Added
- New jelou/references/e2e-environment.md codifying .env loading order, required env vars (E2E_BASE_URL), the boot-vs-point-at-real decision, and what may be intercepted
- e2e-anti-patterns.md #11: forbid page.route().fulfill() of business endpoints; route.abort() allowed only for non-product traffic listed in Out of Scope
- dev block gains optional env_files field for non-Docker launchers (default [.env, .env.e2e])
- user-flow.md template adds required Env Vars and External Endpoints sections plus Acceptance Criteria for the no-mock + env-declared rules
- /jlu-ui-qa-run step 15 sources .env and .env.e2e before launching Playwright, fails fast on missing E2E_BASE_URL or flow-declared vars, and HEAD-checks every external endpoint
- jlu-ui-e2e-writer refuses hard-coded baseURL, refuses undeclared env vars, refuses business-endpoint mocks, and emits required-env.txt + external-endpoints.txt for the orchestrator to read

## [0.3.140] — 2026-04-30

### Fixed
- task-clickup: time_estimate must be integer milliseconds (not string, not minutes); harden Step 5d to flag values < 3,600,000 ms as wrong-unit conversions
- task-clickup: Sprint Points / Story Points use the top-level `points` parameter documented in /reference/createtask and /reference/updatetask, not a custom field; drop the dead "Sprint points"/"Story points" rows from the custom-field mapping table
- task-clickup: Responsable is a dual write — top-level `assignees` (flat array on Create, `{add, rem}` on Update per /reference/updatetask) AND the `Responsable` custom field of type `users` using the documented `{value: {add, rem}}` shape from /docs/customfields
- task-clickup: `custom_fields` is not a valid Update Task body parameter; document the dedicated /reference/setcustomfieldvalue endpoint plus per-type value shapes (users add/rem, drop_down UUID, labels UUID array, date ms)
- close-task: post the closure comment even when CLICKUP_TASK.json is absent — run /jlu-task-clickup inline first instead of skipping with "No ClickUp task associated"

## [0.3.137] — 2026-04-29

### Internal
- Step 7d Red verification: trust the test-writer's report Status: RED + Command fields instead of re-running the same tests in the orchestrator session
- Step 7e Green verification: trust the implementer's report Status: GREEN + Command fields instead of re-running phase tests
- Step 7j: replace jlu-git-agent dispatch with inline Bash; pre-flight branch check + scope check (declared agent artifacts + known auto-staged manifests like package.json)
- Step 7k: build-fix commit also inline (was re-spawning git-agent)
- Step 8a: explicit gate that skips entire Tier 2 step when no phase reported deferred Tier 2 requirements
- Step 4.0 (new): task triviality classification — single-service + ≤150-line SPEC + simple-change pattern → synthesize PROPOSAL.md inline from template, skip jlu-proposal-agent dispatch
- Net effect: ~30-60s saved per phase from removed test-rerun + ~5-15s from inline git + ~1-2 min for trivial tasks from skipped proposal-agent

## [0.3.136] — 2026-04-29

### Internal
- Inline update-check.md and claude-code-runtime.md into each SKILL.md so the agent no longer Reads 2 separate reference files on every /jlu-* invocation
- Drop the redundant "Confirm workflow file exists" ls step
- Run bootstrap (check-update.sh + workflow Read + AskUserQuestion ToolSearch preload) in a single parallel pass instead of serially
- Applied to all 16 jlu skills

## [0.3.135] — 2026-04-29

### Fixed
- run new-task and execute-task workflows inline to keep AskUserQuestion at L2

## [0.3.134] — 2026-04-29

### Added
- close-task posts a natural-language English closure comment driven by a new `closure-comment.md` template; bans PR URLs (already attached by /jlu-task-clickup), signature lines, ISO timestamps, test/phase counts, and internal slugs

## [0.3.133] — 2026-04-29

### Fixed
- daily-slack Step 6b ClickUp gap-fill is now executable: explicit list/field resolution, paginated `clickup_get_tasks`, and a new `bin/daily-slack-discover.mjs` post-filter that handles five known shapes of the Responsable custom-field value

## [0.3.132] — 2026-04-29

### Added
- OKR mapping, CUE story points, time_estimate verification

## [0.3.131] — 2026-04-29

### Added
- polish Slack mrkdwn formatting

## [0.3.130] — 2026-04-28

### Fixed
- daily-slack bucketer normalizes closed tasks to 100% regardless of subtask count, so closed tasks without subtasks no longer render as 0% in the Slack message

## [0.3.129] — 2026-04-27

### Internal
- migrate version bump from claude pre-commit hook to tracked git commit-msg hook (atomic + idempotent, blocks on manifest drift)

## [0.3.128] — 2026-04-26

### Fixed
- run ubiquitous-language and map-codebase workflows inline in their skills so curator and operational analyzer agents stay at L2 where AskUserQuestion works (was failing silently at L3)

## [0.3.126] — 2026-04-26

### Internal
- rename jlu-post-slack references to jlu-daily-slack

## [0.3.125] — 2026-04-26

### Internal
- update jlu-daily-slack placeholder for sprint scope

## [0.3.124] — 2026-04-26

### Added
- rewrite for sprint-scoped flow with bin scripts

## [0.3.123] — 2026-04-26

### Internal
- document new placeholders + Spanish dailyBrain example

## [0.3.122] — 2026-04-26

### Internal
- extract shared file/json helpers, fix render sort comparator

## [0.3.121] — 2026-04-26

### Fixed
- remove duplicate 0.3.120 entry

## [0.3.120] — 2026-04-26

### Internal
- rename sync-clickup to task-clickup

## [0.3.119] — 2026-04-26

### Added
- green — render automated placeholders

## [0.3.118] — 2026-04-26

### Fixed
- null-safe truncate, strip newlines, gate PR state on OPEN

## [0.3.117] — 2026-04-26

### Internal
- cover PR-state priority and fallback

## [0.3.116] — 2026-04-26

### Added
- green — priority-1 post-cutoff comment

## [0.3.115] — 2026-04-26

### Fixed
- clean errors for malformed JSON and missing clickup_id

## [0.3.114] — 2026-04-26

### Fixed
- handle URL fragments, http/https, and IO errors

## [0.3.113] — 2026-04-26

### Internal
- cover normalization edge cases

## [0.3.112] — 2026-04-26

### Added
- green — verify clickup URLs against allowlist

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
