# Workflow: rollback-phase

> Orchestrator workflow for `/jlu-rollback-phase [task-slug] [phase-number]`
> Resets service worktrees to the last known-good state after a failed phase.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

## Step 1 — Resolve Task

1. If a `task-slug` is provided as a command argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If not provided:
   a. Find the most recent task in `implementing` state.
   b. Confirm with the user: "Rollback phases for task `<task-slug>`?"

**Error gate**: If no task found, stop: "No task found. Run `/jlu-new-task` first."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`

---

## Step 2 — Read Phase State

1. Read `<TASK_DIR>/TASKS.md`.
2. Extract:
   - Current task status
   - Phase list with statuses and commit SHAs
   - Pre-execution commit SHA
   - Affected services list

**Validation**:
- If status is `draft`, `refining`, or `planned`: stop. "Task has not started execution. Nothing to roll back."
- If status is `closed`: stop. "Task is already closed. Cannot roll back."
- If no commit SHAs are recorded: stop. "No commit tracking found in TASKS.md. Rollback requires commit SHAs recorded during execution."

**Store**: `PHASE_LIST`, `PRE_EXECUTION_COMMIT`, `AFFECTED_SERVICES`

---

## Step 3 — Determine Rollback Target

1. If `phase-number` is provided as the second argument:
   - If phase-number is 1: target = `PRE_EXECUTION_COMMIT`
   - If phase-number > 1: target = commit SHA of phase `(phase-number - 1)` (the last completed phase before the target)
   - If the target phase does not exist: stop. "Phase <N> not found in TASKS.md."
   - If the target phase status is already `pending`: stop. "Phase <N> has not been executed yet. Nothing to roll back."
2. If no `phase-number` provided:
   - Find the last phase with status `done` and use its commit SHA as the target.
   - If no phases are `done`: target = `PRE_EXECUTION_COMMIT`

**Store**: `TARGET_COMMIT`, `TARGET_PHASE_LABEL` (description for display), `PHASES_TO_ROLLBACK` (list of phases that will be reset)

---

## Step 4 — Execute Rollback Per Service

For each service in `AFFECTED_SERVICES`:

### 4a. Resolve Worktree Path

Apply the **mode-driven** worktree resolution algorithm from `references/worktree-resolution.md`. Do **not** use a filesystem existence check — respect `SETUP_MODE` from `TASKS.md → ## Branching → Mode`.

1. Look up the service's repo path from `<WORKSPACE_PATH>/registry/services.yaml`.
2. Resolve based on `SETUP_MODE`:
   - `Mode: worktree`: `SERVICE_CWD = <service-repo>/.worktrees/<TASK_SLUG>`. If that path is missing, fall back to the main repo and warn: `Worktree missing for <service-id> despite Mode: worktree — using main repo.`
   - `Mode: branch`: `SERVICE_CWD = <service-repo>` (main repo root). Ignore any leftover `.worktrees/<TASK_SLUG>/` that may exist. If detected, log: `Branch-mode task has a leftover worktree at <path>. Ignoring it.`
   - `## Branching` section absent (legacy): fall back to the legacy rule in `references/worktree-resolution.md` → `## Resolution Algorithm`, bullet `3.c` (use `.worktrees/<TASK_SLUG>/` if it exists, else the repo root, and warn that this is a legacy `spec/<slug>` task).

### 4b. Safety Check

Run in the worktree:
```bash
cd <SERVICE_CWD> && git status --porcelain
```

If there are uncommitted changes:
- Stop processing this service.
- Warn via question:
  ```
  Uncommitted changes detected in <service-id> worktree at <SERVICE_CWD>.

  Stash or commit them first:
    cd <SERVICE_CWD> && git stash

  Options:
  A) Skip this service (rollback other services)
  B) Abort entire rollback
  ```

### 4c. Show Rollback Preview

Count files that will be reverted:
```bash
cd <SERVICE_CWD> && git diff --stat <TARGET_COMMIT>..HEAD
```

Present via question:
```
Rollback Preview — <service-id>

Current state: <current phase status description>
Rollback to: <TARGET_PHASE_LABEL> (commit <TARGET_COMMIT>)
Files that will be reverted: <N files>

<file stat output>

Options:
A) Confirm rollback
B) Skip this service
C) Abort entire rollback
```

