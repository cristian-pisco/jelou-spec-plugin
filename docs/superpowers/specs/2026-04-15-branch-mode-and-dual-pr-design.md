# Branch-Mode Setup and Dual-PR Support

## Problem Statement

`/jlu-new-task` unconditionally creates a full isolated working environment — worktree, `.env` copy, Docker Compose override, port allocation, and `docker compose up -d` — via a background subtask that launches during Step 9, **before** the user has even seen the spec. Two concrete costs fall out of this:

1. **Wasted setup for aborted or trivial tasks.** A user who cancels the spec interview leaves behind a running Docker stack. A user making a ten-line fix pays the full Docker bring-up cost for no benefit.
2. **Inflexible for lightweight work.** There is no way to say "this task is small, just give me a branch."

Separately, the plugin's `spec/<slug>` branch naming does not encode deploy intent. The team's real-world flow needs branches to target either the trunk branch (`main` or `master`) for production or `alpha` for staging, and some tasks need PRs to both.

## Goals

1. Zero filesystem and Docker state for aborted, declined, or cancelled tasks.
2. After spec approval, the user chooses between worktree+Docker setup (existing behavior) and branch-only setup (new, lightweight).
3. Branch naming replaces `spec/<slug>` across the whole plugin with deploy-intent prefixes:
   - `production/<slug>` — mandatory for every task, cut from trunk, PR targets trunk.
   - `staging/<slug>` — optional, cut from trunk, commit-parity with `production/<slug>`, PR targets `alpha`.
4. Every commit on `production/<slug>` is also present on `staging/<slug>` when dual-PR is enabled.

## Non-Goals

- Changing the TDD execution loop, proposal generation, QA agents, build validator, ClickUp sync, Slack posting, or any workflow unrelated to branch setup / PR creation.
- Supporting arbitrary base branches beyond trunk (`main` / `master`) and `alpha`.
- Rewriting how Docker isolation works *when* worktree mode is selected. Worktree-mode behavior is preserved end-to-end; it is simply no longer the only option.
- Automatic migration of in-flight tasks already created with `spec/<slug>` naming. Old tasks continue on the old convention until they close.
- Mixing worktree and branch modes per service within a single task. Mode is chosen once and applies to every affected service.

## Terminology

- **Trunk branch**: `main` or `master`, whichever the service repo uses. Detected via `git symbolic-ref refs/remotes/origin/HEAD`, falling back to `main` then `master`.
- **Alpha branch**: the `alpha` branch on each service repo's origin. Assumed to exist for services opting into dual-PR.
- **Setup mode**: either `worktree` (existing behavior) or `branch` (new, lightweight).
- **Dual PR**: boolean per task. When `yes`, a `staging/<slug>` branch and a second PR targeting `alpha` are created alongside the mandatory `production/<slug>` branch and PR.
- **Commit parity**: the invariant that `production/<slug>` and `staging/<slug>` (local and remote) point at the same commit SHA after any push performed by the plugin.

---

## Architecture

Three coupled changes:

### Change A — Defer setup until after spec approval

Today, `new-task.md` Step 9 spawns a background `jlu-git-agent` that creates worktrees and starts Docker in parallel with the spec interview. This change removes that background subtask entirely. All environment setup moves into a new post-approval step that runs only when the user approves the spec.

If the user declines the spec, aborts the interview, or the session ends mid-interview, zero filesystem or Docker state is created. Only the workspace directory (`SPEC.md`, `TASKS.md`, `versions/`) exists, and that is cheap to discard.

### Change B — Mode selection (worktree vs branch)

After spec approval, the plugin asks the user to choose between two setup modes:

- **Worktree mode** runs the existing five-phase subtask: create worktree, allocate ports, generate Docker override, wire inter-service URLs, `docker compose up -d`. Semantics unchanged.
- **Branch-only mode** creates the task's branches directly in each service's main repo (not checked out) and performs no Docker automation. The user works in the main repo on the task branch.

The existing `jelou/references/worktree-resolution.md` fallback — "if no worktree, use main repo" — naturally handles branch-only mode for every downstream reader (`execute-task`, `create-pr`, `close-task`, `load-context`, etc.). Mode is recorded in `TASKS.md` so downstream workflows can branch on it when they need to (for example, `execute-task` auto-checks-out the branch in branch mode).

