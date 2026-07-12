# Changelog

## [0.3.275] — 2026-07-11

### Added
- advisory LLM-judge quality layer — cross-family panel, offline, calibration-gated

## [0.3.274] — 2026-07-11

### Added
- span-keyed feedback layer — free accept/reject ground-truth harvest at close-task

## [0.3.273] — 2026-07-11

### Added
- trace deterministic eval signals — token/cost, task-success (pass@1/pass@k), OpenInference export

### Changed
- trace rules: gate `bump_model_tier` behind the Wilson score lower bound of the binomial retried-fraction (with a `MIN_SAMPLE` floor) so it no longer fires on thin evidence; flag `orphaned` spans as an interrupted-trajectory signal in `immediate_flag`

## [0.3.272] — 2026-07-11

### Added
- enforce zero-comment output across code-authoring agents

## [0.3.271] — 2026-07-07

### Fixed
- set ClickUp start/due dates and require Cliente in task-clickup sync

## [0.3.270] — 2026-07-01

### Fixed
- right-size jlu-dev-diagnoser model tier to sonnet (council audit)

## [0.3.269] — 2026-06-29

### Added
- Let `/jlu-map-codebase --root` and `--all` map every project under a root directory with one flat mapper worker per service.
- Add `jlu-codebase-mapper` for non-interactive batch mapping without nested subagent dispatch.
- Cover root batch mode contracts, shared-write serialization, and batch interview handling in unit tests.

### Changed
- Allow the operational analyzer to consume provided or deferred user concerns in root batch mode while preserving interactive interviews for single-service mapping.
- Document Codex/OpenCode batch dispatch constraints so registry and glossary writes stay centralized in the root orchestrator.

## [0.3.268] — 2026-06-29

### Fixed
- Let Codex and OpenCode jlu-update use the updater repo when no shared cache exists.
- Bootstrap ~/.jelou-spec-plugin automatically when no git checkout is available, then reinstall the current runtime.
- Preserve the Claude marketplace updater path while covering the new Codex cache fallback in tests.

## [0.3.267] — 2026-06-29

### Fixed
- Treat "use the jlu-* skill" as Codex prompt routing instead of falling back to Claude SKILL.md files.
- Convert AskUserQuestion references to plain-text questions that must wait for user input under Codex.
- Preserve context-remaining in the Codex TUI status line during global and project installs.

## [0.3.266] — 2026-06-28

### Fixed
- normalize bare Codex jlu commands

## [0.3.265] — 2026-06-28

### Changed
- guard jlu-summary-agent against hallucinated /jlu:* command recommendations

## [0.3.264] — 2026-06-28

### Added
- self-enforce no-line-by-line-comments across code-writing agents

## [0.3.263] — 2026-06-27

### Added
- jlu-update applies updates directly on Claude Code via the plugin CLI

## [0.3.262] — 2026-06-26

### Added
- shift-left backend E2E authoring + DB/cache persistence assertion doctrine

## [0.3.261] — 2026-06-26

### Fixed
- auth gate auto-provisions logsM.userSessions via session-sync when a local mint still 401s at the gateway, instead of dead-ending or improvising a prod-session menu
- session-sync refuses a non-loopback SESSION_SYNC_MONGO_URI write target (opt-in via SESSION_SYNC_ALLOW_REMOTE_MONGO) so a loopback E2E run can never forge a session row into prod/staging Mongo

## [0.3.260] — 2026-06-24

### Fixed
- dispatch jlu agents via plugin namespace with bare fallback

## [0.3.259] — 2026-06-24

### Added
- deterministic local E2E login + self-healing auth gate

## [0.3.258] — 2026-06-23

### Internal
- Remove the per-commit commit-msg hook and the redundant bin/bump-version.sh
- Add npm run release (bin/changelog-entry.py --release): one +1 bump (--minor/--major supported) plus one CHANGELOG entry across all 4 manifests
- Document the single-bump release workflow in CLAUDE.md

## [0.3.257] — 2026-06-23

### Changed
- `/jlu-create-pr` renamed to `/jlu-ship`; `/jlu-create-pr` is kept as a deprecated alias that prints a warning then delegates to `/jlu-ship` unchanged (all 3 runtimes).
- Trace span `create_pr` renamed to `ship`.

### Added
- **Runtime-aware build+deps preflight gate (Step 4b):** before opening PRs, `/jlu-ship` validates that each service installs deps cleanly and builds. docker-compose-runtime services install and build inside their container; host-runtime services run on the host. Gate failures are user-overridable and recorded in the PR body + TASKS.md.
- `jlu-deps-validator` subagent (haiku, report-only): runs `bin/install-dep.mjs --validate` per service, returns PASS / FAIL / SKIP.
- `jlu-build-validator` runtime-aware mode: reads exec context from `bin/runtime-exec.mjs`, prefixes build commands with `EXEC_PREFIX` for docker-compose services.
- `bin/lib/runtime-exec.mjs` and `bin/runtime-exec.mjs` CLI: resolve service → `{runtime, execPrefix}` from `jlu-services.json`.
- `bin/lib/install-dep.mjs` `planInstallValidate` + `bin/install-dep.mjs --validate`: frozen install on host / container install + lockfile drift check.
- Container-exec carve-out extended in `jelou/references/subagent-base.md` and `jelou/references/docker-conventions.md`, scoped to `/jlu-ship` only (TDD pipeline stays host-only).

## [0.3.256] — 2026-06-23

### Documentation
- README + INVOCATION: add the previously-undocumented `/jlu-production-like` to the Core Commands table and the invocation reference, plus a dedicated "Production-Like — Full-Stack QA Orchestration" section (thin-orchestrator model, fullstack vs full-backend runner matrix, Testcontainers backend-E2E).
- Remove its internal runners (`test-suite`, `ui-qa-run`, `ui-qa-cleanup`) from the command tables — `production-like` is the single QA entry point; the sub-commands stay documented in their own dedicated sections.

## [0.3.255] — 2026-06-21

### Fixed
- bin/lib/env-files.mjs: dependency-free dotenv-style parser + overlay loaders. Verified against the real jelou-apps .env+.env.e2e: parses all 78 keys incl. the malformed line 106, resolves the dashboard base to localhost.
- bin/boot-dev-server.mjs: execs the dev command with the merged env (no shell source); env-lifecycle.md npm/make/shell launcher now uses it.
- e2e-session-probe / e2e-login / e2e-session-sync self-load .env+.env.e2e from UI_WORKTREE via the parser, so they no longer depend on a caller bash-source.
- ui-qa-run.md step 14b stops bash-sourcing; e2e-environment.md documents the parser-not-source rule.
- tests: env-files parser/overlay + boot-dev-server injection/exit + wiring.

## [0.3.254] — 2026-06-21

### Fixed
- env-lifecycle.md boot(): a frontend (build-time-baked env) is NEVER reused — always booted fresh with env_files (incl. .env.e2e) sourced via set -a.
- production-like.md step 10: a ui_services frontend always reboots fresh, even when healthy; never reused.
- ui-qa-run.md exit-47: the loopback-captcha diagnosis names the reused-frontend -bakes-prod trap and the VITE_TURNSTILE_ENABLED=false requirement.
- e2e-environment.md: documents build-time inlining — .env.e2e must be injected into the dev-server env at serve start, not merely present.
- guard tests for all four.

## [0.3.253] — 2026-06-21

### Fixed
- production-like.md 11c: an invalid/stale session is never the user's call — auto-run bin/e2e-login.mjs and regenerate storageState; E2E_BASE_URL and credentials are known from the sourced .env.e2e; the only sanctioned prompts are the four already in ui-qa-run.md step 14b.
- ui-qa-run.md 14b: log in automatically; bar the accept/pause/refresh menu.
- guard test asserting both workflows forbid the discretionary menu.

## [0.3.252] — 2026-06-21

