# Workflow: close-task

> Orchestrator workflow for `/jlu-close-task [task-slug]`
> Performs post-production closure: ClickUp update, artifact finalization, worktree cleanup.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

## Step 0 — Trace gate, then open workflow span

**Resolve `TRACING_ON` exactly once, here.** See `jelou/references/tracing.md`.

- `TRACING_ON = true` **only** when the env var `JLU_TRACE=1`.
- `TRACE_DISABLED=1` forces `TRACING_ON = false`, whatever `JLU_TRACE` says (back-compat hard kill).
- Default, with neither set: **false**. Tracing is OFF for normal runs; the `jlu-bench` evaluation harness is what turns it on.

**When `TRACING_ON = false`, emit no trace Bash call at all** — not `trace-start-span`, not `trace-feedback` (Step 2b), not `trace-snapshot-task` (Step 3.5), not `trace-end-span`. `WORKFLOW_SPAN_ID` and `WORKFLOW_TRACE_ID` stay unset and every trace-dependent step is skipped outright. The cost being avoided is the Bash call itself — the process spawn plus the agent-turn roundtrip — which is paid even when the script short-circuits internally, so the gate lives here and never inside the script.

**When `TRACING_ON = true`**, run:
```bash
WF_OUT=$(node "<root>/bin/trace-start-span.mjs" \
  --name close_task --scope task --task "$TASK_SLUG")
WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
```

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
3. From the same read, also extract and cache for Step 2b:
   - Dual PR (`## Branching → Dual PR`, default "no")
   - Setup mode (`## Branching → Mode`, default "worktree")
   - External link PR URLs:
     - Trunk PR URL (row labeled "PR main (<service-id>)", or the legacy "PR (<service-id>)")
     - Alpha PR URL (row labeled "PR alpha (<service-id>)", only present when Dual PR = yes)
4. Validate:
   - If status is `done` or `ready_to_publish`: proceed.
   - If status is `closed`: stop. "Task `<TASK_SLUG>` is already closed."
   - If status is anything else: warn and ask.
     ```
     Task `<TASK_SLUG>` is in `<status>` state, not `done` or `ready_to_publish`.
     Close anyway? (yes / no)
     ```
     - If user says no: stop.

### 2b. Check PR Status

1. Reuse the parsed TASKS metadata from Step 2a (do not re-read `TASKS.md`).
2. If any PR URL is still missing, also check `<TASK_DIR>/CLICKUP_TASK.json` (if exists) for additional PR references.

For each affected service:

3. **Trunk PR** (required): `gh pr view <trunk-pr-url> --json state,mergedAt`. Must be in `MERGED` state.
   - When `MERGED`: proceed. **Only when `TRACING_ON = true` (Step 0)**, also record the free accept ground-truth signal keyed by the ship span_id — the zero-cost accept/reject harvest that feeds the eval layer (Stage 2). With `TRACING_ON = false` this call is not emitted at all and closure proceeds unchanged. It stays best-effort: a non-zero exit or empty output never fails closure.
     ```bash
     node "<root>/bin/trace-feedback.mjs" --task "$TASK_SLUG" --signal accept --source pr_merge --note merged_clean
     ```
   - When `CLOSED` but not merged: **only when `TRACING_ON = true`**, record the reject signal (same best-effort rule — the other half of the free ground-truth harvest); then, regardless of `TRACING_ON`, present the same options as today (check different URL / skip PR check / abort):
     ```bash
     node "<root>/bin/trace-feedback.mjs" --task "$TASK_SLUG" --signal reject --source pr_close --note reverted
     ```
   - For any other non-merged state: present the same options as today (check different URL / skip PR check / abort).
4. **Alpha PR** (if DUAL_PR = yes): `gh pr view <alpha-pr-url> --json state,mergedAt`. **Not required to be merged.** Record its state for later teardown (Step 4).

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

### 3a. Update ClickUp

1. Check if `<TASK_DIR>/CLICKUP_TASK.json` exists.
2. **If it does NOT exist**: the task was never synced. Run the
   `/jlu-task-clickup` workflow inline against this task directory before
   continuing. This creates the macro + subtasks (mapped to ClickUp status
   per the Status Mapping in `task-clickup.md` Step 5) and writes
   `CLICKUP_TASK.json`. Do **not** skip with "No ClickUp task associated"
   — that path silently drops the closure comment when the user runs
   close-task on a never-synced task. After the inline sync completes,
   continue to step 3 below.
3. Read `CLICKUP_TASK.json` to get the ClickUp macro task ID, subtask
   IDs, and current state.
4. If the macro task is not already at status `closed` in ClickUp, use
   `clickup_update_task` to set the macro task status to `closed`. For
   each subtask in `CLICKUP_TASK.json` not already `closed`, do the same.
   (When step 2 just created the tasks, status may already be `closed`
   via the mapping; do not redundantly re-update.)
