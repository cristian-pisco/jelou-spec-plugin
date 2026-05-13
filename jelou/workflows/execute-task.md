# Workflow: execute-task

> Orchestrator workflow for `/jlu-execute-task [task-slug]`
> Runs TDD implementation with proposal generation, phase-by-phase execution, and QA validation.

> **Execution policy**: This workflow runs fully autonomous. The ONLY case where execution pauses for user input is after 5 failed retry attempts on a phase or build step. All other decisions are auto-resolved.

> **SQL Safety Gate**: inject the block from `jelou/references/sql-safety.md` into every Bash-capable agent prompt (test-writer, implementer, qa-agent, build-validator).

---

## Principles

> **Minimum viable work. Verify before proceeding. Escalate before guessing.**

- Each phase follows strict TDD: Red -> Green -> Refactor. No shortcuts.
- Agents write the minimum code to satisfy tests. Over-engineering is a defect.
- Every phase must end with verified green tests before the next phase starts.
- When something fails after 5 retries, escalate to the user — don't hack around it.
- When the process feels heavy for a trivial change, that's by design. The discipline prevents drift.

**When to simplify:** For single-file, single-function changes with no cross-service impact, the orchestrator may consolidate multiple phases into one if PROPOSAL.md supports it. The TDD cycle within each phase is never skipped.

---

## Step 1 — Resolve Task

Read `.spec-workspace.json` once at the start of this step (if present) and cache it as `WORKSPACE_CONFIG`. Reuse this cached object in Step 2b instead of reading the file again.

1. If a `task-slug` is provided as a command argument:
   a. Use `WORKSPACE_CONFIG.workspace` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If no `task-slug` provided:
   a. Find the most recent task (latest date folder, latest task within it).
   b. Auto-select it. Log to terminal: "Auto-selected task `<task-slug>`."

**Error gate**: If no task found, stop: "No task found. Run `/jlu-new-task` first."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`, `WORKSPACE_CONFIG`

---

## Step 2 — Load Task State

1. Read `<TASK_DIR>/TASKS.md`.
2. Extract:
   - Current status (draft, refining, planned, implementing, etc.)
   - Affected services list
   - Phase progress (if any phases have been executed)
   - Any blocked or failed phases
   - Setup mode from `## Branching → Mode` (default `worktree` if absent)

**Validation**:
- If status is `draft` or `refining`: stop. "Task is in `<status>` state. Run `/jlu-new-task <slug>` first to complete the spec interview and get it to `planned`."
- If status is `closed` or `cancelled`: stop. "Task is already `<status>`. Cannot execute."

**Store**: `CURRENT_STATUS`, `AFFECTED_SERVICES`, `PHASE_STATE`, `SETUP_MODE`

---

### 2b. Resolve Model Configuration

1. Reuse `WORKSPACE_CONFIG` loaded in Step 1 (do not re-read `.spec-workspace.json`).
2. If a `models` section exists in `WORKSPACE_CONFIG`, extract the model overrides.
3. Store as `MODEL_CONFIG` — a map of group name → model name.
4. When spawning agents in subsequent steps, resolve the model:
   - For proposal-agent: use `MODEL_CONFIG.proposal` or default `"sonnet"`
   - For test-writer, implementer, qa-agent, build-validator: use `MODEL_CONFIG.code` or default `"sonnet"`
   - For git-agent, tasks-agent: use `MODEL_CONFIG.operational` or default `"haiku"`
   - For summary-agent: use `MODEL_CONFIG.operational` or default `"sonnet"`

---

## Step 3 — Session Recovery (Decision #35)

If TASKS.md shows a mid-execution state (status is `implementing` and some phases are marked `done` while others are `pending` or `in_progress`):

1. Log the current state to terminal:
   ```
   Task `<TASK_SLUG>` — resuming interrupted execution.
   Completed: Phase 01, Phase 02
   Resuming from: Phase 03
   ```

2. If any phase has status `in_progress` (interrupted mid-execution):
   - Reset that phase's status to `pending`.
   - Log to terminal: "Phase <NN> was interrupted. Restarting from scratch."

3. Set `RESUME_FROM` = first phase that is not `done`. Skip to Step 7, starting from that phase.

---

## Step 3b — Mode Detection and Auto-Checkout (Decision gate)

Use `SETUP_MODE` parsed from Step 2 (do not re-read `TASKS.md`):

- If `SETUP_MODE = worktree` (or `## Branching` section absent): skip to Step 4. Implementation will run in the task worktree.
- If `SETUP_MODE = branch`: continue with the branch-mode pre-flight below.

### Branch-mode pre-flight (runs before the first phase)

**Skip this pre-flight entirely if Step 3 set `RESUME_FROM`.** On session resume, `production/<TASK_SLUG>` is already the active branch and its working tree legitimately contains the in-progress phase's edits — running the dirty-tree check here would produce a false abort.

For each affected service (first execution only):

1. Resolve the service's main repo root: `SERVICE_REPO_ROOT = <WORKSPACE_PATH> + services.yaml[service-id].path`. `cd <SERVICE_REPO_ROOT>` (the main repo, since there is no worktree).
2. Verify the working tree is clean:
   ```bash
   DIRTY=$(git status --porcelain)
   ```
   If `DIRTY` is non-empty, abort the workflow with:
   > Working tree of `<service-id>` is dirty, cannot auto-checkout `production/<TASK_SLUG>`. Resolve first and re-run `/jlu-execute-task`.
