# Workflow: load-context (OpenCode)

> Orchestrator workflow for `/jlu-load-context [task-slug]`
> OpenCode-only variant with global-first + workspace discovery hardening.

---

You are the orchestrator for the `/jlu-load-context` command.

Your job is to reconstruct task context from on-disk artifacts so the user can ask questions about the task in a fresh session. This is read-only: never modify files.

## Runtime contract

- Use `question` for every required user prompt.
- Use `task` for subagent dispatches.
- Always reference commands with the `jlu-` prefix.

## Step 1 — Detect Task Slug

Resolve task slug in this order:

1. If command argument exists, use it directly.
2. Read current branch via `git rev-parse --abbrev-ref HEAD`.
   - If branch matches `production/<task-slug>`, extract `<task-slug>`.
3. If current path contains `/.worktrees/<task-slug>/`, extract `<task-slug>`.
4. If still unknown, leave it unset for Step 3 fallback.

## Step 2 — Resolve Workspace Path (hardened)

Use a discovery process that avoids speculative file reads.

1. Build ordered ancestor list from current directory, nearest first, up to 5 levels.
2. Discovery rule:
   - Use `glob` first to discover existing files/directories.
   - Never call `read` on paths that were not discovered by `glob`.
   - Never probe filesystem root (`/`) for workspace markers.
3. Check each ancestor in order and stop at the first valid workspace:
   - Candidate A: `<ancestor>/.spec-workspace.json`
     - If present, read it.
     - Resolve `workspace` to absolute path using the JSON file directory as base.
     - Validate with `glob` that `<WORKSPACE_PATH>/specs/*/*/TASKS.md` exists.
     - Compatibility fallback: if that fails, test `<WORKSPACE_PATH>/.spec-workspace/specs/*/*/TASKS.md` and set `WORKSPACE_PATH = <WORKSPACE_PATH>/.spec-workspace` when valid.
   - Candidate B: `<ancestor>/.spec-workspace/specs/*/*/TASKS.md`
     - If present, set `WORKSPACE_PATH = <ancestor>/.spec-workspace`.
4. If no candidate is valid, stop with:
   - `No workspace found. Expected .spec-workspace.json or a parent .spec-workspace/specs/ directory.`

## Step 3 — Resolve Task Directory

Given `WORKSPACE_PATH`, resolve `TASK_DIR`.

1. If task slug is known, discover marker files in this order:
   - `<WORKSPACE_PATH>/specs/*/<task-slug>/TASKS.md`
   - `<WORKSPACE_PATH>/specs/*/<task-slug>/SPEC.md`
   - `<WORKSPACE_PATH>/specs/*/<task-slug>/PROPOSAL.md`
2. If multiple dates match the same slug:
   - Prefer the most recently modified marker.
   - If ambiguity remains, use `question` to ask the user which date folder to load.
3. If task slug is unknown:
   - Discover `<WORKSPACE_PATH>/specs/*/*/TASKS.md`.
   - If none exist, stop with clear error.
   - Pick the most recently modified one.
   - If several are near-equivalent and ambiguous, ask with `question`.
4. Set `TASK_DIR = dirname(<selected-marker>)`.

If `TASK_DIR` cannot be resolved, stop with a clear error.

## Step 4 — Load Core Artifacts

Read these files from `TASK_DIR`:

1. `TASKS.md`
2. `SPEC.md`
3. `PROPOSAL.md`

For `PROPOSAL.md`, if very large, surface:
- Summary
- Affected Services
- Phase names/objectives
- Risks
- User stories table

And include path to full file.

## Step 5 — Git Context

Run:

1. `git log --oneline -20`
2. `git diff --stat main...HEAD`

If current branch is not task branch and task slug is known, also attempt `production/<task-slug>` for branch-specific log context.

## Step 6 — Artifact Inventory

Collect and list paths grouped by category.

Core artifacts in `TASK_DIR`:
- `SPEC.md`, `TASKS.md`, `PROPOSAL.md`, `CLICKUP_TASK.json`
- `stories/*.story.md`

Per-service artifacts under `TASK_DIR/services/<service-id>/`:
- `phases/*.md`

Do **not** list or read anything under `<WORKSPACE_PATH>/services/<service-id>/codebase/`.
Those documents are written for humans; grep the service source instead.

## Step 7 — Derive Status Summary

From `TASKS.md`, compute:

1. Lifecycle `Status`.
2. Active blockers (non-resolved).
3. If implementing: completed phases and recovery info (`next phase`, `last completed phase`).
4. If `ready_to_publish`: whether PR URL exists.
5. Recommended next command:
   - `draft` / `refining` -> `/jlu-new-task`
   - `planned` -> `/jlu-execute-task`
   - `implementing` / `validating` -> `/jlu-execute-task`
   - `ready_to_publish` -> `/jlu-ship`
   - `done` -> await merge
   - `closed` -> no action
6. If blockers exist, override recommendation with blocker resolution first.

## Step 8 — Resolve Worktree Map

1. Read `<WORKSPACE_PATH>/registry/services.yaml`.
2. Determine affected services from `TASKS.md` metadata/services section; fallback to `SPEC.md` or `PROPOSAL.md`.
3. For each affected service:
   - Resolve repo path from `services.yaml`.
   - If `<repo>/.worktrees/<task-slug>/` exists, use that as source path.
   - Else use main repo path and flag warning.

## Step 9 — Present Context Block

Present:

1. Task title, branch, date.
2. Active Worktrees table (service, source path, type).
3. Loaded artifacts (SPEC/TASKS/PROPOSAL content or summary).
4. Git activity + change scope.
5. Artifact inventory with file paths.
6. Status summary + recommended next command.

Then print a compact task summary inline (no subagent — you already have TASKS.md, git data, and the status/next-command from the steps above):

```
## Task Summary — <slug>

Status: <lifecycle-state> — <human-label>

### Summary
- Phases: <done>/<total>
- Tests: <unit> unit, <integration> integration, <e2e> e2e (omit types with 0)
- Commits: <count> on <branch> · Files: <count> · Lines: +<added> / -<removed>

### Next Steps
- <recommended next command from the status → command mapping>
```

Never fabricate a number — pull each from TASKS.md or git, or show `—`. The `/jlu:*` vocabulary is closed: any command you name in Next Steps must actually ship in this plugin. Deploy-time or outward-facing work that no plugin command performs is a plain-prose manual/ops step, never a `/jlu:*` command.

Close with:

> Context loaded. You can ask me anything about this task. When making changes, I'll use the worktree source paths shown above.
