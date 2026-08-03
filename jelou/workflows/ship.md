# Workflow: ship

> Orchestrator workflow for `/jlu-ship [task-slug]`
> Stages all changes, commits, pushes, and creates pull requests for all affected services. Idempotent — skips if PR already exists.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

## Step 0 — Trace bootstrap

> **Tracing tolerance**: When `TRACE_DISABLED=1`, every span_id is an empty string and downstream calls become no-ops.

1. **Sweep orphans from any prior interrupted run** (idempotent):
   ```bash
   node "<root>/bin/trace-reconcile.mjs"
   ```

2. **Open the workflow-level span**:
   ```bash
   WF_OUT=$(node "<root>/bin/trace-start-span.mjs" \
     --name ship --scope task --task "$TASK_SLUG")
   WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
   WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
   ```

### Step 0b — Surface suggestions from prior runs (non-blocking)

Run the suggester scoped to the current task. It scans recent trace history and emits one SUGGEST block per active rule that fires (bump model tier, extend failure patterns, suggest parallelization, immediate flag on blocked/failed spans of THIS task). The 7-day cooldown is honored automatically.

```bash
SUGGESTIONS=$(TRACE_CURRENT_TASK="$TASK_SLUG" node "<root>/bin/trace-suggest.mjs" 2>/dev/null || true)
```

Telemetry MUST NOT interrupt the ship flow. Never prompt on these findings here.

- If `SUGGESTIONS` is non-empty: print the blocks as a short informational note ("Prior-run suggestions (run `/jlu-refine-task` or `/jlu-trace-report` to act):") and continue immediately. Do NOT use `question` / `AskUserQuestion`, and do NOT write to `suggestion-history.jsonl` — nothing was decided, so no cooldown starts.
- If `SUGGESTIONS` is empty, continue silently.

Interactive approval of these suggestions lives only in `/jlu-refine-task` (the interview flow) and the on-demand `/jlu-trace-report`. Tracing is best-effort: if the suggester errors out, the empty variable means the workflow simply continues.

---

## Principles

> **Idempotent. Every mutation is followed by its named verification command.**

- Running this workflow twice produces the same result. Existing PRs are skipped.
- The spec compliance review catches drift between what was planned and what was built.
- Every PR description tells reviewers what changed and why — traced back to SPEC.md requirements.
- Rate limits are handled gracefully with backoff. Never skip the retry protocol.

**When to simplify:** For single-service tasks with one PR, the cross-referencing and multi-service coordination steps are automatically skipped. The compliance review always runs.

---

## Autonomous mode — how every gate resolves

`<AUTONOMOUS>` is a caller input, `no` unless the caller says otherwise.
execute-task Step 9.5b passes `yes`: the chain carries the user's standing
authorization (`autochain-handoff.md` §2) and nobody is watching, so a
`question` there is a halted chain, not a decision. A standalone `/jlu-ship` is
`no` — the user typed the command, they are present, the gates ask as written.

**In autonomous mode no gate asks.** Each resolves to its default below, appends
one `SHIP_CAVEATS` line recording what was decided and why, and continues. The
caveat is what makes this safe: nothing is waved through silently, every
autonomous decision is published in the PR body.

Rows at Step 2 and 2b resolve in the orchestrator, before the fan-out. Rows from
4b onward resolve inside `jlu-ship-runner`, per service.

| Gate | Site | Autonomous default |
|------|------|--------------------|
| Task status `draft` / `refining` | Step 2 | **Abort the run.** A spec that never reached `planned` has no agreed contract to ship against. |
| Spec-compliance MISSING requirement, or one tagged `PARTIALLY_COVERED (breadth)` | 2b decision gate (items 6a / 6b) | Proceed. Caveat lists each missing FR/NFR with the coverage ratio, or names the requirement and its untested dimension. |
| `probe-coverage-breadth` verdict `thin` | 2b step 6b (the auditor) | Proceed. Caveat lists the `uncovered_dimensions`. Already documented as advisory friction, never a hard block. |
| Dependency preflight FAIL | 4b.1 | Proceed, set `PREFLIGHT_OVERRIDE += deps`. The validator is report-only by design and the override banner already surfaces it in the PR. |
| Build FAIL after 5 auto-fix rounds | 4b.2 | **Block this service.** Never proceed — a PR whose code does not compile burns a reviewer and cannot merge. |
| git-agent escalation | Step 5 | **Block this service**, escalation verbatim in the caveat. Remaining services continue. |
| Cherry-pick synthesis aborted | 5b | Trunk PR proceeds; this service's staging PR is dropped (`staging.action: "skipped"`). Caveat names the unresolved commit and conflicting files. Never flip `Dual PR: no` in TASKS.md — that edits the task's contract. |
| Existing PR is `CLOSED` | 6 / 6b | Create a new PR; a closed PR is stale and shipping is the instruction. Caveat links the closed one. |
| No commits ahead of the base | 7b | Skip this service (`action: "skipped"` — benign, nothing to ship). One note, no caveat. |
| `gh` rate limit after 3 retries | 6 / 7e | Wait 60s and retry once. Still failing → **block this service**. |

