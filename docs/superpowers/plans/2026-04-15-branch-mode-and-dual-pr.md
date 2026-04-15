# Branch-Mode Setup and Dual-PR Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer environment setup until after spec approval; add a lightweight branch-only alternative to worktree mode; replace `spec/<slug>` naming with `production/<slug>` + optional on-demand `staging/<slug>` cherry-picked from `origin/alpha` via a new `jlu-conflict-resolver` sub-agent.

**Architecture:** Three coupled workstreams. (A) remove the background worktree subtask from `/jlu-new-task` Step 9; add a mode-selection step (Step 15b) and a mode-aware setup subtask (Step 15c) that run only after spec approval. (B) rename branch references across every workflow, reference, and agent from `spec/<slug>` to `production/<slug>`. (C) synthesize `staging/<slug>` on-demand in `/jlu-create-pr` by cherry-picking production commits onto a fresh cut of `origin/alpha` inside a temporary worktree, using the new `jlu-conflict-resolver` sub-agent (sonnet-tier) to resolve conflicts using SPEC + adjacent code. Close-task tears down the staging side regardless of staging-PR merge state.

**Tech Stack:** Markdown workflow files (plugin logic lives in prompts that Claude executes), Bash, `git`, `gh` CLI. No executable code — verification is by grep + manual runs.

**Reference spec:** `docs/superpowers/specs/2026-04-15-branch-mode-and-dual-pr-design.md`.

---

## Conventions Used In This Plan

- **"Verification step"** replaces the usual TDD "run the failing test" step. Because the plugin is markdown prompts rather than executable code, each task's post-edit verification is a `grep` / `git diff` / re-read check that the change landed and no stale references remain.
- **`.opencode/` mirroring**: every agent edit must also be applied to the matching file under `.opencode/agents/`. Tasks that touch `agents/<name>.md` include a step for the mirror file.
- **No forced version bump**: the plugin's pre-commit hook auto-bumps versions on every commit. Do not fight it. If a task commit includes version file changes, that is expected.
- **Commit style**: brief, descriptive, no emojis. Matches the project's existing convention.

---

## File Structure

### Files to CREATE

- `agents/jlu-conflict-resolver.md` — new sub-agent definition for cherry-pick + conflict resolution.
- `.opencode/agents/jlu-conflict-resolver.md` — OpenCode mirror of the above.

### Files to MODIFY

| Path | Responsibility in the new design |
|---|---|
| `jelou/workflows/new-task.md` | Add Step 8c (dual-PR question). Remove Step 9 (background setup). Add Step 15b (mode selection) and Step 15c (mode-aware setup subtask). Update Step 16 (final report). |
| `jelou/workflows/execute-task.md` | Read `## Branching → Mode` from TASKS.md. In branch mode, auto-checkout `production/<slug>` before first phase (strict abort on dirty tree). Rename `spec/<slug>` → `production/<slug>`. |
| `jelou/workflows/create-pr.md` | Rename `spec/<slug>` → `production/<slug>`. Add Step 5b (dual-PR cherry-pick synthesis via sub-agent). Update Steps 6/7/8/9/10 for dual-PR. |
| `jelou/workflows/close-task.md` | Rename `spec/<slug>` → `production/<slug>`. Add dual-PR teardown (close staging PR + delete remote/local staging branch + temp worktree cleanup). |
| `jelou/workflows/rollback-phase.md` | Rename `spec/<slug>` → `production/<slug>`. Mode-aware reset path. |
| `jelou/workflows/load-context.md` | Rename `spec/<slug>` → `production/<slug>`. |
| `jelou/workflows/report-task.md` | Rename `spec/<slug>` → `production/<slug>`. Mode-aware stale detection. Stale-temp-worktree detection (`.worktrees/<slug>-staging-tmp` older than 1 hour). |
| `jelou/references/git-conventions.md` | Rewrite branch-naming section: document `production/<slug>` (mandatory, from trunk) + `staging/<slug>` (opt-in, from alpha, cherry-picked). Document the conflict-resolver. |
| `jelou/references/worktree-resolution.md` | Rename `spec/<TASK_SLUG>` → `production/<TASK_SLUG>`. Add note about temp staging worktree (`.worktrees/<slug>-staging-tmp`) and branch-only mode (source path is main repo root). |
| `jelou/references/docker-conventions.md` | Audit for `spec/<slug>` leakage and rename. |
| `agents/jlu-git-agent.md` | Rename `spec/<task-slug>` → `production/<task-slug>`. Ensure agent never touches `staging/<slug>`. |
| `agents/jlu-tasks-agent.md` | Add `## Branching` section to TASKS.md template. Rename branch refs. |
| `agents/jlu-summary-agent.md` | Rename branch refs. |
| `.opencode/agents/jlu-git-agent.md` | Mirror `agents/jlu-git-agent.md`. |
| `.opencode/agents/jlu-tasks-agent.md` | Mirror `agents/jlu-tasks-agent.md`. |
| `.opencode/agents/jlu-summary-agent.md` | Mirror `agents/jlu-summary-agent.md`. |
| `README.md` | Update branch-naming examples. Add high-level dual-PR flow description. |
| `CHANGELOG.md` | Entry for the release. |

---

## Phase 1 — Branch-naming foundation

Every task in this phase replaces `spec/<slug>` with `production/<slug>` in a single file. The plugin remains usable between commits because each workflow reads branch names from the location it writes them (TASKS.md for orchestrators; explicit parameter for agents). Transient inconsistency is acceptable on a development branch.

### Task 1: Rewrite `jelou/references/git-conventions.md`

**Files:**
- Modify: `jelou/references/git-conventions.md`

- [ ] **Step 1: Rewrite the branch-naming section**

Replace the current `## Branch Naming` and `## PR Strategy` sections with the new convention. The new file should read:

```markdown
# Git Workflow Conventions

> This document defines the Git workflow enforced by the Jelou Spec Plugin. All git operations are performed by the git-agent (Haiku tier) under orchestrator direction. The git-agent never makes judgment calls — it executes predetermined operations.

## Branch Naming

Every task creates a **mandatory** primary branch targeting trunk, and **optionally** a secondary branch targeting alpha.

### Primary — `production/<task-slug>`

- Cut from `origin/<trunk>` (`main` or `master`, auto-detected).
- Created at `/jlu-new-task` Step 15c (after spec approval), in each affected service repo.
- PR targets trunk.

### Secondary (opt-in) — `staging/<task-slug>`

- Cut from `origin/alpha`.
- **Not** created at task creation. Synthesized on-demand by `/jlu-create-pr` when `Dual PR: yes` is recorded in TASKS.md.
- Commits arrive via cherry-pick from `production/<task-slug>`. Conflicts are resolved by the `jlu-conflict-resolver` sub-agent (sonnet) using SPEC + adjacent code.
- PR targets `alpha`.

### Rules

- Branch names use the same slug across all affected service repos.
- Slugs are lowercase, hyphen-separated, ≤50 characters (see `/jlu-new-task` Step 4).
- Neither the git-agent nor any orchestrator may push to `main`, `master`, or `alpha` directly.

## Worktree Management

Worktree mode: `<repo-root>/.worktrees/<task-slug>` (primary task worktree, created on `production/<task-slug>`).

Branch-only mode: no task worktree. The user works on `production/<task-slug>` in the main repo.

Dual-PR synthesis: `<repo-root>/.worktrees/<task-slug>-staging-tmp` (temporary worktree, created by `/jlu-create-pr` for the cherry-pick and removed before the workflow returns).

### Stale Detection (Decision #17)

No automatic worktree cleanup. `/jlu-report-task` identifies:
- Stale task worktrees (task is `done` or `closed`).
- Stale staging temp worktrees (older than 1 hour — left behind by a crashed `/jlu-create-pr`).

### Docker Integration

(Unchanged from today: worktree-mode Docker isolation via port allocation + override file. Not applicable in branch-only mode.)

## Commit Conventions

(Unchanged.)

## Protected Branch Restrictions

The git-agent is **strictly forbidden** from pushing to `main`, `master`, or `alpha`. Staging push (to `origin/staging/<slug>`) is performed by the `/jlu-create-pr` orchestrator, not the git-agent.

## PR Strategy

### Primary PR (always)

- Branch: `production/<task-slug>` → trunk.
- One per affected service.

### Secondary PR (opt-in, per task)

- Branch: `staging/<task-slug>` → `alpha`.
- Synthesized by `/jlu-create-pr` after the primary branch is pushed.
- Flow per service:
  1. Fetch origin.
  2. Rebuild-or-incremental decision from markers in TASKS.md (`Last alpha SHA`, `Last cherry-picked production SHA`).
  3. Create temp staging worktree `.worktrees/<slug>-staging-tmp`.
  4. Spawn `jlu-conflict-resolver` (sonnet) to cherry-pick and resolve conflicts.
  5. Push (force-with-lease on rebuild, fast-forward on incremental).
  6. Open/update alpha PR.
  7. Remove temp worktree.

If the sub-agent cannot resolve a conflict, the staging side is aborted cleanly and the user is offered: resolve manually, disable dual-PR for the task, or abort.

### Cross-Linking

Both PR bodies carry `> Part of dual-PR task. Sibling PR: <url>` above the `## Problem` section.

## Git Operations Summary