### Change C — Naming convention and dual-PR

`spec/<slug>` is replaced throughout the plugin by two new branches:

- `production/<slug>` — mandatory, cut from `origin/<trunk>`, PR targets trunk.
- `staging/<slug>` — created only if the task opted into dual-PR, cut from `origin/<trunk>` with commit parity to `production/<slug>`, PR targets `alpha`.

The dual-PR choice is captured at task creation via a boolean question ("Also create a PR to `alpha`?") between Step 8b and the spec interview. It is persisted to `TASKS.md` under a new `## Branching` section so every downstream workflow can read it.

Commit parity is enforced by `jlu-git-agent`: every push of `production/<slug>` is paired with a push to `staging/<slug>` in the same Git invocation (`git push origin production/<slug> staging/<slug>`), after a local fast-forward (`git branch -f staging/<slug> production/<slug>`). If the staging-side push is rejected for non-fast-forward, the agent aborts and surfaces the divergence.

### Interaction diagram

```
/jlu-new-task
│
├─ Step 1-8   Resolve workspace, services, templates
├─ Step 8c    NEW: Ask "Also create a PR to alpha?" (boolean: DUAL_PR)
├─ Step 9     REMOVED (no background setup subtask)
├─ Step 10-14 Load codebase, interview, write SPEC.md
├─ Step 15    Approval gate
│   │
│   ├─ approved ──┐
│   │             ├─ Step 15b NEW: Mode selection (worktree | branch)
│   │             ├─ Step 15c NEW: Dispatch setup subtask
│   │             │             • Source-branch verification per service
│   │             │             • Create production/<slug> (always)
│   │             │             • Create staging/<slug> (if DUAL_PR=yes)
│   │             │             • Worktree mode: run Docker phases 2-5
│   │             │             • Branch mode: no Docker, no .env mutation
│   │             └─ Step 16   Final report (mode-aware)
│   │
│   └─ declined ──┐
│                 └─ No setup runs. Task stays in `refining` status.
```

Change C (dual-PR) is asked before Change B (mode) because the setup subtask in Change B needs to know whether to create one or two branches. Both hang off Change A (no setup before approval).

---

## Detailed Design

### `new-task.md` changes

#### New: Step 8c — Ask about alpha PR

Runs after Step 8b (Docker detection). Using `question`:

> **"Will this task also need a PR to `alpha` (staging)?"**
> - **No** — only a PR to trunk (default)
> - **Yes** — two PRs: one to trunk, one to alpha

Store as `DUAL_PR` (boolean). Persist to `TASKS.md` in a new `## Branching` section:

```markdown
## Branching
- Dual PR: yes | no
- Primary branch: production/<slug>
- Secondary branch: staging/<slug>   (only when Dual PR = yes)
- Mode: (pending — chosen after spec approval)
```

#### Removed: Step 9 — Launch Worktree Creation Subtask

Deleted. The `WORKTREE_AGENT_TASK` variable and every reference to it in Step 15 and Step 16 are removed.

#### New: Step 15b — Mode Selection

Runs inside the `If approved` branch of Step 15, after `TASKS.md` status flips to `planned`. Using `question`:

> **"How should I set up the work environment for this task?"**
> - **Full setup (worktree + Docker)** — recommended when multiple services, Docker-heavy, or parallel tasks planned
> - **Branch only** — recommended when single-file fix, non-Docker service, or quick change

Store as `SETUP_MODE` ∈ {`worktree`, `branch`}. Update `TASKS.md` → `## Branching` → `Mode: <worktree|branch>`.

#### New: Step 15c — Dispatch Setup Subtask

Spawn `jlu-git-agent` with `MODEL_CONFIG.operational` (default haiku) and pass: `CONFIRMED_SERVICES`, `TASK_SLUG`, `DUAL_PR`, `SETUP_MODE`, per-service repo paths from `services.yaml`.

The agent performs per-service setup as follows.

**Source-branch verification (both modes, per service):**

1. `cd <repo>` and run `git fetch origin` to get latest refs.
2. Detect trunk: `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'`. Fallback order: `main` → `master`.
3. If `origin/<trunk>` does not exist, abort this service: *"Cannot resolve trunk branch for `<service-id>`."*

**In branch mode only**, additionally:

