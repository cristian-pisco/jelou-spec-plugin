# Workflow: report-task

> Orchestrator workflow for `/jlu-report-task [task-slug]`
> Executive summary with progress, blockers, and stale worktree detection.

---

You are the orchestrator for the `/jlu-report-task` command.

## Step 0 — Open workflow span

> **Tracing tolerance**: When `TRACE_DISABLED=1`, captured ids are empty strings — the workflow continues regardless.

Run:
```bash
WF_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name report_task --scope task --task "$TASK_SLUG")
WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
```

---

## Step 1 — Resolve Task

1. If a task slug is provided as an argument, use it.
2. Otherwise, find the most recent task in `.spec-workspace/specs/` by reading `.spec-workspace.json` to locate the workspace.

## Step 2 — Gather Task Artifacts

1. Read the following files from the task's spec folder (`<workspace>/specs/<date>/<task-slug>/`):
   - `TASKS.md` — current execution status, lifecycle state, testing status
   - `SPEC.md` — task title and problem statement
   - `PROPOSAL.md` — planned phases, affected services, dependency order
   - `CLICKUP_TASK.json` — external links and sync state (if exists)

## Step 3 — Gather Phase Status

1. For each affected service, read the phase files from `services/<service-id>/phases/`.
2. Extract the status of each phase: pending, in_progress, done, blocked.
3. Check user stories in `uh/` for completion status.

## Step 4 — Detect Stale Worktrees

1. Scan service repos for `/.worktrees/` directories.
2. Cross-reference with task states — worktrees for tasks in `done` or `closed` state are stale.
3. If stale worktrees are found, include a cleanup prompt in the report (Decision #17).

### Stale Temp Staging Worktrees

For each registered service repo, check for temp staging worktrees older than 1 hour:

```bash
find <SERVICE_REPO_ROOT>/.worktrees -maxdepth 1 -type d -name '*-staging-tmp' -mmin +60
```

For each match, report as a leaked worktree:

> Leaked temp staging worktree: `<path>` (older than 1 hour). Likely left behind by a crashed `/jlu-create-pr`. Remove with:
> ```bash
> git -C <service-repo> worktree remove --force <path>
> ```

### Stale Branch-Mode Branches

For tasks in `done` or `closed` state with `Mode: branch`, check for local `production/<TASK_SLUG>` branches still present in service repos:

```bash
git -C <service-repo> rev-parse --verify production/<TASK_SLUG> 2>/dev/null
```

If present, report as a candidate for cleanup (not auto-removed).

## Step 5 — Consolidate Observability

1. Read observability logs from `/specs/observability/` in each affected service repo.
2. Identify recent events, blockers, and notable activity.

## Step 6 — Present Dashboard Summary

Present an executive summary in dashboard style (default verbosity — Decision #12):

```
## Task: <task-title>
**State**: <lifecycle-state> | **Services**: <count> affected

### Progress
| Service | Phase | Status | Tests |
|---------|-------|--------|-------|
| ...     | ...   | ...    | ...   |

### Blockers
- <blocker descriptions, if any>

### Recent Activity
- <recent events from observability>

### Stale Worktrees (if any)
- <repo>: /.worktrees/<task-slug> — task is <state>, consider cleanup

### External Links
- ClickUp: <url>
- PR: <url>
```

If the user requests detailed mode, include code highlights, test results, and agent reasoning from phase execution sections.

---

## Step N — Close workflow span

Determine `$WORKFLOW_OUTCOME`:
- `ok` — report generated
- `blocked` — workflow halted (missing context, user aborted)
- `failed` — irrecoverable error

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```
