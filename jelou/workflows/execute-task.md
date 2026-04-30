# Workflow: execute-task

> Orchestrator workflow for `/jlu-execute-task [task-slug]`
> Runs TDD implementation with proposal generation, phase-by-phase execution, and QA validation.

> **Autonomy mode**: This workflow runs fully autonomous. The ONLY case where execution pauses for user input is after 5 failed retry attempts on a phase or build step. All other decisions are auto-resolved.

> **SQL Safety Gate — inject into every agent prompt that has Bash access (test-writer, implementer, qa-agent, build-validator):**
> ```
> ## SQL Safety Gate
> NEVER execute Bash commands containing destructive SQL keywords: DROP TABLE, DROP DATABASE, DROP INDEX, DROP COLUMN, DELETE FROM, or TRUNCATE. This applies to direct SQL commands, database CLI tools (psql, mysql, mongosh, redis-cli), and any command that pipes SQL to a database.
> If a phase requires running destructive SQL, SKIP the execution and report:
> "BLOCKED: Phase requires destructive SQL execution. Manual intervention needed."
> ```

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

1. If a `task-slug` is provided as a command argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If no `task-slug` provided:
   a. Find the most recent task (latest date folder, latest task within it).
   b. Auto-select it. Log to terminal: "Auto-selected task `<task-slug>`."

**Error gate**: If no task found, stop: "No task found. Run `/jlu-new-task` first."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`

---

## Step 2 — Load Task State

1. Read `<TASK_DIR>/TASKS.md`.
2. Extract:
   - Current status (draft, refining, planned, implementing, etc.)
   - Affected services list
   - Phase progress (if any phases have been executed)
   - Any blocked or failed phases

**Validation**:
- If status is `draft` or `refining`: stop. "Task is in `<status>` state. Run `/jlu-new-task <slug>` first to complete the spec interview and get it to `planned`."
- If status is `closed` or `cancelled`: stop. "Task is already `<status>`. Cannot execute."

**Store**: `CURRENT_STATUS`, `AFFECTED_SERVICES`, `PHASE_STATE`

---

### 2b. Resolve Model Configuration

1. Read `.spec-workspace.json` from the current working directory.
2. If a `models` section exists, extract the model overrides.
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

Read `<TASK_DIR>/TASKS.md` → `## Branching → Mode`:

- If `Mode: worktree` or the `## Branching` section is absent (old-style task): skip to Step 4. Implementation will run in the task worktree.
- If `Mode: branch`: continue with the branch-mode pre-flight below.

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

### 4a. Load Context

Read and assemble:
- `<TASK_DIR>/SPEC.md` (required)
- For each affected service:
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/STACK.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/INTEGRATIONS.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONCERNS.md`
- `<WORKSPACE_PATH>/principles/ENGINEERING_PRINCIPLES.md`

### 4b. Global Strategy Pass (Decision #21)

Spawn `jlu-proposal-agent` with model: **MODEL_CONFIG.proposal** (default: sonnet):
- All context from 4a
- Task: "Produce the global proposal — cross-service strategy, dependency order, phase structure, contract boundaries, risks, testing strategy."
- The agent writes a draft global strategy.

### 4c. Local Detail Pass (Multi-Service Only)

If there are **2+ affected services**:
- For each affected service, spawn a `jlu-proposal-agent` with model: **MODEL_CONFIG.proposal** (default: sonnet) in parallel:
  - Pass: the global strategy draft + service-specific codebase files + SPEC.md
  - Task: "Expand service-specific execution details for `<service-id>`: local scope, relevant modules, implementation constraints, service-level phases."
- Wait for all local agents to complete.

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

2. For each affected service, record the current worktree HEAD as the pre-execution baseline:
   ```bash
   cd <SERVICE_SOURCE_PATH> && git rev-parse --short HEAD
   ```
   Record in TASKS.md under a new `## Commit Tracking` section:
   ```markdown
   ## Commit Tracking
   - Pre-execution commit: <sha>
   ```

---

## Step 7 — Execute Phases

Read the phases from PROPOSAL.md in dependency order. For each phase:

### 7b. Update Phase Status