| Operation | Who Decides | Who Executes |
|-----------|-------------|-------------|
| `production/<slug>` creation | `/jlu-new-task` Step 15c | Setup subtask (via git-agent) |
| Worktree creation (worktree mode) | `/jlu-new-task` Step 15c | Setup subtask (via git-agent) |
| Staging + committing + pushing `production/<slug>` | Orchestrator (after phase) | git-agent |
| `staging/<slug>` synthesis | `/jlu-create-pr` Step 5b | jlu-conflict-resolver + orchestrator |
| Alpha PR push | `/jlu-create-pr` Step 5b.7 | Orchestrator (not git-agent) |
| PR creation (primary + alpha) | `/jlu-create-pr` | Orchestrator + `gh` CLI |
| Task closure (delete local branches, remove remote staging, close alpha PR if open) | `/jlu-close-task` | Orchestrator |
```

- [ ] **Step 2: Verify no `spec/<slug>` references remain**

Run: `grep -n 'spec/<' jelou/references/git-conventions.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add jelou/references/git-conventions.md
git commit -m "docs(git-conventions): rewrite for production/<slug> + staging/<slug> dual-PR model"
```

---

### Task 2: Update `jelou/references/worktree-resolution.md`

**Files:**
- Modify: `jelou/references/worktree-resolution.md`

- [ ] **Step 1: Rewrite with new branch name and branch-mode note**

Replace the file contents with:

```markdown
# Worktree Resolution

> Resolves the correct source path (worktree or main repo) for each affected service in a task. Used by any workflow or skill that needs to read or modify service code in the context of a task.

## Resolution Algorithm

For each affected service:

1. Look up the service entry in `<WORKSPACE_PATH>/registry/services.yaml`.
2. Resolve the absolute repo path: `<WORKSPACE_PATH>/` + `service.path`.
3. Read the task's `TASKS.md` → `## Branching → Mode`:
   a. If `Mode: worktree`: the primary working directory is `<service-repo>/.worktrees/<TASK_SLUG>/`. Verify it exists — if missing, fall back to the main repo and log a warning: "Worktree missing for `<service-id>` despite `Mode: worktree` — using main repo."
   b. If `Mode: branch`: the primary working directory is the service repo root.
   c. If the `## Branching` section is absent (old-style task on `spec/<slug>`): check if `<service-repo>/.worktrees/<TASK_SLUG>/` exists. If yes, use it; if no, use the repo root. Log a warning about the missing branching section.
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
```

- [ ] **Step 2: Verify**

Run: `grep -n 'spec/<' jelou/references/worktree-resolution.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add jelou/references/worktree-resolution.md
git commit -m "docs(worktree-resolution): support branch mode and document temp staging worktree"
```

---

### Task 3: Update `agents/jlu-git-agent.md` (+ OpenCode mirror)

**Files:**
- Modify: `agents/jlu-git-agent.md`
- Modify: `.opencode/agents/jlu-git-agent.md`

- [ ] **Step 1: Replace `spec/<task-slug>` with `production/<task-slug>` in `agents/jlu-git-agent.md`**

Use a single targeted edit. After the change, the agent:
- Branch restriction reads: "You may ONLY operate on the task's active branch: `production/<task-slug>`"
- Pre-flight check commented as: "Must match: `production/<task-slug>`"
- Example in commit body: "Phase 02 of production/add-user-verification"
- Push command: `git push origin production/<task-slug>` (and `git push -u origin production/<task-slug>` for the upstream variant)
- Output template: "Branch: `production/<task-slug>`"

Also add this paragraph under `## Hard Constraints → Branch Restrictions`:

```markdown
The git-agent NEVER touches `staging/<task-slug>`. The staging branch is synthesized and pushed by the `/jlu-create-pr` orchestrator with the `jlu-conflict-resolver` sub-agent, not by the git-agent.
```

- [ ] **Step 2: Apply the same edits to `.opencode/agents/jlu-git-agent.md`**

Diff-check the two files for parity:

Run: `diff agents/jlu-git-agent.md .opencode/agents/jlu-git-agent.md`
Expected: only header/frontmatter differences (if any), not branch-name differences.

- [ ] **Step 3: Verify no stale refs**

Run: `grep -n 'spec/<task-slug>\|spec/<slug>' agents/jlu-git-agent.md .opencode/agents/jlu-git-agent.md`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add agents/jlu-git-agent.md .opencode/agents/jlu-git-agent.md
git commit -m "agents(git-agent): rename spec/<slug> to production/<slug>, forbid staging/<slug>"
```

---

### Task 4: Update `agents/jlu-tasks-agent.md` (+ OpenCode mirror)

**Files:**
- Modify: `agents/jlu-tasks-agent.md`
- Modify: `.opencode/agents/jlu-tasks-agent.md`

- [ ] **Step 1: Update TASKS.md template in `agents/jlu-tasks-agent.md`**

In the `## TASKS.md Structure` section, replace the Services sub-heading block:

Old:
```markdown
### <service-id>
- **Status**: planned | implementing | validating | done
- **Branch**: spec/<task-slug>
- **Worktree**: .worktrees/<task-slug>
```

New:
```markdown
### <service-id>
- **Status**: planned | implementing | validating | done
- **Branch**: production/<task-slug>
- **Worktree**: .worktrees/<task-slug>  (present only when Mode: worktree)
```

Also add a new top-level section to the template, between `## Services` and `## Blockers`:

```markdown
## Branching
- **Dual PR**: yes | no
- **Primary branch**: production/<task-slug>
- **Secondary branch**: staging/<task-slug>  (intended; synthesized at first /jlu-create-pr when Dual PR = yes)
- **Mode**: worktree | branch
- **Last alpha SHA**: <sha>                         (populated at first dual-PR sync)
- **Last cherry-picked production SHA**: <sha>     (populated at first dual-PR sync)
```

Add to `## Update Rules` (as new rule 8):

```markdown
8. **Branching section is semi-append-only**. The "Dual PR", "Primary branch", "Secondary branch", and "Mode" fields are set once (at task creation / mode selection) and do not change. The "Last alpha SHA" and "Last cherry-picked production SHA" markers are overwritten on each `/jlu-create-pr` dual-PR sync.
```

- [ ] **Step 2: Apply the same edits to `.opencode/agents/jlu-tasks-agent.md`**

- [ ] **Step 3: Verify**

Run: `grep -n 'Branch.*spec/<' agents/jlu-tasks-agent.md .opencode/agents/jlu-tasks-agent.md`
Expected: no matches.

Run: `grep -n '## Branching' agents/jlu-tasks-agent.md .opencode/agents/jlu-tasks-agent.md`
Expected: one match per file.

- [ ] **Step 4: Commit**

```bash
git add agents/jlu-tasks-agent.md .opencode/agents/jlu-tasks-agent.md
git commit -m "agents(tasks-agent): add ## Branching section to TASKS.md template"
```

---

### Task 5: Update `agents/jlu-summary-agent.md` (+ OpenCode mirror)

**Files:**
- Modify: `agents/jlu-summary-agent.md`
- Modify: `.opencode/agents/jlu-summary-agent.md`

- [ ] **Step 1: Rename branch references**

Search the file for `spec/<` and replace every occurrence with `production/<`:

Run: `grep -n 'spec/<' agents/jlu-summary-agent.md`

For each match, update the line so the branch name is `production/<slug>` or `production/<task-slug>`, preserving the surrounding context.

- [ ] **Step 2: Apply the same edits to `.opencode/agents/jlu-summary-agent.md`**

- [ ] **Step 3: Verify**

Run: `grep -rn 'spec/<' agents/jlu-summary-agent.md .opencode/agents/jlu-summary-agent.md`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add agents/jlu-summary-agent.md .opencode/agents/jlu-summary-agent.md
git commit -m "agents(summary-agent): rename spec/<slug> to production/<slug>"
```

---

## Phase 2 — `/jlu-new-task` changes (defer setup + mode selection)

### Task 6: Add Step 8c (dual-PR question) to `new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md`

- [ ] **Step 1: Insert Step 8c between existing Step 8b and Step 9**

After the existing Section `### 8b. Conflict Detection`, add:

```markdown
---

### 8c. Dual-PR Intent

Using `question`:

> **"Will this task also need a PR to `alpha` (staging)?"**
> - No — only a PR to trunk (default)
> - Yes — two PRs: one to trunk (mandatory), one to alpha (synthesized at PR-creation time via cherry-pick with conflict resolver)

Store as `DUAL_PR` (boolean).

**Store**: `DUAL_PR`
```

- [ ] **Step 2: Update the Step 6 TASKS.md template**

In the existing Step 6 "Write Initial TASKS.md" template, insert a new section between the existing `## Services` and `## Phases`:

```markdown
## Branching
- Dual PR: <DUAL_PR yes|no>
- Primary branch: production/<TASK_SLUG>
- Secondary branch: staging/<TASK_SLUG>   (intended; synthesized at first /jlu-create-pr when Dual PR = yes)
- Mode: (pending — chosen after spec approval)
- Last alpha SHA: (pending — populated at first dual-PR sync)
- Last cherry-picked production SHA: (pending — populated at first dual-PR sync)
```

**Note**: Step 6 currently runs before Step 8c, so `DUAL_PR` isn't known yet at that point. Rearrange: move the `## Branching` section write to Step 8c itself (append to TASKS.md after DUAL_PR is known), rather than Step 6. Specifically:

In Step 6, change the initial TASKS.md template to OMIT the `## Branching` section (leaving the other sections as they are today).

At the end of Step 8c, after storing `DUAL_PR`, **append** the `## Branching` section (as shown above) to the existing TASKS.md file, between the `## Services` and `## Phases` sections.

- [ ] **Step 3: Verify**

Run: `grep -n '8c\. Dual-PR' jelou/workflows/new-task.md`
Expected: one match.

Run: `grep -n '## Branching' jelou/workflows/new-task.md`
Expected: at least two matches (the template in Step 6 no longer has it; the Step 8c append adds it).

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "new-task: add Step 8c for dual-PR intent and ## Branching section"
```

---

### Task 7: Remove Step 9 (background worktree subtask) from `new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md`

- [ ] **Step 1: Delete the existing `## Step 9 — Launch Worktree Creation Subtask` section**