### Changed
- boot UI auth/session dependencies via a declarative services.yaml depends_on (Phase 1 step 8a), folded transitively into the boot order; fixes the gateway-401 where the login + session-validation backends were never started.
- reuse-or-reboot is env-aware: a launcher that sources env_files is reused only if no env_file is newer than the running process, else rebooted (stale Vite env fix).
- a captcha on a loopback target is diagnosed as a frontend-points-at-prod misconfiguration, never the prod-capture flow.
- foreign/undecryptable persisted sessions are discarded for a fresh local login.
- boot surfaces the launch-log crash reason on ready_timeout.

## [0.3.251] — 2026-06-20

### Internal
- renumber shift-left section to Step 8e to clear duplicate-ordinal collision

## [0.3.250] — 2026-06-20

### Added
- shift-left UI E2E suite authoring into execute-task final validation

## [0.3.249] — 2026-06-20

### Internal
- subagent-first runtime contract in production-like SKILL

## [0.3.248] — 2026-06-20

### Internal
- thin subagent-first production-like orchestrator + pre-materialize UI suite

## [0.3.247] — 2026-06-20

### Fixed
- correct stale orchestrator-runs-suite attribution in ui-qa-run step 7b'

## [0.3.246] — 2026-06-20

### Internal
- dispatch ui-qa-run execution body to jlu-ui-qa-runner

## [0.3.245] — 2026-06-20

### Added
- add jlu-ui-qa-runner subagent

## [0.3.244] — 2026-06-20

### Added
- add jlu-backend-e2e-runner subagent

## [0.3.243] — 2026-06-20

### Added
- add jlu-test-suite-runner subagent

## [0.3.242] — 2026-06-20

### Added
- install dependencies in the service runtime, not the host

## [0.3.241] — 2026-06-20

### Added
- add /jlu-update command to update the plugin from any runtime

## [0.3.240] — 2026-06-20

### Internal
- lead with remote one-liner, keep source + native as alternatives

## [0.3.239] — 2026-06-20

### Added
- clone-to-cache and delegate to setup

## [0.3.238] — 2026-06-20

### Added
- auto-detect installed CLIs with --host override

## [0.3.237] — 2026-06-20

### Internal
- cover flag parsing and passthrough

## [0.3.236] — 2026-06-20

### Added
- remote bootstrap skeleton with dry-run plan

## [0.3.235] — 2026-06-20

### Fixed
- correct ban pointer + step 10 reuse-or-reboot ordering

## [0.3.234] — 2026-06-20

### Internal
- document backend E2E ephemeral-deps model

## [0.3.233] — 2026-06-20

### Added
- backend Testcontainers E2E phase + frontend reuse-or-reboot

## [0.3.232] — 2026-06-20

### Added
- path-scoped Testcontainers carve-out for E2E

## [0.3.231] — 2026-06-20

### Added
- cap Testcontainers E2E to WORKERS policy

## [0.3.230] — 2026-06-19

### Fixed
- /jlu-test-suite Step 4.5: when EFFECTIVE_PATH contains .worktrees/, inject a worktree exclusion into the jest (testPathIgnorePatterns) / vitest (--exclude) command, merging existing patterns since the CLI flag replaces config
- guard-test-commands hook now denies a cap-allowed full-suite jest/vitest/nx scan when .worktrees/ is on disk and the command carries no worktree exclusion; exempts --findRelatedTests, explicit spec-file targets, --testPathPattern(s), and already-excluded commands
- root cause: git-ignore does not stop jest/vitest test discovery, so /jlu-new-task worktrees under <repo>/.worktrees/<slug>/ leaked stale specs from other tasks into the run

## [0.3.229] — 2026-06-19

### Added
- add /jlu-list-tasks to tabulate local tasks created by /jlu-new-task

## [0.3.228] — 2026-06-16

### Fixed
- add bin/daily-slack-assemble.mjs: normalizes bare-string status into {status_name,status_type}, resolves task_type from the Tipo Proyecto dropdown, computes the percentage fallback, applies OR(assignee,Responsable), and merges plugin tasks — replaces the ad-hoc inline node/jq assembly that caused the [0%]-on-closed bug and env-var failures (Step 6c)
- assemble can gather get_task payloads the harness dumps to disk via --hydrated-dir, removing the manual jq over tool-results/
- hydrate only non-assignee tasks for the Responsable check; assignee-owned tasks use the light payload (6b.3 switches to clickup_filter_tasks)
- render: --drop-completed drops finished items from short-term, honoring the convention and keeping the message under the 5000-char Slack budget
- render: isIssue matches task_type substring so 'Issue Report' splits to Issues
- step 7: fall back past an empty task_snapshots to the latest non-empty baseline

## [0.3.227] — 2026-06-15

### Fixed
- obs resume via append+property:set, maxTokens default, render emits parts

## [0.3.226] — 2026-06-15

### Internal
- README command row + usage section

## [0.3.225] — 2026-06-15

### Fixed
- bare-positional topic, canonical buildNoteContent for obs parity, payload spec, WebSearch tool

## [0.3.224] — 2026-06-15

### Added
- skill + workflow + opencode command + codex prompt

## [0.3.223] — 2026-06-15

### Fixed
- harden resume path — filename match, frontmatter split, round counting

## [0.3.222] — 2026-06-15

### Added
- persistRound + CLI dispatch (locate/fusion/persist)

## [0.3.221] — 2026-06-15

### Added
- runFusion + annotation source extraction

## [0.3.220] — 2026-06-15

### Added
- resolveNote storage detection + resume key

## [0.3.219] — 2026-06-15

### Added
- note frontmatter + round rendering

## [0.3.218] — 2026-06-15

### Added
- slugify + parseArgs

## [0.3.217] — 2026-06-15

### Internal
- use shared chatCompletion transport

## [0.3.216] — 2026-06-15

### Added
- extract shared chatCompletion transport

## [0.3.215] — 2026-06-14

### Added
- derive the rejection list from DTO validators at RED, beyond the happy path

## [0.3.214] — 2026-06-13

### Added
- enforce per-requirement case matrix over happy-path-only coverage

## [0.3.213] — 2026-06-13

### Added
- docker-exec launcher + auto-derived dev blocks; auth captcha fallback + thread-id Gmail OTP read

## [0.3.212] — 2026-06-11

### Added
- council runs as a multi-round deliberation session looping to user+jury consensus, then routes exclusively to /jlu-new-task (never superpowers/GSD/gstack)
- judges declare unverifiable facts in a new uncertainties field instead of assuming; the arbiter researches each via Perplexity/web and folds findings into the deliberation before the next round
- fresh-context handoff: a self-sufficient new-task seed is written and auto-detected by /jlu-new-task in a new session, reloading full task context into a clean window
- engine: --session-dir/--round group rounds under one session dir, parseArgs rejects missing flag values

## [0.3.211] — 2026-06-10

### Added
- unified /jlu-production-like orchestrator (classify, boot once, delegate to ui-qa-run + test-suite)

## [0.3.210] — 2026-06-10

### Fixed
- frontier reasoning roster + reasoning-token headroom

## [0.3.209] — 2026-06-10

### Added
- max_closed_shown channel-template field caps the Closed/closed-like group in {{tasks_by_status}} to the N most-recently-closed tasks (by date_closed); absent means no cap, preserving the full status board
- renderer ranks closed groups by recency only when the cap is set; open and in-progress groups are never capped
- thread date_closed through render-data all_tasks; document the field in the workflow and the channel template

## [0.3.208] — 2026-06-08

