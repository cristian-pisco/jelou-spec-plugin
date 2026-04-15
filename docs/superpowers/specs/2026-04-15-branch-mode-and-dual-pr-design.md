# Branch-Mode Setup and Dual-PR Support

## Problem Statement

`/jlu-new-task` unconditionally creates a full isolated working environment — worktree, `.env` copy, Docker Compose override, port allocation, and `docker compose up -d` — via a background subtask that launches during Step 9, **before** the user has even seen the spec. Two concrete costs fall out of this:

1. **Wasted setup for aborted or trivial tasks.** A user who cancels the spec interview leaves behind a running Docker stack. A user making a ten-line fix pays the full Docker bring-up cost for no benefit.
2. **Inflexible for lightweight work.** There is no way to say "this task is small, just give me a branch."

Separately, the plugin's `spec/<slug>` branch naming does not encode deploy intent. The team's real-world flow needs branches to target either the trunk branch (`main` or `master`) for production or `alpha` for staging, and some tasks need PRs to both — with the alpha PR's diff showing only the task's changes against the current alpha, not also the entire trunk-vs-alpha drift.

## Goals

1. Zero filesystem and Docker state for aborted, declined, or cancelled tasks.
2. After spec approval, the user chooses between worktree+Docker setup (existing behavior) and branch-only setup (new, lightweight).
3. Branch naming replaces `spec/<slug>` across the whole plugin with deploy-intent prefixes:
   - `production/<slug>` — mandatory for every task, cut from trunk, PR targets trunk.
   - `staging/<slug>` — optional, cut from `alpha` on-demand at PR-creation time, PR targets `alpha`.
4. Every commit on `production/<slug>` appears as a content-equivalent cherry-pick on `staging/<slug>` when dual-PR is enabled.
5. Cherry-pick conflicts between `production/<slug>` and `staging/<slug>` are resolved by a dedicated sub-agent that uses spec context, not by the user having to run git commands manually.

## Non-Goals

- Changing the TDD execution loop, proposal generation, QA agents, build validator, ClickUp sync, Slack posting, or any workflow unrelated to branch setup / PR creation.
- Supporting arbitrary base branches beyond trunk (`main` / `master`) and `alpha`.
- Rewriting how Docker isolation works *when* worktree mode is selected. Worktree-mode behavior is preserved end-to-end; it is simply no longer the only option.
- Automatic migration of in-flight tasks already created with `spec/<slug>` naming. Old tasks continue on the old convention until they close.
- Mixing worktree and branch modes per service within a single task. Mode is chosen once and applies to every affected service.
- Persisting prior conflict resolutions across `staging/<slug>` rebuilds. Each rebuild re-runs the conflict resolver.
- Optimizing the conflict-resolver's rebuild-vs-incremental decision beyond what is specified below.

## Terminology

- **Trunk branch**: `main` or `master`, whichever the service repo uses. Detected via `git symbolic-ref refs/remotes/origin/HEAD`, falling back to `main` then `master`.
- **Alpha branch**: the `alpha` branch on each service repo's origin. Must exist on origin for services opting into dual-PR; its absence blocks the staging side only, not the trunk side.
- **Setup mode**: either `worktree` (existing behavior) or `branch` (new, lightweight).
- **Dual PR**: boolean per task. When `yes`, the `/jlu-create-pr` workflow synthesizes a `staging/<slug>` branch on-demand by cherry-picking `production/<slug>` commits onto a fresh cut of `origin/alpha`, then opens a second PR targeting `alpha`.
- **Content parity**: the invariant that every commit on `production/<slug>` has a content-equivalent cherry-picked counterpart on `staging/<slug>` (different commit SHA, identical patch content with any conflict-resolution edits layered in). The cherry-pick chain on staging starts from `origin/alpha`, not from trunk.
- **Rebuild run** vs **incremental run**: a rebuild run of `/jlu-create-pr` dual-PR sync deletes the local `staging/<slug>` branch, re-creates it from the latest `origin/alpha`, and cherry-picks all production commits from scratch (force-push at the end). An incremental run appends only new production commits to the existing local `staging/<slug>` (fast-forward push).

---

## Architecture

Three coupled changes:

### Change A — Defer setup until after spec approval

Today, `new-task.md` Step 9 spawns a background `jlu-git-agent` that creates worktrees and starts Docker in parallel with the spec interview. This change removes that background subtask entirely. All environment setup moves into a new post-approval step that runs only when the user approves the spec.

If the user declines the spec, aborts the interview, or the session ends mid-interview, zero filesystem or Docker state is created. Only the workspace directory (`SPEC.md`, `TASKS.md`, `versions/`) exists, and that is cheap to discard.