**`blocked` is not `skipped`.** `skipped` means there was nothing to ship;
`blocked` means there was, and it could not be. Only `blocked` makes the task
not green (execute-task Step 9.5's task-green rule). Never collapse the two.

Autonomous mode never does two things: change the task's own contract (TASKS.md
`Dual PR`, the SPEC, the status), or ship code that does not build.

---

## GitHub API Rate Limit Handling

All `gh` CLI commands in this workflow (Steps 6, 6b, 7e, 7f, 8, 8b) MUST use the retry protocol below.

### Retry Protocol

**Parameters:**
- **Max retries**: 3 per `gh` command (retries numbered 1–3; the initial attempt is attempt 0)
- **Detection**: Check stderr/stdout for `rate limit`, `abuse detection`, `HTTP 403`, or `HTTP 429`
- **Backoff schedule**: 5s, 15s, 45s (exponential: `5 * 3^(retry-1)`)
- **Logging**: On each retry, inform the user: "Rate limited by GitHub API. Retrying in Ns... (retry M/3)"

**Bash pattern:**
~~~bash
rate_limit_hit=false
for attempt in 0 1 2 3; do
  if [ "$attempt" -gt 0 ]; then
    sleep_time=$((5 * 3 ** (attempt - 1)))
    echo "Rate limited. Retrying in ${sleep_time}s (retry $attempt/3)..."
    sleep "$sleep_time"
  fi
  result=$(cd <SERVICE_CWD> && gh <command> 2>&1) && { rate_limit_hit=false; break; }
  if echo "$result" | grep -qi "rate limit\|abuse detection\|HTTP 403\|HTTP 429"; then
    rate_limit_hit=true
  else
    rate_limit_hit=false
    break  # Non-rate-limit error, don't retry
  fi
done

# Post-exhaustion escalation (Steps 6 and 7e only)
if [ "$rate_limit_hit" = true ]; then
  # Present escalation options to user — see "Post-Exhaustion Escalation" below
fi
~~~

### Post-Exhaustion Escalation

When all 3 retries are exhausted for a `gh` command in **Steps 6 or 7e**, present to the user:

```
GitHub API rate limit exceeded after 3 retries for <command> on <service-id>.

Options:
1. Wait 60 seconds and retry
2. Skip this service
3. Abort the entire operation
```

Autonomous → take option 1 once automatically. If the retry also fails, **block this service** (`action: "blocked"`, reason `rate_limit`) and continue with the rest; never abort the whole run on a transient API limit.

For **Step 8** (`gh pr edit`), on exhaustion: warn "Cross-reference update for <service-id> failed due to rate limit — skipping (non-critical)" and continue to the next service.

---

## Step 1 — Resolve Task

1. If `task-slug` is provided as an argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If not provided:
   a. Check current git branch: if it matches `production/<task-slug>`, extract the slug.
   b. Check current directory path for `/.worktrees/<task-slug>/` — extract the slug.
   c. Fall back to finding the most recent task in `implementing`, `validating`, or `ready_to_publish` state.
   d. If multiple candidates: present the list and ask user to choose.
   e. Confirm: "Create PR for task `<task-slug>`?"

**Error gate**: If no task found, stop: "No task found. Run `/jlu-new-task` first."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`

**Caller inputs (optional).** Running inside the autochain (execute-task Step
9.5b), the caller hands over `<AUTONOMOUS> = yes` (see "Autonomous mode" above —
it decides how every gate resolves) and `SHIP_CAVEATS` — advisory lines from
Steps 8c/8e/8f/8g that must be disclosed in every PR body (Step 7d). Both are
absent or empty on a standalone `/jlu-ship` run. A caller-driven run adds **no**
confirmation of its own beyond the named gates in this workflow: the chain
already carries the user's standing authorization to ship
(`autochain-handoff.md` §2), so never insert an extra "shall I open the PR?"
question, and when the slug arrives as an argument the Step 1.2e confirmation
does not apply.

---

## Step 2 — Load Task State

Read and cache task artifacts in one pass (single parallel tool-call message where supported), then reuse the cached content in later steps. Do not re-read the same files unless they changed on disk.

1. Read `<TASK_DIR>/TASKS.md`. Extract:
   - Current status
   - Affected services list
   - Phase progress (per service)
   - Task title
   - Dual PR (from `## Branching → Dual PR`, default "no" if section is absent)
   - Setup Mode (from `## Branching → Mode`, default "worktree" if section is absent)
   - Sync markers per service (from `## Branching → Sync markers`). Parse the block into a per-service map `{<service-id>: {alpha: <sha>, production: <sha>}}`. Default to an empty map if the block is absent. On a single-service task there is exactly one entry; on multi-service there is one entry per service. A marker written as `alpha=<sha>, production=` (empty production value, seeded by `/jlu-new-task` when it pre-creates the branch) parses to `{alpha: <sha>, production: ''}` — an empty `production` means no commits have been cherry-picked yet. Legacy flat fields (`Last alpha SHA:`, `Last cherry-picked production SHA:`) still count as the single-service entry if they appear without the `Sync markers` block.
2. Read `<TASK_DIR>/SPEC.md`. Extract:
   - Title
   - Problem statement