### Added
- renderCodexAgent (MD->TOML) + renderCodexPrompt; bin/sync-codex.mjs generates .codex/agents/*.toml and .codex/prompts/jlu-*.md from canonical sources (--check)
- .codex/config.toml (context7 MCP, agents.max_depth=1), .codex/hooks.json reusing bin/guard-*.mjs verbatim (Codex PreToolUse contract matches Claude Code's), .codex-plugin/plugin.json, jelou/references/codex-runtime.md
- bin/install-codex.sh and setup --host codex
- jlu-council and jlu-ubiquitous-language commands (parity)
- .opencode/plugins/guard.ts reuses the classifiers to enforce env-hygiene and worker-cap policies under OpenCode; install-opencode.sh ships the guard scripts

## [0.3.207] — 2026-06-07

### Internal
- document local cookie-guard session provisioning + env vars

## [0.3.206] — 2026-06-07

### Added
- step 14c local session provisioning; scope the no-fabrication carve-out

## [0.3.205] — 2026-06-07

### Added
- provisioning driver — decrypt, upsert, localhost cookie

## [0.3.204] — 2026-06-07

### Added
- cookie extraction + loopback auto-detect helpers

## [0.3.203] — 2026-06-07

### Added
- port cookie decrypt + userSessions upsert helpers

## [0.3.202] — 2026-06-07

### Added
- add SECRET_MISMATCH/MONGO_UNREACHABLE exit codes

## [0.3.201] — 2026-06-07

### Fixed
- track inline cd + split on newlines so cd-then-source can't bypass env validation

## [0.3.200] — 2026-06-07

### Fixed
- cold-start self-heal reload + robust submit selector; doc localhost CORS gotcha

## [0.3.199] — 2026-06-07

### Fixed
- canonical structured NEEDS_CONTEXT protocol line; clarify 14b retry vs 18c machinery

## [0.3.198] — 2026-06-07

### Internal
- #12 skip-guards masking not-found as missing-data

## [0.3.197] — 2026-06-07

### Added
- interactive NEEDS_CONTEXT loop with 3-round bound, budget pause, feedback persistence

## [0.3.196] — 2026-06-07

### Added
- forbid unproven missing-data verdicts; accept USER_FEEDBACK with bounded test edits

## [0.3.195] — 2026-06-07

### Added
- forbid not-found skips, require selector provenance and mounted-route verification

## [0.3.194] — 2026-06-07

### Fixed
- auth gate env bootstrap, probe-misconfig abort, WAITING_OTP race, document E2E_STORAGE_STATE

## [0.3.193] — 2026-06-07

### Internal
- orchestrated OTP login as the sanctioned storageState path

## [0.3.192] — 2026-06-07

### Added
- auth gate with OTP login, 401 hard abort, mid-suite collapse check

## [0.3.191] — 2026-06-07

### Added
- mid-suite 401 collapse detector over playwright JSON report

## [0.3.190] — 2026-06-07

### Added
- login driver with OTP file handshake and semantic exit codes

## [0.3.189] — 2026-06-07

### Added
- login driver with OTP file handshake and semantic exit codes

## [0.3.188] — 2026-06-07

### Added
- session probe CLI classifies stored session as valid/invalid

## [0.3.187] — 2026-06-07

### Added
- session probe CLI classifies stored session as valid/invalid

## [0.3.186] — 2026-06-07

### Added
- pure helpers for OTP login, session probe and 401 collapse detection

## [0.3.185] — 2026-06-07

### Added
- pure helpers for OTP login, session probe and 401 collapse detection

## [0.3.184] — 2026-06-07

### Fixed
- guard-env-reads validates sourced env files for fragment-leaking lines

## [0.3.183] — 2026-06-06

### Added
- multi-model jury with adversarial briefs and categorical verdicts

## [0.3.182] — 2026-06-06

### Fixed
- new PreToolUse guard (guard-env-reads.mjs) denies Read/cat/grep-without-q of .env* files; templates (.env.example etc) stay readable
- --trace=retain-on-failure replaces on-first-retry (traces on first failure, no retry doubling); stderr split to run.stderr
- fix phase armed with a bash 15-min deadline + 10-dispatch cap; fixes go only through jlu-ui-fix-loop; re-run only the failing spec per fix, full suite once at the end
- writer EXPECT=red|live: post-deploy dispatches skip the RED-verification suite run and verify collection via --list instead

## [0.3.181] — 2026-06-06

### Fixed
- show clickable SPEC.md path at approval gate instead of dumping spec content

## [0.3.180] — 2026-06-06

### Added
- PreToolUse guard denies uncapped test invocations (`hooks/hooks.json` + `bin/guard-test-commands.mjs`)

### Fixed
- enforce test-runner worker caps across the TDD pipeline

## [0.3.179] — 2026-06-06

### Fixed
- auto-register mapped service in services.yaml (Step 7c)

## [0.3.178] — 2026-06-01

### Internal
- staging branch created at new-task, not synthesized at create-pr

## [0.3.177] — 2026-06-01

### Internal
- centralize no-line-by-line-comments rule in subagent-base

## [0.3.176] — 2026-05-31

### Internal
- gitignore docs/ and untrack design/spec/plan docs

## [0.3.175] — 2026-05-31

### Fixed
- fail-closed anti-prod gate + zero-test false-green guard

## [0.3.174] — 2026-05-31

### Added
- add MODE=bootstrap to jlu-ui-e2e-writer (scaffold Playwright infra)

## [0.3.173] — 2026-05-31

### Internal
- RED invariants for env opt-in + bootstrap contract

## [0.3.172] — 2026-05-31

### Added
- add classify-e2e-target helper (default-deny prod gate)

## [0.3.171] — 2026-05-31

### Internal
- design for E2E env opt-in + Playwright bootstrap

## [0.3.170] — 2026-05-27

### Fixed
- write .cache/ artifacts via Bash to bypass Write read-first guard

## [0.3.169] — 2026-05-27

### Added
- Step 3: extend the auto-mapping table with OKR (Tech), Estado del diseño, Proyecto, QA Asignado, Cliente (typed, criticality-tagged). Explicitly exclude human-only fields (Fecha límite modificada, Fecha de entrega al Cliente).
- Step 4d: inference rules for the new fields. OKR (Tech) option is resolved at runtime by matching the KR-code prefix on the field's option labels (no hardcoded UUIDs).
- Step 5e: extended example payload + per-type shape notes.
- Step 7b: subtasks inherit the extended field set (no OKR re-resolution).
- Step 8: persist field_mappings for the new fields + okr_option_map.
- okr-mapping.md: drop the false claim that no OKR field exists; document the option-resolution pattern.
- 12 new structural tests guard against regressions.

## [0.3.168] — 2026-05-25

### Added

- **Tracing analyzer + suggester + skill (Phase 3 of the harness-engineering observability layer — closes the loop).** New `bin/trace-analyze.mjs` CLI with four query modes (`--by-agent`, `--by-phase`, `--by-task <slug>`, `--trends`) reads the workspace `spans.jsonl` and prints tabular summaries: agents with their p50/p95 durations, retry rate, and escalation rate; phases keyed by `service:phase_num`; the full span tree of one task; and week-over-week trend deltas. New `bin/trace-suggest.mjs` CLI applies four rules over recent traces with a 7-day cooldown: `bump_model_tier` (agent retry rate > 20% over last 10 dispatches), `extend_patterns` (error_signature ≥ 3 occurrences across 30 days), `suggest_parallelize` (phase p95/median > 3.0× over last 10), `immediate_flag` (any blocked/failed span in last 24h). The suggester is wired into the existing `Step 0.5` block of the three heavy workflows (`execute-task`, `refine-task`, `create-pr`) — right after the Phase 2 reconcile call — so suggestions surface before each workflow runs. Approved and declined responses persist to `.spec-workspace/.cache/suggestion-history.jsonl` with `(rule_id, signature)` keying.
- **`/jlu-trace-report` skill** (`skills/trace-report/SKILL.md` + `.opencode/commands/jlu-trace-report.md` + `jelou/workflows/trace-report.md`) — interactive launcher that asks which view (by-agent / by-phase / by-task / trends) and invokes `bin/trace-analyze.mjs`. Read-only; no state written.
- **`bin/lib/trace/aggregate.mjs`** — pure aggregation helpers shared between analyzer and suggester (`pairSpans`, `groupByTrace`, `groupByAgent`, `groupByPhase`, `percentile`, `retryRate`). Stdlib only, no I/O.
- **`bin/lib/trace/rules.mjs`** — the four rules as data + a generic `evaluate(pairs)` entry point + `applyCooldown(findings, history)` + `formatSuggestion(finding)`. Thresholds (retry-rate 0.20, parallelize ratio 3.0, pattern occurrences 3, blocked lookback 24h, pattern lookback 30d, cooldown 7d) are module-scope constants — tunable without touching call sites.
- **Tests**: 4 new unit test files (aggregate, rules, analyze, suggest) totaling ~38 new unit tests; 1 new integration test file (suggester end-to-end with synthetic 15-run trace store + cooldown verification). Full unit suite: 564. Integration suite: 10 (3 Phase 1 + 4 Phase 2 + 3 Phase 3).

### Internal

- The 23 agent prompts under `agents/` are byte-identical to prior main. Phase 3 adds analyzer + suggester + skill on top of Phase 2's instrumentation; subagents are not touched.
- The dual-runtime contract for the new skill follows the existing pattern: shared workflow at `jelou/workflows/trace-report.md`, Claude Code launcher at `skills/trace-report/SKILL.md`, OpenCode launcher at `.opencode/commands/jlu-trace-report.md`.

## [0.3.167] — 2026-05-25

### Fixed
- `bin/finalize-phase.sh` now stages and commits untracked-but-not-ignored files alongside tracked-modified ones. `git diff --name-only HEAD` alone missed brand-new files, forcing manual follow-up commits for phases that produced new test files or modules (observed on Phases 01/02/03a of real runs). The scope check still validates every file in the union against `FINALIZE_EXPECTED` — undeclared new files abort with `reason=unexpected_files_in_diff`. Three new unit tests cover declared-untracked, mixed modified+untracked, and undeclared-untracked-aborts.
- `bin/format-changed-files.sh` CONVENTIONS.md parser no longer treats config filenames like `.prettierrc`, `biome.json`, or `.eslintrc.json` as the format command. The previous awk matched any backtick token containing a formatter substring; config filenames won by appearing earlier in the section (confirmed on real `jelou-apps` CONVENTIONS.md where `biome.json` shadowed `biome check`). The new awk scans every backtick token on each in-section line and requires the token to start with a known runner (`npm|npx|yarn|pnpm|bun|biome|prettier|eslint|rome|black|ruff|gofmt|rustfmt`) followed by whitespace and at least one argument. POSIX `[^[:space:]]` used instead of GNU `\S` for portability across BSD/busybox awk. Two new unit tests cover `.prettierrc` and `biome.json` (jelou-apps-shape) fixtures.

## [0.3.166] — 2026-05-24

### Added

- **Tracing instrumentation across the task lifecycle (Phase 2 of the harness-engineering observability layer).** Every lifecycle workflow now emits structured spans: `new-task`, `refine-task`, `execute-task`, `create-pr`, `report-task`, `close-task` each open a workflow-level span on entry and close it on exit. The three "heavy" workflows (`refine-task`, `create-pr`, `execute-task`) additionally call `bin/trace-reconcile.mjs` at the top of their flow to sweep orphan spans from any prior interrupted run. Inside `execute-task` Step 7, each phase opens a child span (parent = workflow) and each subagent dispatch opens a grandchild span with `agent_role`, `model_used`, and on close the parsed report's `status`, `retry_count`, `outcome`, `diff_size_loc`, and `error_signature`. `close-task` snapshots the task's spans to `<TASK_DIR>/_traces/snapshot.jsonl` before closure via a new `bin/trace-snapshot-task.mjs` helper, so workspace-level rotation never loses the history of closed tasks.
- **Dev-environment daemon migrated to the shared emitter.** `bin/lib/dev-orchestrator/events.mjs::appendEvent` now delegates to `bin/lib/trace/emitter.mjs::appendSpan` with `scope: "daemon"`. The legacy API (`EVENT_TYPES`, `SEVERITY`, `severityFor`, `appendEvent` signature) is preserved unchanged — daemon callers do not need to change. Daemon events now join the same workspace `spans.jsonl` as workflow spans, so the future analyzer (Phase 3) can correlate dev-env failures with the task that hit them.
- **Tests**: 30 new unit tests (23 workflow structural assertions + 7 daemon migration) and 4 new integration tests (workflow span tree shape + TRACE_DISABLED end-to-end + daemon co-residency + workflow/daemon co-existence). Full unit suite: 520. Integration suite: 7 (3 Phase 1 + 4 Phase 2).

### Internal

- Workflow `.md` files now reference `${PLUGIN_ROOT:-.}/bin/trace-*.mjs` for plugin-root resolution, matching the existing pattern in other workflow steps.
- The 23 agent prompts under `agents/` are byte-identical to prior main. Phase 2 instruments workflows, not agents — subagents continue to emit their existing JSON status reports unchanged; the orchestrator extracts span attrs from those reports.
- New helper `bin/trace-snapshot-task.mjs` filters the workspace store by `task_slug` to write per-task snapshots. Stdlib only.

## [0.3.165] — 2026-05-24

> **Phase 1 of 3** for the harness-engineering observability layer. Foundation modules and CLIs land here; workflow auto-instrumentation lands in Phase 2; analyzer + suggester in Phase 3. Single-PR release — the intermediate version bumps (0.3.165–0.3.176) generated by the commit-msg hook during the feature branch were collapsed into this entry on merge.

### Added

- **Tracing foundation.** New `bin/lib/trace/{schema,emitter,reader}.mjs` modules plus three stdlib-only CLI wrappers — `bin/trace-start-span.mjs`, `bin/trace-end-span.mjs`, `bin/trace-reconcile.mjs` — that emit and read a workspace-local JSONL span store at `<WORKSPACE>/.traces/spans.jsonl`. The emitter is ULID-based with proper 80-bit carry-incrementing for same-millisecond monotonicity, payload-capped at 3500 bytes (under `PIPE_BUF` for atomic appends), and short-circuited by `TRACE_DISABLED=1`. Write failures fall back to a stderr warning so tracing is never a failure axis. The reconciler sweeps orphan `span_start` events older than 30 minutes (override via `TRACE_RECONCILE_AFTER_MS`) and emits synthetic `span_end` events with `status: "orphaned"`; it's idempotent across reruns. The reader is tolerant of malformed lines and rotation-aware (it walks `spans-NNN.jsonl` siblings in order). Three subsystem files compile cleanly to ~340 LOC total; six CLI scripts each fit under 130 LOC.
- **Reference docs.** New `jelou/references/tracing.md` (95 lines) documents the event schema, canonical span names, attrs canon, and the "how to add a new span" workflow. New design spec at `docs/superpowers/specs/2026-05-23-tracing-observability-design.md` (338 lines) and Phase 1 implementation plan at `docs/superpowers/plans/2026-05-23-tracing-observability-phase1-foundation.md` (2087 lines) are checked into the repo.
- **README "Tracing & Observability" section** with end-to-end usage example (workflow → phase → agent dispatch span tree, opened and closed via the CLIs with `jq`), recovery flow, and disable knob.
- **53 new unit tests + 3 integration tests** covering ULID monotonicity over 500-id loop, appendSpan atomicity, payload cap, TRACE_DISABLED, stderr fallback, the three CLIs end-to-end, and 100-span concurrent writers without corruption. Full suite: 437 → 490 passing (no regressions).

### Changed

- `.gitignore` ignores `.traces/` at the workspace level — span stores are local-only by default, gitignored across all consuming workspaces.

### Fixed

These three issues surfaced during the cross-cutting code review on the feature branch and are folded into the release:

- **ULID monotonicity for same-millisecond calls.** The initial implementation only patched the last byte of `randomBytes(10)` when the ms hadn't advanced, leaving the leading 9 bytes random on each call — uniqueness held but lexicographic ordering across the full 26 chars did not. Replaced with a proper 80-bit big-endian counter increment over the previous random portion, with carry propagation that advances the ms instead of producing a non-monotonic id on overflow. Test now asserts strict `>` ordering across 500 consecutive ulids generated in a tight loop.
- **Misleading reader comment.** The reader's module docstring claimed "memory-bounded reads ... without loading the whole file," but `readFileSync` loads the entire file before the generator yields its first event. Corrected to describe the actual behavior: lazy in iteration, eager in read; peak memory is bounded by the 50 MB rotation threshold.
- **`trace-end-span` writes null fields for unmatched starts.** When the matching `span_start` was not present, the script wrote `"trace_id":null, "scope":null, "name":null` etc., forcing every downstream parser to handle both null and absent. Switched to ternary expressions so the keys are omitted entirely via `JSON.stringify`, matching the schema's "absent when not applicable" convention.

### Internal

- The orchestrator owns the trace writer; subagents continue to emit their existing JSON status reports unchanged. Verified via `git diff main..feature/tracing-foundation -- agents/ .opencode/agents/` returning empty across the entire PR. The 23 agent prompts under `agents/` are byte-identical to prior main.
- No new npm dependencies — `package.json` diff is version-only. The plugin remains stdlib-only.

## [0.3.164] — 2026-05-23

### Changed

- `/jlu-execute-task` orchestrator decisions extracted to `bin/` scripts. Three classes of bloat were forcing the orchestrator to interpret long inline procedures on every dispatch — this release moves the deterministic parts to scripts, slims the agents to share a base file, and adds opt-in cross-phase parallelism behind a `PROPOSAL.md` flag.
  - **Boilerplate consolidation across the six TDD agents** (`jlu-test-writer`, `jlu-implementer`, `jlu-tdd-cycle`, `jlu-refactor-agent`, `jlu-qa-agent`, `jlu-build-validator`). New `jelou/references/subagent-base.md` carries Context Discipline, Docker-forbidden, three-strike rule, code-style discipline, engineering-principles precedence, and reporting/escalation shape. Each agent now references the base file in `Required Reading` and keeps only agent-specific tips, removing ~250 lines of duplicated prose across the agent set.
  - **QA smell catalog** lifted out of `jlu-qa-agent.md` into `jelou/references/qa-smell-catalog.md`. Code Smell Detection and Over-Engineering Detection catalogs (god classes, long methods, single-implementation abstractions, premature generalization, etc.) plus severity rules and report-table formats are lazy-read during Final Validation only, never preloaded for per-phase reviews.
  - **`bin/finalize-phase.sh`** (9 unit tests) consolidates the five-step git-commit ceremony of Step 7j (pre-flight branch check, scope check, stage, commit, rev-parse) into one Bash dispatch with `key=value` output and an auto-staged-manifest allowlist for hook-touched files.
  - **`bin/format-changed-files.sh`** (13 unit tests) owns the host-side lint/format detection chain — CONVENTIONS.md → `package.json` scripts → `npx eslint` default → skip silently — replacing the ~22 lines of decision logic duplicated between Step 7e and Step 7de. Supports `FORMAT_DRY_RUN=1` for tests.
  - **`bin/classify-phase.sh`** (23 unit tests) replaces the four inline classifiers with subcommands: `mode` (Step 7c.1: docs/vertical/horizontal classification with frontmatter override, docs-mode validation against code-change verbs, and vertical-override size-gate enforcement), `trivial` (Step 7e.1 with safety-override downgrade when the diff exceeds 50 LOC or touches a lockfile/migration/`.d.ts`), `additive` (Step 7h purely-additive `M+D`-empty check), and `compilable` (Step 7k non-compilable allowlist with `package.json` / `tsconfig*.json` forcing the build).

### Added

- **H7 — per-service-parallel wave planning.** New `bin/plan-phase-waves.mjs` (13 unit tests) is a deterministic wave planner — reads phase files under `<TASK_DIR>/services/<svc>/phases/`, groups by service, zips lanes by index, and chunks each wave by `PHASE_PARALLELISM`. Emits JSON consumed by the new Step 7.0 (Wave Planning) at the start of Step 7 in `execute-task.md`. The orchestrator reads `PROPOSAL.md` for an `## Execution Strategy` section (default `sequential`, opt-in `per-service-parallel`); when opted in, each wave dispatches all its phases concurrently in a single orchestrator message and synchronizes at wave boundaries. `jlu-proposal-agent` emits the new section with a one-sentence justification, defaulting to sequential when in doubt. `parallel-dispatch.md` documents the two fan-out axes (wave-level via H7 and per-phase for multi-service phases) and links the helper.

### Docs

- `jelou/workflows/new-task.md` and `jelou/workflows/refine-task.md` — bumped per-round question count from "2-4" to "3-6". The previous rule was conservative: interviews were ending prematurely or stretching across more rounds than they needed when the gap analysis surfaced 6-7 clear questions of similar weight. More importantly, the `question` / `AskUserQuestion` tool fails with `InputValidationError: too_big` when a single question carries more than 4 options. This was undocumented in both workflows and surfaced as a runtime failure during real-task interviews. Added an explicit rule plus three escape hatches: split the decision across rounds, group candidates into bucket options, or fall back to a free-text question. No behavior change in the orchestrator — interview-rules hardening only.

Tests: 388 → 437 (+49). Sync-agents check is clean. The orchestrator no longer counts FR/NFR bullets, runs `grep -cE` inline, or computes `git diff` shortstats — every decision that was inline now goes through a script with `key=value` output that's parseable and unit-tested, and the agent prompts no longer repeat 250+ lines of shared discipline.

## [0.3.163] — 2026-05-19

### Fixed
- `bin/changelog-entry.py` — version-bump markers used by the commit-msg hook now require **end-of-line placement** to be recognized. Previously the hook used a bare substring check, so any commit message that *documented* a marker inside its body (release notes, plan docs, ADRs explaining the workflow) silently activated the marker. The hardening commit that was supposed to ship as 0.3.163 was the visible victim: its body referenced the marker family while explaining the new guards, the hook detected an inline `skip-bump` substring, took the early-return path, and the release never bumped at all. New rule: markers are recognized only when they appear at end of line in the subject or body, matching the existing project convention (`git commit -m "feat: foo [skip-bump]"`). Verified against four scenarios: inline mention does **not** trigger; trailing-subject placement does. Applies to all four markers — the legacy `[skip-bump]` and the three guards added in this release (`[allow-jump]`, `[bump-minor]`, `[bump-major]`).

### Added
- Three controls layered on top of the drift guard added in 0.3.162 so the silent-manifest-freeze scenario cannot recur even on a clone that never ran the maintainer setup. (1) `npm install` now activates the commit-msg hook automatically — `package.json` declares a `prepare` script that invokes `bin/install-git-hooks.sh`, which itself was hardened to exit silently when run outside a git checkout (so end-user npm installs from a tarball do not error). (2) `tests/unit/version-sync.test.mjs` reads all three manifests and fails if their `version` fields disagree, catching drift inside a PR even when the contributor's clone has no commit-msg hook. (3) `bin/changelog-entry.py` gained an anti-jump guard: when a commit pre-stages a version change (the `bin/bump-version.sh` path or a manual edit), the hook now verifies the staged delta against HEAD — it must be exactly +1 patch, or +1 minor / +1 major when the matching `[bump-minor]` / `[bump-major]` marker is present, or any value when `[allow-jump]` is present. `[skip-bump]` no longer bypasses the guard, so it cannot be used to disguise a multi-version leap. Staged drift across the three files (different new versions) is reported with a per-file delta so the maintainer sees which file diverged. Combined effect: silent drift, no-hook clones, and skip-bump-disguised jumps all become loud failures at commit time, and CI catches drift even on clones where the hook was never installed.

## [0.3.162] — 2026-05-19

### Fixed
- `bin/bump-version.sh` — guard against desynced version files and resync manifests to the actual current version. The previous script read `CURRENT` from `package.json` and used a single `sed` pattern that required all 3 version files (`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) to share that exact `"version"` string. Once the files desynced once (a manual edit, a bad merge, anything that touched `package.json` without going through this script), every subsequent run only bumped `package.json` — the two manifests stayed frozen forever. Because Claude Code's marketplace installer reads the plugin version from `.claude-plugin/marketplace.json` on `origin/main` (not from `package.json` and not from git tags), this silently shipped a stale version to every user updating through the marketplace, regardless of how many tags or releases the maintainer cut. The visible symptom: `package.json` at `0.3.161`, tags up to `v0.3.161`, but everyone updating via `/plugin` kept landing on `0.3.157` (the last version where all 3 files happened to agree). New behavior: a pre-bump guard reads all 3 files and aborts with a clear `Versions desynced: package.json=X, plugin.json=Y, marketplace.json=Z` error if they disagree, and a post-bump verification loop confirms every file actually moved to `NEW`. Either failure exits non-zero so the surrounding release workflow halts instead of pushing a half-bumped commit. The manifests are also resynced as part of this release so the marketplace catches up: `0.3.157` → `0.3.162` for both `plugin.json` and `marketplace.json`.

## [0.3.161] — 2026-05-19

### Changed
- `jelou/workflows/load-context.md` — removed stale `CONTEXT.md` references in two places: the per-service artifact bullet under Step 5 (Artifact Inventory) and the `<✅ or ❌> CONTEXT.md — <path>` line in the Step 8 presented inventory block. `CONTEXT.md` generation was removed in 0.3.0 (see CHANGELOG entry for 0.3.0 → "Removed: CONTEXT.md generation — duplicated information already in phase files and codebase knowledge files."), but the inventory still surfaced the file as `❌` for every service in every task, which read as a missing artifact instead of a deprecated one.
- `jelou/workflows-opencode/load-context.md` — same cleanup applied to the OpenCode variant (Step 6 Artifact Inventory).
- `README.md` — removed `CONTEXT.md` from the workspace directory tree under `specs/<dd-mm-yyyy>/<task-slug>/services/<service-id>/` so the documented filesystem layout matches what the plugin actually produces.

No behavior change — purely doc/inventory hygiene. Tasks created after 0.3.0 (e.g. `jelou-apps`, `workflows-service` in recent reports) will no longer show a misleading `❌ CONTEXT.md` row when running `/jlu-load-context`.

## [0.3.160] — 2026-05-19

### Changed
- `jelou/references/systematic-debugging.md` — absorbed disciplines from Matt Pocock's `engineering/diagnose` skill (the `improve-codebase-architecture` lineage was already credited in `architecture-language.md`, so no parallel skill is being added). New **Phase 0 — Build a feedback loop** prepended to the phase sequence: 10 ranked construction strategies (failing test → curl → CLI snapshot → headless browser → replay trace → throwaway harness → property/fuzz → bisection → differential → HITL bash), loop-iteration guidance (faster / sharper / more deterministic), non-deterministic-bug handling (raise the reproduction rate to debuggable), and an explicit "no loop → `status: blocked`" escape hatch. Phase 3 rewritten from single-hypothesis to **3–5 ranked falsifiable hypotheses** surfaced to the orchestrator before testing the top one, with a "if you can't state the prediction, it's a vibe — discard or sharpen" rule. Phase 4 gains a **correct-seam check** before writing the regression test — if no correct seam exists, that is itself the finding and triggers a `/jlu-architecture-review` recommendation in the `risks` array. New **Phase 5 — Post-mortem + architectural handoff**: required-before-success checklist (loop re-run, instrumentation removed, throwaway prototypes deleted, winning hypothesis stated in the commit / PR message), plus "what would have prevented this bug" prompt that escalates to `/jlu-architecture-review` when the answer is structural. New **Debug instrumentation hygiene** section codifies tool preference (debugger / REPL > targeted logs > never "log everything and grep") and the `[DEBUG-xxxx]` tagging + grep cleanup discipline. Quick Reference and "How This Maps to Existing jelou Loops" tables updated. **Existing phase numbering (1, 2, 3, 4, 4.5) is unchanged** so subagents (`jlu-implementer`, `jlu-build-validator`, `jlu-test-writer` on re-invocation) that already reference specific phases by number continue to work — Phase 0 was prepended and Phase 5 appended without renumbering anything in between.
- README — surface `/jlu-diagnose` for parity with `/jlu-architecture-review` after the systematic-debugging reference update made the dev-env diagnose flow more discoverable. New bullet in the "What It Does" intro describes the dev-environment diagnose flow + the `/jlu-add-failure-pattern` follow-up that hot-reloads the daemon's pattern matcher. New row in the Core Commands table grouped between `/jlu-rollback-phase` and `/jlu-architecture-review` (the "something went wrong, triage it" cluster). Both `/jlu-architecture-review <service-id>` and `/jlu-diagnose <service-id>` added to the OpenCode Quick Start cheatsheet so first-time readers see them early. The Dev Environment Orchestrator section + its sub-table are unchanged — the new placements are discoverability-only.

## [0.3.159] — 2026-05-17

### Added
- `{{achieved_goals}}` placeholder now renders **three sub-buckets** instead of a flat list:
  - `- :ladybug: Issues` — tasks whose ClickUp `task_type` matches `"Issue"` (case-insensitive).
  - `- :clipboard: Tareas` — every other task, including tasks with no `task_type` at all.
  - `- :calendar: Meets` — one bullet per non-blank line of the user's `meetings` manual answer.

  Each task bullet is `   * \`[<%>]\` <url|name>` (three-space indent + asterisk to render as a sub-bullet in Slack). Meet bullets carry the user's text verbatim. Sub-buckets with no items are omitted entirely so the reader never sees a stray header above an empty list. The first-run banner only kicks in when **all three** sub-buckets are empty — if the user captured meetings on their first run, those still surface and the banner is suppressed.

### Changed
- `task_type` now flows end-to-end through the daily-slack pipeline: extracted during Step 6 from each ClickUp task object (via the already-hydrated `clickup_get_task` cache), preserved by `bin/daily-slack-bucket.mjs` into `new_snapshot` so it survives subsequent runs, threaded into `render-data.json`'s `achieved[*]` entries, and consumed by `bin/daily-slack-render.mjs` to drive the Issues / Tareas split. Missing or empty `task_type` is treated as non-Issue (lands under Tareas), so legacy snapshots taken before this release continue to render correctly.
- `meetings` is no longer a standalone `{{meetings}}` placeholder in the template body. It's now folded into `{{achieved_goals}}` as the `:calendar: Meets` sub-bucket. The template's separate `**Reuniones**` block + `{{meetings}}` placeholder is removed to prevent duplicate rendering — having both would print the user's input twice. The renderer parses the meetings string itself (one non-blank line per bullet); do not pre-format upstream.
- `jelou/workflows/daily-slack.md` Steps 10–12 reordered. Previously: 10 Render → 11 Check Draft → 12 Prompt Manual. Now: 10 Check Draft → 11 Prompt Manual → 12 Render. The render step is moved last because it now depends on `meetings`, which only exists after the manual-fields prompt. Manual answers are persisted to `<workspace>/.cache/manual-fields.json` before render so `bin/daily-slack-render.mjs` reads them deterministically from disk.
- `render-data.json` schema gains two fields: `achieved[*].task_type` and a top-level `meetings: "<raw multi-line string>"`. Both are optional — missing values render the same as before, just without the new categorization.

### Tests
- `tests/unit/daily-slack-bucket.test.mjs` — new "task_type pass-through" suite confirming `Issue` / `Improvement` values survive snapshot + are emitted on both `achieved[*]` and `new_snapshot[*]`.
- `tests/unit/daily-slack-render.test.mjs` — expanded coverage for the new categorization: existing happy-path and multi-task tests updated for the sub-bucket format; new tests for Issues-only / Tareas-only / mixed rendering, missing `task_type` → Tareas fallback, Meets bullet parsing (whitespace lines stripped, empty meetings omits the header), and the first-run banner gated on all-empty.

## [0.3.158] — 2026-05-17

This release fixes the root cause of the "full test + comprehensive QA" local-machine freeze and extracts full-suite test execution out of the orchestrator into a dedicated on-demand skill. It also clears six related issues found during the freeze investigation.

### Added
- `/jlu-test-suite` — new on-demand skill that runs the current service's unit + integration tests with a fixed worker cap of `1` (literal "minimum workers"), then groups failures by the component under test (Controller, Service, Repository, Middleware, Guard/Interceptor, DTO/Entity, Handler, Util, Module). Resolves the service from cwd against `services.yaml`. Honors task-active worktrees via the standard `worktree-resolution.md` algorithm. Includes a lightweight RAM pre-flight (~1.5 GB threshold) that fails fast on degraded machines. Supports Jest, Vitest, Mocha, pytest (+ `pytest-xdist` / `pytest-json-report` when present), and Go. Failure reporter parses the runner's JSON output (or falls back to stdout) and reads test files to infer the symbol under test from imports and `describe(...)` subjects. Integration-failure errors matching `ECONNREFUSED` / `connection refused` / `Pool exhausted` / `getaddrinfo ENOTFOUND` automatically get a `Did you run /jlu-start-dev?` hint appended. Zero arguments — invocation is unconfigurable on purpose so the workers=1 contract can't be loosened. `skills/test-suite/SKILL.md` + `jelou/workflows/test-suite.md` + `.opencode/commands/jlu-test-suite.md`.
- README "Test execution model" section + dedicated "Test Suite — Pre-PR Validation" subsection with sample success / failure outputs, exit codes, the per-suffix component classifier table, and V1 limitations.
- `docs/architecture.excalidraw` — diagram updated to document the new Test Execution Model (4 boxes: per-phase → Step 8b affected → /jlu-test-suite → CI, with flow arrows), the pre-PR annotation hanging off `ready_to_publish`, and new agents (`tdd-cycle`, `build-validator`, `spec-reviewer`, `refactor-agent`, `summary-agent`). Stale labels also corrected — see "Changed" below.

### Changed
- **execute-task Step 8b extracted from full-suite to affected-tests.** The orchestrator no longer runs `npm test` (or `pytest`, `go test ./...`) against the entire service. Step 8b now invokes the runner's native affected-tests resolver against the task diff: `jest --findRelatedTests`, `vitest related`, `pytest --picked --mode=branch` (when `pytest-picked` is installed), `pytest --testmon` (when `pytest-testmon` is installed), or `go test -p 2` against changed packages. Worker cap is fixed at 2. Mocha and plugin-less pytest skip the step with a hint to run `/jlu-test-suite` before PR. Coverage is forbidden in Step 8b — that's CI's domain. Rationale: the old "full suite + comprehensive QA" pair was triggering local-machine freezes because Jest's default `maxWorkers = cores - 1` spawn pattern + the QA agent's "Run coverage tool if available" instruction caused two back-to-back full-suite runs at near-default workers.
- execute-task Step 6.4 — `TEST_MAX_WORKERS` (and the related `JLU_TEST_MAX_WORKERS` env var) removed. Step 8b's cap is now hard-coded at 2; `/jlu-test-suite` is hard-coded at 1. The workflow no longer reads `JLU_FINAL_TEST_PARALLELISM` either.
- execute-task Step 8c — QA agent now consumes the new `AFFECTED_TESTS_RESULT` structure (per-service PASS / FAIL / SKIPPED / NO_DIFF) instead of the old full-suite verdict. When any service reports SKIPPED, the QA agent surfaces an explicit pre-PR action recommending `/jlu-test-suite`.
- execute-task Step 4c — multi-service proposal-agent fan-out now respects `PHASE_PARALLELISM` (default `1` = sequential) instead of always parallel. Predictable local CPU/RAM beats theoretical speedup.
- `jlu-qa-agent` — three-fold prompt rewrite: (1) consumes `AFFECTED_TESTS_RESULT` instead of the old full-suite verdict, (2) the "Run coverage tool if available" line that caused contradictory behavior (re-running the suite with `--coverage` during 8c) was removed — coverage is now strictly read-only (parse existing reports if present, infer statically otherwise), (3) self-checklist hardened with "did NOT run any test command — not the affected subset, not the full suite, not coverage, not a single test file".
- `jlu-architecture-explorer` — `Agent` removed from `tools:` frontmatter; the agent no longer dispatches `Explore` sub-agents (which produced L3 recursion). Discovery Strategy rewritten to use `Glob` / `Grep` / `Read` directly. Same outputs, ~exponentially less context burn.
- `map-codebase` Step 5 — the two analyzers (structural + operational) are now gated by `JLU_PHASE_PARALLELISM` instead of always-parallel. Default sequential.
- `jelou/references/docker-conventions.md` — the "Command Classification" table was contradicting every other doc by listing tests / lint / build as "Container" commands. Corrected: all TDD-pipeline commands run on the **Host**, only long-running dev services (started by `/jlu-start-dev`) go through Docker. The stale "Docker Exec Prefix" section is removed (every agent already treats it as ignorable).
- `parallel-dispatch.md` — `FINAL_TEST_PARALLELISM` and `TEST_MAX_WORKERS` documented as deprecated; per-task fan-out points (proposal-agent multi-service, codebase analyzers) confirmed as gated by `PHASE_PARALLELISM`.
- README — new "Test execution model" + "Test Suite — Pre-PR Validation" subsections; resource-knob table updated to reflect the deprecations.
- `docs/architecture.excalidraw` — diagram labels corrected: "6 Parallel Researchers" → "2 Codebase Analyzers"; sub-label rewritten to name the structural / operational doc sets explicitly; "cross-validator" (removed agent) → "refactor-agent" (the agent that actually owns the post-Green pass now); "final validation" → "Step 8: affected + static QA"; `tasks-agent` moved from the Sonnet tier visual to the Haiku tier visual (it has been operational-group/Haiku in `model-tiers.md` for a while).

### Fixed
- `bin/lib/dev-orchestrator/daemon-spawn.mjs` `killDaemon` had a tight busy-wait (`while (Date.now() < target) { /* spin */ }`) inside its 5-second grace-period loop, burning 100 % of one CPU core every time the dev daemon was stopped. Replaced with `spawnSync('sleep', ['0.1'])` so the wait actually yields. Function stays synchronous; no caller signature changes.

### Removed
- The full-suite run in `execute-task` Step 8b, along with its pre-flight RAM/CPU gate and per-runner worker-cap injection table. Both moved to `/jlu-test-suite` (in tightened, workers=1 form). Step 8b's pre-flight is gone — affected-tests with cap=2 doesn't need it.

## [0.3.157] — 2026-05-14

### Added
- `{{tasks_by_status}}` — new placeholder in the daily-slack pipeline. Groups every sprint task owned by you under a bold per-status header (`**Internal QA**`, `**In Progress**`, `**Pending To Production**`, …) followed by `` `[<%>]` <url|name> `` per task. Groups sort by descending max percentage; within a group, tasks sort by descending percentage then alphabetically. Renders a static "status board" view alongside the delta-driven `{{achieved_goals}}` / `{{not_achieved_goals}}`. Wired through `bin/daily-slack-render.mjs` (new `renderTasksByStatus`, `titleCase` with QA/PR/UI/UX/API/MCP/POC/RFC/SDK acronym preservation, and the `all_tasks` input field in `render-data.json`).
- `tests/unit/daily-slack-render.test.mjs` — eight new assertions covering grouping by `status_name`, descending-percentage sort with alphabetical tie-break, closed-tasks-at-top behavior, skip-tasks-without-status, empty/missing `all_tasks` back-compat, and case-insensitive status merging with first-seen casing preserved.

### Fixed
- daily-slack discovery silently dropped every task where the user was set as `Responsable` (custom field) but not present in `assignees`. Root cause: `clickup_get_tasks(listId=…)` omits `custom_fields` from each task payload, so `bin/daily-slack-discover.mjs` had nothing to evaluate the Responsable OR-branch against — every Responsable-only task ended up in the "filter failed" path and never surfaced in the daily. The workflow now hydrates the entire sprint list via parallel `clickup_get_task(<id>)` calls (new Step 6b.4) before running the discover script, so the post-filter actually sees `custom_fields`. Step 6c reads from the same hydrated file instead of issuing a second round of fetches.

### Changed
- `jelou/workflows/daily-slack.md` — Step 6b split into 6b.3 (page through list to fix task IDs), 6b.4 (hydrate every task in parallel), 6b.5 (post-filter on the hydrated set), with a "Why hydrate before filtering" callout documenting the Responsable trap. Step 6c rewritten to read from the hydrated cache instead of re-fetching, with a fallback for plugin tasks that live outside the sprint list. Step 10 contract updated to include `all_tasks` in `render-data.json` and `tasks_by_status` in the renderer's stdout JSON; Step 13 inputs updated accordingly.
- `jelou/templates/slack-channel.md` — placeholder index updated with the `{{tasks_by_status}}` entry and its formatting rules.

## [0.3.156] — 2026-05-12

### Fixed
- Four workflows (`execute-task`, `create-pr`, `rollback-phase`, `load-context`) had an inline parenthetical that resolved each service's working directory via filesystem existence (*"worktree if `.worktrees/<slug>` exists, else main repo"*). This contradicted the canonical algorithm in `references/worktree-resolution.md`, which is mode-driven. Branch-mode tasks that happened to have a leftover `.worktrees/<slug>` directory on disk got silently routed into it — tests, builds, and commits all landed in the wrong tree. Each affected workflow now respects `SETUP_MODE` parsed from `TASKS.md → ## Branching → Mode`: `Mode: branch` always resolves to the main repo root, regardless of what's on disk. When a leftover `.worktrees/<slug>` is detected during a branch-mode run, the workflow logs a one-line "ignoring leftover worktree" notice with a remediation hint, but never picks it.