### Change B — Mode selection (worktree vs branch)

After spec approval, the plugin asks the user to choose between two setup modes:

- **Worktree mode** runs the existing five-phase subtask: create worktree, allocate ports, generate Docker override, wire inter-service URLs, `docker compose up -d`. Semantics unchanged.
- **Branch-only mode** creates the task's production branch directly in each service's main repo (not checked out initially — `/jlu-execute-task` checks it out) and performs no Docker automation. The user works in the main repo on the task branch.

The existing `jelou/references/worktree-resolution.md` fallback — "if no worktree, use main repo" — naturally handles branch-only mode for every downstream reader. Mode is recorded in `TASKS.md` so downstream workflows can branch on it when they need to.

### Change C — Naming convention and dual-PR via cherry-pick

`spec/<slug>` is replaced throughout the plugin by two branches that are NOT created in the same way:

- `production/<slug>` — created at task creation (Step 15c) in each affected service's main repo, cut from `origin/<trunk>`, PR targets trunk. Always created.
- `staging/<slug>` — **not created at task creation**. Synthesized on-demand by `/jlu-create-pr` when `DUAL_PR=yes`: cut fresh from `origin/alpha`, with `production/<slug>` commits cherry-picked on top. PR targets `alpha`.

The dual-PR *intent* is captured at task creation via a boolean question ("Also create a PR to `alpha`?") between Step 8b and the spec interview. It is persisted to `TASKS.md` under a new `## Branching` section so `/jlu-create-pr` can read it later.

Because `alpha` and trunk have diverged, cherry-picking `production/<slug>` commits onto a fresh `staging/<slug>` is likely to produce merge conflicts. A new sub-agent — `jlu-conflict-resolver`, running at the code-tier model (`MODEL_CONFIG.code`, default sonnet) — owns the cherry-pick loop and conflict-resolution reasoning, using the task's SPEC and adjacent code as context. If the sub-agent cannot resolve a conflict with sufficient confidence, it aborts cleanly and surfaces the unresolved files to the user.

Content parity (rather than commit-SHA parity) is the invariant: every `production/<slug>` commit has a cherry-picked counterpart on `staging/<slug>` with the same semantic change, just rebased onto alpha's base and with any necessary conflict-resolution edits layered in.

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
│   │             │             • Worktree mode: run Docker phases 2-5
│   │             │             • Branch mode: no Docker, no .env mutation
│   │             │             • staging/<slug> is NOT created here
│   │             └─ Step 16   Final report (mode-aware)
│   │
│   └─ declined ──┐
│                 └─ No setup runs. Task stays in `refining` status.

/jlu-create-pr   (for a DUAL_PR=yes task)
│
├─ Step 1-5   Existing flow: resolve task, load state, push production/<slug>
├─ Step 5b    NEW: Dual-PR synthesis
│             • git fetch origin
│             • Verify origin/alpha exists
│             • Rebuild or incremental? (marker comparison)
│             • Spawn jlu-conflict-resolver in a temp staging worktree:
│                 - Cherry-pick production commits onto staging
│                 - Resolve conflicts using SPEC + adjacent code
│                 - Abort cleanly if unresolvable
│             • Push staging/<slug> (force-with-lease if rebuild)
│             • Update markers in TASKS.md
│             • Remove temp staging worktree
├─ Step 6-7   Create/update PRs (now two when DUAL_PR=yes)
├─ Step 8b    NEW: Cross-link sibling PR URLs in both bodies
└─ Step 9-10  Update TASKS.md and CLICKUP_TASK.json
```

Change C (dual-PR) is asked before Change B (mode) at task creation because the intent is recorded once for downstream use. Branch creation of `staging/<slug>` is deferred until `/jlu-create-pr` because there are no production commits yet at task creation — nothing to cherry-pick.

---

## Detailed Design

### `new-task.md` changes

#### New: Step 8c — Ask about alpha PR

Runs after Step 8b (Docker detection). Using `question`:

> **"Will this task also need a PR to `alpha` (staging)?"**
> - **No** — only a PR to trunk (default)
> - **Yes** — two PRs: one to trunk (mandatory), one to alpha (synthesized at PR-creation time)

Store as `DUAL_PR` (boolean). Persist to `TASKS.md` in a new `## Branching` section:

