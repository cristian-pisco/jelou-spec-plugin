# Worktree Awareness for Multi-Project Tasks

## Problem

When a task spans multiple projects (e.g., backend + frontend), the automated execution phase (execute-task Step 7c) correctly resolves worktree paths per service. However, after execution completes and the user enters a free-form session via `/jlu:load-context`, Claude has no awareness of worktree paths. If the user reports an error in a different service, Claude navigates to the main repo instead of the task worktree, causing changes to land in the wrong directory.

The user must manually tell Claude to revert the changes and apply them to the correct worktree — a frustrating and error-prone experience.

## Solution: Reusable Worktree Resolution Block

Extract the worktree resolution logic into a shared reference and integrate it into load-context (and any future workflow that needs worktree awareness).

## Design

### 1. New Reference: `jelou/references/worktree-resolution.md`

A reusable block that defines:

**Resolution algorithm:**

1. Read `services.yaml` to get all affected services and their repo paths.
2. For each service, resolve the absolute repo path from the workspace root.
3. Check if `<service-repo>/.worktrees/<TASK_SLUG>/` exists.
4. If yes: use the worktree as `SERVICE_SOURCE_PATH`.
5. If no: fall back to `<service-repo>/` and flag it as "main repo (no worktree)".

**Output format — Worktree Map:**

```
### Active Worktrees

| Service | Source Path | Type |
|---------|------------|------|
| jelou-apps | /home/.../jelou-apps/.worktrees/my-task/ | worktree |
| workflow-engine-service | /home/.../workflow-engine-service/.worktrees/my-task/ | worktree |
| workflows-service | /home/.../workflows-service/ | main repo (no worktree) |
```

**Directive instruction:**

> **IMPORTANT**: When reading or modifying files for any affected service, you MUST use the Source Path from the Worktree Map above — never the main repository path. This ensures changes land in the correct task-isolated directory.

### 2. Integration into load-context

**New step between current Steps 6 and 7 — "Resolve Worktree Map":**

1. Read `services.yaml` from the workspace registry.
2. Extract the affected services list from TASKS.md (already loaded in Step 3).
3. Apply the worktree resolution algorithm from `references/worktree-resolution.md` using the task slug detected in Step 1.
4. Store the resolved map for use in Step 7.

**Modification to Step 7 — Present Context Block:**

Insert the Worktree Map (table + directive) as a prominent section in the context output, right after the task header and before artifact listings.

**Modification to Step 8 closing message:**

Current: "Context loaded. You can ask me anything about this task."

Updated: "Context loaded. You can ask me anything about this task. When making changes, I'll use the worktree paths shown above."

### 3. Refactor execute-task Step 7c

Replace the inline worktree resolution logic with a reference to `worktree-resolution.md`. The step becomes:

> 1. Apply the worktree resolution algorithm from `references/worktree-resolution.md` for the current service.
> 2. Docker context resolution — *(unchanged, stays inline since it's execute-task-specific)*

The Docker context logic remains in execute-task because it's specific to phase execution.

## Files Changed

| File | Change |
|------|--------|
| `jelou/references/worktree-resolution.md` | New — reusable resolution algorithm, output format, and directive |
| `skills/load-context/SKILL.md` | Add worktree resolution step; update context block and closing message |
| `jelou/workflows/execute-task.md` | Replace inline resolution in Step 7c with reference to shared block |

## Scope Boundaries

- This design does NOT change how worktrees are created (new-task) or destroyed (close-task).
- This design does NOT persist worktree paths in TASKS.md — resolution is always live (check filesystem).
- Docker context resolution stays in execute-task only; load-context does not need it.