The entire Step 9 block (from its `## Step 9 — …` heading through to the next `---` separator) is removed. This includes all five phases (Create worktrees, Port allocation, Generate override, Wire inter-service URLs, Start Docker) and the `WORKTREE_AGENT_TASK` variable.

The subsequent step numbering stays as-is (Step 10 onward) since Claude reads them by heading, not by ordinal.

- [ ] **Step 2: Remove references to `WORKTREE_AGENT_TASK` elsewhere**

Search for `WORKTREE_AGENT_TASK` in the file:

Run: `grep -n 'WORKTREE_AGENT_TASK' jelou/workflows/new-task.md`

Remove every line / fragment that references it. Primary site to clean up: Step 15 → Step 15.2.b (the "Check `WORKTREE_AGENT_TASK` result" bullet) — delete that bullet.

- [ ] **Step 3: Verify**

Run: `grep -n 'Step 9\|WORKTREE_AGENT_TASK\|Launch Worktree Creation' jelou/workflows/new-task.md`
Expected: no matches (other than possibly a `### Phase` cross-reference that should be checked in context).

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "new-task: remove Step 9 background worktree subtask"
```

---

### Task 8: Add Step 15b (mode selection) to `new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md`

- [ ] **Step 1: Insert Step 15b into the `If approved` branch of Step 15**

Inside the existing Step 15 → `2. If the user approved the spec:` sub-tree, after the `a. Update <TASK_DIR>/TASKS.md:` bullet group completes (status flipped to `planned`), insert before the "b. Check WORKTREE_AGENT_TASK" bullet (which you removed in Task 7) this new top-level section *outside* the existing numbered list:

Add a new top-level section immediately after Step 15 and before Step 16:

```markdown
---

## Step 15b — Mode Selection

Runs only if the user approved the spec in Step 15.

Using `question`:

> **"How should I set up the work environment for this task?"**
> - Full setup (worktree + Docker) — recommended when multiple services, Docker-heavy, or parallel tasks planned
> - Branch only — recommended when single-file fix, non-Docker service, or quick change

Store as `SETUP_MODE` ∈ {`worktree`, `branch`}.

Update `<TASK_DIR>/TASKS.md` → `## Branching` → replace `Mode: (pending ...)` with `Mode: <SETUP_MODE>`.

**Store**: `SETUP_MODE`
```

- [ ] **Step 2: Verify**

Run: `grep -n 'Step 15b' jelou/workflows/new-task.md`
Expected: one match (the heading).

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "new-task: add Step 15b for mode selection after spec approval"
```

---

### Task 9: Add Step 15c (dispatch setup subtask) to `new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md`

- [ ] **Step 1: Insert Step 15c after Step 15b**

Add this new top-level section immediately after Step 15b and before Step 16:

````markdown
---

## Step 15c — Dispatch Setup Subtask

Runs only if the user approved the spec in Step 15.

Notify the user:
```
Setting up work environment (<SETUP_MODE> mode) for <N> services...
```

Spawn a task subagent using `jlu-git-agent` with `MODEL_CONFIG.operational` (default haiku). Pass:
- `CONFIRMED_SERVICES` (list)
- `TASK_SLUG`
- `SETUP_MODE` ∈ {`worktree`, `branch`}
- Per-service repo paths from `services.yaml`

The subtask executes the following per-service algorithm.

### Source-branch verification (both modes)

For each service in `CONFIRMED_SERVICES`:

1. `cd <repo>` and run `git fetch origin` to get latest refs.
2. Detect trunk:
   ```bash
   TRUNK=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
   [ -z "$TRUNK" ] && TRUNK=main
   git rev-parse --verify origin/$TRUNK >/dev/null 2>&1 || TRUNK=master
   ```
3. If `origin/$TRUNK` still does not resolve, abort this service: **"Cannot resolve trunk branch for `<service-id>`."**

**In branch mode only**, additionally:

4. Check working tree cleanliness:
   ```bash
   DIRTY=$(git status --porcelain)
   ```
   If `DIRTY` is non-empty, abort this service with the first 5 dirty paths plus the total count: **"Working tree of `<service-id>` is dirty. Commit or stash before branch-only mode can create branches in place. Dirty files: `<paths...>` (total: N)."**
5. Check current HEAD:
   ```bash
   CURR=$(git rev-parse --abbrev-ref HEAD)
   ```
   If `CURR != $TRUNK`, abort: **"`<service-id>` is currently on `$CURR`, not `$TRUNK`. Check out `$TRUNK` first."**

In worktree mode, skip steps 4 and 5 — the main repo's HEAD and working-tree state do not affect worktree creation.

### Branch creation

**If `SETUP_MODE = worktree`** (existing five-phase behavior):

1. Create the worktree on the new branch:
   ```bash
   git worktree add .worktrees/<TASK_SLUG> -b production/<TASK_SLUG> origin/$TRUNK
   ```
   If `production/<TASK_SLUG>` already exists locally, abort this service: **"Branch `production/<TASK_SLUG>` already exists locally for `<service-id>`. Delete it or use a different slug."**
2. Copy untracked files from repo root to worktree:
   ```bash
   for file in .env .npmrc; do
     [ -f <repo>/$file ] && cp <repo>/$file <worktree>/$file
   done
   ```
3. Run existing Phase 2 (port allocation), Phase 3 (docker-compose.override.yml), Phase 4 (inter-service URLs), Phase 5 (docker compose up -d) from the pre-removal Step 9. Wherever those phases referenced `spec/<TASK_SLUG>`, use `production/<TASK_SLUG>`.

**If `SETUP_MODE = branch`** (new):

1. Create the branch (not checked out):
   ```bash
   git branch production/<TASK_SLUG> origin/$TRUNK
   ```
   If the branch already exists, abort this service: **"Branch `production/<TASK_SLUG>` already exists locally for `<service-id>`. Delete it or use a different slug."**
2. Skip Docker phases entirely. No `.env` copy, no override file, no port allocation, no container bring-up.

### Record

Record per service: `{ mode, production_branch, worktree_path (if worktree mode) }`. The orchestrator includes this in the final report (Step 16).

### Error handling

- Per-service aborts do NOT block the workflow. The orchestrator continues with remaining services and reports all aborts in the final report.
- If the subtask itself crashes (Claude session interruption, infrastructure), any partial state (created branches, open worktrees) is left on disk. Re-running `/jlu-new-task <slug>` will detect existing branches and abort per-service with the "already exists" message.
````

- [ ] **Step 2: Verify**

Run: `grep -n 'Step 15c' jelou/workflows/new-task.md`
Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "new-task: add Step 15c setup subtask supporting worktree and branch modes"
```

---

### Task 10: Update Step 16 (final report) in `new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md`

- [ ] **Step 1: Rewrite the Step 16 report template**

Replace the existing Step 16 report template with:

````markdown
Present the final summary:

```
## Task Created

### Task
- Slug: <TASK_SLUG>
- Path: <TASK_DIR>
- Sprint: <SPRINT_NUMBER>
- Status: planned

### Artifacts
- SPEC.md: <TASK_DIR>/SPEC.md (<N> sections)
- TASKS.md: <TASK_DIR>/TASKS.md

### Affected Services
- <service-id-1> (primary)
- <service-id-2>
- ...

### Branching
- Mode: <SETUP_MODE>
- Dual PR: <DUAL_PR yes|no>
- Branches created:
  <service-id-1>: production/<TASK_SLUG>
  <service-id-2>: production/<TASK_SLUG>
  ...

### Worktrees (Mode: worktree only)
- <service-id-1>: <repo-path>/.worktrees/<TASK_SLUG>
- ...

### Docker Instances (Mode: worktree only)
- <service-id-1>: running on port <port> (container: <id>)
- <service-id-2>: no Docker
- ...

### Warnings
- <any codebase map warnings>
- <any skill staleness warnings>
- <any unregistered service warnings>
- <any setup-subtask per-service aborts>

### Next Step
Run `/jlu-execute-task` to begin implementation.
```

**Mode-specific appendices:**

If `SETUP_MODE = branch`: append to the report:

> Branch-only mode: `/jlu-execute-task` will check out `production/<TASK_SLUG>` in each affected service repo before its first phase. Ensure working trees are clean at that point.

If `DUAL_PR = yes`: append to the report:

> Dual-PR enabled. The `staging/<TASK_SLUG>` branch will be synthesized automatically during `/jlu-create-pr` by cherry-picking from the latest `origin/alpha`, with conflicts resolved by the `jlu-conflict-resolver` sub-agent.
````

- [ ] **Step 2: Verify**

Run: `grep -n '### Branching\|### Worktrees (Mode: worktree only)' jelou/workflows/new-task.md`
Expected: both match.

Run: `grep -n 'Worktrees Created$' jelou/workflows/new-task.md`
Expected: no match (old heading removed).

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "new-task: update Step 16 final report for mode and dual-PR awareness"
```

---

## Phase 3 — `jlu-conflict-resolver` sub-agent

### Task 11: Create `agents/jlu-conflict-resolver.md` (+ OpenCode mirror)

**Files:**
- Create: `agents/jlu-conflict-resolver.md`
- Create: `.opencode/agents/jlu-conflict-resolver.md`

- [ ] **Step 1: Write `agents/jlu-conflict-resolver.md`**

````markdown
---
name: jlu-conflict-resolver
description: "Cherry-pick commits between branches and resolve merge conflicts using SPEC and adjacent code context"
tools: Read, Bash, Glob, Grep
model: sonnet
---

You are the conflict-resolver agent for the Jelou Spec Plugin. Your job is to cherry-pick a specified range of commits into a target worktree and resolve any merge conflicts that arise, using the task's SPEC and adjacent code as evidence for your resolutions.

## Mission