3. Verify `production/<TASK_SLUG>` exists locally:
   ```bash
   git rev-parse --verify production/<TASK_SLUG> >/dev/null 2>&1
   ```
   If missing, abort: *"Local branch `production/<TASK_SLUG>` is missing for `<service-id>`. Re-run `/jlu-new-task <TASK_SLUG>` to recreate, or create manually."*
4. Checkout:
   ```bash
   git checkout production/<TASK_SLUG>
   ```

**Store**: `MODE = "branch"` (for downstream agents that may need it).

Continue to Step 4.

---

## Step 4 — Generate Proposal (if needed)

If `<TASK_DIR>/PROPOSAL.md` does NOT exist:

### 4.0 — Task Triviality Classification

Before invoking `jlu-proposal-agent`, classify the task to decide whether to synthesize PROPOSAL.md inline or run the full two-pass agent flow.

Set `TASK_IS_TRIVIAL = true` if **all** of the following hold:
- Single service in `AFFECTED_SERVICES`
- SPEC.md is ≤ 150 lines
- The task description (or SPEC.md `## Problem Statement`) matches one of the trivial patterns:
  - Rename / refactor (e.g., "rename X to Y")
  - Literal swap (e.g., "change `/brain/` to `/studio/`", "update copy")
  - Single-function fix or single-bug fix
  - Documentation-only update
  - Constant / config value change
- SPEC.md mentions none of: "endpoint", "event", "schema", "contract", "migration", "API", "publish", "subscribe" (heuristic for new public surfaces)

Otherwise: `TASK_IS_TRIVIAL = false`.

If `TASK_IS_TRIVIAL`:
1. Synthesize `<TASK_DIR>/PROPOSAL.md` inline using the proposal template at `<plugin-root>/jelou/templates/proposal.md`:
   - **Strategy**: copy the SPEC.md `## Problem Statement` verbatim
   - **Affected Services**: single row from `services.yaml`
   - **Phases**: a single phase named `01-<task-slug>` with the SPEC.md `## Requirements > Functional` list copied as the phase's immutable requirements
   - **Testing Strategy**: `Tier 1: cover each FR with a behavior test in the existing test convention. No deferred Tier 2.`
   - **Risks**: `None identified — trivial scope.`
2. Generate the single phase file at `<TASK_DIR>/services/<service-id>/phases/01-<phase-slug>.md` from `<plugin-root>/jelou/templates/phase.md`, populating Requirements from SPEC.md FR list.
3. Log: `Task classified as trivial — PROPOSAL.md and phase file synthesized inline.`
4. Skip Steps 4a-4f and continue to Step 6 (Transition to Implementing).

If `TASK_IS_TRIVIAL` is false: continue with Step 4a (full proposal-agent flow).

**Store**: `TASK_IS_TRIVIAL`

### 4a. Load Minimum Context (orchestrator)

Read in a single orchestrator message:

- `<TASK_DIR>/SPEC.md` (required — feeds the Step 4.0 triviality classifier and downstream gates)

Do NOT preload codebase files or `ENGINEERING_PRINCIPLES.md` into the orchestrator. The proposal-agent has `Read` access and pulls them itself. Preloading would balloon every subsequent agent dispatch in the task with 30–80k tokens of context the orchestrator does not need.

### 4b. Global Strategy Pass (Decision #21)

Spawn `jlu-proposal-agent` with model: **MODEL_CONFIG.proposal** (default: sonnet). In the prompt, include:

- **Inlined**: full SPEC.md content (already in orchestrator context from 4a), affected services list with their `services.yaml` entries (`{id, path, stack, docker?}`).
- **Paths to Read** (the agent reads on demand, the orchestrator does NOT prepend file content):
  - `<WORKSPACE_PATH>/principles/ENGINEERING_PRINCIPLES.md`
  - `<WORKSPACE_PATH>/registry/services.yaml`
  - For each affected service, the 6 codebase files at `<WORKSPACE_PATH>/services/<service-id>/codebase/{ARCHITECTURE,STACK,CONVENTIONS,INTEGRATIONS,STRUCTURE,CONCERNS}.md`. Missing files are tolerable — the agent skips silently.
- **Task**: "Produce the global proposal — cross-service strategy, dependency order, phase structure, contract boundaries, risks, testing strategy."

### 4c. Local Detail Pass (Multi-Service Only)

If there are **2+ affected services**, spawn one `jlu-proposal-agent` per service in parallel (single orchestrator message), model: **MODEL_CONFIG.proposal** (default: sonnet). Each prompt includes:

- **Inlined**: full SPEC.md, the global strategy draft from 4b, the target service's `services.yaml` entry.
- **Paths to Read**: the 6 codebase files for the target service (same paths as 4b, scoped to one service).
- **Task**: "Expand service-specific execution details for `<service-id>`: local scope, relevant modules, implementation constraints, service-level phases."

Wait for all local agents to complete before continuing to 4d.

### 4d. Consolidate PROPOSAL.md