### Added
- `tests/unit/worktree-resolution-modes.test.mjs` — regression guard. Asserts every path-resolving workflow names both modes explicitly, pairs `Mode: branch` with "main repo", rejects the previously-buggy filesystem-only phrasings, and contains a "leftover worktree" defensive logging line.

## [0.3.155] — 2026-05-12

### Added
- `jelou/references/tdd-principles.md` — canonical philosophical reference for every agent in the TDD pipeline. Covers: RED→GREEN→REFACTOR cycle, test-behavior-not-implementation (with the canonical bad/good example pair), vertical slicing within a phase, deep modules, interface design for testability, mock-at-boundaries-only, refactor candidates catalog with stop conditions, per-cycle checklist, and the three-strike rule. Adapted from `mattpocock/skills/engineering/tdd` and tightened for this plugin's multi-agent operational model.
- `jlu-refactor-agent` — new agent that owns the Refactor phase of TDD. Runs in execute-task Step 7g (replacing the previous placeholder), skipped when `PHASE_IS_TRIVIAL`. Applies surgical refactors one at a time, re-runs phase tests after each, rolls back on red, never touches test files, never changes a public API. Soft cap of 3 refactors per phase. Reports `APPLIED | NO_CHANGES | BLOCKED`.
- `jlu-tdd-cycle` — new agent that runs vertical-slicing TDD (RED→GREEN per FR within one session) for small single-service phases (≤ 3 FR/NFR, exactly one service). Replaces the test-writer + implementer dispatch in those cases. Includes a procedural Self-Correction Rule that replaces the dispute mechanism: any test rewrite must be documented under `Test Rewrites` with a spec quote, and verified at per-phase QA.
- execute-task Step 7c.1 — new "Phase Mode Classification" step computing `PHASE_MODE = vertical | horizontal` from FR/NFR count and service count. Overrideable per-phase to `horizontal`, never overrideable to `vertical` past the size gate.
- execute-task Step 7de — new "TDD Vertical Cycle" step dispatching `jlu-tdd-cycle` when `PHASE_MODE == vertical`. Includes the same post-Green lint/format pass as Step 7e.