```markdown
## Branching
- Dual PR: yes | no
- Primary branch: production/<slug>
- Secondary branch: staging/<slug>   (intended; synthesized at first /jlu-create-pr when Dual PR = yes)
- Mode: (pending — chosen after spec approval)
- Last alpha SHA: (pending — populated at first dual-PR sync)
- Last cherry-picked production SHA: (pending — populated at first dual-PR sync)
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

Spawn `jlu-git-agent` with `MODEL_CONFIG.operational` (default haiku) and pass: `CONFIRMED_SERVICES`, `TASK_SLUG`, `SETUP_MODE`, per-service repo paths from `services.yaml`. (Note: `DUAL_PR` is *not* passed to the setup subtask, because `staging/<slug>` is not created here.)

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
- Run existing Phases 2-5 (port allocation, `docker-compose.override.yml` generation, inter-service URL wiring, `docker compose up -d`), referencing `production/<slug>` wherever the phases previously referenced `spec/<slug>`.
- **No `staging/<slug>` creation.** `staging/<slug>` is synthesized later by `/jlu-create-pr`.

*Branch-only mode* (new):

- `git branch production/<slug> origin/<trunk>` (not checked out)
- Skip Phases 2-5 entirely. No `.env` copy, no Docker override, no port allocation, no container bring-up.
- **No `staging/<slug>` creation.**

Record per service: `{ mode, production_branch, worktree_path (if worktree mode) }`.

#### Updated: Step 16 — Final Report

Final report gains a `### Branching` section:

```
### Branching
- Mode: worktree | branch
- Dual PR: yes | no
- Branches created:
  <service-id>: production/<slug>
- Worktrees (worktree mode only):
  <service-id>: <repo>/.worktrees/<slug>

### Next Step
Run /jlu-execute-task to begin implementation.
```

In branch mode, the final report appends: *"Branch-only mode: `/jlu-execute-task` will check out `production/<slug>` before the first phase. Ensure your working tree is clean at that point."*

If `DUAL_PR=yes`, the final report notes: *"Dual-PR enabled. The `staging/<slug>` branch will be synthesized automatically during `/jlu-create-pr` from the latest `origin/alpha`, with conflicts resolved by the `jlu-conflict-resolver` sub-agent."*

---

### New agent — `jlu-conflict-resolver`

File: `agents/jlu-conflict-resolver.md` (new).

**Model**: `MODEL_CONFIG.code` (default sonnet).

**Purpose**: run a cherry-pick of a specified commit range into a target worktree, resolving any conflicts that arise using the task's SPEC and adjacent code as context. Does not push. Does not modify TASKS.md.

**Inputs** (passed in the spawn prompt):
- `temp_worktree_path`: absolute path to a pre-prepared temporary worktree that is checked out on the fresh or existing `staging/<slug>` branch.
- `commit_range`: Git revision range (e.g., `abc123..def456` or a single commit SHA) specifying the production commits to cherry-pick in order.
- `spec_content`: the full contents of the task's `SPEC.md`.
- `service_source_paths`: map of service-id → source path (worktree path or main repo path) so the agent can inspect adjacent code for context.
- `service_id`: which service's cherry-pick this is (there may be multiple services, each with their own invocation).

**Algorithm**:

1. `cd <temp_worktree_path>`.
2. For each commit in `commit_range` (in topological order):
   a. Run `git cherry-pick <sha>`.
   b. If the cherry-pick succeeds without conflict, continue to the next commit.
   c. If the cherry-pick produces conflicts:
      - Run `git status --porcelain | grep '^UU\\|^AA\\|^DD\\|^AU\\|^UA\\|^DU\\|^UD'` to list conflicting paths.
      - For each conflicting file: read both `<<<<<<<` / `=======` / `>>>>>>>` sides, read the surrounding context in the file, read the SPEC to understand intent, read adjacent source files if needed, propose a resolution, write the resolved content, `git add <file>`.
      - Once all conflicts are resolved: `git cherry-pick --continue`.
      - If the agent cannot resolve a conflict with reasonable confidence (defined below), run `git cherry-pick --abort` and return `{status: "aborted", unresolved_commit: <sha>, conflicting_files: [...]}`.
3. On success: return `{status: "success", last_staged_sha: <sha of last cherry-picked commit as it now lives on staging>}`.

**Confidence threshold for conflict resolution**: the agent must be able to point to concrete evidence (a SPEC requirement, a test expectation, a clear pattern in adjacent code) that justifies its chosen resolution. If both sides look equally plausible and the SPEC is silent, the agent aborts rather than guesses. The agent's output in the abort case must include a brief explanation of why the conflict could not be resolved.

**Constraints**:
- No network access beyond reading local git state.
- No `git push`. The orchestrator pushes after the agent returns success.
- No edits to `TASKS.md`, `SPEC.md`, or any artifact outside the temp worktree.
- No commits beyond those produced by cherry-pick + `--continue`.
- Must not run `git cherry-pick --skip` without explicit user instruction. Skipping produces content drift.

**Error surfaces**:
- Returns `{status: "aborted", ...}` on any failure: conflict unresolvable, cherry-pick produces an empty commit, working tree unexpectedly dirty, SPEC context missing.
- The orchestrator is responsible for cleanup of the temp worktree on abort.