5. **Compose and post the closure comment** on the macro task. This step
   runs unconditionally — whether `CLICKUP_TASK.json` was pre-existing
   or just created in step 2. Read
   `<plugin-root>/jelou/templates/closure-comment.md` and follow it
   strictly. Source material:
   - `<TASK_DIR>/SPEC.md` (Problem Statement, FRs)
   - `<TASK_DIR>/PROPOSAL.md` (Strategy section)
   - `<TASK_DIR>/TASKS.md` (phase outcomes, deferred items for the
     optional follow-up paragraph)

   Hard rules (non-negotiable, the template enforces them too):
   - Language: **English**, always.
   - Style: natural prose, no Markdown formatting beyond paragraph
     breaks, no headers, no bullets, no code fences.
   - Structure: 1 paragraph summary (2–5 sentences) + optional 1
     paragraph future improvements (only when there's concrete
     evidence — never invented).
   - **Do NOT include**: PR URLs (already posted by `/jlu-task-clickup`
     Step 6), signature lines, ISO timestamps, test counts, phase
     counts, internal slugs / IDs / file paths / branch names, or
     service IDs in code form.

   Then post via `clickup_create_task_comment(task_id=<macro-id>,
   comment_text=<composed body>)`. Do not also post the PR list — that
   is `/jlu-task-clickup`'s responsibility and is already attached as a
   separate comment.
6. Record the closure in `CLICKUP_TASK.json`:
   ```json
   {
     "closedAt": "<CLOSE_TIMESTAMP>",
     "closedBy": "jlu:close-task",
     "previousStatus": "<previous-status>"
   }
   ```
7. If any ClickUp MCP call fails: report the error but continue with
   remaining closure steps. Failure of step 2's inline sync surfaces a
   warning but still proceeds to TASKS.md update — the local artifacts
   should reflect "closed" even when ClickUp is unreachable.

### 3b. Update TASKS.md

Update `<TASK_DIR>/TASKS.md`:
- Status: `closed`
- Add closure timestamp: `- Closed: <CLOSE_TIMESTAMP>`
- Add PR reference (if verified): `- PR merged: <PR_URL> at <merge-timestamp>`
- Preserve all existing content (phase history, test results, etc.)

### 3c. Cleanup

For each affected service:

1. `cd <SERVICE_REPO_ROOT>` (main repo).

2. **Staging branch teardown** (whenever `DUAL_PR = yes`). Because `/jlu-new-task` pushes `staging/<TASK_SLUG>` up front, the remote branch can exist even if `/jlu-ship` never ran and no alpha PR was recorded — so this runs regardless of whether an alpha PR URL was captured:
   - If an alpha PR URL was recorded AND its state was `OPEN` or `DRAFT`:
     ```bash
     gh pr close <alpha-pr-url> --delete-branch
     ```
     This closes the PR and deletes the remote `staging/<TASK_SLUG>` branch.
   - Otherwise (alpha PR `CLOSED`/`MERGED`, or no alpha PR was ever opened):
     - Check if remote `staging/<TASK_SLUG>` still exists:
       ```bash
       git ls-remote --heads origin staging/<TASK_SLUG>
       ```
     - If it exists, delete it:
       ```bash
       git push origin :staging/<TASK_SLUG> 2>/dev/null \
         || echo "Warning: could not delete remote staging/<TASK_SLUG> for <service-id> (check branch protection or permissions). Continuing."
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

5. **Primary worktree teardown** (only when `Mode: worktree`). Use absolute paths so each command is independent of shell cwd state:
   ```bash
   # Tear down Docker first if this is a Docker-enabled service
   docker compose --project-directory <SERVICE_REPO_ROOT>/.worktrees/<TASK_SLUG> down -v --rmi all --remove-orphans 2>/dev/null || true
   # Remove the worktree from the main repo context
   git -C <SERVICE_REPO_ROOT> worktree remove .worktrees/<TASK_SLUG> \
     || git -C <SERVICE_REPO_ROOT> worktree remove --force .worktrees/<TASK_SLUG>
   ```

6. Record cleanup summary per service for the final report.

---

## Step 3.5 — Snapshot task trace to TASK_DIR

Persist every span tagged with this task's `task_slug` to `<TASK_DIR>/_traces/snapshot.jsonl`. This preserves the task's full trace history even after workspace `spans.jsonl` rotates.

Skip this entire step when `TRACING_ON = false` (Step 0) — with tracing off there are no spans to snapshot, so the call is never emitted.

Best-effort — closure proceeds whether or not this succeeds:

```bash
node "<root>/bin/trace-snapshot-task.mjs" \
  --task "$TASK_SLUG" \
  --out "$TASK_DIR/_traces/snapshot.jsonl" || true
```

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
- staging/<TASK_SLUG>: deleted locally and remotely / local only / remote only / not applicable (DUAL_PR = no)
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
| Trace snapshot | `.spec-workspace/specs/<date>/<task-slug>/_traces/snapshot.jsonl` |

---

## Step N — Close workflow span

Skip this entire step when `TRACING_ON = false` (Step 0).

Determine `$WORKFLOW_OUTCOME`:
- `ok` — closure complete (ClickUp + Slack updated, task status moved)
- `blocked` — closure halted (missing PR merge confirmation, ClickUp sync failure)
- `failed` — irrecoverable error

Run:
```bash
node "<root>/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```