When `/jlu-create-pr` runs a dual-PR sync, production commits must be cherry-picked from `production/<slug>` onto a fresh `staging/<slug>` cut from `origin/alpha`. Because trunk and alpha have diverged, these cherry-picks frequently produce merge conflicts. Your job is to run the cherry-pick loop, resolve conflicts with evidence-based reasoning, and abort cleanly when resolution is not possible with confidence.

## Invocation Inputs

The orchestrator spawns you with:

- `temp_worktree_path`: absolute path to a temporary worktree that is already checked out on the target `staging/<slug>` branch (either freshly cut from `origin/alpha` or carried over from a prior incremental run).
- `commit_range`: Git revision range (e.g., `abc123..def456`, or a single SHA for first-run / non-range invocations) specifying the production commits to cherry-pick in topological order.
- `spec_content`: the full contents of the task's SPEC.md.
- `service_source_paths`: map of service-id → absolute source path (primary task worktree or main repo) so you can inspect adjacent code when reasoning about conflicts. This may include services outside the one being cherry-picked.
- `service_id`: which service's cherry-pick this is.

## Behavioral Guardrails

**Evidence or abort. No guessing.**
- Every conflict resolution must be backed by a concrete SPEC requirement, a test expectation, or a clear pattern in adjacent code. If both sides look equally plausible and the SPEC is silent, abort.
- Never run `git cherry-pick --skip`. Skipping produces content drift invisible to reviewers.
- Never force-push, never rebase, never reset. Your scope is the temp worktree and cherry-pick operations only.
- Never edit SPEC.md, TASKS.md, or any artifact outside `temp_worktree_path`.
- Never `git commit --amend`.

**Self-test at each conflict:** *Can I point to a specific SPEC line, test, or adjacent function that justifies this choice?* If not, abort.

## Algorithm

1. `cd <temp_worktree_path>`.
2. Parse `commit_range` into an ordered list of commit SHAs:
   ```bash
   git rev-list --reverse <commit_range>
   ```
3. For each SHA in order:
   a. Run `git cherry-pick <sha>`.
   b. Inspect exit status:
      - `0` — clean cherry-pick. Continue to the next commit.
      - Non-zero with conflicts — proceed to resolution (below).
      - Non-zero without conflicts (e.g., empty commit) — abort with `{status: "aborted", unresolved_commit: <sha>, reason: "empty-or-invalid-commit"}`.
4. **Resolution loop** (conflict case):
   a. List conflicted paths:
      ```bash
      git status --porcelain | awk '/^(UU|AA|DD|AU|UA|DU|UD) /{print $2}'
      ```
   b. For each conflicted path:
      i. Read the file, identify `<<<<<<<` / `=======` / `>>>>>>>` markers.
      ii. Read the surrounding ±30 lines for context.
      iii. Grep the SPEC for the identifiers involved (function names, class names, route paths) to find authoritative requirements.
      iv. Inspect adjacent files if the conflict involves function signatures, API contracts, or shared types.
      v. Decide the resolution:
         - If SPEC explicitly dictates one side: apply that resolution.
         - If both sides are plausible and SPEC is silent: abort the cherry-pick (`git cherry-pick --abort`) and return `{status: "aborted", unresolved_commit: <sha>, conflicting_files: [<paths>], reason: "ambiguous-no-spec-evidence"}`.
         - If one side matches an established pattern in adjacent code and the other does not: prefer the side that matches the pattern.
         - If the conflict is purely structural (e.g., import ordering, trailing whitespace): merge both sides, keeping the union.
      vi. Write the resolved file. Remove all conflict markers.
      vii. `git add <path>`.
   c. After all conflicts are resolved and staged:
      ```bash
      git cherry-pick --continue --no-edit
      ```
      Use `--no-edit` to preserve the original commit message. If `--continue` fails (e.g., remaining conflicts you missed), abort.
5. After the final commit cherry-picks cleanly, capture:
   ```bash
   LAST_SHA=$(git rev-parse HEAD)
   ```
6. Return `{status: "success", last_staged_sha: <LAST_SHA>}`.

## Abort Output Format

```json
{
  "status": "aborted",
  "unresolved_commit": "<sha>",
  "conflicting_files": ["<path1>", "<path2>"],
  "reason": "<short description>",
  "explanation": "<1-3 sentences explaining why the agent could not resolve with confidence>"
}
```

Before returning, ensure the temp worktree is in a clean state:
```bash
git cherry-pick --abort 2>/dev/null || true
git reset --hard HEAD 2>/dev/null || true
```
(The orchestrator will remove the temp worktree; you only need to abort the in-flight cherry-pick so the worktree is not left mid-operation.)

## Success Output Format

```json
{
  "status": "success",
  "last_staged_sha": "<sha>"
}
```

## Escalation Triggers (abort immediately)

- Working tree in `temp_worktree_path` is unexpectedly dirty before the first cherry-pick.
- Commit range is empty (nothing to cherry-pick).
- A cherry-picked commit produces zero file changes (empty diff) — likely means the change was already applied upstream.
- More than one cherry-pick produces the same kind of conflict on the same file — suggests a systemic divergence that needs human review.
- SPEC content is missing or empty.

## Rules

- You have Read, Bash, Glob, Grep tools. No network access beyond local git.
- No `git push`, no `git fetch`, no `git remote` mutation. Pure local cherry-pick work.
- Preserve original commit messages via `git cherry-pick --no-edit` on `--continue`.
- Prefer one clear abort over five speculative resolutions.
- Report any unusual state (detached HEAD mid-cherry-pick, merge-in-progress, etc.) as an abort with `reason: "unexpected-state"`.

## Working Well When

- Cherry-picks that match clean SPEC requirements complete without human intervention.
- Ambiguous conflicts produce clean aborts with actionable `conflicting_files` lists.
- The orchestrator never has to clean up partial cherry-pick state — either you complete, or you abort with the worktree returned to a pre-cherry-pick state.
````

- [ ] **Step 2: Write `.opencode/agents/jlu-conflict-resolver.md`**

Use the same content. If OpenCode requires different frontmatter format, follow the pattern used by other `.opencode/agents/*.md` files — inspect `cat .opencode/agents/jlu-git-agent.md | head -10` to check the expected header shape. Otherwise use the frontmatter above verbatim.

- [ ] **Step 3: Verify**

Run: `ls -la agents/jlu-conflict-resolver.md .opencode/agents/jlu-conflict-resolver.md`
Expected: both files exist, non-empty.

Run: `diff <(sed -n '/^##/,/^##/p' agents/jlu-conflict-resolver.md | head -20) <(sed -n '/^##/,/^##/p' .opencode/agents/jlu-conflict-resolver.md | head -20)`
Expected: no diff (or only frontmatter differences).

- [ ] **Step 4: Commit**

```bash
git add agents/jlu-conflict-resolver.md .opencode/agents/jlu-conflict-resolver.md
git commit -m "agents: add jlu-conflict-resolver for cherry-pick conflict resolution"
```

---

## Phase 4 — `/jlu-create-pr` dual-PR synthesis

### Task 12: Rename `spec/<slug>` → `production/<slug>` in `create-pr.md`

**Files:**
- Modify: `jelou/workflows/create-pr.md`

- [ ] **Step 1: Global rename within the file**

Run: `grep -n 'spec/<' jelou/workflows/create-pr.md`

For every match, update to `production/<`. Specifically:
- `spec/<TASK_SLUG>` → `production/<TASK_SLUG>`
- `spec/<task-slug>` → `production/<task-slug>`
- Step 1 branch-matching heuristic: "current git branch matches `spec/<task-slug>`" → "current git branch matches `production/<task-slug>`"
- Step 2b diff commands: `git diff <DEFAULT_BRANCH>..spec/<TASK_SLUG>` → `git diff <DEFAULT_BRANCH>..production/<TASK_SLUG>`
- Step 6 PR lookup: `gh pr view spec/<TASK_SLUG>` → `gh pr view production/<TASK_SLUG>`
- Step 7e PR create: `--head spec/<TASK_SLUG>` → `--head production/<TASK_SLUG>`

- [ ] **Step 2: Verify**

Run: `grep -n 'spec/<' jelou/workflows/create-pr.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "create-pr: rename spec/<slug> to production/<slug>"
```

---

### Task 13: Update Step 2 of `create-pr.md` to read `## Branching`

**Files:**
- Modify: `jelou/workflows/create-pr.md`

- [ ] **Step 1: Extend Step 2 "Load Task State" to read new fields**

In the existing Step 2 block, find the list of things read from TASKS.md:
```
1. Read `<TASK_DIR>/TASKS.md`. Extract:
   - Current status
   - Affected services list
   - Phase progress (per service)
   - Task title
```

Add four new bullets after "Task title":
```
   - Dual PR (from `## Branching → Dual PR`, default "no" if section is absent)
   - Setup Mode (from `## Branching → Mode`, default "worktree" if section is absent)
   - Last alpha SHA (from `## Branching → Last alpha SHA`, may be empty/pending)
   - Last cherry-picked production SHA (from `## Branching → Last cherry-picked production SHA`, may be empty/pending)
```

Add four new entries to the **Store** line at the end of Step 2:
```
**Store**: TASK_TITLE, PROBLEM_STATEMENT, PROPOSAL_SUMMARY, AFFECTED_SERVICES, SERVICE_PATHS, PHASE_PROGRESS, DUAL_PR, SETUP_MODE, LAST_ALPHA_SHA, LAST_CHERRYPICKED_PROD_SHA
```

- [ ] **Step 2: Verify**

Run: `grep -n 'DUAL_PR\|LAST_ALPHA_SHA\|LAST_CHERRYPICKED_PROD_SHA\|SETUP_MODE' jelou/workflows/create-pr.md`
Expected: multiple matches, at least in Step 2.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "create-pr: Step 2 reads ## Branching fields from TASKS.md"
```

---