1. Update the phase file status to `in_progress`.
2. Update TASKS.md with phase start timestamp.
3. Output milestone to terminal: "Starting Phase <NN>: <Phase Name> for <service-id>"

### 7c. Resolve Service Source Path and Docker Context

1. Apply the worktree resolution algorithm from `references/worktree-resolution.md` for the current service:
   - Look up the service entry in `services.yaml`.
   - Check if `<service-repo>/.worktrees/<TASK_SLUG>` exists.
   - If yes: use the worktree as `SERVICE_SOURCE_PATH`.
   - If no: fall back to the service's main repo path from `services.yaml`.
2. **Docker context resolution** — Read the service's `docker` config from `services.yaml`:
   a. If the service has a `docker` block:
      1. Check container status: `cd <SERVICE_SOURCE_PATH> && docker compose ps --format '{{.State}}'`
      2. If not running, restart: `cd <SERVICE_SOURCE_PATH> && docker compose up -d`
      3. Compute `DOCKER_EXEC_PREFIX` = `cd <SERVICE_SOURCE_PATH> && docker compose exec <docker.service>`
      4. Set `IS_DOCKER_SERVICE` = `true`
   b. If no `docker` block:
      1. Set `DOCKER_EXEC_PREFIX` = empty
      2. Set `IS_DOCKER_SERVICE` = `false`

**Store**: `SERVICE_SOURCE_PATH`, `DOCKER_EXEC_PREFIX`, `IS_DOCKER_SERVICE`

### 7d. TDD Red — Spawn Test Writer

When the phase affects multiple services with no cross-service contract being defined this phase, dispatch one `jlu-test-writer` per service **in a single orchestrator message** rather than sequentially. See `jelou/references/parallel-dispatch.md` for the pattern, scope-isolation rules, and conflict-detection on return.

Spawn `jlu-test-writer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Phase requirements (from the phase file's immutable section)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Service source path (worktree or repo)
  - SPEC.md relevant sections
  - `TEST_TIER: 1` (TDD cycle — fast, isolated tests only)
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include in the agent prompt:
  ```
  ## Execution Environment
  This service runs in Docker. When running tests or any framework command via Bash, prefix with:
    <DOCKER_EXEC_PREFIX> <command>
  File reads/writes (Read, Write, Glob, Grep) operate on the host filesystem (the worktree).
  Only test execution, lint, build, and dependency commands go through Docker.
  ```
  Omit this block entirely for non-Docker services.
- **Task**: Write failing tests that cover the phase requirements.
- **Output**: Test file paths and a summary of what was tested.

**Red verification**:
1. Run ONLY the new test files produced by the test-writer (use exact file paths from the agent's report).
   - Example: `<DOCKER_EXEC_PREFIX> jest path/to/new-test.spec.ts` or `<DOCKER_EXEC_PREFIX> pytest path/to/new_test.py`
   - Do NOT run the full test suite.
2. Confirm the new tests FAIL (Red state).
3. If any new tests PASS unexpectedly:
   - Log to terminal: "Test `<test-name>` passes without implementation — auto-investigating."
   - Spawn a fresh `jlu-test-writer` with model: **MODEL_CONFIG.code** (default: sonnet) to evaluate whether the test is correct or the requirement is already implemented.
   - If already implemented: mark requirement as covered, skip to next.
   - If test is incorrect: rewrite and re-verify Red state.

### 7e. TDD Green — Spawn Implementer

When the phase affects multiple services with no shared file edits, dispatch one `jlu-implementer` per service **in a single orchestrator message** rather than sequentially. See `jelou/references/parallel-dispatch.md`. After all implementers return, compare `artifacts` arrays to detect any unintended overlap before running per-phase QA.

Spawn `jlu-implementer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Phase requirements
  - Test file paths (from the test writer)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Service source path
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the same `## Execution Environment` block as in Step 7d. Omit for non-Docker services.
- **Task**: Implement the minimum code to make all tests pass.
- **Output**: Implementation file paths and a summary.