The orchestrator (or the global proposal agent in single-service mode) writes the consolidated `<TASK_DIR>/PROPOSAL.md`.

If a proposal.md template exists at `<plugin-root>/jelou/templates/proposal.md`, use it as the structure. The proposal MUST include:
- Implementation strategy overview
- Affected services with dependency order
- Phase breakdown (numbered, ordered by dependencies)
- Per-phase: requirements, scope, service(s), testing approach
- Risk assessment and mitigations
- Cross-service contracts (if multi-service)

### 4e. Generate Phase Files

For each phase defined in PROPOSAL.md, for each affected service:
1. Create `<TASK_DIR>/services/<service-id>/phases/<NN>-<phase-name>.md`
2. Use the phase.md template from `<plugin-root>/jelou/templates/phase.md` if available.
3. Each phase file has:
   ```markdown
   # Phase <NN>: <Phase Name>

   ## Requirements (immutable)
   <!-- Generated from PROPOSAL.md. Do not modify. -->
   - <requirement from proposal>
   - ...

   ## Execution (mutable)
   <!-- Updated by agents during implementation -->
   ### Status: pending
   ### Agent Output
   ### Artifacts
   ### Deviations
   ```

### 4f. Auto-Approve Proposal

Log the proposal summary to terminal (do not ask for approval):
```
## Proposal Generated — Auto-Approved

Phases: <N> phases across <N> services
Dependency order: <service-a> → <service-b> → ...

Full proposal: <TASK_DIR>/PROPOSAL.md
```

Continue to Step 6 (Transition to Implementing).

### 4g. If PROPOSAL.md Already Exists

Skip proposal generation. Read the existing PROPOSAL.md and phase files to resume execution.

---

## Step 6 — Transition to Implementing

1. Update `<TASK_DIR>/TASKS.md`:
   - Status: `implementing`
   - Add timestamp: `- Implementing: <current-datetime-ISO>`

2. **Per-service setup (once per task — not per phase).** Resolve the source path and capture the baseline commit so subsequent phases reuse cached values:

   a. Resolve `SERVICE_SOURCE_PATH[service-id]` via the worktree resolution algorithm in `references/worktree-resolution.md`. The algorithm is **mode-driven**, NOT a filesystem existence check:
      - `Mode: worktree` (`SETUP_MODE = worktree`): `SERVICE_SOURCE_PATH = <WORKSPACE_PATH>/<service-repo>/.worktrees/<TASK_SLUG>/`. If that path is missing, fall back to the main repo and log `Worktree missing for <service-id> despite Mode: worktree — using main repo.`
      - `Mode: branch` (`SETUP_MODE = branch`): `SERVICE_SOURCE_PATH = <WORKSPACE_PATH>/<service-repo>` (main repo root). **Ignore any `.worktrees/<TASK_SLUG>/` that may exist on disk** — it is leftover state from a prior attempt, not the task's working tree. If such a leftover is detected, log `Branch-mode task <TASK_SLUG> has a leftover worktree at <path>. Ignoring it for execution; clean up with /jlu-close-task or git worktree remove.`
      - `## Branching` section absent (legacy `spec/<slug>` tasks only): defer to `references/worktree-resolution.md` §3c.
   b. Record current HEAD as the pre-execution baseline: `cd <SERVICE_SOURCE_PATH[service-id]> && git rev-parse --short HEAD`. Per-service `git rev-parse` calls can run in parallel (single orchestrator message) when 2+ services.

   **Do NOT** run `docker compose up -d`, `docker compose ps`, or compute any container exec prefix here. The TDD pipeline runs entirely on the host — tests, build, lint, and format never go through a container. If the developer wants a dev container running for the service, that is `/jlu-start-dev`'s job and is independent of this workflow.

3. Update TASKS.md with the per-service baselines:
   ```markdown
   ## Commit Tracking
   - <service-id-1> pre-execution commit: <sha>
   - <service-id-2> pre-execution commit: <sha>
   ```

**Store** (per-service maps): `SERVICE_SOURCE_PATH`.

4. **Set local CPU safety throttles (once per task).**

   - `PHASE_PARALLELISM`: default `1` (sequential) unless explicitly overridden by `JLU_PHASE_PARALLELISM`.
   - `FINAL_TEST_PARALLELISM`: default `1` (sequential) unless explicitly overridden by `JLU_FINAL_TEST_PARALLELISM`.
   - Clamp both values to `1..N` where `N = number of affected services`.

**Store** (task-level): `PHASE_PARALLELISM`, `FINAL_TEST_PARALLELISM`.

---

## Step 7 — Execute Phases

Read the phases from PROPOSAL.md in dependency order. For each phase:

### 7b. Update Phase Status

1. Update the phase file status to `in_progress`.
2. Update TASKS.md with phase start timestamp.
3. Output milestone to terminal: "Starting Phase <NN>: <Phase Name> for <service-id>"

### 7c. Resolve Service Source Path (cached lookup)

Per-service setup ran once at task start in Step 6.2. Look up the precomputed value for the current service:

- `SERVICE_SOURCE_PATH = SERVICE_SOURCE_PATH[service-id]`

Tests, build, lint, and format all run on the host runtime against this path — never via a container.

### 7c.1. Phase Mode Classification