### Task 14: Add Step 5b (dual-PR cherry-pick synthesis) to `create-pr.md`

**Files:**
- Modify: `jelou/workflows/create-pr.md`

- [ ] **Step 1: Insert Step 5b after Step 5**

Add this new section after the existing `## Step 5 — Stage, Commit, Push (via git-agent)` and before `## Step 6 — Check for Existing PR`:

````markdown
---

## Step 5b — Dual-PR Cherry-Pick Synthesis

**Runs only if `DUAL_PR = yes`.** Executes per-service inside the loop started in Step 3, right after Step 5 completes for that service.

### 5b.1 — Fetch

```bash
cd <SERVICE_REPO_ROOT>   # main repo root, NOT the primary task worktree
git fetch origin
```

Use the service's main repo root (from `services.yaml`), not the worktree. The cherry-pick always runs from the main repo because the temp staging worktree is added off it, and the main repo's refs are where `origin/alpha` lives.

### 5b.2 — Verify alpha exists

```bash
ALPHA_EXISTS=$(git ls-remote --heads origin alpha | head -1)
```

If empty, warn and skip to Step 6 for this service:

> Service `<service-id>` has no `alpha` branch at origin. Skipping staging PR. Trunk PR still proceeds.

Record `STAGING_SYNC[<service-id>] = "skipped-no-alpha"` in the PR_RESULTS map.

### 5b.3 — Rebuild vs incremental decision

```bash
CURRENT_ALPHA_SHA=$(git rev-parse origin/alpha)
CURRENT_PRODUCTION_SHA=$(git rev-parse production/<TASK_SLUG>)
```

Decision tree (using `LAST_ALPHA_SHA` and `LAST_CHERRYPICKED_PROD_SHA` from Step 2):

- If `LAST_ALPHA_SHA` is empty OR `LAST_CHERRYPICKED_PROD_SHA` is empty → **rebuild** (first sync). Cherry-pick range: `origin/<TRUNK>..production/<TASK_SLUG>`.
- Else if `CURRENT_ALPHA_SHA != LAST_ALPHA_SHA` → **rebuild**. Cherry-pick range: `origin/<TRUNK>..production/<TASK_SLUG>`.
- Else if `CURRENT_PRODUCTION_SHA == LAST_CHERRYPICKED_PROD_SHA` → **no-op** (staging already current). Skip to Step 6 for this service. Record `STAGING_SYNC[<service-id>] = "no-op"`.
- Else → **incremental**. Cherry-pick range: `<LAST_CHERRYPICKED_PROD_SHA>..production/<TASK_SLUG>`.

Store for this service: `SYNC_MODE ∈ {rebuild, incremental, no-op}`, `CHERRY_PICK_RANGE`.

### 5b.4 — Prepare temp staging worktree

For `SYNC_MODE = rebuild`:

```bash
# Tear down any stale local staging branch
git branch -D staging/<TASK_SLUG> 2>/dev/null || true
# Create fresh temp worktree on a brand-new staging branch from origin/alpha
git worktree add -b staging/<TASK_SLUG> .worktrees/<TASK_SLUG>-staging-tmp origin/alpha
```

For `SYNC_MODE = incremental`:

```bash
# Local staging branch exists from a previous run; add a worktree on it
git worktree add .worktrees/<TASK_SLUG>-staging-tmp staging/<TASK_SLUG>
```

If either worktree add fails (e.g., temp worktree already exists), abort for this service:

> Temp staging worktree for `<service-id>` is in an unexpected state. Remove `.worktrees/<TASK_SLUG>-staging-tmp` manually and re-run `/jlu-create-pr`.

Record as an abort and continue to the next service.

### 5b.5 — Spawn jlu-conflict-resolver

Spawn `jlu-conflict-resolver` with `MODEL_CONFIG.code` (default sonnet) and pass:

- `temp_worktree_path`: `<SERVICE_REPO_ROOT>/.worktrees/<TASK_SLUG>-staging-tmp`
- `commit_range`: `CHERRY_PICK_RANGE`
- `spec_content`: full contents of `<TASK_DIR>/SPEC.md`
- `service_source_paths`: map of every affected service's source path (so the agent can read adjacent code across services if needed)
- `service_id`: `<service-id>`

### 5b.6 — Handle sub-agent result

On `{status: "success", last_staged_sha}`:

Proceed to Step 5b.7.

On `{status: "aborted", unresolved_commit, conflicting_files, reason, explanation}`:

1. Clean up:
   ```bash
   git worktree remove --force .worktrees/<TASK_SLUG>-staging-tmp
   git branch -D staging/<TASK_SLUG> 2>/dev/null || true
   ```
   (Force-delete local staging — this run's partial state is discarded. Next `/jlu-create-pr` will rebuild from scratch.)
2. Using `question`, present to the user:
   ```
   Staging-PR synthesis aborted for <service-id>.
     Commit: <unresolved_commit>
     Reason: <reason>
     Conflicting files:
       - <path1>
       - <path2>
     Explanation: <explanation>

   Options:
     A) Resolve manually — cut staging/<TASK_SLUG> from origin/alpha, cherry-pick <CHERRY_PICK_RANGE>, resolve conflicts, push, then re-run /jlu-create-pr.
     B) Disable dual-PR for this task — edit TASKS.md (Dual PR: no), then re-run /jlu-create-pr.
     C) Abort /jlu-create-pr entirely.
   ```
3. On "A": stop the workflow. Note that the trunk PR may already exist — report its state. User resolves and re-runs.
4. On "B": update `<TASK_DIR>/TASKS.md` → `## Branching → Dual PR: no`. Continue with trunk-only flow (skip to Step 6 for remaining services; skip all remaining 5b steps).
5. On "C": stop the workflow.

### 5b.7 — Push staging

For `SYNC_MODE = rebuild`:
```bash
git push --force-with-lease origin staging/<TASK_SLUG>
```

For `SYNC_MODE = incremental`:
```bash
git push origin staging/<TASK_SLUG>
```

If either push is rejected (non-fast-forward on incremental, or `--force-with-lease` detects an unexpected remote ref), abort per Option A logic:

> Remote `staging/<TASK_SLUG>` has diverged unexpectedly for `<service-id>`. Inspect remote, reconcile, and re-run `/jlu-create-pr`.

Clean up the temp worktree and local staging branch before aborting:
```bash
git worktree remove --force .worktrees/<TASK_SLUG>-staging-tmp
git branch -D staging/<TASK_SLUG> 2>/dev/null || true
```

### 5b.8 — Update markers

Write into `<TASK_DIR>/TASKS.md` → `## Branching`:
- `Last alpha SHA: <CURRENT_ALPHA_SHA>`
- `Last cherry-picked production SHA: <CURRENT_PRODUCTION_SHA>`

(If multiple services are affected and each has its own sync, use a nested form under `## Branching`:
```
## Branching
- Dual PR: yes
- ...
- Sync markers per service:
  - <service-id-1>: alpha=<sha>, production=<sha>
  - <service-id-2>: alpha=<sha>, production=<sha>
```
Single-service tasks use the flat form.)

### 5b.9 — Remove temp worktree

```bash
git worktree remove .worktrees/<TASK_SLUG>-staging-tmp
```

Keep the local `staging/<TASK_SLUG>` branch for future incremental runs.

Record `STAGING_SYNC[<service-id>] = SYNC_MODE` (rebuild | incremental | no-op).
````

- [ ] **Step 2: Verify**

Run: `grep -n 'Step 5b' jelou/workflows/create-pr.md`
Expected: multiple matches (section heading + sub-step headings).

Run: `grep -n 'jlu-conflict-resolver' jelou/workflows/create-pr.md`
Expected: at least one match.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "create-pr: add Step 5b dual-PR cherry-pick synthesis via conflict-resolver"
```

---

### Task 15: Update Step 6 & Step 7 of `create-pr.md` for dual-PR

**Files:**
- Modify: `jelou/workflows/create-pr.md`

- [ ] **Step 1: Wrap Step 6 existing-PR logic to also check the staging PR**

In the existing Step 6, the check `gh pr view production/<TASK_SLUG>` returns the trunk PR's state. When `DUAL_PR = yes` AND `STAGING_SYNC[<service-id>]` ∈ {rebuild, incremental, no-op}, run a second check:

After the existing Step 6 logic, add:

```markdown
### 6b — Check for Existing Staging PR

Runs only if `DUAL_PR = yes` AND `STAGING_SYNC[<service-id>]` is not `"skipped-no-alpha"` and not `"aborted"`.

```bash
cd <SERVICE_CWD> && gh pr view staging/<TASK_SLUG> --json url,state,title,number 2>&1
```

Apply the retry protocol (same as Step 6).

Parse the result:

- **`OPEN`**: store URL and number. Record `STAGING_PR_ACTION[<service-id>] = "existing"`.
- **`MERGED`**: store URL and number. Record `STAGING_PR_ACTION[<service-id>] = "existing"`.
- **`CLOSED`**: ask the user whether to re-open a new staging PR (same flow as CLOSED for trunk PR).
- **Not found**: proceed to Step 7 for the staging PR.
```

- [ ] **Step 2: Extend Step 7 to create the alpha PR after the trunk PR**

After the existing Step 7e "Create the PR" block (which creates the trunk PR), add:

```markdown
### 7f — Create Alpha PR (dual-PR path)

Runs only if `DUAL_PR = yes` AND `STAGING_SYNC[<service-id>]` ∈ {rebuild, incremental, no-op} AND `STAGING_PR_ACTION[<service-id>]` is not `"existing"`.

Construct the staging PR body:

```markdown
## Problem
<Problem statement from SPEC.md>

## Impact
<Summary from PROPOSAL.md>

## Changes
**Service**: <SERVICE_ID>
**Branch**: `staging/<TASK_SLUG>` → `alpha`

### Phase Progress
<Phase progress table from TASKS.md for this service>

### Test Results
<Test summary from TASKS.md for this service, if available>
```

If `STAGING_SYNC[<service-id>] = "rebuild"`, prepend to the PR body (before `## Problem`):

```
> Note: this branch was rebuilt from `origin/alpha` in the latest run. Prior review comments may be detached from their original commits.
```

If `COMPLIANCE_REPORT` exists, append the same `<details>` block used in the trunk PR body.

Create the PR:

```bash
cd <SERVICE_CWD> && gh pr create \
  --base alpha \
  --head staging/<TASK_SLUG> \
  --title "<PR_TITLE>" \
  --body "$(cat <<'EOF'
<STAGING_PR_BODY>
EOF
)"
```

Apply the retry protocol on rate limits.

Record the PR URL and number as `STAGING_PR[<service-id>]`. Set `STAGING_PR_ACTION[<service-id>] = "created"`.
```

- [ ] **Step 3: Verify**

Run: `grep -n 'Step 6b\|7f — Create Alpha PR' jelou/workflows/create-pr.md`
Expected: two matches (one for each heading).

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "create-pr: extend Steps 6 and 7 to detect/create the alpha PR"
```

---

### Task 16: Add Step 8b (dual-PR cross-linking) to `create-pr.md`

**Files:**
- Modify: `jelou/workflows/create-pr.md`

- [ ] **Step 1: Insert Step 8b after Step 8**

After the existing `## Step 8 — Cross-Reference PRs (multi-service only)` and before `## Step 9 — Update TASKS.md`, add:

````markdown
---

## Step 8b — Dual-PR Cross-Linking (per service)

Runs only for services with `DUAL_PR = yes` AND both `production/<TASK_SLUG>` PR and `staging/<TASK_SLUG>` PR exist.

For each qualifying service:

1. Read the current body of the trunk PR: `gh pr view <trunk-pr-number> --json body`.
2. Prepend to the trunk PR body, above the existing `## Problem` header:
   ```
   > Part of dual-PR task. Sibling PR: <staging-pr-url>

   ```
3. Update:
   ```bash
   cd <SERVICE_CWD> && gh pr edit <trunk-pr-number> --body "$(cat <<'EOF'
   <UPDATED_TRUNK_BODY>
   EOF
   )"
   ```
4. Repeat symmetrically for the staging PR with `Sibling PR: <trunk-pr-url>`.

Apply the retry protocol on rate limits. On exhaustion or failure, warn and continue — cross-linking is non-critical.
````

- [ ] **Step 2: Verify**

Run: `grep -n 'Step 8b — Dual-PR Cross-Linking' jelou/workflows/create-pr.md`
Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "create-pr: add Step 8b dual-PR cross-linking"
```

---

### Task 17: Update Steps 9 & 10 of `create-pr.md` for dual PRs

**Files:**
- Modify: `jelou/workflows/create-pr.md`

- [ ] **Step 1: Update Step 9 External Links to record both PRs**

In Step 9 "External Links" section, change the single PR row template to:

```markdown
### External Links

Add or update PR rows in the External Links section:
```
| PR main (<service-id>) | <trunk-pr-url> |
| PR alpha (<service-id>) | <alpha-pr-url> |  (only when DUAL_PR = yes and alpha PR exists)
```

If the External Links section doesn't exist, create it.
```

- [ ] **Step 2: Update Step 9 Timeline entries to include alpha PRs**

In Step 9 Timeline section, change the template to:

```markdown
### Timeline

Append to the Timeline section:
```
| <ISO-timestamp> | PR created (trunk) | <service-id>: <trunk-pr-url> |
| <ISO-timestamp> | PR created (alpha) | <service-id>: <alpha-pr-url> |  (only when alpha PR is new)
```

For existing PRs that were not newly created, use "PR found (existing)" instead of "PR created".
```

- [ ] **Step 3: Update Step 10 CLICKUP_TASK.json shape**

In Step 10, replace the existing `pr` field shape with:

```markdown
1. If `<TASK_DIR>/CLICKUP_TASK.json` exists:
   - Update the `pr` field with a per-service nested object:
     ```json
     {
       "pr": {
         "<service-id-1>": {
           "main": "<trunk-pr-url>",
           "alpha": "<alpha-pr-url>"
         },
         "<service-id-2>": {
           "main": "<trunk-pr-url>"
         }
       }
     }
     ```
     Include `alpha` only when the service has an alpha PR (DUAL_PR = yes and alpha branch existed).
2. If the file does not exist: skip.
```

- [ ] **Step 4: Verify**

Run: `grep -n 'PR main\|PR alpha\|"main":\|"alpha":' jelou/workflows/create-pr.md`
Expected: matches in Step 9 and Step 10.

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "create-pr: update Steps 9 and 10 to record dual PRs in TASKS.md and CLICKUP_TASK.json"
```

---

## Phase 5 — `/jlu-execute-task` mode-aware execution

### Task 18: Add branch-mode auto-checkout to `execute-task.md`

**Files:**
- Modify: `jelou/workflows/execute-task.md`

- [ ] **Step 1: Rename all `spec/<slug>` references to `production/<slug>`**

Run: `grep -n 'spec/<' jelou/workflows/execute-task.md`

For each match, update to `production/<`.

- [ ] **Step 2: Add a new Step 3b "Mode Detection and Auto-Checkout"**

Add after the existing Step 3 (Session Recovery) and before Step 4 (Generate Proposal):

````markdown
---

## Step 3b — Mode Detection and Auto-Checkout (Decision gate)

Read `<TASK_DIR>/TASKS.md` → `## Branching → Mode`:

- If `Mode: worktree` or the `## Branching` section is absent (old-style task): skip to Step 4. Implementation will run in the task worktree.
- If `Mode: branch`: continue with the branch-mode pre-flight below.

### Branch-mode pre-flight (runs before the first phase)

For each affected service:

1. `cd <SERVICE_REPO_ROOT>` (the main repo, since there is no worktree).
2. Verify the working tree is clean:
   ```bash
   DIRTY=$(git status --porcelain)
   ```
   If `DIRTY` is non-empty, abort the workflow with:
   > Working tree of `<service-id>` is dirty, cannot auto-checkout `production/<TASK_SLUG>`. Resolve first and re-run `/jlu-execute-task`.
3. Verify `production/<TASK_SLUG>` exists locally:
   ```bash
   git rev-parse --verify production/<TASK_SLUG> >/dev/null 2>&1
   ```
   If missing, abort: *"Local branch `production/<TASK_SLUG>` is missing for `<service-id>`. Re-run `/jlu-new-task <TASK_SLUG>` to recreate, or create manually."*
4. Checkout:
   ```bash
   git checkout production/<TASK_SLUG>
   ```

**Store**: `MODE = "branch"` (for downstream agents that may need it).

Continue to Step 4.
````

- [ ] **Step 3: Verify**

Run: `grep -n 'Step 3b — Mode Detection' jelou/workflows/execute-task.md`
Expected: one match.

Run: `grep -n 'spec/<' jelou/workflows/execute-task.md`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "execute-task: rename branch refs and add branch-mode auto-checkout pre-flight"
```

---

## Phase 6 — `/jlu-close-task` dual-PR teardown

### Task 19: Update `close-task.md` for dual-PR teardown and branch rename

**Files:**
- Modify: `jelou/workflows/close-task.md`

- [ ] **Step 1: Rename all `spec/<slug>` references to `production/<slug>`**

Run: `grep -n 'spec/<' jelou/workflows/close-task.md`

For each match, update to `production/<`.

- [ ] **Step 2: Extend "Check PR Status" to cover both PRs when DUAL_PR = yes**

Locate the existing Step 2b "Check PR Status" section. Replace the single-PR logic with:

```markdown
### 2b. Check PR Status

1. Read `<TASK_DIR>/TASKS.md` → `## Branching → Dual PR` (default "no").
2. Read `## Branching → Setup Mode` (default "worktree").
3. From `## External Links`, extract:
   - Trunk PR URL (row labeled "PR main (<service-id>)", or the legacy "PR (<service-id>)")
   - Alpha PR URL (row labeled "PR alpha (<service-id>)", only present when Dual PR = yes)

For each affected service:

4. **Trunk PR** (required): `gh pr view <trunk-pr-url> --json state,mergedAt`. Must be in `MERGED` state. If not, present the same options as today (check different URL / skip PR check / abort).
5. **Alpha PR** (if DUAL_PR = yes): `gh pr view <alpha-pr-url> --json state,mergedAt`. **Not required to be merged.** Record its state for later teardown (Step 4).
```

- [ ] **Step 3: Extend cleanup section with dual-PR teardown**

Locate the current worktree cleanup step (typically Step 4 or similar). Replace its body with:

````markdown
### 4. Cleanup

For each affected service:

1. `cd <SERVICE_REPO_ROOT>` (main repo).

2. **Alpha PR teardown** (only when `DUAL_PR = yes` AND an alpha PR URL was recorded):
   - If alpha PR state was `OPEN` or `DRAFT`:
     ```bash
     gh pr close <alpha-pr-url> --delete-branch
     ```
     This closes the PR and deletes the remote `staging/<TASK_SLUG>` branch.
   - Else if alpha PR state was `CLOSED` or `MERGED`:
     - Check if remote `staging/<TASK_SLUG>` still exists:
       ```bash
       git ls-remote --heads origin staging/<TASK_SLUG>
       ```
     - If it exists, delete it:
       ```bash
       git push origin :staging/<TASK_SLUG> || true
       ```

3. **Local branch teardown**:
   - Delete local `staging/<TASK_SLUG>` if present:
     ```bash
     git branch -D staging/<TASK_SLUG> 2>/dev/null || true
     ```
   - Delete local `production/<TASK_SLUG>` (must be merged on trunk, which was verified in Step 2b):
     ```bash
     git branch -d production/<TASK_SLUG>
     ```
     If this fails because git thinks it's not merged (e.g., squash-merge on GitHub), fall back to:
     ```bash
     git branch -D production/<TASK_SLUG>
     ```
     Force-delete is acceptable here because the trunk PR merge was verified in Step 2b.

4. **Temp staging worktree teardown** (defensive — should already be gone):
   ```bash
   git worktree remove --force .worktrees/<TASK_SLUG>-staging-tmp 2>/dev/null || true
   ```

5. **Primary worktree teardown** (only when `Mode: worktree`):
   ```bash
   # Tear down Docker first if this is a Docker-enabled service
   cd .worktrees/<TASK_SLUG> && docker compose down -v --rmi all --remove-orphans 2>/dev/null || true
   cd <SERVICE_REPO_ROOT>
   git worktree remove .worktrees/<TASK_SLUG> || git worktree remove --force .worktrees/<TASK_SLUG>
   ```

6. Record cleanup summary per service for the final report.
````

- [ ] **Step 4: Verify**

Run: `grep -n 'spec/<' jelou/workflows/close-task.md`
Expected: no matches.

Run: `grep -n 'Alpha PR teardown\|gh pr close.*--delete-branch\|git worktree remove --force' jelou/workflows/close-task.md`
Expected: at least one match per pattern.

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/close-task.md
git commit -m "close-task: rename branch refs and add dual-PR + mode-aware teardown"
```

---

## Phase 7 — rollback, load-context, report-task

### Task 20: Update `rollback-phase.md` for branch rename and mode awareness

**Files:**
- Modify: `jelou/workflows/rollback-phase.md`

- [ ] **Step 1: Rename branch references**

Run: `grep -n 'spec/<' jelou/workflows/rollback-phase.md`

For each match, update to `production/<`.

- [ ] **Step 2: Add mode-aware reset logic**

Locate the existing reset logic (likely uses `git reset --hard <sha>` in the worktree). Replace it with:

```markdown
### Mode-Aware Reset

Read `<TASK_DIR>/TASKS.md` → `## Branching → Mode`.

**If `Mode: worktree`**:

```bash
cd <SERVICE_REPO_ROOT>/.worktrees/<TASK_SLUG>
# Verify we're on production/<TASK_SLUG>
[[ $(git rev-parse --abbrev-ref HEAD) = "production/<TASK_SLUG>" ]] || { echo "Unexpected branch"; exit 1; }
git reset --hard <target-phase-sha>
```

**If `Mode: branch`**:

```bash
cd <SERVICE_REPO_ROOT>
# Verify we're on production/<TASK_SLUG>
[[ $(git rev-parse --abbrev-ref HEAD) = "production/<TASK_SLUG>" ]] || {
  echo "Not on production/<TASK_SLUG> — checkout first and retry"
  exit 1
}
# Verify working tree is clean
[[ -z "$(git status --porcelain)" ]] || {
  echo "Working tree dirty — resolve first and retry"
  exit 1
}
git reset --hard <target-phase-sha>
```

Rollback does NOT touch `staging/<TASK_SLUG>`. The next `/jlu-create-pr` run will detect that `production/<TASK_SLUG>` moved backward (its tip SHA no longer matches `Last cherry-picked production SHA` and is not an ancestor) and will perform a rebuild, force-pushing the new staging state.
```

- [ ] **Step 3: Verify**

Run: `grep -n 'spec/<' jelou/workflows/rollback-phase.md`
Expected: no matches.

Run: `grep -n 'Mode-Aware Reset' jelou/workflows/rollback-phase.md`
Expected: one match.

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/rollback-phase.md
git commit -m "rollback-phase: rename branch refs and add mode-aware reset"
```

---

### Task 21: Update `load-context.md` branch references

**Files:**
- Modify: `jelou/workflows/load-context.md`

- [ ] **Step 1: Rename branch references**

Run: `grep -n 'spec/<' jelou/workflows/load-context.md`

For each match, update to `production/<`.

- [ ] **Step 2: Verify**

Run: `grep -n 'spec/<' jelou/workflows/load-context.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/load-context.md
git commit -m "load-context: rename spec/<slug> to production/<slug>"
```

---

### Task 22: Update `report-task.md` — branch rename + stale temp worktree detection

**Files:**
- Modify: `jelou/workflows/report-task.md`

- [ ] **Step 1: Rename branch references**

Run: `grep -n 'spec/<' jelou/workflows/report-task.md`

For each match, update to `production/<`.

- [ ] **Step 2: Add stale-temp-worktree detection**

Locate the existing stale-worktree detection section. After the existing stale-worktree logic, add:

```markdown
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
```

- [ ] **Step 3: Add branch-mode stale branch detection**

In the stale-detection section, also add:

```markdown
### Stale Branch-Mode Branches

For tasks in `done` or `closed` state with `Mode: branch`, check for local `production/<TASK_SLUG>` branches still present in service repos:

```bash
git -C <service-repo> rev-parse --verify production/<TASK_SLUG> 2>/dev/null
```

If present, report as a candidate for cleanup (not auto-removed).
```

- [ ] **Step 4: Verify**

Run: `grep -n 'spec/<' jelou/workflows/report-task.md`
Expected: no matches.

Run: `grep -n 'Stale Temp Staging Worktrees\|Stale Branch-Mode Branches' jelou/workflows/report-task.md`
Expected: both match.

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/report-task.md
git commit -m "report-task: detect stale temp staging worktrees and branch-mode leftovers"
```

---

## Phase 8 — Docs and housekeeping

### Task 23: Audit and update `docker-conventions.md`

**Files:**
- Modify: `jelou/references/docker-conventions.md`

- [ ] **Step 1: Search for branch-name leakage**

Run: `grep -n 'spec/<\|spec/$' jelou/references/docker-conventions.md`

For each match, update to `production/<`. Docker override keying remains on `<TASK_SLUG>`, not branch name — verify that distinction holds.

- [ ] **Step 2: Verify**

Run: `grep -n 'spec/<' jelou/references/docker-conventions.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add jelou/references/docker-conventions.md
git commit -m "docker-conventions: rename any residual spec/<slug> references"
```

---

### Task 24: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Search for branch-name examples**

Run: `grep -n 'spec/<\|spec/add-\|spec/fix-' README.md`

For each match:
- Rename `spec/<slug>` → `production/<slug>` in examples.
- In any "branch naming" bullet list, update to describe both `production/<slug>` and optional `staging/<slug>`.

- [ ] **Step 2: Add a short "Dual-PR" subsection to the workflow overview**

Near the existing `/jlu-create-pr` description, insert a short paragraph:

```markdown
### Dual-PR Tasks

Tasks opting into dual-PR (via the `/jlu-new-task` prompt "Also create a PR to `alpha`?") produce **two** PRs on `/jlu-create-pr`:

- `production/<slug>` → trunk (the mandatory primary PR)
- `staging/<slug>` → `alpha` (synthesized on-demand: cut from `origin/alpha`, with production commits cherry-picked on top by the `jlu-conflict-resolver` sub-agent)

If the conflict resolver cannot resolve a merge conflict with confidence, the staging side aborts cleanly and offers the user three options: resolve manually, disable dual-PR, or abort.
```

- [ ] **Step 3: Verify**

Run: `grep -n 'spec/<' README.md`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "README: update branch-naming examples and document dual-PR flow"
```

---

### Task 25: Add CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Prepend a new entry**

At the top of the CHANGELOG (under any header — match the existing format), add a new version block following the project's convention. The entry should read approximately:

```markdown
## <next-version> — <date>

### Added
- Branch-only setup mode: `/jlu-new-task` asks (after spec approval) whether to use the full worktree+Docker setup or a lightweight branch-only setup.
- Dual-PR support: tasks can opt into producing a second PR targeting `alpha`. The `staging/<slug>` branch is synthesized on-demand at `/jlu-create-pr` time by cherry-picking production commits onto a fresh cut of `origin/alpha`.
- `jlu-conflict-resolver` sub-agent (sonnet): runs cherry-pick loops and resolves merge conflicts using SPEC + adjacent code as evidence.

### Changed
- Branch naming: `spec/<slug>` is replaced by `production/<slug>` (mandatory) and optional `staging/<slug>`. Old tasks continue to use the legacy name through close.
- `/jlu-new-task`: environment setup (worktree, Docker) is now deferred until after spec approval. Aborted or declined tasks leave no filesystem or Docker state behind.
- `/jlu-create-pr`: records two PRs in `TASKS.md` and `CLICKUP_TASK.json` when `DUAL_PR = yes`; cross-links sibling PR URLs in both PR bodies.
- `/jlu-close-task`: tears down the staging side (closes PR, removes remote/local `staging/<slug>`) regardless of whether the alpha PR was merged. Closure requires only the trunk PR to be merged.

### Internal
- Removed `new-task.md` Step 9 (background worktree subtask). Replaced with Step 15b (mode selection) and Step 15c (setup subtask) that run only after spec approval.
- `jlu-git-agent` simplified: operates only on `production/<slug>`; no paired pushes; no dual-PR awareness.
- `jlu-report-task` detects stale `.worktrees/<slug>-staging-tmp` directories older than 1 hour.
```

Replace `<next-version>` and `<date>` with whatever the pre-commit version-bump hook produces for this commit range.

- [ ] **Step 2: Verify**

Run: `head -30 CHANGELOG.md`
Expected: the new entry at the top.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): entry for branch-mode and dual-PR feature"
```

---

## Phase 9 — End-to-end verification

### Task 26: Manual smoke test — worktree mode, no dual-PR

**Files:**
- (no edits — verification only)

- [ ] **Step 1: Create a throwaway test task**

In a test workspace (a pet repo registered in `services.yaml`), run:

```
/jlu-new-task smoke-worktree-nodual
```

Answer the interview prompts:
- Dual PR? → No
- Approve spec? → Yes
- Mode? → Full setup (worktree + Docker)

- [ ] **Step 2: Verify branches**

```bash
cd <test-service-repo>
git branch -a
```

Expected:
- Local `production/smoke-worktree-nodual`
- No `staging/smoke-worktree-nodual`
- Remote `production/*` not yet pushed

- [ ] **Step 3: Verify worktree**

```bash
ls .worktrees/smoke-worktree-nodual/
```

Expected: worktree exists and contains a checkout of `production/smoke-worktree-nodual`.

- [ ] **Step 4: Verify TASKS.md**

Read `.spec-workspace/specs/<date>/smoke-worktree-nodual/TASKS.md`.

Expected `## Branching` section:
```
- Dual PR: no
- Primary branch: production/smoke-worktree-nodual
- Mode: worktree
```

- [ ] **Step 5: Clean up**

Follow `/jlu-close-task smoke-worktree-nodual` (or manual cleanup with `git worktree remove` + `git branch -D`) — do not commit any test artifacts.

No commit for this task.

---

### Task 27: Manual smoke test — branch mode, dual-PR

**Files:**
- (no edits — verification only)

- [ ] **Step 1: Create a throwaway test task**

```
/jlu-new-task smoke-branch-dual
```

Answer:
- Dual PR? → Yes
- Approve spec? → Yes
- Mode? → Branch only

Before approval, ensure the test service repo is on trunk and the working tree is clean.

- [ ] **Step 2: Verify branches and absence of worktree**

```bash
cd <test-service-repo>
git branch -a
ls .worktrees/ 2>/dev/null
docker ps --format '{{.Names}}' | grep smoke-branch-dual
```

Expected:
- Local `production/smoke-branch-dual` exists
- No local `staging/smoke-branch-dual` (not yet synthesized)
- `.worktrees/` either doesn't exist or doesn't contain `smoke-branch-dual`
- No Docker containers for the task

- [ ] **Step 3: Verify TASKS.md**

Expected `## Branching` section:
```
- Dual PR: yes
- Primary branch: production/smoke-branch-dual
- Secondary branch: staging/smoke-branch-dual   (intended; synthesized at first /jlu-create-pr when Dual PR = yes)
- Mode: branch
- Last alpha SHA: (pending ...)
- Last cherry-picked production SHA: (pending ...)
```

- [ ] **Step 4: Simulate /jlu-execute-task pre-flight**

(Optional — if the task is small enough to simulate the full flow. Otherwise skip to Step 5.)

```
/jlu-execute-task smoke-branch-dual
```

Verify the workflow auto-checks-out `production/smoke-branch-dual` in the main repo before the first phase.

- [ ] **Step 5: Clean up**

Follow `/jlu-close-task` or manual cleanup. Verify that cleanup deletes local `production/smoke-branch-dual` and doesn't leave any `staging/*` leftover.

No commit for this task.

---

### Task 28: Manual smoke test — dual-PR cherry-pick + conflict resolver

**Files:**
- (no edits — verification only)

- [ ] **Step 1: Prepare a divergent alpha**

In the test service, prior to task creation:

```bash
cd <test-service-repo>
git checkout alpha
# Make a deliberate change to a file that the task will ALSO modify, creating a likely cherry-pick conflict
echo "alpha-only-change" >> shared_file.txt
git commit -am "chore: alpha-only change for smoke test"
git push origin alpha
git checkout main  # or master
```

- [ ] **Step 2: Create task with dual-PR enabled**

```
/jlu-new-task smoke-dual-conflict
```

Answer: Dual PR = yes, Mode = worktree (or branch, either works).

- [ ] **Step 3: Run the TDD phases (or manually commit) to create commits on production/<slug>**

Make at least one commit on `production/smoke-dual-conflict` that modifies `shared_file.txt` in a way that overlaps with the alpha-only change. This is the conflict scenario.

- [ ] **Step 4: Run /jlu-create-pr**

```
/jlu-create-pr smoke-dual-conflict
```

Expected workflow path:
- Step 5 pushes `production/smoke-dual-conflict`.
- Step 5b.1 fetches origin.
- Step 5b.3 decides rebuild (first run).
- Step 5b.4 creates `.worktrees/smoke-dual-conflict-staging-tmp`.
- Step 5b.5 spawns `jlu-conflict-resolver`.
- The resolver detects the conflict in `shared_file.txt` and EITHER resolves it with evidence (if SPEC is clear) OR aborts with `conflicting_files: [shared_file.txt]`.

- [ ] **Step 5: Verify abort path (if resolver aborted)**

```bash
cd <test-service-repo>
ls .worktrees/smoke-dual-conflict-staging-tmp 2>/dev/null
git branch -a | grep staging/smoke-dual-conflict
git ls-remote --heads origin staging/smoke-dual-conflict
```

Expected: temp worktree removed, local staging branch deleted, no remote staging ref. User was presented with the three options (resolve manually / disable dual-PR / abort).

- [ ] **Step 6: Verify success path (if resolver resolved)**

```bash
git log origin/staging/smoke-dual-conflict --oneline
```

Expected: cherry-picked commit visible on `origin/staging/smoke-dual-conflict`, with `shared_file.txt` containing both the alpha change and the task's change (merged per SPEC).

- [ ] **Step 7: Verify TASKS.md markers**

```
Last alpha SHA: <sha matching the alpha HEAD at sync time>
Last cherry-picked production SHA: <sha matching production HEAD>
```

- [ ] **Step 8: Clean up**

Follow `/jlu-close-task` — alpha PR may be open; verify teardown closes it, deletes remote `staging/*`, and removes local branches.

Verify no stale temp worktree is left behind.

No commit for this task.

---

## Self-Review Against Spec

### Spec coverage check

Each numbered item below is a spec requirement. Every one must map to at least one task above.

| Spec Goal / SC | Task(s) |
|---|---|
| Goal 1 (zero state for aborted tasks) | Task 7 (remove Step 9); Task 6, 8 (defer setup to post-approval) |
| Goal 2 (mode selection) | Task 8 (Step 15b), Task 9 (Step 15c both modes) |
| Goal 3 (production/<slug> + staging/<slug>) | Tasks 1–5, 12, 18–22 (branch rename); Task 6, 11 (staging intent + sub-agent) |
| Goal 4 (content parity via cherry-pick) | Task 11 (resolver), Task 14 (Step 5b) |
| Goal 5 (sub-agent handles conflicts) | Task 11 (jlu-conflict-resolver), Task 14 (spawning logic) |
| SC-1 (abort = no state) | Task 7, 26 |
| SC-2 (decline = no mode set) | Tasks 6, 8, 9 |
| SC-3 (worktree mode observable parity) | Tasks 9, 26 |
| SC-4 (branch mode observable) | Tasks 9, 27 |
| SC-5 (execute-task auto-checkout) | Task 18 |
| SC-6 (content parity after sync) | Tasks 11, 14, 28 |
| SC-7 (two PRs + cross-link) | Tasks 15, 16 |
| SC-8 (close-task teardown) | Task 19 |
| SC-9 (old tasks still close) | Task 2 (fallback logic), Task 19 (legacy row labels) |
| SC-10 (branch-mode strict abort) | Task 9 |
| SC-11 (resolver evidence-based) | Task 11 |
| SC-12 (rebuild vs incremental) | Task 14 |
| SC-13 (missing alpha gracefully skipped) | Task 14 (Step 5b.2) |

### Placeholder scan

Run against this plan:

```bash
grep -nE 'TBD|TODO|FIXME|XXX|similar to Task|implement later|add appropriate' docs/superpowers/plans/2026-04-15-branch-mode-and-dual-pr.md
```

Expected: no matches (empty output). Any match indicates a placeholder to fill in before starting execution.

### Consistency check

- Branch name in all tasks: `production/<TASK_SLUG>` (never `production/<slug>` mixed with `production/<task-slug>` in the same context — SPEC uses `<TASK_SLUG>` as the variable name in workflow files).
- Sub-agent name: `jlu-conflict-resolver` (hyphen-separated, matches other agents).
- Model tier: sonnet for the resolver, haiku for git-agent, sonnet for tasks-agent. Consistent with `MODEL_CONFIG` conventions.
- Temp worktree path: `.worktrees/<TASK_SLUG>-staging-tmp` (always same spelling).

### Testing plan

The plugin has no executable unit tests, so verification relies on three Phase 9 smoke tests:
- Task 26: worktree mode, no dual-PR (baseline parity with today's behavior).
- Task 27: branch mode, dual-PR intent recorded (setup stops at branch creation).
- Task 28: dual-PR cherry-pick full flow including conflict scenarios (both success and abort paths).

These smoke tests exercise the three spec dimensions (Change A — deferred setup, Change B — modes, Change C — dual-PR) in combination.

---

## Execution Notes

- Tasks 1–5 (Phase 1) are order-independent within themselves and can be parallelized if using subagent-driven execution.
- Tasks 6–10 (Phase 2) must be applied in order (each edits `new-task.md` at overlapping sections).
- Tasks 12–17 (Phase 4) must be applied in order (all edit `create-pr.md`).
- Task 11 (Phase 3) can run in parallel with Phases 1 and 2 (creates a new file).
- Task 18 (Phase 5) depends on Task 4 (TASKS.md template must have `## Branching → Mode`).
- Task 19 (Phase 6) depends on Tasks 4 and 17 (TASKS.md section and External Links row labels).
- Tasks 20–22 (Phase 7) can run in parallel after Phase 1.
- Tasks 23–25 (Phase 8) can run last, in any order.
- Phase 9 (Tasks 26–28) runs manually against a test workspace.
