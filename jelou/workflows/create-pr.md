# Workflow: create-pr

> Orchestrator workflow for `/jlu-create-pr [task-slug]`
> Stages all changes, commits, pushes, and creates pull requests for all affected services. Idempotent — skips if PR already exists.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

## Principles

> **Idempotent. Verifiable. No surprises in the diff.**

- Running this workflow twice produces the same result. Existing PRs are skipped.
- The spec compliance review catches drift between what was planned and what was built.
- Every PR description tells reviewers what changed and why — traced back to SPEC.md requirements.
- Rate limits are handled gracefully with backoff. Never skip the retry protocol.

**When to simplify:** For single-service tasks with one PR, the cross-referencing and multi-service coordination steps are automatically skipped. The compliance review always runs.

---

## GitHub API Rate Limit Handling

All `gh` CLI commands in this workflow (Steps 6, 7e, 8) MUST use the retry protocol below.

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

---

## Step 2 — Load Task State

1. Read `<TASK_DIR>/TASKS.md`. Extract:
   - Current status
   - Affected services list
   - Phase progress (per service)
   - Task title
   - Dual PR (from `## Branching → Dual PR`, default "no" if section is absent)
   - Setup Mode (from `## Branching → Mode`, default "worktree" if section is absent)
   - Last alpha SHA (from `## Branching → Last alpha SHA`, may be empty/pending)
   - Last cherry-picked production SHA (from `## Branching → Last cherry-picked production SHA`, may be empty/pending)
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
- If status is `draft` or `refining`: warn and ask user to confirm proceeding.
- If status is `closed`: stop. "Task is already closed. Cannot create PR."

**Store**: `TASK_TITLE`, `PROBLEM_STATEMENT`, `PROPOSAL_SUMMARY`, `AFFECTED_SERVICES`, `SERVICE_PATHS`, `PHASE_PROGRESS`, `DUAL_PR`, `SETUP_MODE`, `LAST_ALPHA_SHA`, `LAST_CHERRYPICKED_PROD_SHA`

---

### 2b. Spec Compliance Review

1. Read `<TASK_DIR>/SPEC.md`.
2. Read `<TASK_DIR>/PROPOSAL.md` (if exists).
3. Read `<TASK_DIR>/versions/SPEC-changelog.md` (if exists).
4. For each affected service, collect the git diff:
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
5. Spawn `jlu-spec-reviewer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
   - Pass: SPEC.md content, PROPOSAL.md content (or empty), SPEC-changelog.md content (or empty), combined git diff for all services, service source paths.
6. Receive the compliance report from the agent.
7. **Decision gate**:
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
   b. If all requirements are COVERED or PARTIALLY_COVERED: log the summary to terminal and continue.
8. Store the compliance report for inclusion in PR descriptions.

**Store**: `COMPLIANCE_REPORT`

---

## Step 3 — Iterate Over Affected Services

For each affected service, execute Steps 4–7. Collect results into a `PR_RESULTS` map:

```
PR_RESULTS[<service-id>] = {
  action: "created" | "existing" | "skipped",
  url: "<pr-url>",
  number: <pr-number>,
  state: "OPEN" | "MERGED" | ...
}
```

**Rate limit throttle**: After completing Steps 4–7 for a service, wait 3 seconds before starting the next service iteration. The delay fires only between services, not after the final service in the loop.

---

## Step 4 — Resolve Service Working Directory

For the current service:

1. Look up the service repo path from `services.yaml`.
2. Check if a worktree exists: `<service-repo>/.worktrees/<TASK_SLUG>`
3. If worktree exists: use it as `SERVICE_CWD`.
4. If not: use the service repo root as `SERVICE_CWD`.

**Store**: `SERVICE_CWD`

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

---

## Step 6 — Check for Existing PR

Run:
```bash
cd <SERVICE_CWD> && gh pr view production/<TASK_SLUG> --json url,state,title,number 2>&1
```

> **Rate limit**: Apply the retry protocol (see "GitHub API Rate Limit Handling" above). On exhaustion, escalate to user.

Parse the result:

- **`OPEN`**: Store URL and number. Record action as `existing`. Skip to next service.
- **`MERGED`**: Store URL and number. Record action as `existing`. Skip to next service.
- **`CLOSED`**: Ask user:
  ```
  A closed PR exists for `production/<TASK_SLUG>` in <service-id>:
  <pr-url>

  Options:
  1. Create a new PR
  2. Skip this service
  3. Abort
  ```
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
- **`CLOSED`**: ask the user whether to re-open a new staging PR (same flow as CLOSED for trunk PR).
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

If no commits ahead: warn "No commits ahead of `<DEFAULT_BRANCH>` for `<service-id>`. Skip PR creation?" If user says yes, record as `skipped`.

### 7c. Construct PR Title

Derive from the task title. The title must be:
- Specific and task-related (e.g., "Add retry logic for payment webhook processing")
- NOT prefixed with `production/<slug>:` or similar generic patterns
- Truncated to 70 characters

### 7d. Construct PR Body

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

| Service | Action | PR URL | State |
|---------|--------|--------|-------|
| <service-id> | created / existing / skipped | <url> | OPEN / MERGED |

### Artifacts Updated
- TASKS.md: External Links and Timeline updated
- CLICKUP_TASK.json: PR URLs recorded (or "not present")

### Next Steps
- Request code review on the PR(s) above
- After merge, run `/jlu-close-task` to finalize
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No task found | Stop with message |
| Task is closed | Stop with message |
| Task in draft/refining | Warn, ask user to confirm |
| `gh` CLI not installed or not authenticated | Stop: "GitHub CLI (`gh`) is required. Install it and run `gh auth login`." |
| No commits ahead of default branch | Warn, ask user — skip or abort |
| Git-agent escalation | Present to user, offer skip/retry/abort |
| GitHub API rate limit | Auto-retry with exponential backoff (5s/15s/45s). After 3 failed retries, escalate to user: offer to wait 60s and retry, skip the service, or abort. |
| PR creation fails | Report error, ask user to retry or skip service |
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
