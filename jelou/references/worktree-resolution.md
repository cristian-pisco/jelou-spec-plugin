# Worktree Resolution

> Resolves the correct source path (worktree or main repo) for each affected service in a task. Used by any workflow or skill that needs to read or modify service code in the context of a task.

## Resolution Algorithm

For each affected service:

1. Look up the service entry in `<WORKSPACE_PATH>/registry/services.yaml`.
2. Resolve the absolute repo path: `<WORKSPACE_PATH>/` + `service.path`.
3. Check if the task worktree exists: `<service-repo>/.worktrees/<TASK_SLUG>/`
4. If the worktree directory exists → `SERVICE_SOURCE_PATH` = the worktree path.
5. If the worktree does not exist → `SERVICE_SOURCE_PATH` = the service repo root. Log a warning: "No worktree found for `<service-id>` — using main repo."

If TASKS.md lists a service that is not in `services.yaml`, skip it with a warning: "Service `<service-id>` not found in registry — skipping worktree resolution."

## Output: Worktree Map

Present the resolved paths as a table:

### Active Worktrees

| Service | Source Path | Type |
|---------|------------|------|
| `<service-id>` | `<resolved-absolute-path>` | worktree |
| `<service-id>` | `<resolved-absolute-path>` | main repo (no worktree) |

## Directive

After presenting the Worktree Map, include this instruction:

> **IMPORTANT**: When reading or modifying files for any affected service, you MUST use the Source Path from the Worktree Map above — never the main repository path. This ensures changes land in the correct task-isolated directory.
