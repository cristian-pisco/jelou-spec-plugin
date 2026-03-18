# Workflow: create-pr

> Orchestrator workflow for `/jlu:create-pr [task-slug]`
> Stages all changes, commits, pushes, and creates pull requests for all affected services. Idempotent — skips if PR already exists.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.

---

## Step 1 — Resolve Task

1. If `task-slug` is provided as an argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If not provided:
   a. Check current git branch: if it matches `spec/<task-slug>`, extract the slug.
   b. Check current directory path for `/.worktrees/<task-slug>/` — extract the slug.
   c. Fall back to finding the most recent task in `implementing`, `validating`, or `ready_to_publish` state.
   d. If multiple candidates: present the list and ask user to choose.
   e. Confirm: "Create PR for task `<task-slug>`?"

**Error gate**: If no task found, stop: "No task found. Run `/jlu:new-task` first."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`

---

## Step 2 — Load Task State

1. Read `<TASK_DIR>/TASKS.md`. Extract:
   - Current status
   - Affected services list
   - Phase progress (per service)
   - Task title
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

**Store**: `TASK_TITLE`, `PROBLEM_STATEMENT`, `PROPOSAL_SUMMARY`, `AFFECTED_SERVICES`, `SERVICE_PATHS`, `PHASE_PROGRESS`

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

Spawn `jlu-git-agent` in `SERVICE_CWD` with this task:

> Verify you are on branch `spec/<TASK_SLUG>`. Stage all task-related changes, commit, and push.
> Commit style: brief, descriptive, no emojis. Follow the project's commit convention (detect from git log or config). Example: `feat(auth): add JWT token validation for user sessions`
> If there are no changes to commit, just push any unpushed commits. If fully up-to-date with no changes, report that.

**If no changes and no unpushed commits**: record as "no changes" and continue to Step 6.

**If git-agent escalates**: present the escalation to the user and offer:
1. Resolve the issue and retry
2. Skip this service
3. Abort the entire operation

---

## Step 6 — Check for Existing PR

Run:
```bash
cd <SERVICE_CWD> && gh pr view spec/<TASK_SLUG> --json url,state,title,number 2>&1
```

Parse the result:

- **`OPEN`**: Store URL and number. Record action as `existing`. Skip to next service.
- **`MERGED`**: Store URL and number. Record action as `existing`. Skip to next service.
- **`CLOSED`**: Ask user:
  ```
  A closed PR exists for `spec/<TASK_SLUG>` in <service-id>:
  <pr-url>

  Options:
  1. Create a new PR
  2. Skip this service
  3. Abort
  ```
- **Not found** (command fails / no PR): Proceed to Step 7.

---

## Step 7 — Create PR

### 7a. Detect Default Branch

```bash
cd <SERVICE_CWD> && gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'
```

If the command fails, fall back to `main`.

**Store**: `DEFAULT_BRANCH`

### 7b. Check Commits Ahead

```bash
cd <SERVICE_CWD> && git log --oneline <DEFAULT_BRANCH>..spec/<TASK_SLUG>
```

If no commits ahead: warn "No commits ahead of `<DEFAULT_BRANCH>` for `<service-id>`. Skip PR creation?" If user says yes, record as `skipped`.

### 7c. Construct PR Title

Derive from the task title. The title must be:
- Specific and task-related (e.g., "Add retry logic for payment webhook processing")
- NOT prefixed with `spec/<slug>:` or similar generic patterns
- Truncated to 70 characters

### 7d. Construct PR Body

```markdown
## Problem
<Problem statement from SPEC.md>

## Impact
<Summary from PROPOSAL.md, or brief description of what changes and why>

## Changes
**Service**: <SERVICE_ID>
**Branch**: `spec/<TASK_SLUG>` → `<DEFAULT_BRANCH>`

### Phase Progress
<Phase progress table from TASKS.md for this service>

### Test Results
<Test summary from TASKS.md for this service, if available>
```

### 7e. Create the PR

```bash
cd <SERVICE_CWD> && gh pr create \
  --base <DEFAULT_BRANCH> \
  --head spec/<TASK_SLUG> \
  --title "<PR_TITLE>" \
  --body "$(cat <<'EOF'
<PR_BODY>
EOF
)"
```

Parse the output to extract the PR URL and number. Record action as `created`.

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

If updating fails, warn but continue — cross-references are non-critical.

---

## Step 9 — Update TASKS.md

In `<TASK_DIR>/TASKS.md`:

### External Links

Add or update PR rows in the External Links section:
```
| PR (<service-id>) | <pr-url> |
```

If the External Links section doesn't exist, create it.

### Timeline

Append to the Timeline section:
```
| <ISO-timestamp> | PR created | <service-id>: <pr-url> |
```

For existing PRs that were not newly created, use "PR found (existing)" instead of "PR created".

---

## Step 10 — Update CLICKUP_TASK.json

1. If `<TASK_DIR>/CLICKUP_TASK.json` exists:
   - Update the `pr` field with a per-service-id map:
     ```json
     {
       "pr": {
         "<service-id-1>": "<pr-url-1>",
         "<service-id-2>": "<pr-url-2>"
       }
     }
     ```
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
- After merge, run `/jlu:close-task` to finalize
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