4. Run `git status --porcelain`. If non-empty, abort this service: *"Working tree of `<service-id>` is dirty. Commit or stash before branch-only mode can create branches in place."* (List the first five dirty paths plus total count.)
5. `git rev-parse --abbrev-ref HEAD`. If the current branch is not `<trunk>`, abort: *"`<service-id>` is currently on `<branch>`, not `<trunk>`. Check out `<trunk>` first."*

In worktree mode, the main repo's HEAD and working-tree state do not matter — branches are created in an isolated worktree off `origin/<trunk>`.

**Branch creation:**

*Worktree mode* (existing five-phase behavior, renamed):

- `git worktree add .worktrees/<slug> -b production/<slug> origin/<trunk>`
- If `DUAL_PR=yes`: `git branch staging/<slug> origin/<trunk>` (local branch, not checked out; no second worktree)
- Run existing Phases 2-5 (port allocation, `docker-compose.override.yml` generation, inter-service URL wiring, `docker compose up -d`), referencing `production/<slug>` wherever the phases previously referenced `spec/<slug>`.

*Branch-only mode* (new):

- `git branch production/<slug> origin/<trunk>` (not checked out)
- If `DUAL_PR=yes`: `git branch staging/<slug> origin/<trunk>`
- Skip Phases 2-5 entirely. No `.env` copy, no Docker override, no port allocation, no container bring-up.

Record per service: `{ mode, production_branch, staging_branch (if dual), worktree_path (if worktree mode) }`.

#### Updated: Step 16 — Final Report

Final report gains a `### Branching` section:

```
### Branching
- Mode: worktree | branch
- Dual PR: yes | no
- Branches created:
  <service-id>: production/<slug>[, staging/<slug>]
- Worktrees (worktree mode only):
  <service-id>: <repo>/.worktrees/<slug>

### Next Step
Run /jlu-execute-task to begin implementation.
```

In branch mode, the final report appends: *"Branch-only mode: `/jlu-execute-task` will check out `production/<slug>` before the first phase. Ensure your working tree is clean at that point."*

---

### Downstream workflow and reference changes

Every file that references `spec/<slug>` is updated. For new tasks, all references resolve to `production/<slug>` (and `staging/<slug>` when dual-PR is enabled). For old tasks, the same files continue to read the old branch name from the existing `TASKS.md` or via git-branch inference.

| File | Change |
|---|---|
| `jelou/references/git-conventions.md` | Rewrite: document `production/<slug>` (mandatory) and `staging/<slug>` (opt-in). Document source = trunk always. |
| `jelou/references/worktree-resolution.md` | Swap `spec/<TASK_SLUG>` references to `production/<TASK_SLUG>`. Add explicit note: "In branch-only mode, the source path is always the main repo root; no worktree directory exists." |
| `jelou/workflows/new-task.md` | Apply all changes in the section above. |
| `jelou/workflows/execute-task.md` | (a) Read `## Branching → Mode` from `TASKS.md`. (b) In branch mode, before the first phase, verify working tree clean, then `git checkout production/<slug>`. If dirty, abort: *"Working tree dirty, resolve before running `/jlu-execute-task`."* (c) Replace every `spec/<slug>` reference with `production/<slug>`. |
| `jelou/workflows/create-pr.md` | Add Step 5b (dual-PR sync), extend Step 6/7 for dual PRs, extend Step 8 cross-linking. Details below. |
| `jelou/workflows/close-task.md` | Mode-aware cleanup. Dual-PR teardown. Details below. |
| `jelou/workflows/rollback-phase.md` | Branch-mode path: perform `git reset --hard <sha>` in the main repo on `production/<slug>` (verify HEAD is on it first). Worktree-mode path: same command inside the worktree, unchanged behavior. |
| `jelou/workflows/load-context.md` | Uses `worktree-resolution.md` already; inherits branch-only fallback naturally. Update branch name references only. |
| `jelou/workflows/report-task.md` | Mode-aware stale detection. Worktree mode: existing stale-worktree check. Branch mode: detect stale local `production/<slug>` branches not updated in N days. |
| `agents/jlu-git-agent.md` | (a) Every push of `production/<slug>` is paired with a local fast-forward of `staging/<slug>` plus a combined push to both, when `DUAL_PR=yes`. (b) Abort on non-fast-forward rejection per Option A below. (c) Branch-name references updated. |
| `agents/jlu-summary-agent.md` | Branch-name references updated. |
| `agents/jlu-tasks-agent.md` | Add `## Branching` section to the TASKS.md template. Branch-name references updated. |
| `jelou/references/docker-conventions.md` | Audit for any branch-name leakage in labels/override snippets. Update to `production/<slug>` where applicable. Docker override keying remains on `<TASK_SLUG>`, not branch name. |
| `README.md` | Branch-naming examples updated. |
| `CHANGELOG.md` | Entry added: "Deferred setup, branch-mode option, and `production/<slug>` + `staging/<slug>` naming with dual-PR support." |