**Post-Green lint/format** (Docker-enabled services only):
After the implementer finishes and tests are green, run lint and format inside the container:
1. Detect the lint command from `package.json` scripts or `CONVENTIONS.md`.
2. Run: `<DOCKER_EXEC_PREFIX> npx eslint --fix . && <DOCKER_EXEC_PREFIX> npx prettier --write .`
3. Re-run ONLY the phase test files to confirm Green is maintained after formatting changes.

**Green verification**:
1. Run ONLY the phase test files (use the exact file paths from the test-writer's report).
   - Example: `<DOCKER_EXEC_PREFIX> jest path/to/phase-test.spec.ts` or `<DOCKER_EXEC_PREFIX> pytest path/to/test_phase.py`
   - Do NOT run the full test suite. Regression checking happens once at Step 8.
2. Confirm all phase tests PASS (Green state).
3. If tests still fail after implementation:
   - Log failures to terminal.
   - Spawn a fresh `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and accumulated failure context (Decision #1).
   - Retry up to 5 times total.
   - If still failing after 5 attempts: pause and notify user (see Escalation Format below).

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

### 7f. Test Dispute Resolution (Decision #5)

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

### 7g. Refactor Pass (Optional)

**Skip this step entirely if `PHASE_IS_TRIVIAL` is true.** Trivial phases by construction have no duplicated code, no naming hot-spots, and no functions exceeding 100 lines.

Otherwise:
1. Review implementation for code quality:
   - Duplicated code that can be extracted
   - Naming improvements
   - Overly complex logic that can be simplified
   - Functions exceeding 100 lines must be refactored into smaller units
2. If changes are made, re-run ONLY the phase test files to confirm Green is maintained. Do not run the full suite.

### 7h. Per-Phase QA (Decision #13)

**Skip this step entirely if `PHASE_IS_TRIVIAL` is true.** Per-phase static review on a 1-3 file, ≤20-line change yields no signal worth the agent dispatch. Comprehensive QA still runs once at Step 8c against the full task scope.

Otherwise, spawn `jlu-qa-agent` with model: **MODEL_CONFIG.code** (default: sonnet) for a static per-phase review:
- Phase file with requirements
- List of files created/modified in this phase
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`

The QA agent performs static analysis ONLY — it reads code and checks conventions. It does NOT run tests. Test execution is reserved for Step 8.

If QA finds code quality issues (convention violations, function length, test tier violations):
- Log issues to terminal.
- Attempt to fix automatically: spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and QA findings.
- After fix, re-run ONLY the phase test files to confirm Green is maintained.
- Retry up to 5 times total.
- If still failing after 5 attempts: pause and notify user (see Escalation Format below).

### 7i. Update TASKS.md (inline)

The orchestrator updates TASKS.md directly via `Edit` — no agent dispatch. All required data is already in context from prior steps in this phase:

1. Locate the phase entry in `<TASK_DIR>/TASKS.md`.
2. Update via `Edit`:
   - Status: `pending` → `done`
   - Add: test pass/fail counts (from the Green verification step), artifacts list (file paths from test-writer + implementer reports), and any deviations noted by the implementer.
3. The commit SHA is appended in Step 7l after `jlu-git-agent` reports the commit; do not record it here.

Rationale: this step is pure file editing. Spawning a subagent for a string-substitution task is wasted overhead.

### 7j. Git Commit

Spawn `jlu-git-agent` with model: **MODEL_CONFIG.operational** (default: haiku):
- Stage all changes from this phase (in the task worktree only)
- Commit with a conventional commit message referencing the phase
- **Restrictions**: Only commit to `production/<TASK_SLUG>` branch. Never to main/master/alpha.
- If unexpected or unrelated changes are detected in the worktree: block and escalate to user.

### 7k. Build Validation

**Skip this step entirely if `PHASE_IS_TRIVIAL` is true.** Trivial phases by construction have no edits to manifests, lockfiles, tsconfigs, type declaration files, or migrations — the categories that justify a separate build pass on top of the in-phase tsc/lint that already ran. Tier 2 build/regression checking still runs once at Step 8b across the full task scope.

Otherwise, spawn `jlu-build-validator` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Service source path (worktree or repo)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Phase context (phase number, service-id)
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the same `## Execution Environment` block as in Step 7d. Omit for non-Docker services.
- **Task**: Run the project build command and fix any compilation failures. Do NOT run the test suite.

**If the agent reports PASS** (with or without fixes):
- If fixes were applied: re-run ONLY the phase test files to confirm Green is maintained. Then re-spawn `jlu-git-agent` with model: **MODEL_CONFIG.operational** (default: haiku) to commit the build fixes (message: `fix(<service>): resolve build errors from phase <NN>`).
- If no fixes needed: continue to 7l.

**If the agent reports SKIP** (no build command detected):
- Continue to 7l. No action needed.

**If the agent reports FAIL** (5 rounds exhausted):
- Pause and notify user (see Escalation Format below).

### 7l. Complete Phase

1. Update phase file status to `done`.
2. Output milestone to terminal: "Phase <NN> complete. Tests: <pass-count>/<total-count> passing."
3. Record the phase's commit SHA in TASKS.md. After the git-agent commits (Step 7j), capture the commit:
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
4. **Container cleanup** (Docker-enabled services only):
   ```bash
   docker container prune -f 2>/dev/null || true
   ```
   Remove any orphaned containers from interrupted test runs to prevent memory accumulation across phases.

---

## Step 8 — Final Validation

After all phases are complete, this is the SINGLE full test suite run for the entire task.

### 8a. Write Tier 2 Integration Tests

For each service that has Tier 2 deferred requirements (from test-writer reports across phases):
1. Collect all deferred requirements from phase files.
2. Spawn `jlu-test-writer` with model: **MODEL_CONFIG.code** (default: sonnet):
   - **Input**: Deferred requirements list, CONVENTIONS.md, service source path
   - **TEST_TIER: 2** (integration tests — Testcontainers and real infrastructure allowed)
   - **Docker context**: Include if applicable
   - **Task**: Write integration tests for all deferred requirements.
3. Spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) if the integration tests reveal missing wiring (e.g., a repository method needs a real database query that was mocked in Tier 1).

