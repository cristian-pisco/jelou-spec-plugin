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

## Step 6 — Present Context Block

Present the loaded context in this structured format:

```
## Task: <task-title> (from SPEC.md)
**State**: <lifecycle-state from TASKS.md> | **Branch**: <branch-name> | **Date**: <task-date>

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

After presenting the context, tell the user:
> Context loaded. You can ask me anything about this task. I can read any artifact from the inventory above for more detail.