#### `/jlu-create-pr` — dual-PR support

- **Step 1 (Resolve Task)**: branch-matching heuristics recognize `production/<slug>` as the primary indicator of an active task. The worktree-path pattern `/.worktrees/<slug>/` remains a valid secondary indicator.
- **Step 2 (Load Task State)**: read `## Branching` section → `DUAL_PR`, `SETUP_MODE`.
- **Step 4 (Resolve Service Working Directory)**: in branch mode, verify the current branch in the main repo matches `production/<slug>` before staging. If on a different branch, abort that service (user resolves manually).
- **Step 5 (Stage, Commit, Push)**: `jlu-git-agent` stages and commits on `production/<slug>`. The push step now pushes `production/<slug>` alone if `DUAL_PR=no`, or runs the paired `git branch -f staging/<slug> production/<slug>` + `git push origin production/<slug> staging/<slug>` if `DUAL_PR=yes`. This preserves commit parity for every push event.
- **New Step 5b — Dual-PR Sync Verification**: runs only if `DUAL_PR=yes`. Confirms the paired push in Step 5 succeeded on both refs. If the staging-side push was rejected for non-fast-forward, the workflow aborts with:
  > *"Remote `staging/<slug>` has diverged from `production/<slug>`. Resolve manually (inspect remote, reconcile, or force-push if intended), then re-run `/jlu-create-pr`."*
- **Step 6 (Check for Existing PR)**: checks both PRs independently when `DUAL_PR=yes`. One may exist, one may not. Each is reconciled on its own.
- **Step 7 (Create PR)**: always creates or updates the PR from `production/<slug>` → trunk. If `DUAL_PR=yes`, also creates or updates the PR from `staging/<slug>` → `alpha`. Before opening the alpha PR, run `git ls-remote --heads origin alpha`; if empty, log a warning *"Service `<service-id>` has no `alpha` branch at origin. Skipping staging PR."* and skip only the staging PR (the trunk PR still proceeds).
- **New Step 8b — Dual-PR Cross-Linking**: after both PRs exist for a service, run a second `gh pr edit` on each to prepend to the PR body:
  ```
  > Part of dual-PR task. Sibling PR: <sibling-url>
  ```
  Placed above the existing `## Problem` header. Failures are non-fatal (warn and continue).
- **Step 9 (Update TASKS.md)**: the `External Links` section now records both PRs when applicable, as separate rows.
- **Step 10 (CLICKUP_TASK.json)**: the `pr` field becomes an object keyed by service, with nested `main` and optional `alpha` URLs:
  ```json
  {
    "pr": {
      "<service-id>": {
        "main": "<trunk-pr-url>",
        "alpha": "<alpha-pr-url>"
      }
    }
  }
  ```

#### `/jlu-close-task` — dual-PR teardown

- **Preconditions**: require the trunk PR (`production/<slug>`) to be in `MERGED` state. The staging PR's state does not block closure.
- **Active staging PR teardown**: if the staging PR is in `OPEN` or `DRAFT` state, run `gh pr close <url> --delete-branch` — this closes the PR and deletes the remote `staging/<slug>` branch in one call.
- **Closed/merged staging PR**: if the staging PR is already `CLOSED` or `MERGED`, explicitly delete the remote ref: `git push origin :staging/<slug>` (ignore errors if already gone).
- **Local cleanup** (both modes):
  - `git branch -D staging/<slug>` (force delete — local staging has no unique commits by construction, so `-D` is safe)
  - `git branch -d production/<slug>` (standard delete; verified merged)