---

### Downstream workflow and reference changes

Every file that references `spec/<slug>` is updated. For new tasks, all references resolve to `production/<slug>` (and `staging/<slug>` when dual-PR is enabled and the sync has run). For old tasks, the same files continue to read the old branch name from the existing `TASKS.md` or via git-branch inference.

| File | Change |
|---|---|
| `jelou/references/git-conventions.md` | Rewrite: document `production/<slug>` (mandatory, cut from trunk) and `staging/<slug>` (opt-in, cut from alpha, synthesized at PR time via cherry-pick with conflict resolution). |
| `jelou/references/worktree-resolution.md` | Swap `spec/<TASK_SLUG>` references to `production/<TASK_SLUG>`. Add explicit note: "In branch-only mode, the source path is always the main repo root; no worktree directory exists." Document the temp staging worktree path: `.worktrees/<slug>-staging-tmp` is created during `/jlu-create-pr` and removed before the workflow returns. |
| `jelou/workflows/new-task.md` | Apply all changes in the section above. |
| `jelou/workflows/execute-task.md` | (a) Read `## Branching → Mode` from `TASKS.md`. (b) In branch mode, before the first phase, verify working tree clean, then `git checkout production/<slug>`. If dirty, abort: *"Working tree dirty, resolve before running `/jlu-execute-task`."* (c) Replace every `spec/<slug>` reference with `production/<slug>`. No interaction with `staging/<slug>` at any point. |
| `jelou/workflows/create-pr.md` | Substantial rewrite (details below). Adds Step 5b for dual-PR cherry-pick synthesis and Step 8b for cross-linking. |
| `jelou/workflows/close-task.md` | Mode-aware cleanup; dual-PR teardown (details below). |
| `jelou/workflows/rollback-phase.md` | Branch-mode path: perform `git reset --hard <sha>` in the main repo on `production/<slug>` (verify HEAD is on it first). Worktree-mode path: same command inside the worktree, unchanged behavior. No interaction with `staging/<slug>` — rollback never touches the staging side; the next `/jlu-create-pr` rebuilds staging from the rolled-back production tip. |
| `jelou/workflows/load-context.md` | Uses `worktree-resolution.md` already; inherits branch-only fallback naturally. Update branch name references only. |
| `jelou/workflows/report-task.md` | Mode-aware stale detection. Worktree mode: existing stale-worktree check. Branch mode: detect stale local `production/<slug>` branches not updated in N days. Stale-temp-worktree check: if `.worktrees/<slug>-staging-tmp` exists for longer than one hour, report as a leaked worktree (left behind by a crashed `/jlu-create-pr`). |
| `agents/jlu-git-agent.md` | Remove any commit-parity logic that was in the previous design draft; this agent only operates on one branch at a time. Branch-name references updated (`spec/<slug>` → `production/<slug>`). The agent does not know about `DUAL_PR` and never touches `staging/<slug>`. |
| `agents/jlu-conflict-resolver.md` | **New file.** See "New agent" section above. |
| `agents/jlu-summary-agent.md` | Branch-name references updated. |
| `agents/jlu-tasks-agent.md` | Add `## Branching` section to the TASKS.md template with the new fields (`Last alpha SHA`, `Last cherry-picked production SHA`). Branch-name references updated. |
| `jelou/references/docker-conventions.md` | Audit for any branch-name leakage in labels/override snippets. Update to `production/<slug>` where applicable. Docker override keying remains on `<TASK_SLUG>`, not branch name. |
| `README.md` | Branch-naming examples updated. Document the dual-PR cherry-pick flow at a high level. |
| `CHANGELOG.md` | Entry added: "Deferred setup, branch-mode option, `production/<slug>` naming, and on-demand `staging/<slug>` dual-PR synthesis via cherry-pick with conflict resolver." |

#### `/jlu-create-pr` — dual-PR synthesis

