# Workflow: close-task

> Orchestrator workflow for `/jlu:close-task [task-slug]`
> Performs post-production closure: ClickUp update, artifact finalization, worktree cleanup.

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

1. Look for PR information in TASKS.md (the "External Links" section).
2. Also check `<TASK_DIR>/CLICKUP_TASK.json` (if exists) for PR references.
3. If a PR URL or ID is recorded:
   a. Check the PR status using `gh pr view <url> --json state,mergedAt` (via Bash).
   b. The PR must be in `MERGED` state.
   c. If the PR is NOT merged:
      ```
      PR <url> is in `<state>` state, not `merged`.

      Options:
      1. Check a different PR URL
      2. Skip PR check and close anyway
      3. Abort closure
      ```
4. If NO PR information is found:
   - Warn: "No PR found for this task. Closing without PR verification."
   - Ask: "Provide a PR URL to verify, or close without PR check?"

**Store**: `PR_STATUS`, `PR_URL` (if available)

---

## Step 3 — Perform Closure Actions

If all preconditions pass (or user overrides), proceed with closure.

### 3a. Update ClickUp (if configured)

1. Check if `<TASK_DIR>/CLICKUP_TASK.json` exists.
2. If it exists:
   a. Read the file to get the ClickUp task ID and current state.
   b. Check if ClickUp integration is configured (look for `~/.spec-plugin/clickup.json`).
   c. If configured:
      - Update the ClickUp macro task status from current state to `CLOSED`.
      - Update any subtask statuses to `CLOSED`.
      - Record the closure in `CLICKUP_TASK.json`:
        ```json
        {
          "closedAt": "<ISO-timestamp>",
          "closedBy": "jlu:close-task",
          "previousStatus": "<previous-status>"
        }
        ```
   d. If ClickUp is NOT configured: skip with note "ClickUp not configured, skipping sync."
3. If `CLICKUP_TASK.json` does not exist: skip with note "No ClickUp task associated."

### 3b. Update TASKS.md

Update `<TASK_DIR>/TASKS.md`:
- Status: `closed`
- Add closure timestamp: `- Closed: <current-datetime-ISO>`
- Add PR reference (if verified): `- PR merged: <PR_URL> at <merge-timestamp>`
- Preserve all existing content (phase history, test results, etc.)

### 3c. Register Observability Event

For each affected service:
1. Determine the service repo path from `<WORKSPACE_PATH>/registry/services.yaml`.
2. Create or append to `<service-repo>/specs/observability/events.jsonl`:
   ```json
   {
     "timestamp": "<ISO-timestamp>",
     "event": "task_closed",
     "task": "<TASK_SLUG>",
     "service": "<service-id>",
     "inputs": {
       "pr_url": "<PR_URL>",
       "pr_state": "merged"
     },
     "decision": "close_task",
     "outputs": {
       "clickup_updated": true|false,
       "worktrees_cleaned": true|false
     }
   }
   ```
3. Ensure the `specs/observability/` directory exists before writing.

### 3d. Clean Up Worktrees

1. For each affected service:
   a. Look up the service repo path from `services.yaml`.
   b. Check if `<service-repo>/.worktrees/<TASK_SLUG>` exists.
   c. If it exists, collect it for cleanup.
2. If any worktrees are found:
   ```
   Worktrees found for this task:
   - <service-id-1>: <service-repo-1>/.worktrees/<TASK_SLUG>
   - <service-id-2>: <service-repo-2>/.worktrees/<TASK_SLUG>

   Remove these worktrees? (yes / no / select individually)
   ```
   - If "yes": for each worktree:
     ```bash
     cd <service-repo> && git worktree remove .worktrees/<TASK_SLUG>
     ```
     If removal fails (e.g., uncommitted changes), report the error and skip that worktree.
   - If "select individually": present each one and ask.
   - If "no": leave worktrees in place, note them in the report.
3. Optionally delete the task branch if it has been fully merged:
   ```bash
   git branch -d spec/<TASK_SLUG>
   ```
   Only offer this if the branch is fully merged. Never force-delete.

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

### Observability
- Events registered in: <list of service repos>

### Worktree Cleanup
- <service-id-1>: removed / skipped / not found
- <service-id-2>: removed / skipped / not found

### Branch Cleanup
- spec/<TASK_SLUG>: deleted / kept / not found
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
| Observability directory creation fails | Report error, continue |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| TASKS.md (updated) | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| CLICKUP_TASK.json (updated) | `.spec-workspace/specs/<date>/<task-slug>/CLICKUP_TASK.json` |
| Observability events | `<service-repo>/specs/observability/events.jsonl` |
| Worktrees (removed) | `<service-repo>/.worktrees/<task-slug>` |
| Branch (deleted) | `spec/<task-slug>` |