- **Worktree cleanup** (worktree mode only): `git worktree remove .worktrees/<slug>` (or `--force` if needed).
- **Remote `production/<slug>`**: not deleted by the plugin. GitHub's `--delete-branch-on-merge` setting or team hygiene handles it.

### Dual-PR mechanics (summary)

| Question | Answer |
|---|---|
| When is the dual-PR choice made? | At `/jlu-new-task` Step 8c, before the spec interview. |
| Where is the choice recorded? | `TASKS.md` → `## Branching → Dual PR: yes\|no`. |
| When are the branches created? | At `/jlu-new-task` Step 15c, only if the user approves the spec. |
| Where does `staging/<slug>` exist locally? | In each service's main repo, created by `git branch staging/<slug> origin/<trunk>`. Not checked out anywhere. |
| How is commit parity enforced? | `jlu-git-agent` runs `git branch -f staging/<slug> production/<slug>` then `git push origin production/<slug> staging/<slug>` on every push, whenever `DUAL_PR=yes`. |
| What if the staging push is rejected? | Abort with a divergence message. User resolves manually and re-runs. No automatic cherry-pick fallback. |
| How are the PRs cross-linked? | Second `gh pr edit` pass appends `> Part of dual-PR task. Sibling PR: <url>` to each PR body above `## Problem`. |
| What blocks task closure? | Only the trunk PR merge. Staging PR state is irrelevant. |
| How is the staging side torn down at close? | If open, `gh pr close --delete-branch`. If already closed/merged, explicit remote ref delete. Local branch force-deleted. |

---

## Migration

In-flight tasks created before this change carry a `spec/<slug>` branch and have no `## Branching` section in `TASKS.md`. No automatic migration runs.

Every downstream workflow reads the branch from one of:
- `TASKS.md → ## Branching → Primary branch` — present only for new tasks.
- Git branch inference from the service's current branch or the worktree path — the existing mechanism, which continues to recognize `spec/<slug>`.

Old tasks close out normally on the old naming. New tasks use the new naming from the moment the updated plugin is installed. No dual-generation code is needed — the plugin writes one scheme (the new one) and reads either.

---

## Edge Cases

- **User not on trunk, branch mode:** strict abort. Error message: *"`<service-id>` is on `<current-branch>`. Check out `<trunk>` before branch-only mode."*
- **Dirty working tree, branch mode:** strict abort. Error lists first five dirty paths plus the total count. User runs `/jlu-new-task <slug>` again after resolving.
- **`origin/<trunk>` behind local trunk:** `git fetch origin` runs first in every setup path. Branches are cut from `origin/<trunk>` explicitly, so local drift does not affect correctness.
- **`alpha` branch missing at origin when `DUAL_PR=yes`:** warn at `/jlu-create-pr` Step 7 and skip only the staging PR. The trunk PR still proceeds. The user is responsible for creating `alpha` at origin if needed.
- **User wants to flip dual-PR intent mid-task:** no dedicated command in v1. User edits `TASKS.md → ## Branching → Dual PR:` by hand; subsequent `/jlu-create-pr` and `/jlu-close-task` honor the new value.
- **Single-service vs multi-service tasks:** identical behavior. Setup subtask iterates per service; mode and dual-PR apply uniformly across all services in the task.
- **`production/<slug>` or `staging/<slug>` already exists locally:** setup aborts for that service with: *"Branch `<name>` already exists locally for `<service-id>`. Delete it or use a different slug."*
- **Staging PR divergence between pushes:** any push in `jlu-git-agent` that fails non-fast-forward aborts the current operation. User inspects the remote state, reconciles (merge, force-push, or re-cut `staging/<slug>`), then re-runs.
- **`/jlu-execute-task` in branch mode, working tree dirty:** strict abort before the first phase. User cleans up and re-runs.
- **Cancellation during setup (Step 15c):** if the subtask is interrupted mid-run, some services may have branches (and a worktree) while others do not. Re-running `/jlu-new-task <slug>` does **not** auto-resume: services that already have the branches hit the "already exists locally" abort (see above), which lists the offending branches. The user deletes them manually (and removes the worktree with `git worktree remove`) and re-runs. No plugin-side resume logic in v1.

---

## Success Criteria