3. Read `<TASK_DIR>/PROPOSAL.md` (if exists). Extract:
   - Summary section
4. Read `<WORKSPACE_PATH>/registry/services.yaml`. Get:
   - Service repo paths for each affected service
5. Read `<TASK_DIR>/CLICKUP_TASK.json` (if exists). Note:
   - Existing PR entries

**Validation**:
- If status is `draft` or `refining`: warn and ask user to confirm proceeding. Autonomous → abort the run (gate table).
- If status is `closed`: stop. "Task is already closed. Cannot create PR."

**Store**: `TASK_TITLE`, `PROBLEM_STATEMENT`, `PROPOSAL_SUMMARY`, `AFFECTED_SERVICES`, `SERVICE_PATHS`, `PHASE_PROGRESS`, `DUAL_PR`, `SETUP_MODE`, `SYNC_MARKERS` (map of service-id → `{alpha_sha, production_sha}`)

---

### 2b. Spec Compliance Review

1. Reuse cached `SPEC.md` and `PROPOSAL.md` content loaded in Step 2 (do not re-read).
2. Read `<TASK_DIR>/versions/SPEC-changelog.md` (if exists).
3. For each affected service, collect the git diff:
   a. Resolve the service working directory (worktree or repo root, same logic as Step 4).
   b. Detect the default branch:
      ```bash
      cd <SERVICE_CWD> && git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
      ```
      Fall back to `main` if this fails.
   c. Collect the diff:
      ```bash
      cd <SERVICE_CWD> && git diff <DEFAULT_BRANCH>..production/<TASK_SLUG>
      ```
4. Spawn `jlu-spec-reviewer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
   - Pass: SPEC.md content, PROPOSAL.md content (or empty), SPEC-changelog.md content (or empty), combined git diff for all services, service source paths.
5. Receive the compliance report from the agent.
6. **Decision gate**:
   a. If the report shows any MISSING requirements, present via question:
      ```
      Spec Compliance Review found gaps:

      Missing requirements:
      - FR-<N>: <requirement>
      - NFR-<N>: <requirement>

      Coverage: <N>/<total> (<percentage>%)

      Options:
      A) Proceed with PR creation (known gaps, will address in follow-up)
      B) Abort PR creation (go implement missing requirements)
      ```
   b. If a requirement is tagged `PARTIALLY_COVERED (breadth)` — an input-validating requirement backed only by a happy-path test, with no rejection/realistic case — present it via question exactly like a MISSING gap (Options: A) Proceed with known thin coverage · B) Abort and add the rejection + realistic tests). Do NOT silently wave a breadth gap through.
   c. Otherwise, if all requirements are COVERED or plain PARTIALLY_COVERED: log the summary to terminal and continue.
   d. **Autonomous** (`<AUTONOMOUS> = yes`): neither 6a nor 6b asks. Proceed and append one `SHIP_CAVEATS` line per gap — the missing FR/NFR list with its coverage ratio, or the breadth-thin requirement with its untested dimension (gate table).
6b. **Coverage-breadth check (static, scoped to changed DTOs — always runs, advisory).** This puts the `/jlu-goal` Phase 4.5 breadth gate on the always-run PR path without booting anything. Compute the DTO/validator files changed in THIS task:
   ```bash
   cd <SERVICE_CWD> && git diff --name-only <DEFAULT_BRANCH>..production/<TASK_SLUG> | grep -E '\.(dto|schema)\.[jt]sx?$'
   ```
   If any changed DTO files exist, run the static auditor scoped to exactly those files (legacy untouched DTOs are never flagged):
   ```bash
   node <plugin-root>/bin/probe-coverage-breadth.mjs --service <SERVICE_CWD> $(printf -- '--dto %s ' <each changed dto>) --json
   ```
   On `verdict: thin` (exit 4), present the `uncovered_dimensions` via question — each is a validated field with no rejecting-payload test, or a collection/reference exercised only empty — and offer: A) Proceed (known thin coverage) · B) Abort and add the missing rejection/realistic tests (re-dispatch `jlu-test-writer` with `--allow-test-edits`). The auditor is a heuristic: advisory friction, never a hard block, consistent with the goal PASS-THIN stance. Autonomous → proceed with the `uncovered_dimensions` as a `SHIP_CAVEATS` line.
7. Store the compliance report for inclusion in PR descriptions.

**Store**: `COMPLIANCE_REPORT`

---

## Step 3 — Fan Out Per Service (one runner each)

> **Orchestrator delegates. One subagent per service; you never run Steps 4–7 yourself.**

For each affected service, dispatch `jlu-ship-runner` with model
**MODEL_CONFIG.code** (default sonnet) and these inputs: `<TASK_SLUG>`,
`<TASK_DIR>`, `<SERVICE_ID>`, `<SERVICE_CWD>` (resolved per Step 4 — the
orchestrator resolves it, the runner does not), `<PLUGIN_ROOT>`,
`<SETUP_MODE>`, `<DUAL_PR>`, this service's `<SYNC_MARKERS>`, `<TASK_TITLE>`,
`<PROBLEM_STATEMENT>`, `<PROPOSAL_SUMMARY>`, this service's `<PHASE_PROGRESS>`
and `<TEST_SUMMARY>`, `<COMPLIANCE_REPORT>`, `<SHIP_CAVEATS>`, and
`<AUTONOMOUS>`. Wrap each dispatch in the span wrapper
(`--agent ship-runner`).

**Sequentially, concurrency 1.** Step 4b.2 runs a real build inside the runner;
two concurrent runners mean two concurrent builds, which is the documented
machine-freeze condition in `jelou/references/subagent-base.md`. The win here is
context isolation — verbose install/build/git/`gh` output never enters the
orchestrator's window — not wall-clock. Never fan these out in parallel.

**Depth-limited runtimes.** The runner dispatches validators and the git-agent
itself, which is dispatch depth 2 — Codex defaults to `agents.max_depth = 1`.
Where depth 2 is unavailable, keep the fan-out and drop the nesting: the runner
still runs as the one subagent per service and performs 4b.1/4b.2/5 inline in
its own session. Never resolve it the other way (running the per-service body in
the orchestrator to keep the validators dispatched) — isolating the verbose
per-service output is the whole point of the fan-out.

**Brokering `NEEDS_DECISION` (interactive runs only).** With
`<AUTONOMOUS> = no`, the runner cannot ask the user: an `AskUserQuestion` one
level below the orchestrator reaches nobody. When a runner returns
`STATUS: NEEDS_DECISION gate=<...> detail=<...> options=<...>`, present those
options with `question` yourself, then re-dispatch the same runner for the same
service with `<DECISION>=<the user's answer>`. The runner is idempotent —
already-pushed work is re-checked, not redone. That is the only reason an
interactive gate still works: the decision stays at the orchestrator level where
`question` functions.