### Changed
- execute-task Step 7g (Refactor Pass) — replaced the optional/inline checklist with a proper `jlu-refactor-agent` dispatch. Still gated on `!PHASE_IS_TRIVIAL`.
- execute-task Step 7d/7e — now horizontal-mode-only. Skipped when `PHASE_MODE == vertical`.
- execute-task Step 7f (Test Dispute Resolution) — now horizontal-mode-only. Vertical-mode `Test Rewrites` are surfaced via the agent's report and scrutinized at 7h instead.
- execute-task Step 7h (Per-Phase QA) — receives `PHASE_MODE` and (in vertical mode) the `Test Rewrites` list, so it can verify each rewrite has a valid spec quote and the rewritten tests describe behavior, not implementation.
- jlu-test-writer, jlu-implementer, jlu-qa-agent — added "Required Reading" pointer to `tdd-principles.md`; removed duplicated philosophical content (behavior-not-implementation rule, bad/good examples, minimum-code rationale) now sourced from the principles doc.
- jlu-implementer report template — added a `Refactor Candidates` section so the refactor agent has structured input. The implementer surfaces candidates but never applies them.
- jlu-qa-agent — adds a "TDD Principles Compliance" check block to its report (§2 behavior-not-implementation, §4 no new shallow modules, §6 mocks at boundaries only). A passing test that violates §2 or §6 is now a FAIL.
- `tdd-cycle.md` — operational doc realigned with the no-Docker policy (no Testcontainers in any tier) and the new two-mode agent layout (horizontal vs vertical). Cross-references the new `tdd-principles.md`.
- jlu-execute-task: remove Docker from the TDD pipeline. The orchestrator no longer runs `docker compose up -d` in Step 6, no longer computes `DOCKER_EXEC_PREFIX` / `IS_DOCKER_SERVICE`, and no longer injects the Docker execution context block into test-writer, implementer, build-validator, qa-agent, or Tier 2 dispatches. All test, build, lint, and format commands run on the host runtime directly. Step 8b/8d container-prune calls dropped.
- jlu-test-writer: ban Testcontainers (and any container-spawning library) in **both** tiers — previously only banned in Tier 1. Tier 2 now assumes any required real infrastructure is already running on the host via `/jlu-start-dev`; tests that can't be exercised in the current host environment are reported as skipped instead of starting anything.
- jlu-implementer, jlu-build-validator: drop the `DOCKER_EXEC_PREFIX` prefix from test, lint, format, and build invocations; commands run on the host runtime directly.
- jlu-qa-agent: extend the Docker check from "Tier 1 only" to "any tier" — flags Testcontainers, `dockerode`, and `docker`/`docker compose`/`podman` shell-outs as FAIL regardless of tier.

### Removed
- `jelou/references/docker-execution-context.md` — the prompt block was the source of the per-test `docker compose exec` calls that piled load onto the host. Dev-container lifecycle is now owned exclusively by `/jlu-start-dev`.

## [0.3.154] — 2026-05-12

### Fixed
- prioritize global workflows and trim redundant reads

## [0.3.153] — 2026-05-10

### Fixed
- enforce single-hit workflow resolution

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
