# Workflow: close-task

> Orchestrator workflow for `/jlu-close-task [task-slug]`
> Performs post-production closure: ClickUp update, artifact finalization, worktree cleanup.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

## Step 1 — Resolve Task

1. If `task-slug` is provided as an argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If not provided:
   a. Find the most recent task in `done` or `ready_to_publish` state.
   b. If multiple candidates: present the list and ask user to choose.
   c. Confirm: "Close task `<task-slug>`?"

**Error gate**: If no task found, stop: "No task found to close."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`

---

## Step 2 — Verify Preconditions

### 2a. Check Task Status

1. Read `<TASK_DIR>/TASKS.md`.
2. Extract the current status.
3. Validate:
   - If status is `done` or `ready_to_publish`: proceed.
   - If status is `closed`: stop. "Task `<TASK_SLUG>` is already closed."
   - If status is anything else: warn and ask.
     ```
     Task `<TASK_SLUG>` is in `<status>` state, not `done` or `ready_to_publish`.
     Close anyway? (yes / no)
     ```
     - If user says no: stop.

### 2b. Check PR Status

1. Read `<TASK_DIR>/TASKS.md` → `## Branching → Dual PR` (default "no").
2. Read `## Branching → Setup Mode` (default "worktree").
3. From `## External Links`, extract:
   - Trunk PR URL (row labeled "PR main (<service-id>)", or the legacy "PR (<service-id>)")
   - Alpha PR URL (row labeled "PR alpha (<service-id>)", only present when Dual PR = yes)

For each affected service:

4. **Trunk PR** (required): `gh pr view <trunk-pr-url> --json state,mergedAt`. Must be in `MERGED` state. If not, present the same options as today (check different URL / skip PR check / abort).
5. **Alpha PR** (if DUAL_PR = yes): `gh pr view <alpha-pr-url> --json state,mergedAt`. **Not required to be merged.** Record its state for later teardown (Step 4).

Also check `<TASK_DIR>/CLICKUP_TASK.json` (if exists) for any additional PR references.

If NO PR information is found:
- Warn: "No PR found for this task. Closing without PR verification."
- Ask: "Provide a PR URL to verify, or close without PR check?"

**Store**: `DUAL_PR`, `SETUP_MODE`, `TRUNK_PR_URL`, `ALPHA_PR_URL`, `TRUNK_PR_STATUS`, `ALPHA_PR_STATUS` (if available)

---

## Step 3 — Perform Closure Actions

If all preconditions pass (or user overrides), proceed with closure.

> **Timestamp**: Before executing any closure action, generate the current UTC timestamp by running:
> ```bash
> date -u +"%Y-%m-%dT%H:%M:%SZ"
> ```
> Store the output as `CLOSE_TIMESTAMP`. Use this value everywhere a closure timestamp is needed below.

### 3a. Update ClickUp (if synced)

1. Check if `<TASK_DIR>/CLICKUP_TASK.json` exists.
2. If it exists:
   a. Read the file to get the ClickUp macro task ID, subtask IDs, and current state.
   b. Use `clickup_update_task` to set the macro task status to `closed`.
   c. For each subtask in CLICKUP_TASK.json: use `clickup_update_task` to set status to `closed`.
   d. Use `clickup_create_task_comment` on the macro task with closure details (PR URL, merge timestamp).
   e. Record the closure in `CLICKUP_TASK.json`:
      ```json
      {
        "closedAt": "<CLOSE_TIMESTAMP>",
        "closedBy": "jlu:close-task",
        "previousStatus": "<previous-status>"
      }
      ```
   f. If any ClickUp MCP call fails: report the error but continue with remaining closure steps.
3. If `CLICKUP_TASK.json` does not exist: skip with note "No ClickUp task associated."

### 3b. Update TASKS.md

Update `<TASK_DIR>/TASKS.md`:
- Status: `closed`
- Add closure timestamp: `- Closed: <CLOSE_TIMESTAMP>`
- Add PR reference (if verified): `- PR merged: <PR_URL> at <merge-timestamp>`
- Preserve all existing content (phase history, test results, etc.)

### 3c. Cleanup

For each affected service:

1. `cd <SERVICE_REPO_ROOT>` (main repo).

2. **Alpha PR teardown** (only when `DUAL_PR = yes` AND an alpha PR URL was recorded):
   - If alpha PR state was `OPEN` or `DRAFT`:
     ```bash
     gh pr close <alpha-pr-url> --delete-branch
     ```
     This closes the PR and deletes the remote `staging/<TASK_SLUG>` branch.
   - Else if alpha PR state was `CLOSED` or `MERGED`:
     - Check if remote `staging/<TASK_SLUG>` still exists:
       ```bash
       git ls-remote --heads origin staging/<TASK_SLUG>
       ```
     - If it exists, delete it:
       ```bash
       git push origin :staging/<TASK_SLUG> || true
       ```

3. **Local branch teardown**:
   - Delete local `staging/<TASK_SLUG>` if present:
     ```bash
     git branch -D staging/<TASK_SLUG> 2>/dev/null || true
     ```
   - Delete local `production/<TASK_SLUG>` (must be merged on trunk, which was verified in Step 2b):
     ```bash
     git branch -d production/<TASK_SLUG>
     ```
     If this fails because git thinks it's not merged (e.g., squash-merge on GitHub), fall back to:
     ```bash
     git branch -D production/<TASK_SLUG>
     ```
     Force-delete is acceptable here because the trunk PR merge was verified in Step 2b.

4. **Temp staging worktree teardown** (defensive — should already be gone):
   ```bash
   git worktree remove --force .worktrees/<TASK_SLUG>-staging-tmp 2>/dev/null || true
   ```

5. **Primary worktree teardown** (only when `Mode: worktree`):
   ```bash
   # Tear down Docker first if this is a Docker-enabled service
   cd .worktrees/<TASK_SLUG> && docker compose down -v --rmi all --remove-orphans 2>/dev/null || true
   cd <SERVICE_REPO_ROOT>
   git worktree remove .worktrees/<TASK_SLUG> || git worktree remove --force .worktrees/<TASK_SLUG>
   ```

6. Record cleanup summary per service for the final report.

---

## Step 4 — Closure Report

Present the final summary:

```
## Task Closed — <TASK_SLUG>

### Status
- Previous: <previous-status>
- Current: closed
- Closed at: <timestamp>

### PR
- URL: <PR_URL>
- State: merged
- Merged at: <merge-timestamp>

### ClickUp
- <Updated to CLOSED / Not configured / No task associated>

### Docker Cleanup
- <service-id-1>: containers stopped, volumes removed, images removed
- <service-id-2>: no Docker
- ...

### Worktree Cleanup
- <service-id-1>: removed / skipped / not found
- <service-id-2>: removed / skipped / not found

### Branch Cleanup
- production/<TASK_SLUG>: deleted / kept / not found
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No task found | Stop with message |
| Task already closed | Stop with message |
| Task not in closeable state | Warn, ask user to confirm override |
| PR not merged | Present options (different URL, skip check, abort) |
| PR check command fails (gh not installed) | Warn, offer to skip PR check |
| ClickUp update fails | Report error, continue with rest of closure |
| Worktree removal fails | Report error, skip that worktree, continue |
| Branch deletion fails | Report error, skip, continue |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| TASKS.md (updated) | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| CLICKUP_TASK.json (updated) | `.spec-workspace/specs/<date>/<task-slug>/CLICKUP_TASK.json` |
| Worktrees (removed) | `<service-repo>/.worktrees/<task-slug>` |
| Branch (deleted) | `production/<task-slug>` |