Determine whether this phase runs in **vertical** mode (one combined `jlu-tdd-cycle` agent doing RED→GREEN per FR) or **horizontal** mode (separate `jlu-test-writer` then `jlu-implementer`). The choice is governed by `tdd-cycle.md` "Agent Separation" and `tdd-principles.md` §3.

1. Count requirements in the phase file:
   ```bash
   FR_NFR_COUNT=$(grep -cE '^[[:space:]]*[-*][[:space:]]+\*{0,2}(FR|NFR)-[0-9]+' <PHASE_FILE> || echo 0)
   ```
   This counts top-level `- FR-N` or `- NFR-N` bullet entries in the requirements section.
2. Count services affected by this specific phase (not the whole task — just the services whose `phases/<phase>.md` was provided to this iteration).
3. Set `PHASE_MODE`:
   - `vertical` if `FR_NFR_COUNT <= 3` AND `services_in_phase == 1`.
   - `horizontal` otherwise.
4. Optional override: if the phase file's frontmatter or a `Mode:` line under requirements explicitly sets `mode: horizontal`, honor it (use case: a small phase where the developer wants the dispute mechanism). Never honor `mode: vertical` for a phase that flunks the size gate — the gate is the safety, not the override.
5. Log to terminal:
   - `Phase <NN> mode: vertical (<FR_NFR_COUNT> FR/NFR, 1 service) — dispatching jlu-tdd-cycle.`
   - `Phase <NN> mode: horizontal (<FR_NFR_COUNT> FR/NFR, <K> services) — dispatching jlu-test-writer then jlu-implementer.`

**Store**: `PHASE_MODE`, `FR_NFR_COUNT`.

### 7d. TDD Red — Spawn Test Writer (horizontal mode only)

**If `PHASE_MODE == vertical`, skip 7d AND 7e entirely — both are replaced by 7de.**



When the phase affects multiple services with no cross-service contract being defined this phase, dispatch one `jlu-test-writer` per service **in a single orchestrator message** only when `PHASE_PARALLELISM > 1`. Otherwise run sequentially. See `jelou/references/parallel-dispatch.md` for the pattern, scope-isolation rules, and conflict-detection on return.

Spawn `jlu-test-writer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Phase requirements (from the phase file's immutable section)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Service source path (worktree or repo)
  - SPEC.md relevant sections
  - `TEST_TIER: 1` (TDD cycle — fast, isolated tests only)
- **Task**: Write failing tests that cover the phase requirements.
- **Output**: Test file paths and a summary of what was tested.

**Red verification (trust-the-report)**: the test-writer already ran tests in its own session and reports `Status` + `Command`. Don't re-run in the orchestrator unless the report is incomplete or flags an unexpected pass.

1. Parse the test-writer's report.
2. If the report includes `Status: RED` AND a `Command:` line with the exact test runner invocation: trust the result. Continue to Step 7e.
3. If the report is missing either field, or the report explicitly notes any unexpected pass: re-run the new test files locally (`<command>` on the host) and validate.
4. If a test passes unexpectedly (either flagged in the report or surfaced by the local re-run):
   - Log to terminal: "Test `<test-name>` passes without implementation — auto-investigating."
   - Spawn a fresh `jlu-test-writer` with model: **MODEL_CONFIG.code** (default: sonnet) to evaluate whether the test is correct or the requirement is already implemented.
   - If already implemented: mark requirement as covered, skip to next.
   - If test is incorrect: rewrite and re-verify Red state.

### 7e. TDD Green — Spawn Implementer (horizontal mode only)

**If `PHASE_MODE == vertical`, skip this step — it is replaced by 7de.**

When the phase affects multiple services with no shared file edits, dispatch one `jlu-implementer` per service **in a single orchestrator message** only when `PHASE_PARALLELISM > 1`. Otherwise run sequentially. See `jelou/references/parallel-dispatch.md`. After all implementers return, compare `artifacts` arrays to detect any unintended overlap before running per-phase QA.

Spawn `jlu-implementer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Phase requirements
  - Test file paths (from the test writer)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Service source path
- **Task**: Implement the minimum code to make all tests pass.
- **Output**: Implementation file paths and a summary.

**Post-Green lint/format**:
After the implementer finishes and tests are green, run lint/format on **phase-changed files only** — never against the whole repo, because reformatting unrelated files would trip the Step 7j scope check.

1. Build `CHANGED_FILES` from the union of:
   - The implementer's `Files Modified` artifacts for this phase.
   - The test-writer's `Tests Written` artifacts for this phase.
   If `CHANGED_FILES` is empty (no files declared), skip the format step and continue to Green verification.
2. Detect the format command in priority order:
   a. An explicit "Format" or "Lint" command in CONVENTIONS.md.
   b. A `format` or `lint:fix` script in `package.json` (run via `npm run <script> -- <CHANGED_FILES>` if the script supports file arguments; otherwise skip this option).
   c. Default for JS/TS services: `npx eslint --fix` then `npx prettier --write`.
   If none of the above is detectable (e.g., a Python or Go service with no convention noted), log `No format command detected for <service-id>, skipping post-Green format.` and continue.
3. Run the detected command(s) against `CHANGED_FILES` only, on the host runtime:
   `<format-command> <CHANGED_FILES>`