- **Step 1 (Resolve Task)**: branch-matching heuristics recognize `production/<slug>` as the primary indicator of an active task. The worktree-path pattern `/.worktrees/<slug>/` remains a valid secondary indicator. The ignore-list gains `/.worktrees/<slug>-staging-tmp` so it is never mistaken for the primary worktree.
- **Step 2 (Load Task State)**: read `## Branching` section → `DUAL_PR`, `SETUP_MODE`, `Last alpha SHA`, `Last cherry-picked production SHA`.
- **Step 4 (Resolve Service Working Directory)**: in branch mode, verify the current branch in the main repo matches `production/<slug>` before staging. If on a different branch, abort that service (user resolves manually).
- **Step 5 (Stage, Commit, Push)**: `jlu-git-agent` stages, commits, and pushes **only** `production/<slug>`. No paired push. No knowledge of dual-PR.
- **New Step 5b — Dual-PR Cherry-Pick Synthesis**: runs only if `DUAL_PR=yes`. For each service:

  1. **Fetch**: `cd <SERVICE_REPO_ROOT>` and `git fetch origin`. (The cherry-pick always runs against the main repo root, not the primary worktree — the temp staging worktree is added from the main repo.)
  2. **Verify alpha exists**: `git ls-remote --heads origin alpha`. If empty, warn: *"Service `<service-id>` has no `alpha` branch at origin. Skipping staging PR for this service."* Skip to Step 6 for this service (trunk PR still proceeds).
  3. **Decide rebuild vs incremental**:
     - Read `Last alpha SHA` and `Last cherry-picked production SHA` from `TASKS.md`.
     - Current alpha tip: `CURRENT_ALPHA_SHA = $(git rev-parse origin/alpha)`.
     - Current production tip: `CURRENT_PRODUCTION_SHA = $(git rev-parse production/<slug>)`.
     - If no marker entries exist → **rebuild** (first run). Commit range: `origin/<trunk>..production/<slug>`.
     - Else if `CURRENT_ALPHA_SHA != Last alpha SHA` → **rebuild**. Commit range: `origin/<trunk>..production/<slug>`.
     - Else if `CURRENT_PRODUCTION_SHA == Last cherry-picked production SHA` → **no-op** (staging is already current). Skip cherry-pick; the existing remote `staging/<slug>` ref is still valid. Proceed to Step 6 for PR creation/update.
     - Else → **incremental**. Commit range: `<Last cherry-picked production SHA>..production/<slug>`.
  4. **Prepare temp staging worktree**:
     - If rebuild: `git branch -D staging/<slug> 2>/dev/null || true`, then `git worktree add -b staging/<slug> .worktrees/<slug>-staging-tmp origin/alpha`.
     - If incremental: `git worktree add .worktrees/<slug>-staging-tmp staging/<slug>` (the local branch from the previous run still holds the cherry-picked state).
  5. **Spawn `jlu-conflict-resolver`** (model: `MODEL_CONFIG.code`, default sonnet) with inputs described in the agent section above. Pass the commit range, temp worktree path, SPEC content, and service source paths.
  6. **Handle sub-agent result**:
     - On `{status: "success"}`: continue to step 7.
     - On `{status: "aborted", unresolved_commit, conflicting_files}`:
       - `git worktree remove --force .worktrees/<slug>-staging-tmp`
       - `git branch -D staging/<slug>` (the force-deleted local branch; it holds partial state)
       - Present to user:
         ```
         Staging-PR synthesis aborted for <service-id>.
         Commit: <unresolved_commit>
         Conflicting files:
           - <path1>
           - <path2>
         The conflict-resolver could not determine the correct resolution with confidence.

         Options:
         A) Resolve manually: cut staging/<slug> from origin/alpha, cherry-pick
            <commit-range>, resolve conflicts, push, then re-run /jlu-create-pr.
         B) Disable dual-PR for this task (edit TASKS.md → Dual PR: no), then re-run.
         C) Abort /jlu-create-pr entirely.
         ```
       - On "A" or "C": stop the workflow. The trunk PR may have already been created in earlier steps — report its state. On "B": update TASKS.md, continue with trunk-only flow.
  7. **Push staging**:
     - If rebuild: `git push --force-with-lease origin staging/<slug>`. Include in the staging PR body a note that the branch was rebuilt from a new `origin/alpha`.
     - If incremental: `git push origin staging/<slug>`.
     - If the push is rejected (remote was updated since fetch): abort this service per Option A — surface to user with the divergence message, do not retry.
  8. **Update markers**: write `Last alpha SHA: <CURRENT_ALPHA_SHA>` and `Last cherry-picked production SHA: <CURRENT_PRODUCTION_SHA>` into `TASKS.md`.
  9. **Remove temp worktree**: `git worktree remove .worktrees/<slug>-staging-tmp`. Keep the local `staging/<slug>` branch for future incremental runs.

- **Step 6 (Check for Existing PR)**: checks both PRs independently when `DUAL_PR=yes`. One may exist, one may not. Each is reconciled on its own.
- **Step 7 (Create PR)**: always creates or updates the PR from `production/<slug>` → trunk. If `DUAL_PR=yes` and the Step 5b sync succeeded for the service, also creates or updates the PR from `staging/<slug>` → `alpha`. If the Step 5b sync was a rebuild, include in the staging PR body:
  > *Note: this branch was rebuilt from `origin/alpha` in the latest run. Prior review comments may be detached from their original commits.*
