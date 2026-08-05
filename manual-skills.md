# Skills Manual

Every user-invocable skill in `jelou-spec-plugin`, what it does, and when to reach for it.

**35 skills**, of which 33 are active and 2 are deprecated aliases kept for compatibility.

- Signatures are the canonical `argument-hint` from each `skills/<name>/SKILL.md`. Everything in `[brackets]` is optional.
- Invocation differs per runtime — see [Invocation](#invocation) at the end. This manual uses the Claude Code form `/jlu-<name>`.
- For the internals of any skill, read its workflow at `jelou/workflows/<name>.md`. That file is the source of truth; this manual is the user-facing view of it.

## Contents

- [Where to start](#where-to-start)
- [Task lifecycle](#task-lifecycle) — 8 skills
- [Visibility and reporting](#visibility-and-reporting) — 5 skills
- [Local dev environment](#local-dev-environment) — 8 skills
- [Testing and QA](#testing-and-qa) — 4 skills
- [Knowledge and design](#knowledge-and-design) — 5 skills
- [Plugin observability](#plugin-observability) — 2 skills
- [Maintenance](#maintenance) — 1 skill
- [Deprecated aliases](#deprecated-aliases) — 2 skills
- [Invocation](#invocation)

---

## Where to start

If you have never used the plugin, this is the whole happy path:

```bash
/jlu-map-codebase --root       # once per workspace: learn the code, register services
/jlu-new-task "what you want to build"
/jlu-execute-task              # runs automatically when autochain is on
/jlu-goal                      # QA against the real local stack
/jlu-ship                      # PRs
/jlu-close-task                # after merge
```

With autochain on (the default), `/jlu-new-task` chains into `/jlu-execute-task` and then into `/jlu-ship`, driving every open PR to green. In that case the only command you type after the spec interview is `/jlu-goal`.

### The state machine

Most task skills are only legal in certain states. The states live in `TASKS.md` and are documented in `jelou/references/lifecycle-states.md`:

```
draft → refining → planned → implementing → validating → ready_to_publish → done → closed
```

| State | Reached by | What can run next |
|---|---|---|
| `draft` | `/jlu-new-task` | the inline spec interview |
| `refining` | spec interview started | spec approval |
| `planned` | spec approved (human gate) | `/jlu-execute-task` |
| `implementing` | `/jlu-execute-task` (human gate) | `/jlu-extend-phase`, `/jlu-rollback-phase` |
| `validating` | all phases done | final QA |
| `ready_to_publish` | QA green | `/jlu-ship` |
| `done` | closure approved | `/jlu-close-task` |
| `closed` | PR merged | — |

`/jlu-extend-phase` is the legal way back: from `implementing` or `validating` it returns the task to `planned` (minor impact) or `refining` (major impact), preserving the code already written.

---

## Task lifecycle

### `/jlu-new-task`

```
/jlu-new-task [task description] [clickup-url|id] [--no-autochain]
```

Creates a task: writes the spec through a structured interview, detects which services it affects, and sets up a git worktree per service. Binds or creates the ClickUp task at spec approval (non-blocking — a ClickUp failure never stops the task).

**When:** starting any new piece of work. This is the entry point.

**Notes**
- The spec interview ends in a **human approval gate**. Nothing is implemented until you approve `SPEC.md`.
- With autochain on (default) it continues straight into `/jlu-execute-task` in the same session. `--no-autochain` stops after the interview.
- Offers to create `.spec-workspace/` if the workspace does not exist yet.

### `/jlu-refine-task`

```
/jlu-refine-task [change description] [clickup-url|id] [--no-autochain]
```

Applies a targeted change to an already-approved spec, via a focused interview. Re-syncs ClickUp.

**When:** the spec is wrong or incomplete and implementation has not diverged yet.

**Notes:** with autochain on, re-enters `/jlu-execute-task` when the change altered the phase plan.

### `/jlu-extend-phase`

```
/jlu-extend-phase [task-slug] [phase-number]
```

Adds new scope to an in-progress task via a mini-interview, then moves the task back to `planned` or `refining` depending on impact.

**When:** scope grew mid-implementation ("I also need X"). Prefer this over editing artifacts by hand — it keeps the existing code as baseline instead of discarding it.

**Requires:** state `implementing` or `validating`.

### `/jlu-execute-task`

```
/jlu-execute-task [task-slug] [clickup-url|id] [--no-autochain]
```

Runs the full TDD pipeline: proposal generation, then phase by phase RED → GREEN → refactor → per-phase QA → commit, then final validation.

**When:** the spec is approved (`planned`).

**Notes**
- Sequential by default, with CPU-safe resource caps. Parallelism is opt-in.
- Also authors the E2E suites from the spec (UI specs and `test/e2e/**`) so `/jlu-goal` has something to run.
- With autochain on, after final QA is green it runs `/jlu-ship` inline and drives every open PR to green, resumable from `AUTOCHAIN.json`.
- Session-recoverable: on re-entry it offers resume / re-validate / start over.

### `/jlu-rollback-phase`

```
/jlu-rollback-phase [task-slug] [phase-number]
```

Resets the service worktrees to the last known-good phase state.

**When:** a phase went wrong badly enough that starting it over beats fixing it.

### `/jlu-ship`

```
/jlu-ship [task-slug]
```

Stages, commits, pushes, and opens a pull request for every affected service. Before opening any PR it runs a per-service preflight that validates the service **installs its dependencies cleanly and builds** — inside the container for docker-compose services.

**When:** implementation is done and QA is green.

**Notes:** delegates the per-service body to `jlu-ship-runner`, one runner per service. `/jlu-create-pr` is a deprecated alias.

### `/jlu-resolve-pr`

```
/jlu-resolve-pr [pr-url|pr-number] [--autonomous]
```

Drives the current branch's PRs to green. Covers four fronts:

- merge conflicts with the base branch,
- review threads (CodeRabbit and other bots are first-class),
- failing CI / pipeline jobs,
- a gated SonarQube phase when the repo has Sonar.

Issues are clustered by root cause; mechanical fixes are applied automatically, structural refactors are planned for your approval, and **security hotspots are never auto-resolved**.

**When:** a PR is open and red, or has review comments waiting.

**Notes:** `--autonomous` never prompts — every ask-path resolves to skip, rerun, or escalate. That is the mode autochain uses. Never force-pushes, never merges.

### `/jlu-close-task`

```
/jlu-close-task [task-slug]
```

Closes the task after the PR is merged: updates ClickUp to CLOSED, cleans up worktrees and artifacts, marks the task `closed`.

**Requires:** the PR must actually be in `merged` state.

---

## Visibility and reporting

### `/jlu-list-tasks`

```
/jlu-list-tasks [--status <state>] [--sprint <n>]
```

Scans the workspace and prints a table of every local task: slug, title, lifecycle state, date, sprint, affected services. Read-only, live scan — no index to keep in sync.

**When:** "what tasks do I have?"

### `/jlu-report-task`

```
/jlu-report-task [task-slug]
```

Executive summary of one task: progress, blockers, and stale-worktree detection.

**When:** "where am I on this?"

### `/jlu-load-context`

```
/jlu-load-context [task-slug]
```

Loads a task's artifacts into a fresh session so you can ask questions and pick up where you left off.

**When:** resuming in a new window. Cheaper than re-reading artifacts by hand and it loads them in the right order.

### `/jlu-task-clickup`

```
/jlu-task-clickup [task-slug]
```

Creates or updates the ClickUp macro task and its subtasks from the workspace artifacts, via MCP.

**When:** ClickUp drifted from local state. The lifecycle skills already sync automatically, so this is a repair tool.

### `/jlu-daily-slack`

```
/jlu-daily-slack <sprint> #channel
```

Generates a sprint-scoped daily summary and posts it to a Slack channel. Meetings are filled in automatically from Calendar.

**When:** the daily standup update.

---

## Local dev environment

These eight skills manage the local stack. Nothing here touches specs, tasks, or PRs.

Two boot paths exist. The **plan-driven `--jelou-stack` boot** is the current one: it reuses your existing docker containers, and for services with a worktree for the active task it boots a namespaced, task-isolated container from the worktree code. The older tmux path still works but is **deprecated** — new work should pass `--jelou-stack`.

Full reference: `jelou/references/dev-orchestrator.md`.

### `/jlu-register-service`

```
/jlu-register-service [service-name]
```

Interactively registers or updates a service in `jlu-services.json`.

**When:** first-time setup of the dev environment, or a service's launch details changed. Also what the other dev-env skills tell you to run when no workspace config exists.

### `/jlu-start-dev`

```
/jlu-start-dev [--jelou-stack] [--auto-fix] [--tail]
```

Launches the registered services in a TMUX window dedicated to the active task slug, and starts the observer daemon.

**Flags**
- `--jelou-stack` — the plan-driven boot (reuse dev containers + task-isolated worktree containers). Recommended.
- `--auto-fix` — when the observer sees a failure pattern, invoke `/jlu-autofix` automatically instead of only logging the event.
- `--tail` — follow the logs.

### `/jlu-stop-dev`

```
/jlu-stop-dev [--kill-services] [--jelou-stack]
```

Stops the daemon and optionally closes the TMUX window and the services it started.

### `/jlu-add-service`

```
/jlu-add-service [service-name]
```

Adds one service's pane to an already-running `jlu-dev` window without restarting the rest.

### `/jlu-logs`

```
/jlu-logs [<service> [--lines N]]
```

Prints the last N lines of a service's pane. Read-only.

### `/jlu-diagnose`

```
/jlu-diagnose [service-name]
```

Triages a failing service. Reads recent failure events plus a fresh pane capture, dispatches the `jlu-dev-diagnoser` agent, and proposes a structured fix that runs in the right context (host or container). **You confirm before anything runs.**

**When:** a service is red and you want to understand why before touching it.

**Notes**
- The diagnoser can never bypass the confirmation gate — its tools are read-only.
- If the diagnosis matches a failure signature that is not yet registered, the last step offers to register it (see `/jlu-add-failure-pattern`).

### `/jlu-autofix`

```
/jlu-autofix <service>
```

The unattended sibling of `/jlu-diagnose`: a bounded loop that fixes a failing service without asking per fix. Up to **3 attempts** of:

**evidence** (recent events + fresh log capture) → **diagnose** (`jlu-dev-diagnoser`) → **apply exactly one fix** → **verify** (restart the service, one observer pass, poll readiness).

The fix takes one of two branches:
- `runs_in: container` — a shell command inside the container (reinstall a dependency, free a port). Executed directly.
- code — dispatched to `jlu-implementer`, constrained to the task worktree.

**Requires:** the service must be in the unified registry, i.e. a `--jelou-stack` boot. It refuses on anything else.

**It never gives up silently.** These all escalate to you:

| Condition | Why |
|---|---|
| diagnosis `confidence: low`, or no fix proposed | it will not guess |
| the main checkout is dirty | it will not edit on top of your uncommitted work |
| the implementer returns `BLOCKED` / `flagged` / `NEEDS_CONTEXT` | the fix agent itself refused |
| the same hunk edited twice (repeated `hunk_hash`) | the implementer is looping on a dead end |
| 3 attempts without a green verify | summarizes all three and points at `/jlu-diagnose` |

Success is only declared when there is no new failure-pattern match **and** readiness polls green.

**Notes:** it does not register new failure patterns — there is no gate at which to ask you.

### `/jlu-add-failure-pattern`

```
/jlu-add-failure-pattern [<service> <pattern>]
```

Appends one case-insensitive regex to a service's `log_failure_patterns` and hot-reloads the daemon via SIGHUP.

**When:** your service fails in a way the built-in patterns do not catch, and you want the observer to detect it instead of you noticing 20 minutes later.

**Context.** While the stack is up, the daemon polls each service's logs (every 2s) against a list of failure regexes and writes a `pattern_match` event to `dev-events.log` when one hits. The built-in defaults (`bin/lib/dev-orchestrator/config.mjs`) are:

```
EADDRINUSE · Cannot find module · ENOENT.*node_modules
ECONNREFUSED · no such file or directory
container .* not running · service ".*" is not running
```

**Notes**
- Validates that the regex compiles, and dedupes. Reports `Daemon: reloaded | not-running`.
- No subagent ever calls this. Three surfaces only *suggest* it: the `jlu-dev-diagnoser` agent's `register_pattern` field, `/jlu-diagnose`'s final step, and the trace suggester's `extend_patterns` rule (same error signature ≥3 times in 30 days), surfaced through `/jlu-refine-task`. The write always happens after a human yes.

---

## Testing and QA

### `/jlu-goal`

```
/jlu-goal [goal matrix] [--task=<slug>] [--max-iterations=N]
```

**The single QA entry point for a finished task.** You supply a *goal matrix* — a set of objectives, each at frontend, backend, or fullstack level. Each objective compiles to E2E suites, the full local stack boots **once**, and a convergence loop runs `run → auto-fix → re-run` until every objective is green or the iteration cap is exhausted. Frontend and fullstack objectives must carry **video evidence** in the final report.

**When:** implementation is done and you want proof it works against the real stack, not just green unit tests.

**How the work is split.** The orchestrator owns the environment lifecycle (boot once, teardown once) and delegates all execution:
- backend services → `jlu-test-suite-runner` (host unit + integration) and `jlu-backend-e2e-runner` (Testcontainers, dependencies only, real HTTP)
- UI services → `jlu-ui-qa-runner` (`/jlu-ui-qa-run --no-boot`); the orchestrator owns only the OTP auth gate before it

**Flags**
- `--max-iterations=N` — convergence-loop cap, default `3`.
- `--force` — override the pre-flight resource gate.
- `--workers=N` — Playwright worker count.
- `--allow-shared-data` — required when an affected service declares `dev.data_isolation: shared`.
- `--allow-prod-target` — override the anti-prod E2E target gate. Use sparingly.
- `--skip-unbootable` — drop a non-bootable **backend** from the boot order instead of refusing. Never drops a UI service.

**Notes:** invoked with no matrix, it resumes from the `GOALS.md` persisted by a previous run. `/jlu-production-like` is a deprecated alias.

### `/jlu-test-suite`

```
/jlu-test-suite
```

Runs the current service's unit + integration suites with **workers = 1** and reports failures grouped by the component under test (Controller, Service, Repository, Middleware, Guard/Interceptor, DTO/Entity, Handler, Util, Module).

**Zero arguments by design** — it does not negotiate, ask, or accept flags. It guarantees it will not saturate your CPU; it takes as long as it takes.

**When:** local pre-PR validation, when you want a richer signal than `/jlu-execute-task`'s affected-tests step. CI still runs the full suite on push.

**Notes:** it validates, it never auto-fixes. Standalone it runs on the host and only warns if the dev infrastructure is unreachable; under `/jlu-goal` the stack is already up and the integration tests hit it live.

### `/jlu-ui-qa-run`

```
/jlu-ui-qa-run [task-slug]
```

Boots only the services the task affects, runs the Playwright E2E suite headless and single-worker, and on failure dispatches the bounded fix-loop. Records video for every run, pass or fail.

**When:** verifying UI behaviour post-deploy. In a full-task QA pass, prefer `/jlu-goal`, which calls this for you.

**Flags:** `--force`, `--workers=N` (default 1, refuses unsafe values unless the RAM and CPU gates pass), `--allow-shared-data`, `--allow-test-edits` (lets the fix-loop edit `.spec.ts`; forbidden by default), `--allow-prod-target`, `--no-boot` (the caller already owns the infrastructure — this is how `/jlu-goal` invokes it).

**Notes:** with no slug it parses one from the branch (`production/<slug>` or `staging/<slug>`) and refuses on off-task branches.

### `/jlu-ui-qa-cleanup`

```
/jlu-ui-qa-cleanup [task-slug]
```

Recovers from a crashed E2E run: leaked dev servers, stale containers, held lock files, occupied ports.

**When:** `/jlu-ui-qa-run` died mid-run and the next one refuses to start.

---

## Knowledge and design

### `/jlu-map-codebase`

```
/jlu-map-codebase [service-id | --root [root-path] | --all]
```

Analyzes a service with two parallel agents and generates six codebase knowledge files (architecture, stack, structure, conventions, integrations, concerns), then auto-registers the service in `services.yaml`. Certifies the service's `dev` block by actually booting it, recording a `verified: {date, commit, block_hash}` mark.

**When:** before starting work on a service or workspace you have not mapped yet. Everything downstream — spec interviews, proposals, boots — reads these files.

**Modes:** a single `service-id`; `--root` for the workspace root; `--all` to sweep every registered service.

### `/jlu-ubiquitous-language`

```
/jlu-ubiquitous-language [service-id]
```

Curates the workspace's domain glossary. An extractor scans code for terminology, a curator interviews you and drafts `UBIQUITOUS_LANGUAGE.md`, and it persists **only after you approve** — a review-then-save loop.

**When:** the same concept has three names across services, or a new team member cannot read the domain.

### `/jlu-architecture-review`

```
/jlu-architecture-review [<service-id>] [--cross-service]
```

Surfaces *deepening opportunities* — refactors that turn shallow modules into deep ones. An explorer proposes candidates from the code alone, then an interactive grilling loop walks each one with you; a rejected candidate can be recorded lazily as an ADR.

**When:** the code works but keeps costing more than it should to change.

**Notes:** the vocabulary (Module, Interface, Seam, Adapter, Depth, Leverage, Locality) is contractual — see `jelou/references/architecture-language.md`.

### `/jlu-council`

```
/jlu-council <idea text | path-to-idea-file> [--context <path>] [--services a,b]
```

Convenes a multi-model jury on an architecture idea. Heterogeneous judges refute it round after round until you and the jury reach consensus, ending in a categorical verdict — `GO` / `GO_WITH_CONDITIONS` / `NO_GO` — with dissent preserved.

**When:** before committing to a design you are not sure about, or when you want a second opinion that is not your own model agreeing with you.

**Notes:** a cleared idea hands off exclusively to `/jlu-new-task`, in a fresh window, with a self-sufficient seed.

### `/jlu-investigate`

```
/jlu-investigate "<question>" [--engine perplexity|fusion]
```

Stateful research. Runs one engine per call (Perplexity by default, OpenRouter Fusion with `--engine fusion`) and persists each investigation as a resumable Obsidian note, falling back to a local file. Resumes by topic slug.

**When:** comparing options, or gathering what is known about a topic.

**Not a debugger.** Failures, 500s, and stack traces route to `/jlu-diagnose`.

---

## Plugin observability

These two read the plugin's own trace store. Both are read-only.

### `/jlu-trace-report`

```
/jlu-trace-report [--by-agent | --by-phase | --by-task <slug> | --trends]
```

Queries the workspace trace store: latency percentiles, retry rate, and escalation rate per agent role, per phase, per task, or as a trend over time.

**When:** "why is this pipeline slow?" or "which agent keeps retrying?"

### `/jlu-eval-report`

```
/jlu-eval-report [--json | --task <slug>]
```

The consolidated scorecard: task success (pass@1 / pass@k / autonomy), cost per successful task, per-agent quality scores, judge calibration (Cohen's κ), failure taxonomy, and suggestion hit-rate.

**When:** deciding whether the pipeline is actually getting better.

**Notes:** quality rules stay dormant until the judge is calibrated (κ ≥ 0.4 against your accept/reject feedback), so early numbers are descriptive, not actionable.

---

## Maintenance

### `/jlu-update`

```
/jlu-update [--ref <ref>]
```

Updates the plugin to the latest version for the current runtime. On Claude Code it drives the plugin CLI directly — no manual `/plugin update`. On Codex and OpenCode it pulls or bootstraps the shared `~/.jelou-spec-plugin` git cache and reinstalls.

**Notes**
- `--ref <ref>` pins a tag or branch instead of latest.
- On Claude Code a **restart or a new session** is required for the new version to load.

---

## Deprecated aliases

Both still work and forward to their replacement. They exist so old muscle memory and old docs do not break.

| Alias | Use instead |
|---|---|
| `/jlu-production-like` | `/jlu-goal` |
| `/jlu-create-pr` | `/jlu-ship` |

---

## Invocation

Skill content is shared across three runtimes; only the prefix differs.

| Runtime | Form | Example |
|---|---|---|
| Claude Code | `/jlu:<name>` (also `/jlu-<name>`) | `/jlu:new-task` |
| OpenCode | `/jlu-<name>` | `/jlu-new-task` |
| Codex | `$jlu-<name>` | `$jlu-new-task` |

Write `/jlu-<name>` in prose — it reads correctly on every runtime. See `INVOCATION.md` for the per-runtime resolution details.

## Related documentation

- `README.md` — installation, core-command table, deep dives on the larger flows with real output samples
- `jelou/references/dev-orchestrator.md` — dev-environment configuration, event schema, daemon model, troubleshooting
- `jelou/references/lifecycle-states.md` — the full task state machine, including exceptional states
- `jelou/references/dev-block-schema.md` — the `services.yaml` `dev` block and boot certification
- `jelou/references/tracing.md` — trace schema and how to add a span
- `jelou/workflows/<name>.md` — the executable procedure behind each skill
