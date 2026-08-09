# Workflow: load-context

> Orchestrator workflow for `/jlu-load-context [task-slug]`
> Load completed or in-progress task context into a fresh session for Q&A.

---

You are the orchestrator for the `/jlu-load-context` command.

Your job is to reconstruct task context from on-disk artifacts so the user can ask questions about the task in a fresh session. This is read-only — you never modify any files.

## Step 1 — Detect Task from Environment

Use worktree-first detection:

1. Check current git branch: `git rev-parse --abbrev-ref HEAD`
   - If it matches `production/<task-slug>`, extract the task slug.
2. Check current directory path for `/.worktrees/<task-slug>/` pattern — extract the slug from the path.
3. If an argument was provided to the command, use it as the task slug (overrides auto-detection).
4. **Fallback**: Resolve workspace in this order, then scan `<WORKSPACE_PATH>/specs/` for the most recent task directory.
   - First try `.spec-workspace.json` from the current directory (or up to 5 parent directories).
   - If missing, search upward (up to 5 parent directories) for `.spec-workspace/specs/` and set `WORKSPACE_PATH = <found-parent>/.spec-workspace`.
   - If multiple tasks exist, list them and ask the user to pick one.

## Step 2 — Resolve Task Directory

1. Build an ordered ancestor list from current directory upward (max 5 levels, nearest first).
2. Locate `.spec-workspace.json` by discovery first (prefer `glob` against the ancestor list), then read only the nearest match. If in a worktree, the workspace pointer may be in a parent directory of the worktree root.
3. If `.spec-workspace.json` exists:
    - Read the `workspace` path and resolve it to an absolute path.
    - Set `WORKSPACE_PATH` to that resolved value.
    - Validate `WORKSPACE_PATH/specs` exists.
    - Compatibility fallback: if `WORKSPACE_PATH/specs` is missing but `WORKSPACE_PATH/.spec-workspace/specs` exists, set `WORKSPACE_PATH = WORKSPACE_PATH/.spec-workspace`.
4. If `.spec-workspace.json` does not exist:
    - Discover `.spec-workspace/specs/` from the same ancestor list and use the nearest match.
    - If found at `<root>/.spec-workspace/specs/`, set `WORKSPACE_PATH = <root>/.spec-workspace`.
5. Stop discovery after the first valid match. Do not probe higher ancestors once `WORKSPACE_PATH` is resolved.
6. Resolve the full task directory: `<WORKSPACE_PATH>/specs/<date>/<task-slug>/`
   - If the date folder is unknown, do not glob directories directly (the glob tool may only return files).
   - Instead, glob for marker files in this order and derive the task directory from the parent path:
     1. `<WORKSPACE_PATH>/specs/*/<task-slug>/TASKS.md`
     2. `<WORKSPACE_PATH>/specs/*/<task-slug>/SPEC.md`
     3. `<WORKSPACE_PATH>/specs/*/<task-slug>/PROPOSAL.md`
   - If any marker exists, set `TASK_DIR = dirname(<marker-file>)`.

If `WORKSPACE_PATH` cannot be resolved, stop with: "No workspace found. Expected `.spec-workspace.json` or a parent `.spec-workspace/specs/` directory."

If the task directory cannot be found, stop with: "Task `<task-slug>` was not found. Searched `<WORKSPACE_PATH>/specs/*/<task-slug>/` for `TASKS.md`, `SPEC.md`, and `PROPOSAL.md`."

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

If the current branch is not the task branch, try `production/<task-slug>` as the branch name for the git log.

## Step 5 — Artifact Inventory

Glob for all task artifacts and organize them by category. Use the task directory as the root.

**Core artifacts:**
- `SPEC.md`, `TASKS.md`, `PROPOSAL.md`, `CLICKUP_TASK.json`
- `stories/*.story.md` — user story files (task-level, not per-service)

**Per-service artifacts** (under `services/<service-id>/`):
- `phases/*.md` — phase execution files (Red/Green/Refactor details)

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
   - Check External Links: does a PR URL already exist? (exists = awaiting review, missing = need to run `/jlu-ship`)