- **New Step 8b — Dual-PR Cross-Linking**: after both PRs exist for a service, run a second `gh pr edit` on each to prepend to the PR body:
  ```
  > Part of dual-PR task. Sibling PR: <sibling-url>
  ```
  Placed above the existing `## Problem` header. Failures are non-fatal (warn and continue).
- **Step 9 (Update TASKS.md)**: the `External Links` section now records both PRs when applicable, as separate rows. Branch section markers (`Last alpha SHA`, `Last cherry-picked production SHA`) updated in Step 5b.
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
- **Closed/merged staging PR with remote branch still present**: explicitly delete the remote ref: `git push origin :staging/<slug>` (ignore errors if already gone).
- **Local cleanup** (both modes):
  - `git branch -D staging/<slug>` if the branch exists locally (may not exist if `/jlu-create-pr` never ran with `DUAL_PR=yes`).
  - `git branch -d production/<slug>` (standard delete; verified merged).
  - `git worktree remove .worktrees/<slug>-staging-tmp` if a stale temp worktree exists.
- **Worktree cleanup** (worktree mode only): `git worktree remove .worktrees/<slug>` (or `--force` if needed).
- **Remote `production/<slug>`**: not deleted by the plugin. GitHub's `--delete-branch-on-merge` setting or team hygiene handles it.

### Dual-PR mechanics (summary)

| Question | Answer |
|---|---|
| When is the dual-PR intent decided? | At `/jlu-new-task` Step 8c, before the spec interview. |
| Where is the intent recorded? | `TASKS.md` → `## Branching → Dual PR: yes\|no`. |
| When is `staging/<slug>` created? | On-demand at `/jlu-create-pr` Step 5b. Not at task creation. |
| What is `staging/<slug>` cut from? | `origin/alpha` (the latest alpha fetched from origin at sync time). |
| How do production commits get onto staging? | Cherry-pick via `jlu-conflict-resolver` sub-agent, which resolves conflicts using SPEC + adjacent code. |
| Where does the cherry-pick run? | In a temporary worktree `.worktrees/<slug>-staging-tmp` created from the main repo and removed at the end of Step 5b. |
| What happens when the sub-agent can't resolve a conflict? | Clean abort. Partial state is discarded. User is presented with resolve-manually / disable-dual-PR / abort options. |
| Rebuild vs incremental? | Incremental by default (cherry-pick only new production commits onto existing local staging). Rebuild if `origin/alpha` advanced since the last sync — force-push at the end with a note in the PR body. |
| Can reviewers rely on stable staging commit SHAs? | Only within a single alpha epoch. When `origin/alpha` advances, the next `/jlu-create-pr` run rebuilds and force-pushes. Review comments on older commit SHAs may detach. |
| How are the PRs cross-linked? | Second `gh pr edit` pass appends `> Part of dual-PR task. Sibling PR: <url>` to each PR body above `## Problem`. |
| What blocks task closure? | Only the trunk PR merge. Staging PR state is irrelevant. |
| How is the staging side torn down at close? | If open, `gh pr close --delete-branch`. If already closed/merged with remote still present, explicit remote ref delete. Local branch force-deleted if present. |

---

## Migration

In-flight tasks created before this change carry a `spec/<slug>` branch and have no `## Branching` section in `TASKS.md`. No automatic migration runs.

Every downstream workflow reads the branch from one of:
- `TASKS.md → ## Branching → Primary branch` — present only for new tasks.
- Git branch inference from the service's current branch or the worktree path — the existing mechanism, which continues to recognize `spec/<slug>`.

Old tasks close out normally on the old naming with no dual-PR logic. New tasks use the new naming from the moment the updated plugin is installed. No dual-generation code is needed — the plugin writes one scheme (the new one) and reads either.

---

## Edge Cases

