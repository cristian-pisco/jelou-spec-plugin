# Workflow: execute-task

> Orchestrator workflow for `/jlu:execute-task [task-slug]`
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

## Step 1 — Resolve Task

1. If a `task-slug` is provided as a command argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If no `task-slug` provided:
   a. Find the most recent task (latest date folder, latest task within it).
   b. Auto-select it. Log to terminal: "Auto-selected task `<task-slug>`."

**Error gate**: If no task found, stop: "No task found. Run `/jlu:new-task` first."

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
- If status is `draft` or `refining`: stop. "Task is in `<status>` state. Run `/jlu:refine-spec` first to get it to `planned`."
- If status is `closed` or `cancelled`: stop. "Task is already `<status>`. Cannot execute."

**Store**: `CURRENT_STATUS`, `AFFECTED_SERVICES`, `PHASE_STATE`

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

Spawn `jlu-proposal-agent` with:
- All context from 4a
- Task: "Produce the global proposal — cross-service strategy, dependency order, phase structure, contract boundaries, risks, testing strategy."
- The agent writes a draft global strategy.

### 4c. Local Detail Pass (Multi-Service Only)

If there are **2+ affected services**:
- For each affected service, spawn a `jlu-proposal-agent` in parallel:
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

### 4f. Generate User Stories

