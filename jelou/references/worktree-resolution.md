# Worktree Resolution

> Resolves the correct source path (worktree or main repo) for each affected service in a task. Used by any workflow or skill that needs to read or modify service code in the context of a task.

## Resolution Algorithm

For each affected service:

1. Look up the service entry in `<WORKSPACE_PATH>/registry/services.yaml`.
2. Resolve the absolute repo path: `<WORKSPACE_PATH>/` + `service.path`.
3. Read the task's `TASKS.md` → `## Branching → Mode`:
   a. If `Mode: worktree`: the primary working directory is `<service-repo>/.worktrees/<TASK_SLUG>/`. Verify it exists — if missing, fall back to the main repo and log a warning: "Worktree missing for `<service-id>` despite `Mode: worktree` — using main repo."
   b. If `Mode: branch`: the primary working directory is the service repo root.
   c. If the `## Branching` section is absent: this is a legacy fallback for tasks created before the branch-mode upgrade (pre-existing `spec/<slug>` tasks). New tasks should never reach this branch. Check if `<service-repo>/.worktrees/<TASK_SLUG>/` exists. If yes, use it; if no, use the repo root. Log a warning: *"TASKS.md has no ## Branching section for `<service-id>` — assuming legacy spec/<slug> task. Verify task creation date and confirm this is expected."*
4. If TASKS.md lists a service that is not in `services.yaml`, skip it with a warning: "Service `<service-id>` not found in registry — skipping worktree resolution."

## Temporary Staging Worktree

During `/jlu-create-pr` dual-PR synthesis, a temporary worktree is created at:

```
<service-repo>/.worktrees/<TASK_SLUG>-staging-tmp
```

This worktree is **never** used for regular reads or edits. It exists only for the duration of the cherry-pick operation and is removed before `/jlu-create-pr` returns. If `/jlu-report-task` detects one older than 1 hour, treat it as leaked state from a crashed run.

## Output: Worktree Map

Present the resolved paths as a table:

### Active Worktrees

| Service | Source Path | Type |
|---------|------------|------|
| `<service-id>` | `<resolved-absolute-path>` | worktree (Mode: worktree) |
| `<service-id>` | `<resolved-absolute-path>` | main repo (Mode: branch) |
| `<service-id>` | `<resolved-absolute-path>` | main repo (fallback — worktree missing) |

## Directive

After presenting the Worktree Map, include this instruction:

> **IMPORTANT**: When reading or modifying files for any affected service, you MUST use the Source Path from the Worktree Map above — never the main repository path unless Mode: branch explicitly resolves there. This ensures changes land in the correct task-isolated directory.
