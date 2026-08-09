# Worktree Resolution

> Resolves the correct source path (worktree or main repo) for each affected service in a task. Used by any workflow or skill that needs to read or modify service code in the context of a task.

## Precondition: `.worktrees/` Must Be Git-Ignored (auto-fixed)

Before any `git worktree add` runs (in `/jlu-new-task` and downstream), the service repo's `.worktrees/` directory must be ignored, or worktree contents pollute the repo's tracked state and may be staged by accident.

`/jlu-new-task` still runs the `git check-ignore -q .worktrees` pre-flight in **worktree mode only** (branch mode creates no worktree, so the gate does not apply). It is no longer an abort:

1. Exit 0 → already ignored, nothing to do.
2. Non-zero → the workflow records that a fix is needed and **continues**.
3. The worktree is created as usual: `git worktree add .worktrees/<TASK_SLUG> -b production/<TASK_SLUG> origin/$TRUNK`.
4. Then, **inside the worktree** (where `production/<TASK_SLUG>` is checked out), `.worktrees/` is appended to `.gitignore`, staged, and committed:

   ```bash
   cd <repo>/.worktrees/<TASK_SLUG>
   grep -qE '^\.worktrees/?$' .gitignore 2>/dev/null || printf '.worktrees/\n' >> .gitignore
   git add .gitignore
   git commit -m "chore: git-ignore .worktrees/"
   ```

   `.gitignore` is created if absent. The `grep` guard prevents a duplicate entry when an equivalent pattern (`.worktrees` or `.worktrees/`) is already present but was not matched by `check-ignore` — for example because it lives in a not-yet-committed working copy. If after the guard there is nothing to commit, skip the commit silently.

This reversal exists because the old abort was fatal in headless/autonomous runs: the service ended up with no `production/<slug>` branch, and `finalize-phase.sh` then aborted every phase with `reason=wrong_branch` with nobody to escalate to.

### Known limitation

The fix commit lands on the **task branch**, not on trunk. Until that PR merges, the service's trunk still does not ignore `.worktrees/`, so the main checkout keeps showing `.worktrees/` as untracked. This is the accepted trade-off of not writing to a service's trunk. The scope-check in `finalize-phase.sh` runs inside the worktree with the task branch checked out, so it is unaffected.

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

During `/jlu-ship` dual-PR synthesis, a temporary worktree is created at:

```
<service-repo>/.worktrees/<TASK_SLUG>-staging-tmp
```

This worktree is **never** used for regular reads or edits. It exists only for the duration of the cherry-pick operation and is removed before `/jlu-ship` returns. If a later run detects one older than 1 hour, treat it as leaked state from a crashed run.

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