5. **Map state → human label and recommended command**:

   | State | Human Label | Next Step Message |
   |-------|-------------|-------------------|
   | `draft` | Spec seed created — not yet refined | Run `/jlu-new-task` to expand the spec via inline interview. |
   | `refining` | Spec refinement in progress | Re-run `/jlu-new-task <slug>` — spec interview is not yet complete. |
   | `planned` | Spec finalized — ready to implement | Run `/jlu-execute-task` to begin TDD implementation. |
   | `implementing` | TDD execution in progress | Run `/jlu-execute-task` to resume — next phase is `<recovery-info.next-phase>` (phase <N>/<total>). |
   | `validating` | All phases complete — QA running | Run `/jlu-execute-task` to complete QA, then `/jlu-ship` when all services pass. |
   | `ready_to_publish` | Implementation done — PR needed | Run `/jlu-ship` to open pull requests. *(If PR already exists: awaiting review — merge, then `/jlu-close-task`.)* |
   | `done` | PRs open — awaiting merge | PR is open. Await review and merge, then run `/jlu-close-task`. |
   | `closed` | Task finalized | No action needed. |

6. **If active blockers exist**, override the next step with: `Resolve blocker: <description>`

## Step 7 — Resolve Worktree Map

Resolve the correct source paths for all affected services so the assistant uses worktree paths (not main repo paths) when the user requests changes.

1. Read `<WORKSPACE_PATH>/registry/services.yaml`.
2. Extract the list of affected services from the TASKS.md loaded in Step 3 (the "Services" field in the Metadata section). If TASKS.md does not list affected services, extract them from SPEC.md or PROPOSAL.md instead.
3. For each affected service, apply the **mode-driven** worktree resolution algorithm from `references/worktree-resolution.md`. Do **not** use a filesystem existence check — respect `SETUP_MODE` from `TASKS.md → ## Branching → Mode`.
   a. Resolve the absolute repo path from `services.yaml`.
   b. Resolve the source path based on `SETUP_MODE`:
      - `Mode: worktree`: source path = `<service-repo>/.worktrees/<TASK_SLUG>/`. If that path is missing, fall back to the main repo and warn: `Worktree missing for <service-id> despite Mode: worktree — using main repo.`
      - `Mode: branch`: source path = `<service-repo>` (main repo root). Ignore any leftover `.worktrees/<TASK_SLUG>/` that may exist. If detected, log: `Branch-mode task has a leftover worktree at <path>. Ignoring it.`
      - `## Branching` section absent (legacy): fall back to the legacy rule in `references/worktree-resolution.md` → `## Resolution Algorithm`, bullet `3.c` (use `.worktrees/<TASK_SLUG>/` if it exists, else the repo root, and warn that this is a legacy `spec/<slug>` task).
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
- Phases: <list of phase files with paths>
- User Stories: <list of UH files with paths>

**Codebase Knowledge: <service-id>**
- <list of codebase files with paths, mark ✅ if exists, ❌ if not>
```

---

## Step 9 — Task Summary

Print a compact task summary inline — **no agent dispatch**. You already have every field: TASKS.md (Step 3), git data (Step 4), and the lifecycle state + recommended next step (Step 6). Do not re-derive any of it from a subagent.

```
## Task Summary — <slug>

Status: <lifecycle-state> — <human-label from Step 6>

### Summary
- Phases: <done>/<total>[ per <service-id> if multi-service]
- Tests: <unit> unit, <integration> integration, <e2e> e2e (omit any type with 0 count)
- Commits: <count> on <branch-name>
- Files changed: <count> · Lines: +<added> / -<removed>

### Next Steps
- <recommended next step from the Step 6 state → command mapping>
```

**Never fabricate data.** Every number must come from TASKS.md or the git output already gathered — never estimate. If a metric is unavailable, show `—`; an honest gap beats a plausible guess.

**Never invent commands. The `/jlu:*` vocabulary is closed.** Every `/jlu:*` you name in Next Steps must be a command that actually ships in this plugin — the lifecycle set is `/jlu:new-task`, `/jlu:execute-task`, `/jlu:refine-task`, `/jlu:extend-phase`, `/jlu:test-suite`, `/jlu:goal`, `/jlu:ship`, `/jlu:close-task`. Outward-facing or deploy-time work that no plugin command performs — deploying a service, setting a gateway env var, flipping a feature flag, running a live external E2E — is a **plain-prose manual/ops step**, never a `/jlu:*` command. There is no `jlu:land-and-deploy` command and no `jlu:deploy` command; if you are reaching for one, you are hallucinating — write the action in prose instead.

After the summary, tell the user:
> Context loaded. You can ask me anything about this task. When making changes, I'll use the worktree paths shown above. I can read any artifact from the inventory for more detail.