With `<AUTONOMOUS> = yes` a runner never returns `NEEDS_DECISION` at all — it
applies the gate table's default itself and reports what it decided. If one
arrives anyway, that is a runner bug: do NOT ask the user (nobody is watching a
chain). Apply the gate table's default for that gate yourself, caveat it, and
re-dispatch.

Never invent a confirmation of your own around the fan-out. An unverified
requirement, a QA follow-up and a caveat are not gates — they are
`<SHIP_CAVEATS>` lines the runner renders in the PR body.

Merge each runner's `rows` into `PR_RESULTS` (and `STAGING_PR`,
`PREFLIGHT_OVERRIDE`, `SYNC_MARKERS`), and append its `caveats` to
`SHIP_CAVEATS`, as it returns:

```
PR_RESULTS[<service-id>] = {
  action: "created" | "existing" | "skipped" | "blocked",
  reason: "<only for skipped | blocked>",
  url: "<pr-url>",
  number: <pr-number>,
  state: "OPEN" | "MERGED" | ...
}
```

A `blocked` or `skipped` service never aborts the remaining ones — every service
gets its runner, and Step 11 reports the aggregate. The difference matters
downstream: `skipped` is benign (nothing to ship), `blocked` means the PR should
have opened and did not, which is what makes the task not green.

**Rate limit throttle**: After a runner returns for a service, wait 3 seconds before dispatching the next service's runner. The delay fires only between services, not after the final service in the loop.

---

## Step 4 — Resolve Service Working Directory

For the current service, apply the **mode-driven** worktree resolution algorithm from `references/worktree-resolution.md`. Do **not** use a filesystem existence check — respect `SETUP_MODE` parsed from `TASKS.md → ## Branching → Mode`.

1. Look up the service repo path from `services.yaml`.
2. Resolve based on `SETUP_MODE`:
   - `Mode: worktree`: `SERVICE_CWD = <service-repo>/.worktrees/<TASK_SLUG>`. If that path is missing, fall back to the main repo and warn: `Worktree missing for <service-id> despite Mode: worktree — using main repo.`
   - `Mode: branch`: `SERVICE_CWD = <service-repo>` (main repo root). Ignore any leftover `.worktrees/<TASK_SLUG>/` that may exist. If detected, log: `Branch-mode task has a leftover worktree at <path>. Ignoring it.`
   - `## Branching` section absent (legacy): fall back to `references/worktree-resolution.md` §3c.

**Store**: `SERVICE_CWD`

---

> **Steps 4b–7 are the runner's body, not the orchestrator's.**
> `jlu-ship-runner` follows them for its one service; they live here as the
> single source of truth for the mechanics. Read every "present via `question`"
> in them as "return `STATUS: NEEDS_DECISION` to the caller" when you are the
> runner — Step 3 brokers it and re-dispatches you with `<DECISION>`. Steps
> 8–11 belong to the orchestrator again.

## Step 4b — Ship Preflight (Build + Dependency Validation)

> **Gate. Orchestrator delegates everything — never runs install/build itself.**
> Per service, in this order. Any verbose install/build output stays inside the
> subagents; you only ingest their compact reports and broker overrides.

### 4b.1 — Dependency install (report-only)

Spawn `jlu-deps-validator` with model **haiku** and this task:

> Validate that service `<SERVICE_ID>` installs dependencies cleanly. SERVICE_CWD is `<SERVICE_CWD>`. PLUGIN_ROOT is `<PLUGIN_ROOT>`. Run the runtime-aware validator and report PASS / FAIL / SKIP.