4. Re-run ONLY the phase test files to confirm Green is maintained after formatting changes.

**Green verification (trust-the-report)**: the implementer already ran phase tests in its own session and reports `Status` + `Command`. Don't re-run in the orchestrator unless the report is incomplete or post-Green lint/format modified files without re-verification.

1. Parse the implementer's report.
2. If the report includes `Status: GREEN` AND a `Command:` line with the exact test runner invocation: trust the result. Continue to Step 7e.1.
3. If the report is missing either field, OR the post-Green lint/format step modified files (and the implementer didn't re-verify), OR `PHASE_IS_TRIVIAL` cannot yet be classified due to missing diff data: re-run the phase test files locally (`<command>` on the host) and confirm Green.
4. If verification fails (either the trusted report turns out wrong on a sanity spot-check, or the orchestrator's re-run fails):
   - Log failures to terminal.
   - Spawn a fresh `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and accumulated failure context (Decision #1).
   - Retry up to 5 times total.
   - If still failing after 5 attempts: pause and notify user (see Escalation Format below).

### 7de. TDD Vertical Cycle — Spawn TDD Cycle Agent (vertical mode only)

**Skip this step if `PHASE_MODE == horizontal` — RED→GREEN is handled by 7d and 7e in that mode.**

When `PHASE_MODE == vertical`, dispatch a single `jlu-tdd-cycle` agent with model: **MODEL_CONFIG.code** (default: sonnet). The agent runs RED→GREEN per FR within one session — see `tdd-principles.md` §3 and `tdd-cycle.md` "Agent Separation".

- **Input**:
  - Phase requirements (from the phase file's immutable section)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/STACK.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
  - Service source path (worktree or repo)
  - SPEC.md relevant sections
  - `TEST_TIER: 1` (TDD cycle — fast, isolated tests only; Tier 2 deferred to Step 8a)
- **Task**: For each requirement in the phase, write one failing test (RED), implement the minimum code to make it pass (GREEN), then move to the next requirement. Self-correct without silently rewriting tests — any rewrites must be documented under `Test Rewrites` with a spec quote.
- **Output**: A `TDD Cycle Report — Phase <N>` covering all slices, with `Files Modified`, `Tests Written`, `Refactor Candidates`, `Test Rewrites`, and a final `Command:` line.

**Verification (trust-the-report)**: the agent already ran every slice's tests in its own session and reports `Final Test Run` status and command. Don't re-run in the orchestrator unless the report is incomplete.

1. Parse the report.
2. If the report includes `Status: GREEN` AND a `Command:` line AND a slice table where every row is `GREEN`: trust the result. Continue.
3. If any of those is missing, OR the report flags `status: blocked`: re-run the test files listed in `Tests Written` locally (`<command>` on the host) and validate. If the local re-run shows red tests that the agent reported green, treat this as a phase failure and follow the standard retry path (spawn a fresh `jlu-tdd-cycle` with accumulated failure context, retry up to 5 times; pause and notify user after the 5th attempt).

**Post-Green lint/format** (same as 7e for horizontal mode):
After the agent finishes and tests are green, run lint/format on phase-changed files only — never against the whole repo. Build `CHANGED_FILES` from the union of the agent's `Files Modified` and `Tests Written` artifacts. Apply the same format-command detection chain as in 7e (CONVENTIONS.md > `package.json` scripts > default eslint+prettier for JS/TS > skip silently for Python/Go). Run on the host:
   `<format-command> <CHANGED_FILES>`
Re-run ONLY the phase test files after formatting to confirm Green is maintained.

### 7e.1 — Phase Triviality Classification

After Green is verified, classify the phase to gate downstream agents (refactor, per-phase QA, build-validator).

1. Capture the phase diff:
   ```bash
   cd <SERVICE_SOURCE_PATH> && git diff --shortstat HEAD
   cd <SERVICE_SOURCE_PATH> && git diff --name-only HEAD
   ```
2. Set `PHASE_IS_TRIVIAL = true` if **all** of the following hold:
   - Total lines changed (insertions + deletions) ≤ 20
   - Files changed ≤ 3
   - The diff contains none of: `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `tsconfig*.json`, `*.d.ts`, files under any `migrations/` directory
   - The implementer did not report new exported symbols, new module imports, or new TypeScript interfaces/types
   - Single service is affected by this phase

   Otherwise: `PHASE_IS_TRIVIAL = false`.

3. Log to terminal:
   - If trivial: `Phase <NN> classified as trivial — skipping refactor (7g), per-phase QA (7h), and build-validator (7k).`
   - If not trivial: `Phase <NN> non-trivial — running full per-phase pipeline.`

**Store**: `PHASE_IS_TRIVIAL`

### 7f. Test Dispute Resolution (Decision #5) — horizontal mode only

**Skip if `PHASE_MODE == vertical`.** Vertical mode has no separate dispute mechanism because the `jlu-tdd-cycle` agent owns both test and implementation. Test rewrites in vertical mode are surfaced under the agent's `Test Rewrites` section (each with a spec quote) and verified at per-phase QA (7h) and final QA (8c). If `Test Rewrites` is non-empty, log a one-line warning and pass the rewrites list through to per-phase QA for scrutiny.

If the implementer flags that a test is incorrect:
1. Spawn a **fresh** `jlu-test-writer` agent with model: **MODEL_CONFIG.code** (default: sonnet) and:
   - The original phase requirements from SPEC.md and the phase file
   - The implementer's objection (what it believes is wrong with the test)
   - The test code in question
2. The new test agent evaluates independently:
   - If it agrees the test is wrong: it rewrites the test.
   - If it confirms the test is correct: it responds with justification.
3. If the test was rewritten:
   - Re-run TDD Green (spawn implementer again with updated tests).

### 7g. Refactor Pass

**Skip if `PHASE_IS_TRIVIAL`.** Trivial phases (≤ 20 LOC, ≤ 3 files, no lockfile/migration/exported-symbol changes) don't earn the refactor pass overhead.

Otherwise, spawn `jlu-refactor-agent` with model: **MODEL_CONFIG.code** (default: sonnet). The agent applies surgical refactors guided by `jelou/references/tdd-principles.md` §7, keeping tests green at every step.

- **Input**:
  - Phase context (phase number, service-id)
  - Service source path (worktree or repo)
  - The implementer's full report (especially `Files Modified` and `Refactor Candidates`)
  - The exact test command the implementer reported (so the agent runs the same suite)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
- **Task**: Apply refactor candidates one at a time. Re-run the phase test files after each. Roll back any refactor that goes red. Stay within `Files Modified`. Never touch test files. Never change a public API.
- **Output**: A `Refactor Agent Report — Phase <N>` with `Status: APPLIED | NO_CHANGES | BLOCKED`.

**Handling the report:**

- `APPLIED`: continue to 7h.
- `NO_CHANGES`: continue to 7h.
- `BLOCKED` (two consecutive refactors went red on first try): log the agent's last error output and continue to 7h with a note in the per-phase QA prompt — do not retry the refactor agent. The remaining candidates are not load-bearing.

No re-run of the phase tests is needed at the orchestrator level — the refactor agent re-runs after every step and reports the final state. Trust the report unless `Status` or the green confirmation is missing, in which case re-run the phase test files locally.

### 7h. Per-Phase QA (Decision #13)

**Skip if `PHASE_IS_TRIVIAL`.** Comprehensive QA still runs at Step 8c against the full task scope.

Otherwise, spawn `jlu-qa-agent` with model: **MODEL_CONFIG.code** (default: sonnet) for a static per-phase review:
- Phase file with requirements
- List of files created/modified in this phase
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`
- The `PHASE_MODE` (vertical or horizontal) so QA can apply mode-specific scrutiny
- If `PHASE_MODE == vertical` AND the `jlu-tdd-cycle` report had a non-empty `Test Rewrites` section: pass the rewrites list and ask QA to verify each rewrite has a valid spec quote and that the rewritten tests still describe behavior, not implementation.

The QA agent performs static analysis ONLY — it reads code and checks conventions. It does NOT run tests. Test execution is reserved for Step 8.

If QA finds code quality issues (convention violations, function length, test tier violations):
- Log issues to terminal.
- Attempt to fix automatically: spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and QA findings.
- After fix, re-run ONLY the phase test files to confirm Green is maintained.
- Retry up to 5 times total.
- If still failing after 5 attempts: pause and notify user (see Escalation Format below).

### 7i. Update TASKS.md (inline)

The orchestrator edits TASKS.md directly via `Edit` — no agent dispatch needed for string substitution.

1. Locate the phase entry in `<TASK_DIR>/TASKS.md`.
2. Update via `Edit`:
   - Status: `pending` → `done`
   - Add: test pass/fail counts (from the Green verification step), artifacts list (file paths from test-writer + implementer reports), and any deviations noted by the implementer.
3. The commit SHA is appended in Step 7l after the inline commit in Step 7j; do not record it here.

### 7j. Git Commit (inline)

The orchestrator stages and commits directly via `Bash` — no agent dispatch (stage + commit are deterministic).

**Pre-flight (mandatory)**:

```bash
cd <SERVICE_SOURCE_PATH>
CURR=$(git branch --show-current)
[ "$CURR" = "production/<TASK_SLUG>" ] || abort "Expected branch production/<TASK_SLUG>, got $CURR"
git diff --name-only HEAD
```

**Scope check**: every file in the diff output must be one of:
- Declared in the test-writer's `Tests Written` artifacts for this phase, OR
- Declared in the implementer's `Files Modified` artifacts for this phase, OR
- A known auto-staged manifest from project pre-commit hooks: `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `composer.lock`, `poetry.lock`, `Cargo.lock`, `go.sum`.

If any other file appears in the diff, abort with:

> "Unexpected changes detected in `<SERVICE_SOURCE_PATH>` after phase <NN>: `<file-list>`. These were not produced by any agent in this phase. Manual intervention needed."

**Stage and commit**:

```bash
git add <declared-files-and-known-manifests>

git commit -m "$(cat <<'EOF'
<type>(<service-id>): <phase title>

Phase <NN> of production/<TASK_SLUG>
EOF
)"
```

`<type>` selection: `feat` for new functionality, `fix` for bug fixes, `test` for test-only phases, `refactor` for refactoring without behavior change, `docs` for documentation-only.

**Forbidden operations** (orchestrator must NEVER invoke, even via Bash):
- `git push --force` / `git push -f`
- `git reset --hard`
- `git rebase` (any flavor)
- `git checkout main`, `git checkout master`, `git checkout alpha`
- `git branch -D`
- `git commit --no-verify` (always run hooks; if a hook fails, fix the underlying issue and re-commit)

If a commit fails due to a hook (lint, commitlint, etc.): parse the hook output, dispatch a `jlu-implementer` with the failure context to fix, then re-stage and retry. Never bypass with `--no-verify`.

### 7k. Build Validation

**Skip if `PHASE_IS_TRIVIAL`.** Tier 2 build/regression check still runs at Step 8b.

Otherwise, spawn `jlu-build-validator` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Service source path (worktree or repo)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Phase context (phase number, service-id)
- **Task**: Run the project build command on the host and fix any compilation failures. Do NOT run the test suite.

**If the agent reports PASS** (with or without fixes):
- If fixes were applied: re-run ONLY the phase test files to confirm Green is maintained. Then commit the build fixes inline using the same procedure as Step 7j (with message `fix(<service-id>): resolve build errors from phase <NN>`).
- If no fixes needed: continue to 7l.

**If the agent reports SKIP** (no build command detected):
- Continue to 7l. No action needed.

**If the agent reports FAIL** (5 rounds exhausted):
- Pause and notify user (see Escalation Format below).

### 7l. Complete Phase

1. Update phase file status to `done`.
2. Output milestone to terminal: "Phase <NN> complete. Tests: <pass-count>/<total-count> passing."
3. Record the phase's commit SHA in TASKS.md. After the inline commit in Step 7j, capture the commit SHA:
   ```bash
   cd <SERVICE_SOURCE_PATH> && git rev-parse --short HEAD
   ```
   Update the phase entry in TASKS.md:
   ```markdown
   ### Phase <NN>: <Phase Name>
   - Status: done
   - Commit: <sha>
   - Completed: <ISO datetime>
   ```
4. **No container cleanup.** The TDD pipeline never starts or manages containers, so there's nothing to prune.

---

## Step 8 — Final Validation

After all phases are complete, this is the SINGLE full test suite run for the entire task.

### 8a. Write Tier 2 Integration Tests (gated)

**Aggregate first**: collect every `Tier 2 Deferred` entry reported across phases. If empty, skip to Step 8b and log: `Tier 2 step skipped — no deferred requirements.`

Otherwise, for each service that has Tier 2 deferred requirements:
1. Collect all deferred requirements from that service's phase files.
2. Spawn `jlu-test-writer` with model: **MODEL_CONFIG.code** (default: sonnet):
   - **Input**: Deferred requirements list, CONVENTIONS.md, service source path
   - **TEST_TIER: 2** (integration tests against host-resident infrastructure only — no containers, no Testcontainers)
   - **Task**: Write integration tests for all deferred requirements. Assume any required real dependency (database, queue, peer service) is already running on the host; if it isn't, mark the test skipped with a clear reason rather than starting anything yourself.
3. Spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) if the integration tests reveal missing wiring (e.g., a repository method needs a real database query that was mocked in Tier 1).

### 8b. Full Test Suite Run

This is the only time the full test suite runs during the entire task execution.

1. Run the complete test suite for each affected service on the host runtime. Use `FINAL_TEST_PARALLELISM` from Step 6.4:
   - If `FINAL_TEST_PARALLELISM == 1`: run sequentially (default, safest for local CPU/RAM).
   - If `FINAL_TEST_PARALLELISM > 1`: dispatch in parallel with one `Bash` call per service in a single orchestrator message.
      - Per service, use the full test command from CONVENTIONS.md (e.g., `npm test`, `pytest`, `go test ./...`) executed directly on the host.
      - This includes ALL tests: unit, integration, e2e. None of them go through Docker.
   - Aggregate pass/fail counts across services after all return; pass the consolidated results to Step 8c.

3. If tests fail:
   - Analyze failures: are they Tier 1 tests (regression) or Tier 2 tests (new integration tests)?
   - Spawn `jlu-implementer` to fix. Retry up to 5 times.
   - If still failing after 5 attempts: pause and notify user.

### 8c. Comprehensive QA (static only)

Spawn `jlu-qa-agent` with model: **MODEL_CONFIG.code** (default: sonnet) for a **static** comprehensive review. The QA agent **must NOT run the test suite** — Step 8b is the only sanctioned full run; re-running here is duplicate work.

Pass the QA agent the captured Step 8b results (test counts, failing test list if any) so it has the verdict without re-executing:

- **Step 8b results**: PASS/FAIL counts per service, list of any failing tests
- **Full coverage analysis**: Are all requirements from SPEC.md covered by tests? (read SPEC.md and test files; do not run them)
- **Edge case review**: Were edge cases from the spec addressed?
- **Cross-service contract verification** (if multi-service): Do the services communicate correctly? Are contracts honored?
- **Convention compliance**: Final check against CONVENTIONS.md
- **Code smell detection**: Full structural review
- **Over-engineering detection**: Verify minimum viable implementation

Log the validation results to terminal:
```
## Final Validation Results

### Coverage
- Requirements covered: <N>/<total>
- Test suites passing: <N>/<total>
- Tier 1 (unit/mock) tests: <count>
- Tier 2 (integration) tests: <count>

### Issues Found
- <issue-1>
- <issue-2>

### Cross-Service Contracts
- <contract check results>
```

### 8d. Post-Validation Cleanup

No cleanup needed. The TDD pipeline never starts containers, so there is nothing to prune. If a dev container was running for `/jlu-start-dev`, leave it alone — its lifecycle is owned by that workflow.

---

## Step 9 — Success Path

If all validation passes:

1. Update TASKS.md:
   - Status: `validating` → `ready_to_publish`
   - Add completion timestamp
   - Record final test counts
2. Print the final summary directly to terminal — no agent dispatch (orchestrator already has every field from prior steps). Format:

   ```
   ## Execution Complete — <TASK_SLUG>

   Status: ready_to_publish · <N> phase(s) · <C> commit(s) on production/<TASK_SLUG>

   ### Phases
   | NN | Name | Service | Tests | Commit |
   |----|------|---------|-------|--------|
   | 01 | <name> | <service-id> | <pass>/<total> | <sha> |
   | ...

   ### Verification
   - Tier 1 tests: <count> passing
   - Tier 2 tests: <count> passing (or "none — no deferred requirements")
   - Build: <pass | skipped (all phases trivial) | n/a>
   - QA findings: <count>

   ### Files Changed
   <total: +<insertions> / -<deletions> across <N> files>

   ### Next Steps
   - Run `/jlu-create-pr` to open the pull request.
   - After merge, run `/jlu-close-task`.
   ```

---

## Step 10 — Failure Path

If validation fails or phases have unresolved issues:

1. Log failures to terminal:
   ```
   ## Execution Incomplete — Auto-Retrying Failed Phases

   ### Failed Phases
   - Phase <NN>: <reason>

   ### Failing Tests
   - <test-name>: <failure reason>
   ```

2. Auto-retry each failed phase (re-run the full TDD cycle from Step 7d). Track attempts per phase.

3. If a phase fails after 5 total attempts: pause and notify user (see Escalation Format below).

4. Update TASKS.md with the failure state and details.

---

## Error Handling

| Error | Action |
|-------|--------|
| Task not in `planned` or `implementing` state | Stop with status message |
| SPEC.md missing | Stop — cannot execute without spec |
| Codebase files missing | Warn, proceed (agents will have less context) |
| Test writer agent fails | Kill, spawn fresh with failure context — up to 5 attempts (Decision #1) |
| Implementer agent fails | Kill, spawn fresh with failure context — up to 5 attempts (Decision #1) |
| Tests never go green after 5 retries | Pause and notify user (see Escalation Format) |
| QA auto-fix fails after 5 retries | Pause and notify user (see Escalation Format) |
| Git commit fails | Report error, do not block phase execution |
| Build validation fails after 5 rounds | Pause and notify user (see Escalation Format) |
| Worktree missing | Fall back to main repo, warn user |
| Destructive SQL in Bash command | Block execution, report BLOCKED (SQL Safety Gate) |

---

## Escalation Format

When any retry limit (5 attempts) is exhausted, this is the **only** point where execution pauses for user input. Use `question` with this format:

```
## Execution Paused — Manual Intervention Needed

Phase <NN>: <Phase Name> (<service-id>)
Failure type: <test-writer | implementer | build | qa>
Attempts: 5/5

Last error:
<last error output>

Completed phases: <list>
Remaining phases: <list>

Awaiting your input to proceed.
```

**After user responds**, handle accordingly:
- **Resume phase**: Re-run the failed phase's TDD cycle with user-provided guidance.
- **Skip phase**: Mark phase as `skipped`, continue to next phase.
- **Abort execution**: Stop execution, update TASKS.md with current state.

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| SPEC.md | `.spec-workspace/specs/<date>/<task-slug>/SPEC.md` |
| PROPOSAL.md | `.spec-workspace/specs/<date>/<task-slug>/PROPOSAL.md` |
| TASKS.md | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| Phase files | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/phases/<NN>-<phase>.md` |
| Implementation (Mode: worktree) | `<service-repo>/.worktrees/<task-slug>/` |
| Implementation (Mode: branch) | `<service-repo>` (main repo root, on branch `production/<task-slug>`) |

---

## Decision References

| Decision | Application |
|----------|-------------|
| #4 | Separate test-writer + implementer agents per TDD cycle |
| #5 | Orchestrator mediates test disputes |
| #7 | PROPOSAL.md bridges SPEC.md and implementation |
| #9 | Dependency-driven multi-service execution order |
| #10 | User stories auto-generated from spec in hybrid format |
| #13 | QA: lightweight per-phase + full final validation |
| #19 | Phase files: immutable requirements + mutable execution |
| #21 | Two-pass proposal: global strategy + per-service detail |
| #29 | **Superseded**: always autonomous, execution mode selection removed |
| #35 | **Simplified**: session recovery always auto-resumes from first incomplete phase |
| #36 | Real-time progress in TASKS.md + milestone terminal output |
| #38 | Hybrid user story format |
| #40 | Task branch `production/<task-slug>` across all repos |
