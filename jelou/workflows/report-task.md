# Workflow: report-task

> Orchestrator workflow for `/jlu-report-task [task-slug]`
> Executive summary with progress, blockers, and stale worktree detection.

---

You are the orchestrator for the `/jlu-report-task` command.

## Step 0 — Trace gate (the workflow span opens at the end of Step 1, once `TASK_SLUG` exists)

**Resolve `TRACING_ON` exactly once, here.** See `jelou/references/tracing.md`.

- `TRACING_ON = true` **only** when the env var `JLU_TRACE=1`.
- `TRACE_DISABLED=1` forces `TRACING_ON = false`, whatever `JLU_TRACE` says (back-compat hard kill).
- Default, with neither set: **false**. Tracing is OFF for normal runs; the `jlu-bench` evaluation harness is what turns it on.

**When `TRACING_ON = false`, emit no trace Bash call at all** — not `trace-start-span`, not `trace-end-span`. `WORKFLOW_SPAN_ID` and `WORKFLOW_TRACE_ID` stay unset and "Step N — Close workflow span" is skipped outright. The cost being avoided is the Bash call itself — the process spawn plus the agent-turn roundtrip — which is paid even when the script short-circuits internally, so the gate lives here and never inside the script.

**When `TRACING_ON = true`**, do NOT open the span here — `TASK_SLUG` does not exist yet, and a span opened now would carry an empty `--task`. Run Step 1 first to resolve the slug, then open the span as described at the end of Step 1.

---

## Step 1 — Resolve Task

1. If a task slug is provided as an argument, use it.
2. Otherwise, find the most recent task in `.spec-workspace/specs/` by reading `.spec-workspace.json` to locate the workspace.

**Store**: `TASK_SLUG`

Then, and only when `TRACING_ON = true` (Step 0), open the workflow span with the resolved slug:
```bash
WF_OUT=$(node "<root>/bin/trace-start-span.mjs" \
  --name report_task --scope task --task "$TASK_SLUG")
WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
```

## Step 2 — Gather Task Artifacts

1. Read the following files from the task's spec folder (`<workspace>/specs/<date>/<task-slug>/`):
   - `TASKS.md` — current execution status, lifecycle state, testing status
   - `SPEC.md` — task title and problem statement
   - `PROPOSAL.md` — planned phases, affected services, dependency order
   - `CLICKUP_TASK.json` — external links and sync state (if exists)

## Step 3 — Gather Phase Status

1. For each affected service, read the phase files from `services/<service-id>/phases/`.
2. Extract the status of each phase: pending, in_progress, done, blocked.
3. Check user stories in `<TASK_DIR>/stories/*.story.md` for completion status.

## Step 4 — Detect Stale Worktrees

1. Scan service repos for `/.worktrees/` directories.
2. Cross-reference with task states — worktrees for tasks in `done` or `closed` state are stale.
3. If stale worktrees are found, include a cleanup prompt in the report.

### Stale Temp Staging Worktrees

For each registered service repo, check for temp staging worktrees older than 1 hour:

```bash
find <SERVICE_REPO_ROOT>/.worktrees -maxdepth 1 -type d -name '*-staging-tmp' -mmin +60
```

For each match, report as a leaked worktree:

> Leaked temp staging worktree: `<path>` (older than 1 hour). Likely left behind by a crashed `/jlu-ship`. Remove with:
> ```bash
> git -C <service-repo> worktree remove --force <path>
> ```

### Stale Branch-Mode Branches

For tasks in `done` or `closed` state with `Mode: branch`, check for leftover local `production/<TASK_SLUG>` and `staging/<TASK_SLUG>` branches still present in service repos:

```bash
git -C <service-repo> rev-parse --verify production/<TASK_SLUG> 2>/dev/null
git -C <service-repo> rev-parse --verify staging/<TASK_SLUG> 2>/dev/null
```

If either is present, report it as a candidate for cleanup (not auto-removed). The `staging/<TASK_SLUG>` branch may linger for dual-PR tasks created but never carried through `/jlu-ship` / `/jlu-close-task`.

## Step 5 — Consolidate Observability

1. Read observability logs from `/specs/observability/` in each affected service repo.
2. Identify recent events, blockers, and notable activity.

## Step 6 — Present Dashboard Summary

Present an executive summary in dashboard style (default verbosity):

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

Skip this entire step when `TRACING_ON = false` (Step 0).

Determine `$WORKFLOW_OUTCOME`:
- `ok` — report generated
- `blocked` — workflow halted (missing context, user aborted)
- `failed` — irrecoverable error

Run:
```bash
node "<root>/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```