Spawn a sub-agent to derive user stories from SPEC.md + PROPOSAL.md:
- For each affected service, create story files at `<TASK_DIR>/services/<service-id>/uh/<story-slug>.md`.
- Use the user-story.md template from `<plugin-root>/jelou/templates/user-story.md` if available.
- Each story follows the hybrid format (Decision #38):
  ```markdown
  # <story-slug>

  ## Story
  As a [user], I want [action], so that [benefit].

  ## Acceptance Criteria

  ### Scenario: <scenario-name>
  - Given <precondition>
  - When <action>
  - Then <expected-result>

  ## Phase Mapping
  - Phase <NN>: <phase-name>
  ```

### 4g. Auto-Approve Proposal

Log the proposal summary to terminal (do not ask for approval):
```
## Proposal Generated — Auto-Approved

Phases: <N> phases across <N> services
Dependency order: <service-a> → <service-b> → ...

Full proposal: <TASK_DIR>/PROPOSAL.md
```

Continue to Step 6 (Transition to Implementing).

### 4h. If PROPOSAL.md Already Exists

Skip proposal generation. Read the existing PROPOSAL.md and phase files to resume execution.

---

## Step 6 — Transition to Implementing

1. Update `<TASK_DIR>/TASKS.md`:
   - Status: `implementing`
   - Add timestamp: `- Implementing: <current-datetime-ISO>`


---

## Step 7 — Execute Phases

Read the phases from PROPOSAL.md in dependency order. For each phase:

### 7a. Pre-Phase Gate (Step-by-Step Mode Only)

If `EXECUTION_MODE` is `step_by_step`:
```
## Phase <NN>: <Phase Name>
Service: <service-id>
Requirements:
- <requirement-1>
- <requirement-2>

Proceed with this phase? (yes / skip / abort)
```
- If "skip": mark phase as `skipped`, continue to next.
- If "abort": stop execution, report current state.

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

Spawn `jlu-test-writer` agent:
- **Input**:
  - Phase requirements (from the phase file's immutable section)
  - `<TASK_DIR>/services/<service-id>/CONTEXT.md` (if exists)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Service source path (worktree or repo)
  - SPEC.md relevant sections
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
1. Run the test suite for the affected files.
2. Confirm the new tests FAIL (Red state).
3. If any new tests PASS unexpectedly:
   - Flag to user: "Test `<test-name>` passes without implementation. This may indicate the requirement is already implemented or the test is incorrect."
   - Ask: "Continue anyway, or investigate?"

### 7e. TDD Green — Spawn Implementer

Spawn `jlu-implementer` agent:
- **Input**:
  - Phase requirements
  - Test file paths (from the test writer)
  - `<TASK_DIR>/services/<service-id>/CONTEXT.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Service source path
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the same `## Execution Environment` block as in Step 7d. Omit for non-Docker services.
- **Task**: Implement the minimum code to make all tests pass.
- **Output**: Implementation file paths and a summary.

**Post-Green lint/format** (Docker-enabled services only):
After the implementer finishes and tests are green, run lint and format inside the container:
1. Detect the lint command from `package.json` scripts or `CONVENTIONS.md`.
2. Run: `<DOCKER_EXEC_PREFIX> npx eslint --fix . && <DOCKER_EXEC_PREFIX> npx prettier --write .`
3. Re-run tests to confirm Green is maintained after formatting changes.

**Green verification**:
1. Run the test suite.
2. Confirm all tests PASS (Green state).
3. If tests still fail after implementation:
   - Report failures.
   - Offer: "Retry implementation, or spawn a fresh implementer with failure context?" (Decision #1)

### 7f. Test Dispute Resolution (Decision #5)

If the implementer flags that a test is incorrect:
1. Spawn a **fresh** `jlu-test-writer` agent with:
   - The original phase requirements from SPEC.md and the phase file
   - The implementer's objection (what it believes is wrong with the test)
   - The test code in question
2. The new test agent evaluates independently:
   - If it agrees the test is wrong: it rewrites the test.
   - If it confirms the test is correct: it responds with justification.
3. If the test was rewritten:
   - Re-run TDD Green (spawn implementer again with updated tests).

### 7g. Refactor Pass (Optional)

After Green:
1. Review implementation for code quality:
   - Duplicated code that can be extracted
   - Naming improvements
   - Overly complex logic that can be simplified
   - Functions exceeding 100 lines must be refactored into smaller units
2. If changes are made, re-run tests to confirm Green is maintained.

### 7h. Per-Phase QA (Decision #13)

Spawn `jlu-qa-agent` for a lightweight per-phase check:
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the same `## Execution Environment` block as in Step 7d. Omit for non-Docker services.
- All phase tests pass
- No regression in existing tests
- Conventions from CONVENTIONS.md are followed
- No obvious security or performance issues

If QA finds issues:
- Report them clearly.
- In autonomous mode: attempt to fix automatically (spawn implementer with QA findings).
- In step-by-step mode: present to user and ask how to proceed.

### 7i. Update TASKS.md

Spawn `jlu-tasks-agent` (or update directly):
- Update phase status in TASKS.md
- Record: test results, artifacts created, any deviations
- Record agent summaries from this phase

### 7j. Git Commit

Spawn `jlu-git-agent`:
- Stage all changes from this phase (in the task worktree only)
- Commit with a conventional commit message referencing the phase
- **Restrictions**: Only commit to `spec/<TASK_SLUG>` branch. Never to main/master/alpha.
- If unexpected or unrelated changes are detected in the worktree: block and escalate to user.

### 7k. Build Validation

Spawn `jlu-build-validator` agent:
- **Input**:
  - Service source path (worktree or repo)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Phase context (phase number, service-id)
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the same `## Execution Environment` block as in Step 7d. Omit for non-Docker services.
- **Task**: Run the project build, fix any failures, verify tests still pass.

**If the agent reports PASS** (with or without fixes):
- If fixes were applied: re-spawn `jlu-git-agent` to commit the build fixes (message: `fix(<service>): resolve build errors from phase <NN>`).
- If no fixes needed: continue to 7l.

**If the agent reports SKIP** (no build command detected):
- Continue to 7l. No action needed.

**If the agent reports FAIL** (5 rounds exhausted):
- Report the failure to the user with the agent's last error output.
- In autonomous mode: pause execution and ask the user how to proceed.
- In step-by-step mode: present the failure and ask how to proceed.

### 7l. Complete Phase

1. Update phase file status to `done`.
2. Output milestone to terminal: "Phase <NN> complete. Tests: <pass-count>/<total-count> passing."

---

## Step 8 — Final Validation

After all phases are complete:

Spawn `jlu-qa-agent` for comprehensive final validation:
- **Full coverage analysis**: Are all requirements from SPEC.md covered by tests?
- **Edge case review**: Were edge cases from the spec addressed?
- **Regression check**: Full test suite across all affected services
- **Cross-service contract verification** (if multi-service): Do the services communicate correctly? Are contracts honored?
- **Convention compliance**: Final check against CONVENTIONS.md

Present the validation results:
```
## Final Validation Results

### Coverage
- Requirements covered: <N>/<total>
- Test suites passing: <N>/<total>

### Issues Found
- <issue-1>
- <issue-2>

### Cross-Service Contracts
- <contract check results>
```

---

## Step 9 — Success Path

If all validation passes:

1. Update TASKS.md:
   - Status: `validating` → `ready_to_publish`
   - Add completion timestamp
   - Record final test counts
2. Dispatch `jlu-summary-agent`:
   - Pass `TASK_DIR` (the resolved task directory path)
   - Pass `CONTEXT_HINT` = `post-execution`
   - Print the agent's output verbatim — do not add to or reformat it.

---

## Step 10 — Failure Path

If validation fails or phases have unresolved issues:

1. Present failures clearly:
   ```
   ## Execution Incomplete

   ### Failed Phases
   - Phase <NN>: <reason>

   ### Failing Tests
   - <test-name>: <failure reason>

   ### Unresolved Issues
   - <issue>
   ```

2. Offer options:
   - "Retry failed phases"
   - "Pause for manual intervention"
   - "Mark as blocked (will need `/jlu:extend-phase` to continue)"

3. Update TASKS.md with the failure state and details.

---

## Error Handling

| Error | Action |
|-------|--------|
| Task not in `planned` or `implementing` state | Stop with status message |
| SPEC.md missing | Stop — cannot execute without spec |
| Codebase files missing | Warn, proceed (agents will have less context) |
| Test writer agent fails | Kill, spawn fresh with failure context (Decision #1) |
| Implementer agent fails | Kill, spawn fresh with failure context (Decision #1) |
| Tests never go green after 2 retries | Escalate to user |
| Git commit fails | Report error, do not block phase execution |
| Build validation fails after 5 rounds | Report failure, pause for user intervention |
| Worktree missing | Fall back to main repo, warn user |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| SPEC.md | `.spec-workspace/specs/<date>/<task-slug>/SPEC.md` |
| PROPOSAL.md | `.spec-workspace/specs/<date>/<task-slug>/PROPOSAL.md` |
| TASKS.md | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| Phase files | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/phases/<NN>-<phase>.md` |
| User stories | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/uh/<story-slug>.md` |
| CONTEXT.md | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/CONTEXT.md` |
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
| #29 | Configurable autonomous/step-by-step execution mode |
| #35 | Session recovery: resume, re-validate, or start over |
| #36 | Real-time progress in TASKS.md + milestone terminal output |
| #38 | Hybrid user story format |
| #40 | Task branch `spec/<task-slug>` across all repos |