### 4d. Mode-Aware Reset

Read `<TASK_DIR>/TASKS.md` → `## Branching → Mode`. If the `## Branching` section is absent (legacy task created before branch-mode support), treat it as `Mode: worktree` and use the worktree path resolved in Step 4a.

**If `Mode: worktree`**:

```bash
cd <SERVICE_CWD>   # The worktree path resolved in Step 4a: <SERVICE_REPO_ROOT>/.worktrees/<TASK_SLUG>
# Verify we're on production/<TASK_SLUG>
[[ $(git rev-parse --abbrev-ref HEAD) = "production/<TASK_SLUG>" ]] || { echo "Unexpected branch"; exit 1; }
# Working-tree cleanliness was already verified in Step 4b against SERVICE_CWD.
git reset --hard <target-phase-sha>
```

**If `Mode: branch`**:

```bash
cd <SERVICE_REPO_ROOT>
# Verify we're on production/<TASK_SLUG>
[[ $(git rev-parse --abbrev-ref HEAD) = "production/<TASK_SLUG>" ]] || {
  echo "Not on production/<TASK_SLUG> — checkout first and retry"
  exit 1
}
# Verify working tree is clean
[[ -z "$(git status --porcelain)" ]] || {
  echo "Working tree dirty — resolve first and retry"
  exit 1
}
git reset --hard <target-phase-sha>
```

Rollback does NOT touch `staging/<TASK_SLUG>`. The next `/jlu-ship` run will detect that `production/<TASK_SLUG>` moved backward (its tip SHA no longer matches `Last cherry-picked production SHA` and is not an ancestor) and will perform a rebuild, force-pushing the new staging state.

Log to terminal: "Rolled back `<service-id>` to commit `<TARGET_COMMIT>`."

---

## Step 5 — Update TASKS.md

1. For each phase in `PHASES_TO_ROLLBACK`:
   - Change status from `done` or `in_progress` back to `pending`. `pending` is the only valid
     "not yet executed" value in the phase-status vocabulary (`pending | in_progress | done |
     blocked`), and it is what Step 6 writes into the phase file — TASKS.md and the phase file
     MUST agree. Do NOT invent a `rolled_back` status; the rollback fact is recorded in the
     Lifecycle entry below, not as a status value.
2. Add a rollback entry to the Lifecycle section:
   ```markdown
   - Rolled back: <ISO datetime> — Target: <TARGET_PHASE_LABEL> (commit <TARGET_COMMIT>), Phases rolled back: <phase list>
   ```
3. Set task status to `implementing` (ready for re-execution).

---

## Step 6 — Reset Phase Files

For each phase in `PHASES_TO_ROLLBACK`, for each affected service:

1. Read the phase file at `<TASK_DIR>/services/<service-id>/phases/<NN>-<phase-name>.md`.
2. Reset the `## Execution (mutable)` section:
   ```markdown
   ## Execution (mutable)
   ### Status: pending
   ### Agent Output
   ### Artifacts
   ### Deviations
   ```
3. Write the updated phase file.

---

## Step 7 — Final Report

```
## Rollback Complete — <TASK_SLUG>

### Services Rolled Back
| Service | Target Commit | Files Reverted | Status |
|---------|--------------|----------------|--------|
| <service-id> | <sha> | <N> | rolled back |

### Phases Reset
| Phase | Previous Status | New Status |
|-------|----------------|------------|
| Phase <NN>: <name> | done | pending (rolled back — see Lifecycle) |

### Next Steps
- Re-run `/jlu-execute-task <TASK_SLUG>` to retry from the first rolled-back phase
- Or run `/jlu-refine-task <TASK_SLUG>` to adjust the spec before retrying
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No task found | Stop with message |
| Task not in executing state | Stop with message |
| No commit SHAs in TASKS.md | Stop — rollback requires tracking data |
| Uncommitted changes in worktree | Block that service, offer skip or abort |
| Target phase not found | Stop with message |
| git reset fails | Report error, skip service, continue others |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| TASKS.md (updated) | `<WORKSPACE_PATH>/specs/<date>/<task-slug>/TASKS.md` |
| Phase files (reset) | `<WORKSPACE_PATH>/specs/<date>/<task-slug>/services/<service-id>/phases/*.md` |