### 8b. Full Test Suite Run

This is the only time the full test suite runs during the entire task execution.

1. **Container cleanup first**:
   ```bash
   docker container prune -f 2>/dev/null || true
   ```

2. Run the complete test suite for each affected service:
   - Use the full test command from CONVENTIONS.md (e.g., `npm test`, `pytest`, `go test ./...`)
   - If Docker-enabled: `<DOCKER_EXEC_PREFIX> <full test command>`
   - This includes ALL tests: unit, integration, Testcontainer-based, e2e
   
3. If tests fail:
   - Analyze failures: are they Tier 1 tests (regression) or Tier 2 tests (new integration tests)?
   - Spawn `jlu-implementer` to fix. Retry up to 5 times.
   - If still failing after 5 attempts: pause and notify user.

### 8c. Comprehensive QA (static only)

Spawn `jlu-qa-agent` with model: **MODEL_CONFIG.code** (default: sonnet) for **static** comprehensive review. The QA agent **must NOT run the test suite** — Step 8b is the only sanctioned full test run, and re-running here is duplicate work that the trace shows costing 1-3 min per task.

Pass the QA agent the captured Step 8b results (test counts, failing test list if any) so it has the verdict without re-executing:

- **Step 8b results**: PASS/FAIL counts per service, list of any failing tests
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the `## Execution Environment` block. Omit for non-Docker services.
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

For Docker-enabled services, clean up Testcontainer instances:
```bash
docker container prune -f 2>/dev/null || true
```

---

## Step 9 — Success Path

If all validation passes:

1. Update TASKS.md:
   - Status: `validating` → `ready_to_publish`
   - Add completion timestamp
   - Record final test counts
2. Print the final summary directly to terminal — no agent dispatch. The orchestrator already has every field from earlier steps in this run (TASKS.md just updated, git commit SHAs from Step 7j per phase, test counts from Step 8b, artifact paths from test-writer + implementer reports). Format:

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

   Rationale: this step is fixed-format rendering of data already in context. Dispatching a subagent for string interpolation is wasted overhead.

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
| Implementation | `<service-repo>/.worktrees/<task-slug>/` (or service repo if no worktree) |

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