On **PASS** or **SKIP** → continue to 4b.2.
On **FAIL** (install failure or lockfile drift) → present via `question`:

```
Dependency preflight FAILED for <SERVICE_ID>: <one-line reason>.

Options:
A) Abort — fix deps, then re-run /jlu-ship
B) Proceed anyway (record the override in the PR)
```

On A → stop the workflow for this service (offer skip/abort like Step 5 escalation). On B → set `PREFLIGHT_OVERRIDE[<service-id>] += "deps"`.

Autonomous → take B automatically (proceed + override + caveat). This validator is report-only by design, and the override banner already discloses it in the PR body.

### 4b.2 — Build validation (auto-fix)

Spawn `jlu-build-validator` with model **MODEL_CONFIG.code** (default sonnet) and this task:

> Validate the build for service `<SERVICE_ID>`. SERVICE_CWD is `<SERVICE_CWD>`. PLUGIN_ROOT is `<PLUGIN_ROOT>`. Resolve the runtime exec context first (host or docker-compose) and run the build in the right place. Auto-fix build errors within the 5-round limit. Report PASS / FAIL / SKIP.

On **PASS** or **SKIP** → continue to Step 5. On **FAIL** after 5 rounds → present via `question` the same A/B override. On B → set `PREFLIGHT_OVERRIDE[<service-id>] += "build"`.

Autonomous → **block this service** (`action: "blocked"`, reason `build_failed`) and open no PR for it. This is the one gate whose autonomous default is a stop rather than a proceed: a PR whose code does not compile cannot merge and wastes the reviewer's pass. Remaining services still get their runner.

### 4b.3 — Record overrides

If `PREFLIGHT_OVERRIDE[<service-id>]` is non-empty, you MUST surface it later:
- Prepend to that service's PR body (in Step 7d, before `## Problem`):
  `> ⚠️ Shipped past failing preflight (<deps|build|deps+build>) — user override`
- Append to the TASKS.md Timeline in Step 9:
  `| <ISO-timestamp> | preflight override | <service-id>: <deps|build> |`

**Store**: `PREFLIGHT_OVERRIDE` (map service-id → list)

---

## Step 5 — Stage, Commit, Push (via git-agent)

Spawn `jlu-git-agent` in `SERVICE_CWD` with model: **haiku** and this task:

> Verify you are on branch `production/<TASK_SLUG>`. Stage all task-related changes, commit, and push.
> Commit style: brief, descriptive, no emojis. Follow the project's commit convention (detect from git log or config). Example: `feat(auth): add JWT token validation for user sessions`
> If there are no changes to commit, just push any unpushed commits. If fully up-to-date with no changes, report that.

**If no changes and no unpushed commits**: record as "no changes" and continue to Step 6.

**If git-agent escalates**: present the escalation to the user and offer:
1. Resolve the issue and retry
2. Skip this service
3. Abort the entire operation

Autonomous → **block this service** (`action: "blocked"`, reason `git_escalation`) with the escalation verbatim in the caveat. Never abort the whole run: the other services' PRs are independent and still worth opening.

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

Look up this service's markers: `LAST_ALPHA_SHA = SYNC_MARKERS[<service-id>].alpha_sha` (may be empty), `LAST_CHERRYPICKED_PROD_SHA = SYNC_MARKERS[<service-id>].production_sha` (may be empty).

Also detect whether a usable staging branch already exists:
```bash
STAGING_LOCAL_EXISTS=$(git rev-parse --verify staging/<TASK_SLUG> >/dev/null 2>&1 && echo yes)
STAGING_REMOTE_EXISTS=$(git ls-remote --heads origin staging/<TASK_SLUG> | head -1)
```

Decision tree (evaluated top to bottom):

- If `LAST_ALPHA_SHA` is empty AND neither `STAGING_LOCAL_EXISTS` nor `STAGING_REMOTE_EXISTS` → **rebuild** (legacy task, or `Dual PR` toggled on after creation). Cherry-pick range: `origin/<TRUNK>..production/<TASK_SLUG>`.
- Else if `CURRENT_ALPHA_SHA != LAST_ALPHA_SHA` → **rebuild** (alpha moved since the branch was created or last synced). Cherry-pick range: `origin/<TRUNK>..production/<TASK_SLUG>`.
- Else if `LAST_CHERRYPICKED_PROD_SHA` is empty → **first-pick** (first cherry-pick onto the branch `/jlu-new-task` pre-created; alpha unchanged). Reuse the existing staging branch. Cherry-pick range: `origin/<TRUNK>..production/<TASK_SLUG>`.
- Else if `CURRENT_PRODUCTION_SHA == LAST_CHERRYPICKED_PROD_SHA` → **no-op candidate**. If `STAGING_REMOTE_EXISTS` is empty (branch was deleted externally since the last sync), downgrade to **rebuild** with range `origin/<TRUNK>..production/<TASK_SLUG>`. Otherwise record `STAGING_SYNC[<service-id>] = "no-op"` and skip to Step 6 for this service.
- Else → **incremental**. Cherry-pick range: `<LAST_CHERRYPICKED_PROD_SHA>..production/<TASK_SLUG>`.

