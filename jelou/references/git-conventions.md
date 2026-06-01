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
- **Created at task creation** by `/jlu-new-task` Step 15c (when `Dual PR: yes`), in each affected service repo, and pushed to the remote. At creation it is empty (identical to `alpha`) — no PR is opened until there are commits.
- Commits arrive via cherry-pick from `production/<task-slug>` at `/jlu-create-pr`, which **reuses** the pre-created branch when `origin/alpha` is unchanged and **rebuilds** it from fresh `origin/alpha` when alpha has moved. Conflicts are resolved by the `jlu-conflict-resolver` sub-agent (sonnet) using SPEC + adjacent code.
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

The git-agent is **strictly forbidden** from pushing to `main`, `master`, or `alpha`, and from force-pushing any branch. The git-agent performs exactly one `staging/<slug>` operation: the initial create-from-`origin/alpha` + non-force push at `/jlu-new-task` Step 15c. All later `staging/<slug>` pushes (cherry-pick syncs, force-with-lease rebuilds) are performed by the `/jlu-create-pr` orchestrator, not the git-agent.

## PR Strategy

### Primary PR (always)

- Branch: `production/<task-slug>` → trunk.
- One per affected service.

### Secondary PR (opt-in, per task)

- Branch: `staging/<task-slug>` → `alpha` (created at `/jlu-new-task`; see Branch Naming).
- The alpha PR is opened by `/jlu-create-pr` after the primary branch is pushed and commits have been cherry-picked onto the staging branch.
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
| `staging/<slug>` creation + initial push | `/jlu-new-task` Step 15c | Setup subtask (via git-agent) |
| `staging/<slug>` cherry-pick sync / rebuild | `/jlu-create-pr` Step 5b | jlu-conflict-resolver + orchestrator |
| Alpha PR push | `/jlu-create-pr` Step 5b.7 | Orchestrator (not git-agent) |
| PR creation (primary + alpha) | `/jlu-create-pr` | Orchestrator + `gh` CLI |
| Task closure (delete local branches, remove remote staging, close alpha PR if open) | `/jlu-close-task` | Orchestrator |
