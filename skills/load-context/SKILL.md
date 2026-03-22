---
name: Load Context
description: Load completed or in-progress task context into a fresh session for Q&A
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
model: opus
---

You are the orchestrator for the `/jlu:load-context` command.

Your job is to reconstruct task context from on-disk artifacts so the user can ask questions about the task in a fresh session. This is read-only — you never modify any files.

## Step 1 — Detect Task from Environment

Use worktree-first detection:

1. Check current git branch: `git rev-parse --abbrev-ref HEAD`
   - If it matches `spec/<task-slug>`, extract the task slug.
2. Check current directory path for `/.worktrees/<task-slug>/` pattern — extract the slug from the path.
3. If an argument was provided to the command, use it as the task slug (overrides auto-detection).
4. **Fallback**: Read `.spec-workspace.json` in the current directory (or up to 5 parent directories) to find the workspace path, then scan `<workspace>/specs/` for the most recent task directory. If multiple tasks exist, list them and ask the user to pick one.

## Step 2 — Resolve Task Directory

1. Locate `.spec-workspace.json` — search from the current directory upward (up to 5 levels). If in a worktree, the workspace pointer may be in a parent directory of the worktree root.
2. Read `.spec-workspace.json` to get the `workspace` path.
3. Resolve the full task directory: `<workspace>/specs/<date>/<task-slug>/`
   - If the date folder is unknown, glob for `<workspace>/specs/*/<task-slug>/` to find it.

If the task directory cannot be found, report the error clearly and stop.

## Step 3 — Load Tier 1 Context

Read these core artifacts in full:

1. **TASKS.md** — execution status, lifecycle state, phase progress, test results, timeline.
2. **SPEC.md** — requirements, problem statement, acceptance criteria.
3. **PROPOSAL.md** — read the full file. If it exceeds 200 lines, present only:
   - Summary section
   - Affected Services section
   - Phase names and objectives (not full phase details)
   - Risks section
   - User Stories table
   - Note that the full proposal is available and provide the path.

## Step 4 — Git Context

Run these commands on the task branch:

1. `git log --oneline -20` — recent commit history on the branch.
2. `git diff --stat main...HEAD` — scope of changes vs main (use `main` or the appropriate base branch).

If the current branch is not the task branch, try `spec/<task-slug>` as the branch name for the git log.

## Step 5 — Artifact Inventory

Glob for all task artifacts and organize them by category. Use the task directory as the root.

**Core artifacts:**
- `SPEC.md`, `TASKS.md`, `PROPOSAL.md`, `CLICKUP_TASK.json`

**Per-service artifacts** (under `services/<service-id>/`):
- `CONTEXT.md` — service-specific context and integration points
- `phases/*.md` — phase execution files (Red/Green/Refactor details)
- `uh/*.md` — user story files

**Codebase knowledge** (under `<workspace>/services/<service-id>/codebase/`):
- `ARCHITECTURE.md`, `CONVENTIONS.md`, `STACK.md`, `STRUCTURE.md`, `INTEGRATIONS.md`, `CONCERNS.md`

List each file with its full path so the assistant (you) can read any of them on demand later.

## Step 6 — Derive Status Summary

Before presenting context, compute a compact status summary from the TASKS.md you loaded in Step 3.

1. **Extract lifecycle state** from the `Status` field in the Metadata section.
2. **Check for active blockers** in the Blockers section (any row where status is not `resolved`).
3. **If state is `implementing`**:
   - Count phases: `done` / total from the Phase Progress table.
   - Read the Recovery Info section: extract "Next phase" and "Last completed phase".
4. **If state is `ready_to_publish`**:
   - Check External Links: does a PR URL already exist? (exists = awaiting review, missing = need to run `/jlu:create-pr`)
5. **Map state → human label and recommended command**:

   | State | Human Label | Next Step Message |
   |-------|-------------|-------------------|
   | `draft` | Spec seed created — not yet refined | Run `/jlu:refine-spec` to expand the spec seed into a full specification. |
   | `refining` | Spec refinement in progress | Continue `/jlu:refine-spec` — spec interview is not yet complete. |
   | `planned` | Spec finalized — ready to implement | Run `/jlu:execute-task` to begin TDD implementation. |
   | `implementing` | TDD execution in progress | Run `/jlu:execute-task` to resume — next phase is `<recovery-info.next-phase>` (phase <N>/<total>). |
   | `validating` | All phases complete — QA running | Run `/jlu:execute-task` to complete QA, then `/jlu:create-pr` when all services pass. |
   | `ready_to_publish` | Implementation done — PR needed | Run `/jlu:create-pr` to open pull requests. *(If PR already exists: awaiting review — merge, then `/jlu:close-task`.)* |
   | `done` | PRs open — awaiting merge | PR is open. Await review and merge, then run `/jlu:close-task`. |
   | `closed` | Task finalized | No action needed. |

6. **If active blockers exist**, override the next step with: `Resolve blocker: <description>`

## Step 7 — Resolve Worktree Map

Resolve the correct source paths for all affected services so the assistant uses worktree paths (not main repo paths) when the user requests changes.

1. Read `<WORKSPACE_PATH>/registry/services.yaml`.
2. Extract the list of affected services from the TASKS.md loaded in Step 3 (the "Services" field in the Metadata section). If TASKS.md does not list affected services, extract them from SPEC.md or PROPOSAL.md instead.
3. For each affected service, apply the worktree resolution algorithm from `references/worktree-resolution.md`:
   a. Resolve the absolute repo path from `services.yaml`.
   b. Check if `<service-repo>/.worktrees/<TASK_SLUG>/` exists (using the task slug from Step 1).
   c. If it exists: record the worktree path as the service's source path.
   d. If not: record the main repo path and log a warning.
4. Store the Worktree Map for use in Step 8.

## Step 8 — Present Context Block

Present the loaded context in this structured format:

```
## Task: <task-title> (from SPEC.md)
**Branch**: <branch-name> | **Date**: <task-date>

---

### Active Worktrees

| Service | Source Path | Type |
|---------|------------|------|
| `<service-id>` | `<resolved-path>` | worktree or main repo |

> **IMPORTANT**: When reading or modifying files for any affected service, you MUST use the Source Path from the Worktree Map above — never the main repository path. This ensures changes land in the correct task-isolated directory.

---

### Loaded Artifacts

#### SPEC.md
<full content>

#### TASKS.md
<full content>

#### PROPOSAL.md
<full content or summary — see Step 3>

---

### Git Activity (last 20 commits)
<git log output>

### Change Scope
<git diff --stat output>

---

### Artifact Inventory (available for drill-down)

**Core:**
- ✅ SPEC.md — <path>
- ✅ TASKS.md — <path>
- ✅ PROPOSAL.md — <path>
- <✅ or ❌> CLICKUP_TASK.json — <path>

**Service: <service-id>**
- <✅ or ❌> CONTEXT.md — <path>
- Phases: <list of phase files with paths>
- User Stories: <list of UH files with paths>

**Codebase Knowledge: <service-id>**
- <list of codebase files with paths, mark ✅ if exists, ❌ if not>
```

---

## Step 9 — Task Summary

Dispatch `jlu-summary-agent`:
- Pass `TASK_DIR` (the resolved task directory path from Step 2)
- Pass `CONTEXT_HINT` = `context-load`
- Print the agent's output before the closing message.

After the summary, tell the user:
> Context loaded. You can ask me anything about this task. When making changes, I'll use the worktree paths shown above. I can read any artifact from the inventory for more detail.