`first-pick` and `incremental` both **reuse** the existing staging branch (worktree prep and push behave identically — see 5b.4 / 5b.7); `rebuild` recreates it from fresh `origin/alpha`.

Store for this service: `SYNC_MODE ∈ {rebuild, first-pick, incremental, no-op}`, `CHERRY_PICK_RANGE`.

### 5b.4 — Prepare temp staging worktree

For `SYNC_MODE = rebuild`:

```bash
# Tear down any stale local staging branch
git branch -D staging/<TASK_SLUG> 2>/dev/null || true
# Create fresh temp worktree on a brand-new staging branch from origin/alpha
git worktree add -b staging/<TASK_SLUG> .worktrees/<TASK_SLUG>-staging-tmp origin/alpha
```

For `SYNC_MODE ∈ {first-pick, incremental}` (reuse the existing staging branch):

```bash
# Prefer the local branch; if it is missing but the remote exists, recreate it tracking the remote
if git rev-parse --verify staging/<TASK_SLUG> >/dev/null 2>&1; then
  git worktree add .worktrees/<TASK_SLUG>-staging-tmp staging/<TASK_SLUG>
else
  git worktree add .worktrees/<TASK_SLUG>-staging-tmp -b staging/<TASK_SLUG> origin/staging/<TASK_SLUG>
fi
```

If either worktree add fails (e.g., temp worktree already exists), abort for this service:

> Temp staging worktree for `<service-id>` is in an unexpected state. Remove `.worktrees/<TASK_SLUG>-staging-tmp` manually and re-run `/jlu-ship`.

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
   (Force-delete local staging — this run's partial state is discarded. Next `/jlu-ship` will rebuild from scratch.)
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
     A) Resolve manually — cut staging/<TASK_SLUG> from origin/alpha, cherry-pick <CHERRY_PICK_RANGE>, resolve conflicts, push, then re-run /jlu-ship.
     B) Disable dual-PR for this task — edit TASKS.md (Dual PR: no), then re-run /jlu-ship.
     C) Abort /jlu-ship entirely.
   ```
3. On "A": stop the workflow. Note that the trunk PR may already exist — report its state. User resolves and re-runs.
4. On "B": update `<TASK_DIR>/TASKS.md` → `## Branching → Dual PR: no`. Continue with trunk-only flow (skip to Step 6 for remaining services; skip all remaining 5b steps).
5. On "C": stop the workflow.
6. **Autonomous**: take none of the three. Drop only this service's staging PR (`staging.action: "skipped"`, reason `cherry_pick_conflict`) and continue to Step 6 so the trunk PR still opens — a staging-sync conflict says nothing about the trunk change. Caveat names the unresolved commit and the conflicting files. Do NOT choose "B": flipping `Dual PR` rewrites the task's own contract, which autonomous mode never does.

### 5b.7 — Push staging

For `SYNC_MODE = rebuild`:
```bash
git push --force-with-lease origin staging/<TASK_SLUG>
```

For `SYNC_MODE ∈ {first-pick, incremental}`:
```bash
git push origin staging/<TASK_SLUG>
```

If either push is rejected (non-fast-forward on a reuse push, or `--force-with-lease` detects an unexpected remote ref), abort per Option A logic. Clean up the temp worktree and preserve the local `staging/<TASK_SLUG>` branch — the push rejection is not a content problem, so the local branch is still valid.

For `SYNC_MODE = rebuild` (push-rejection means a force-push was refused because `--force-with-lease` saw an unexpected remote):
```bash
git worktree remove --force .worktrees/<TASK_SLUG>-staging-tmp
git branch -D staging/<TASK_SLUG> 2>/dev/null || true
```
> Remote `staging/<TASK_SLUG>` has diverged unexpectedly for `<service-id>`. Inspect remote, reconcile, and re-run `/jlu-ship`.

For `SYNC_MODE ∈ {first-pick, incremental}` (push-rejection means a fast-forward was not possible — typically someone pushed to `origin/staging/<TASK_SLUG>` externally):
```bash
git worktree remove --force .worktrees/<TASK_SLUG>-staging-tmp
# Do NOT delete local staging/<TASK_SLUG> — it is a valid branch; only the push was rejected.
```
> Remote `staging/<TASK_SLUG>` diverged since the last sync for `<service-id>`. Local branch is intact. Inspect remote, reconcile, then re-run `/jlu-ship`.

### 5b.8 — Update markers

Write into `<TASK_DIR>/TASKS.md` → `## Branching` → `Sync markers`. The block is always a map keyed by service-id, even for single-service tasks:

```
## Branching
- Dual PR: yes
- Primary branch: production/<TASK_SLUG>
- Secondary branch: staging/<TASK_SLUG>
- Mode: worktree | branch
- Sync markers:
  - <service-id>: alpha=<CURRENT_ALPHA_SHA>, production=<CURRENT_PRODUCTION_SHA>
```

When this run syncs only one service (of many), leave the other services' entries untouched — replace only the current service's line. If the `Sync markers` block does not yet exist, create it at the end of the `## Branching` section. Any legacy flat `Last alpha SHA:` / `Last cherry-picked production SHA:` fields from pre-upgrade tasks should be removed once the `Sync markers` block is present for their service.