- **User not on trunk, branch mode:** strict abort. Error message: *"`<service-id>` is on `<current-branch>`. Check out `<trunk>` before branch-only mode."*
- **Dirty working tree, branch mode:** strict abort. Error lists first five dirty paths plus the total count. User runs `/jlu-new-task <slug>` again after resolving.
- **`origin/<trunk>` behind local trunk:** `git fetch origin` runs first in every setup path. Branches are cut from `origin/<trunk>` explicitly, so local drift does not affect correctness.
- **`alpha` branch missing at origin when `DUAL_PR=yes`:** warn at `/jlu-create-pr` Step 5b and skip only the staging side. The trunk PR still proceeds. The user is responsible for creating `alpha` at origin and re-running `/jlu-create-pr` if the staging PR is still wanted.
- **User wants to flip dual-PR intent mid-task:** no dedicated command in v1. User edits `TASKS.md → ## Branching → Dual PR:` by hand; subsequent `/jlu-create-pr` and `/jlu-close-task` honor the new value.
- **Single-service vs multi-service tasks:** identical behavior. Setup subtask iterates per service; mode and dual-PR apply uniformly across all services. Cherry-pick synthesis runs per service (each has its own `staging/<slug>` branch in its own repo).
- **`production/<slug>` already exists locally** at task creation: setup aborts for that service with: *"Branch `production/<slug>` already exists locally for `<service-id>`. Delete it or use a different slug."*
- **Conflict resolver aborts:** partial cherry-pick state is cleaned up by the orchestrator (temp worktree force-removed, local `staging/<slug>` deleted if it was newly created this run). User gets explicit options: resolve manually, disable dual-PR, or abort `/jlu-create-pr`.
- **Staging push rejected (remote divergence between fetch and push):** abort per Option A — surface to user, do not retry. Rare; implies someone pushed to `origin/staging/<slug>` between the `git fetch` at Step 5b.1 and the `git push` at Step 5b.7.
- **Alpha advanced between runs:** detected via the `Last alpha SHA` marker. Triggers a rebuild (cherry-pick all production commits from a fresh `origin/alpha`) and a force-push. PR body gains a note about the rebuild.
- **Rollback on production:** `/jlu-rollback-phase` resets `production/<slug>` to an earlier SHA. No automatic staging update. The next `/jlu-create-pr` detects the production tip moved back, performs a rebuild (since the production commit set changed non-incrementally), and force-pushes staging.
- **`/jlu-execute-task` in branch mode, working tree dirty:** strict abort before the first phase. User cleans up and re-runs.
- **Cancellation during setup (Step 15c):** if the subtask is interrupted mid-run, some services may have branches (and a worktree) while others do not. Re-running `/jlu-new-task <slug>` does **not** auto-resume: services that already have the branches hit the "already exists locally" abort (see above), which lists the offending branches. The user deletes them manually (and removes the worktree with `git worktree remove`) and re-runs. No plugin-side resume logic in v1.
- **Cancellation during `/jlu-create-pr` Step 5b:** temp staging worktree may remain. `report-task` detects and reports stale temp worktrees older than one hour. User removes via `git worktree remove --force .worktrees/<slug>-staging-tmp` and re-runs `/jlu-create-pr`.

---

## Success Criteria

- **SC-1**: Aborting the spec interview before Step 15 approval leaves no local branches, no worktrees, and no Docker containers for the task.
- **SC-2**: Declining the spec at Step 15 leaves no setup state. The workspace directory (`SPEC.md`, `TASKS.md`, `versions/`) may exist but contains no `## Branching → Mode` value beyond `pending`.
- **SC-3**: Approving the spec and choosing worktree mode produces the same observable state as today's `spec/<slug>` flow, except the branches are named `production/<slug>`. `staging/<slug>` is *not* present after `/jlu-new-task` — not locally, not remotely, even when `DUAL_PR=yes`.
- **SC-4**: Approving the spec and choosing branch mode produces a `production/<slug>` branch in each service's main repo, with no worktree directory and no Docker containers.
- **SC-5**: In branch mode, `/jlu-execute-task` auto-checks-out `production/<slug>` before the first phase, provided the working tree is clean. Dirty working tree causes a strict abort.
- **SC-6**: For a `DUAL_PR=yes` task, after any successful `/jlu-create-pr` run, every commit on `production/<slug>` that lies above `origin/<trunk>` has a content-equivalent cherry-pick on `staging/<slug>` (different SHA, identical patch semantics, conflict-resolution edits layered in where needed). The local `staging/<slug>` and remote `origin/staging/<slug>` point at the same SHA.
- **SC-7**: `/jlu-create-pr` on a `DUAL_PR=yes` task creates exactly two PRs per service (when `alpha` exists): one from `production/<slug>` → trunk, one from `staging/<slug>` → `alpha`. Both PR bodies contain a cross-linked sibling reference.
- **SC-8**: `/jlu-close-task` on a `DUAL_PR=yes` task requires only the trunk PR to be merged. The staging PR is closed (if open) and the staging branch deleted locally and remotely. The production branch is deleted locally and the worktree removed (if applicable). Temp staging worktrees, if any, are also removed.
- **SC-9**: Old tasks created on `spec/<slug>` still close normally after the plugin upgrade, without requiring migration.
- **SC-10**: Attempting branch mode with a dirty working tree or the wrong current branch produces a clear abort message and creates no branches for that service.
- **SC-11**: When `jlu-conflict-resolver` cannot resolve a conflict with confidence, it aborts cleanly without forcing a resolution. The orchestrator cleans up all partial state (temp worktree, force-deleted local staging branch) and presents the user with resolve-manually / disable-dual-PR / abort options. No silent guesses.
- **SC-12**: Rebuild runs of the dual-PR sync (triggered by `origin/alpha` advancing) produce a single force-push to `origin/staging/<slug>` with a note in the PR body flagging the rebuild. Incremental runs produce only fast-forward pushes.
- **SC-13**: If `origin/alpha` does not exist, `/jlu-create-pr` warns and proceeds with the trunk PR only. No partial `staging/<slug>` state is left behind.