- **SC-1**: Aborting the spec interview before Step 15 approval leaves no local branches, no worktrees, and no Docker containers for the task.
- **SC-2**: Declining the spec at Step 15 leaves no setup state. The workspace directory (`SPEC.md`, `TASKS.md`, `versions/`) may exist but contains no `## Branching → Mode` value beyond `pending`.
- **SC-3**: Approving the spec and choosing worktree mode produces the same observable state as today's `spec/<slug>` flow, except the branches are named `production/<slug>` (and `staging/<slug>` if dual-PR).
- **SC-4**: Approving the spec and choosing branch mode produces a `production/<slug>` branch (and optionally `staging/<slug>`) in each service's main repo, with no worktree directory and no Docker containers.
- **SC-5**: In branch mode, `/jlu-execute-task` auto-checks-out `production/<slug>` before the first phase, provided the working tree is clean. Dirty working tree causes a strict abort.
- **SC-6**: For a `DUAL_PR=yes` task, every push performed by `jlu-git-agent` leaves the remote `production/<slug>` and `staging/<slug>` refs pointing at the same SHA.
- **SC-7**: `/jlu-create-pr` on a `DUAL_PR=yes` task creates exactly two PRs: one from `production/<slug>` → trunk, one from `staging/<slug>` → `alpha`, both with cross-linked sibling references in the PR body.
- **SC-8**: `/jlu-close-task` on a `DUAL_PR=yes` task requires only the trunk PR to be merged. The staging PR is closed (if open) and the staging branch deleted locally and remotely. The production branch is deleted locally and the worktree removed (if applicable).
- **SC-9**: Old tasks created on `spec/<slug>` still close normally after the plugin upgrade, without requiring migration.
- **SC-10**: Attempting branch mode with a dirty working tree or the wrong current branch produces a clear abort message and creates no branches for that service.

---

## Testing Strategy

Because the plugin is markdown workflow files rather than executable code, verification is behavioral and manual.

1. **Happy-path scenarios** — run each end-to-end in a test service and verify `git branch -a`, `.worktrees/`, `docker ps`, `gh pr list`, and `TASKS.md`:
   - Worktree mode, single service, `DUAL_PR=no`.
   - Worktree mode, single service, `DUAL_PR=yes`.
   - Worktree mode, multi-service, `DUAL_PR=yes`.
   - Branch mode, single service, `DUAL_PR=no`.
   - Branch mode, single service, `DUAL_PR=yes`.
   - Branch mode, multi-service, `DUAL_PR=yes`.

2. **Abort scenarios** — verify zero state is left behind:
   - User declines spec at Step 15 — no branches, no worktrees, no Docker.
   - Branch mode setup with dirty working tree — abort, no branches created for that service.
   - Branch mode setup with wrong current branch — abort, no branches created.

3. **Dual-PR sync** — verify commit parity invariant:
   - Normal commit / push sequence on `production/<slug>` — remote `staging/<slug>` fast-forwards with every push.
   - Manually push an unrelated commit to `origin/staging/<slug>`, then attempt a normal push — plugin aborts with the expected divergence message; both remote refs remain in their pre-operation state.

4. **Close-task teardown**:
   - Dual-PR task with alpha PR still open — close-task closes the PR (`gh pr close --delete-branch` observed), deletes local branches, deletes worktree (if applicable).
   - Dual-PR task with alpha PR merged — close-task explicitly pushes `:staging/<slug>` to remove the remote ref, cleans up local.
   - Single-PR task — close-task behavior matches today's semantics apart from the branch name.

5. **Migration compatibility**:
   - An in-flight task on `spec/<slug>` (created before the upgrade) continues through `/jlu-create-pr` and `/jlu-close-task` without errors.

Each scenario is documented in the implementation plan with pre-conditions, steps, and expected observable state.

---

## Out of Scope

- Per-service mode selection (one service worktree, another service branch).
- Automatic migration of old tasks to the new naming.
- A dedicated command to flip `DUAL_PR` after task creation.
- Cherry-pick fallback on staging divergence. Plugin always aborts; user handles recovery.
- Deleting the remote `production/<slug>` branch. Left to GitHub's `--delete-branch-on-merge` or team hygiene.
- Support for base branches beyond trunk and `alpha`.
- Interactive stash/switch flows on dirty working tree during branch-mode setup. Always strict abort.