Step 2 of this workflow reads markers via the same map format, so reads and writes stay in sync regardless of service count.

### 5b.9 — Remove temp worktree

```bash
git worktree remove .worktrees/<TASK_SLUG>-staging-tmp
```

Keep the local `staging/<TASK_SLUG>` branch for future incremental runs.

Record `STAGING_SYNC[<service-id>] = SYNC_MODE` (rebuild | first-pick | incremental | no-op).

---

## Step 6 — Check for Existing PR

Run:
```bash
cd <SERVICE_CWD> && gh pr view production/<TASK_SLUG> --json url,state,title,number 2>&1
```

> **Rate limit**: Apply the retry protocol (see "GitHub API Rate Limit Handling" above). On exhaustion, escalate to user.

Parse the result:

- **`OPEN`**: Store URL and number. Record action as `existing`. If `DUAL_PR = yes`, continue to Step 6b (the staging PR may still need creation on re-runs); otherwise skip to Step 8.
- **`MERGED`**: Store URL and number. Record action as `existing`. If `DUAL_PR = yes`, continue to Step 6b (same reason); otherwise skip to Step 8.
- **`CLOSED`**: Ask user:
  ```
  A closed PR exists for `production/<TASK_SLUG>` in <service-id>:
  <pr-url>

  Options:
  1. Create a new PR
  2. Skip this service
  3. Abort
  ```
  Autonomous → option 1 (create a new PR), with the closed PR's URL in a caveat. The closed PR is stale state; shipping is the standing instruction.
- **Not found** (command fails / no PR): Proceed to Step 7.

### 6b — Check for Existing Staging PR

Runs only if `DUAL_PR = yes` AND `STAGING_SYNC[<service-id>]` is not `"skipped-no-alpha"` and not `"aborted"`.

```bash
cd <SERVICE_CWD> && gh pr view staging/<TASK_SLUG> --json url,state,title,number 2>&1
```

Apply the retry protocol (same as Step 6).

Parse the result:

- **`OPEN`**: store URL and number. Record `STAGING_PR_ACTION[<service-id>] = "existing"`.
- **`MERGED`**: store URL and number. Record `STAGING_PR_ACTION[<service-id>] = "existing"`.
- **`CLOSED`**: ask the user whether to re-open a new staging PR (same flow as CLOSED for trunk PR). Autonomous → create a new one, closed URL in a caveat.
- **Not found**: proceed to Step 7 for the staging PR.

---

## Step 7 — Create PR

### 7a. Detect Default Branch

```bash
cd <SERVICE_CWD> && git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
```

This uses local git data (no API call). If the command fails or returns empty, fall back to `main`.

**Store**: `DEFAULT_BRANCH`

### 7b. Check Commits Ahead

```bash
cd <SERVICE_CWD> && git log --oneline <DEFAULT_BRANCH>..production/<TASK_SLUG>
```

If no commits ahead: warn "No commits ahead of `<DEFAULT_BRANCH>` for `<service-id>`. Skip PR creation?" If user says yes, record as `skipped`. Autonomous → record `skipped` and continue; this is the benign skip (nothing to ship), so it takes a note, not a caveat, and never `blocked`.

### 7c. Construct PR Title

Derive from the task title. The title must be:
- Specific and task-related (e.g., "Add retry logic for payment webhook processing")
- NOT prefixed with `production/<slug>:` or similar generic patterns
- Truncated to 70 characters

### 7d. Construct PR Body

If `PREFLIGHT_OVERRIDE[<service-id>]` is non-empty, prepend this banner before `## Problem`:

```
> ⚠️ Shipped past failing preflight (<deps|build|deps+build>) — user override
```

```markdown
## Problem
<Problem statement from SPEC.md>

## Impact
<Summary from PROPOSAL.md, or brief description of what changes and why>

## Changes
**Service**: <SERVICE_ID>
**Branch**: `production/<TASK_SLUG>` → `<DEFAULT_BRANCH>`

### Phase Progress
<Phase progress table from TASKS.md for this service>

### Test Results
<Test summary from TASKS.md for this service, if available>
```

If `SHIP_CAVEATS` is non-empty, append this block after `### Test Results`:

```markdown
### Not verified by this PR
- <caveat line, verbatim>
```

Each line is one advisory item — a QA follow-up, a manual or post-merge
verification nobody could run locally, an E2E suite that could not be
committed. This block is why an advisory finding never has to hold a PR back:
the reviewer learns exactly what was and was not verified, and the PR still
opens. Never silently drop a caveat, and never let a caveat become a reason to
skip PR creation.

If `COMPLIANCE_REPORT` exists, append to the PR body:

```html
<details>
<summary>Spec Compliance Review (<N>/<total> requirements covered)</summary>

<COMPLIANCE_REPORT content>

</details>
```

### 7e. Create the PR

```bash
cd <SERVICE_CWD> && gh pr create \
  --base <DEFAULT_BRANCH> \
  --head production/<TASK_SLUG> \
  --title "<PR_TITLE>" \
  --body "$(cat <<'EOF'
<PR_BODY>
EOF
)"
```

> **Rate limit**: Apply the retry protocol (see "GitHub API Rate Limit Handling" above). On exhaustion, escalate to user.