---

## Testing Strategy

Because the plugin is markdown workflow files rather than executable code, verification is behavioral and manual.

1. **Happy-path scenarios** — run each end-to-end in a test service and verify `git branch -a`, `git log <branch>`, `.worktrees/`, `docker ps`, `gh pr list`, and `TASKS.md`:
   - Worktree mode, single service, `DUAL_PR=no`.
   - Worktree mode, single service, `DUAL_PR=yes`, alpha present, no cherry-pick conflicts.
   - Worktree mode, single service, `DUAL_PR=yes`, alpha present, with conflicts that the resolver handles.
   - Worktree mode, multi-service, `DUAL_PR=yes`.
   - Branch mode, single service, `DUAL_PR=no`.
   - Branch mode, single service, `DUAL_PR=yes`, alpha present.
   - Branch mode, multi-service, `DUAL_PR=yes`.

2. **Abort scenarios** — verify zero state is left behind:
   - User declines spec at Step 15 — no branches, no worktrees, no Docker.
   - Branch mode setup with dirty working tree — abort, no branches created for that service.
   - Branch mode setup with wrong current branch — abort, no branches created.
   - `alpha` missing at origin for a `DUAL_PR=yes` task — staging side skipped, trunk PR still created.
   - Conflict resolver aborts on unresolvable conflict — temp worktree and local `staging/<slug>` are gone; user gets the three options; choosing "B) disable dual-PR" updates TASKS.md and the workflow continues with trunk-only.

3. **Cherry-pick mechanics**:
   - First-run (no markers): rebuild, force-push, PR body contains no rebuild note (since it is the initial creation).
   - Subsequent run, no new production commits, alpha unchanged: no-op. No push. No sub-agent invocation.
   - Subsequent run, new production commits, alpha unchanged: incremental. Fast-forward push. No rebuild note.
   - Subsequent run, alpha advanced: rebuild. Force-push. Rebuild note appears in staging PR body.
   - Rollback-on-production between runs: next `/jlu-create-pr` detects production tip moved backward, triggers rebuild, force-pushes staging.

4. **Conflict resolver behavior**:
   - Given a cherry-pick with a conflict where SPEC clearly supports one side: resolver resolves and continues.
   - Given a cherry-pick with a conflict where SPEC is silent and both sides are plausible: resolver aborts, returns `conflicting_files` and a brief explanation.
   - Given a cherry-pick that produces an empty commit (change already applied): resolver aborts.

5. **Close-task teardown**:
   - Dual-PR task with alpha PR still open — close-task closes the PR (`gh pr close --delete-branch` observed), deletes local branches, deletes worktree (if applicable).
   - Dual-PR task with alpha PR merged, remote `staging/<slug>` still present — close-task explicitly pushes `:staging/<slug>` to remove the remote ref, cleans up local.
   - Dual-PR task that never ran `/jlu-create-pr` (so no local `staging/<slug>`, no remote ref) — close-task completes cleanly with no staging-related operations.
   - Single-PR task — close-task behavior matches today's semantics apart from the branch name.

6. **Migration compatibility**:
   - An in-flight task on `spec/<slug>` (created before the upgrade) continues through `/jlu-create-pr` and `/jlu-close-task` without errors.

Each scenario is documented in the implementation plan with pre-conditions, steps, and expected observable state.

---

## Out of Scope

- Per-service mode selection (one service worktree, another service branch).
- Automatic migration of old tasks to the new naming.
- A dedicated command to flip `DUAL_PR` after task creation.
- Persisting prior conflict resolutions across rebuild runs. Each rebuild re-runs the resolver from scratch.
- Smarter rebuild-vs-incremental heuristics (e.g., rebuild only when the files touched by production intersect with the files changed on alpha). V1 uses the simple alpha-SHA comparison.
- Deleting the remote `production/<slug>` branch. Left to GitHub's `--delete-branch-on-merge` or team hygiene.
- Support for base branches beyond trunk and `alpha`.
- Interactive stash/switch flows on dirty working tree during branch-mode setup. Always strict abort.
- Running the conflict resolver against multiple services in parallel within a single `/jlu-create-pr` invocation. V1 runs per-service sequentially.