Parse the output to extract the PR URL and number. Record action as `created`.

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

If `SHIP_CAVEATS` is non-empty, append the same `### Not verified by this PR`
block used in the trunk PR body. If `COMPLIANCE_REPORT` exists, append the same
`<details>` block used in the trunk PR body.

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

---

## Step 8 — Cross-Reference PRs (multi-service only)

If 2 or more services have PRs (created or existing):

For each PR, update the body to append a "Related PRs" section:

```markdown

## Related PRs
<For each OTHER service PR:>
- **<service-id>**: <pr-url>
```

Use:
```bash
cd <SERVICE_CWD> && gh pr edit <NUMBER> --body "$(cat <<'EOF'
<UPDATED_BODY_WITH_RELATED_PRS>
EOF
)"
```

> **Rate limit**: Apply the retry protocol (see "GitHub API Rate Limit Handling" above). On exhaustion, warn "Cross-reference update for <service-id> failed due to rate limit — skipping (non-critical)" and continue. Non-rate-limit failures also warn and continue — cross-references are non-critical.

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

---

## Step 9 — Update TASKS.md

In `<TASK_DIR>/TASKS.md`:

### External Links

Add or update PR rows in the External Links section:
```
| PR main (<service-id>) | <trunk-pr-url> |
| PR alpha (<service-id>) | <alpha-pr-url> |  (only when DUAL_PR = yes and alpha PR exists)
```

If the External Links section doesn't exist, create it.

### Timeline

Append to the Timeline section:
```
| <ISO-timestamp> | PR created (trunk) | <service-id>: <trunk-pr-url> |
| <ISO-timestamp> | PR created (alpha) | <service-id>: <alpha-pr-url> |  (only when alpha PR is new)
| <ISO-timestamp> | preflight override | <service-id>: <deps|build> |  (only when PREFLIGHT_OVERRIDE is set for this service)
```

For existing PRs that were not newly created, use "PR found (existing)" instead of "PR created".

---

## Step 10 — Update CLICKUP_TASK.json

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

---

## Step 11 — Final Summary

Present the results:

```
## PR Summary — <TASK_SLUG>

| Service | PR Type | Action | PR URL | State |
|---------|---------|--------|--------|-------|
| <service-id> | trunk | created / existing / skipped / blocked | <url> | OPEN / MERGED |
| <service-id> | alpha | created / existing / skipped / blocked / n/a | <url> | OPEN / MERGED |   (alpha row present only when DUAL_PR = yes)

### Blocked
- <service-id>: <reason> — <what the caller must fix>
(or "none")

### Autonomous decisions
- <the SHIP_CAVEATS lines this run added at a gate>
(or "none — no gate fired" · omit the section entirely on an interactive run)

### Artifacts Updated
- TASKS.md: External Links and Timeline updated
- CLICKUP_TASK.json: PR URLs recorded (or "not present")

### Next Steps
- Request code review on the PR(s) above
- After merge, run `/jlu-close-task` to finalize
```

A non-empty `Blocked` section means this ship did NOT fully succeed, whatever the
other rows say. Report it as such — never present a partial ship as done.

---

## Error Handling

> Every "ask user" row below is the interactive behaviour. With
> `<AUTONOMOUS> = yes` it resolves per the gate table instead — no prompt.

| Error | Action |
|-------|--------|
| No task found | Stop with message |
| Task is closed | Stop with message |
| Task in draft/refining | Warn, ask user to confirm · autonomous: abort |
| `gh` CLI not installed or not authenticated | Stop: "GitHub CLI (`gh`) is required. Install it and run `gh auth login`." |
| No commits ahead of default branch | Warn, ask user — skip or abort · autonomous: skip (benign) |
| Git-agent escalation | Present to user, offer skip/retry/abort · autonomous: block this service |
| GitHub API rate limit | Auto-retry with exponential backoff (5s/15s/45s). After 3 failed retries, escalate to user: offer to wait 60s and retry, skip the service, or abort. Autonomous: retry once, then block this service. |
| PR creation fails | Report error, ask user to retry or skip service · autonomous: block this service |
| Cross-reference update fails | Warn, continue |
| CLICKUP_TASK.json write fails | Warn, continue |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| TASKS.md (updated) | `<WORKSPACE_PATH>/specs/<date>/<task-slug>/TASKS.md` |
| CLICKUP_TASK.json (updated) | `<WORKSPACE_PATH>/specs/<date>/<task-slug>/CLICKUP_TASK.json` |
| SPEC.md (read-only) | `<WORKSPACE_PATH>/specs/<date>/<task-slug>/SPEC.md` |
| PROPOSAL.md (read-only) | `<WORKSPACE_PATH>/specs/<date>/<task-slug>/PROPOSAL.md` |
| services.yaml (read-only) | `<WORKSPACE_PATH>/registry/services.yaml` |

---

## Step N — Close workflow span

Determine `$WORKFLOW_OUTCOME`:
- `ok` — PRs created successfully
- `blocked` — workflow halted (uncommitted changes, push failures, gh CLI missing)
- `failed` — irrecoverable error

Run:
```bash
node "<root>/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```
