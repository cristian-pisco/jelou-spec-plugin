# Workflow: new-task

> Orchestrator workflow for `/jlu-new-task [task description]`
> Creates a new task, runs the spec interview inline, and creates worktrees in the background.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

## Principles

> **Precision over speed. Ask before assuming. The spec is the contract.**

- A vague spec produces vague code. Invest in clarity now to avoid rewrites later.
- Every question should be informed by what you found in the codebase, not generic.
- The user's time is valuable — ask 2-4 focused questions per round, not 10 scattered ones.
- When the user says "that's enough", stop. Write the spec with what you have.
- The spec is complete when a developer could implement it without guessing.

**When to simplify:** For obvious, well-bounded tasks (single endpoint, single fix, clear requirements), the interview can be as short as 1-2 rounds. Don't force 8 rounds of questions on a task that's already clear.

---

## Step 1 — Resolve Workspace

1. Read `.spec-workspace.json` from the current working directory.
   - If it exists:
     a. Extract `workspace` path and `serviceId`.
     b. Resolve `workspace` relative to the current directory.
     c. Verify the `.spec-workspace/` directory exists at that path.
     d. If the directory does NOT exist at the configured path:
        - Search parent directories (up to 5 levels) for `.spec-workspace/`.
        - If found elsewhere, offer to update `.spec-workspace.json` to the correct path.
        - If not found anywhere, offer to create it (see step 1.2).
   - If `.spec-workspace.json` does NOT exist:
     a. Search parent directories (up to 5 levels) for `.spec-workspace/`.
     b. If found: offer to create `.spec-workspace.json` in the current directory pointing to it.
     c. If NOT found: offer to create the workspace:
        - Create `../.spec-workspace/` with base structure:
          ```
          ../.spec-workspace/
            registry/
              services.yaml
            principles/
              ENGINEERING_PRINCIPLES.md
            services/
            specs/
          ```
        - Initialize `services.yaml` with empty services list.
        - Initialize `ENGINEERING_PRINCIPLES.md` with default principles template (security, simplicity, readability, TDD, repo conventions).
        - Create `.spec-workspace.json` in the current directory.

**Store**: `WORKSPACE_PATH`, `SERVICE_ID`

---

### 1b. Resolve Model Configuration

1. Read `.spec-workspace.json` from the current directory (already read in Step 1).
2. If a `models` section exists, extract the model overrides.
3. Store as `MODEL_CONFIG`.
4. Use `MODEL_CONFIG.operational` (default: haiku) for the git-agent spawn in Step 15c.

---

## Step 2 — Verify Service Registration

1. Read `<WORKSPACE_PATH>/registry/services.yaml`.
2. Check if `SERVICE_ID` is registered in the services list.
3. If NOT registered:
   - Ask the user: "Service `<SERVICE_ID>` is not registered in `services.yaml`. Register it now?"
   - If yes:
     a. Auto-detect the stack by examining the current directory (look for `package.json`, `composer.json`, `go.mod`, `Cargo.toml`, framework-specific files like `nest-cli.json`, `artisan`, `next.config.*`, `angular.json`, `vite.config.*`).
     b. Confirm detected stack with user.
     c. Add entry to `services.yaml`:
        ```yaml
        - id: <SERVICE_ID>
          path: <relative-path-from-workspace>
          stack: <detected-stack>
        ```
   - If no: warn that some features may not work correctly without registration.

### 2b. Docker Detection

After service registration (or if already registered):

1. Search the service repo for `docker-compose.yml`, `docker-compose.yaml`, or `compose.yml`.
2. If a Compose file is found and the service does NOT already have a `docker` block in `services.yaml`:
   - Ask: "Docker Compose file detected at `<path>`. Register Docker config for this service?"
   - If yes:
     a. Parse the Compose file's `services:` keys and suggest the service name.
     b. Ask for the port env var name (default: `APP_PORT`).
     c. Write the `docker` block into the service's entry in `services.yaml`:
        ```yaml
        docker:
          service: <compose-service-name>
          compose_file: <relative-path>
          port_env: <port-env-var>
        ```
   - If no: skip, proceed as non-Docker service.
3. If no Compose file is found: skip silently.

---

### 2c. Template Auto-Detection

1. Check if `<WORKSPACE_PATH>/templates/` directory exists.
   - If not, create it and copy built-in templates from `<PLUGIN_ROOT>/jelou/templates/spec-templates/` to `<WORKSPACE_PATH>/templates/`.
2. Scan `<WORKSPACE_PATH>/templates/` for `.md` files.
3. For each file, read the `## Description` section to extract the one-line description.
4. Analyze the task description (`TASK_DESCRIPTION`) against each template's description and interview hints.
   Determine which templates are relevant based on keyword and semantic matching:
   - API/endpoint/route/request/response keywords → rest-api template
   - UI/component/frontend/screen/form/modal keywords → ui-component template
   - Database/migration/schema/table/column keywords → db-migration template
   - Event/consumer/async/queue/message/subscriber keywords → event-consumer template
   - Custom templates: match against their `## Description` content
5. If one or more templates match:
   a. Read each matching template file.
   b. Merge `## Pre-filled Sections` from all matching templates:
      - Combine Functional Requirements lists (re-number sequentially: FR-1, FR-2, ...)
      - Combine Non-Functional Requirements lists (re-number sequentially: NFR-1, NFR-2, ...)
      - Merge Constraints (deduplicate overlapping constraints)
      - Merge Success Criteria (re-number sequentially: SC-1, SC-2, ...)
      - For Problem Statement: keep one `<!-- FILL -->` placeholder
      - For Out of Scope: keep one `<!-- FILL -->` placeholder
   c. Merge `## Interview Hints` from all matching templates into a combined list (deduplicate overlapping hints).
   d. Set `DETECTED_TEMPLATES` = list of template names,
      `MERGED_PREFILL` = merged pre-filled sections,
      `MERGED_HINTS` = combined interview hints.
6. If no templates match:
   a. Set `DETECTED_TEMPLATES` = empty, `MERGED_PREFILL` = empty, `MERGED_HINTS` = empty.
7. Log detected templates to terminal:
   "Auto-detected templates: <template-1>, <template-2>" or
   "No domain-specific templates matched. Using generic interview."

**Store**: `DETECTED_TEMPLATES`, `MERGED_PREFILL`, `MERGED_HINTS`

---

## Step 3 — Prompt for Task Details

1. **Task description**:
   - If provided as the command argument, use it as the seed.
   - If not provided, ask the user:
     > "Describe the task you want to create:"
2. **Sprint number**:
   - Ask the user:
     > "Sprint number for this task? (positive integer, e.g. 14)"
   - No default. The user must provide a value.
   - Validate: must be a positive integer (> 0). If invalid, ask again.
3. **Creation date**:
   - Auto-generate today's date in `dd-mm-yyyy` format using the system's local timezone.
   - Do NOT prompt the user.

**Store**: `TASK_DESCRIPTION`, `SPRINT_NUMBER`, `CREATION_DATE`

---

## Step 4 — Generate Task Slug

1. Generate from the task description:
   - Convert to lowercase.
   - Replace spaces and special characters with hyphens.
   - Remove consecutive hyphens.
   - Truncate to a maximum of 50 characters.
   - Remove trailing hyphens.
2. Verify the slug does not already exist at `<WORKSPACE_PATH>/specs/<CREATION_DATE>/<task-slug>/`.
   - If it already exists, append a numeric suffix (e.g., `-2`, `-3`).

**Store**: `TASK_SLUG`

---

## Step 5 — Create Task Directory

1. Create the task directory tree:
   ```
   <WORKSPACE_PATH>/specs/<CREATION_DATE>/<TASK_SLUG>/
     services/
   ```

**Store**: `TASK_DIR` = `<WORKSPACE_PATH>/specs/<CREATION_DATE>/<TASK_SLUG>`

---

## Step 6 — Write Initial TASKS.md

Write the initial tracker to `<TASK_DIR>/TASKS.md`:

```markdown
# Task: <TASK_SLUG>

## Status: refining

## Lifecycle
- Created: <current-datetime-ISO>
- Sprint: <SPRINT_NUMBER>

## Services
- Primary: <SERVICE_ID>
- Affected: (pending detection)

## Phases
(pending — will be generated by /jlu-execute-task)

## Testing
(pending)

## External Links
- ClickUp: (not synced)
- PR: (not created)
```

If a tasks.md template exists at `<plugin-root>/jelou/templates/tasks.md`, use it as the base. Otherwise, use the format above.

Note: The `## Branching` section is NOT written here. It is appended to TASKS.md in Step 8c after `DUAL_PR` is known.

---

## Step 7 — Detect Affected Services

1. Read `<WORKSPACE_PATH>/registry/services.yaml` for all registered services.
2. Read `<WORKSPACE_PATH>/services/<SERVICE_ID>/codebase/INTEGRATIONS.md` (if it exists) to understand the primary service's integration points.
3. Analyze the task description (`TASK_DESCRIPTION`) for references to other services:
   - Look for service names or IDs mentioned in the text.
   - Cross-reference with known integrations from INTEGRATIONS.md.
   - Cross-reference with services registered in `services.yaml`.
4. Build a proposed list of affected services (always including the primary `SERVICE_ID`).
5. Check for references to services NOT in the registry (Decision #39):
   - If found, warn: "The task references `<name>` which is not registered in `services.yaml`. Would you like to register it?"

**Store**: `PROPOSED_SERVICES` = list of affected service IDs

---

## Step 8 — Confirm Affected Services

Present the proposed affected services to the user:

```
Affected services for this task:
  1. <SERVICE_ID> (primary)
  2. <service-2>
  3. <service-3>

Confirm? (yes / add more / remove some)
```

- If the user confirms: proceed with the list.
- If the user wants to add/remove: update the list and confirm again.

**Store**: `CONFIRMED_SERVICES` = final list of affected service IDs

Create the per-service directories in the task folder:
```
<TASK_DIR>/services/<service-id>/
  phases/
  uh/
```

Update `TASKS.md` with the confirmed affected services list.

---

### 8b. Conflict Detection

After confirming affected services, scan for overlapping active tasks:

1. **Scan active tasks**:
   a. List all date folders under `<WORKSPACE_PATH>/specs/`.
   b. For each date folder, list all task slug directories.
   c. For each task directory (excluding the current task being created):
      - Read `TASKS.md` and extract the task status.
      - If status is `closed`, `cancelled`, or `rolled_back`: skip.
      - Otherwise: extract the affected services list from TASKS.md.
      - If TASKS.md doesn't list services, try reading SPEC.md for service references.

2. **Detect overlaps**:
   For each active task, compare its affected services with `CONFIRMED_SERVICES`.
   If any service-id appears in both lists, record the overlap:
   - Active task slug
   - Active task status (e.g., "implementing, Phase 3/5")
   - Overlapping service IDs
   - Active task's spec title (from SPEC.md first line, if readable)

3. **Report conflicts**:
   If overlaps were found, present via question:
   ```
   Conflict detected with active task(s):

   Task: <active-task-slug> (<status>)
     Title: <spec title>
     Overlapping services: <service-id-1>, <service-id-2>

   Task: <another-task-slug> (<status>)
     Title: <spec title>
     Overlapping services: <service-id-3>

   These tasks modify some of the same services. Concurrent changes
   may cause merge conflicts or unexpected interactions.

   Options:
   A) Proceed anyway (I know about these tasks)
   B) Abort task creation
   ```

   If the user selects "Abort": stop the workflow. Report: "Task creation aborted due to conflicts. Review active tasks and retry."

4. **No conflicts**: continue silently to Step 8c.

---

### 8c. Dual-PR Intent

Using `question`:

> **"Will this task also need a PR to `alpha` (staging)?"**
> - No — only a PR to trunk (default)
> - Yes — two PRs: one to trunk (mandatory), one to alpha (synthesized at PR-creation time via cherry-pick with conflict resolver)

Store as `DUAL_PR` (boolean).

After storing `DUAL_PR`, **append** the `## Branching` section to the existing TASKS.md file, between the `## Services` and `## Phases` sections:

```markdown
## Branching
- Dual PR: <DUAL_PR yes|no>
- Primary branch: production/<TASK_SLUG>
- Secondary branch: staging/<TASK_SLUG>   (intended; synthesized at first /jlu-create-pr when Dual PR = yes)
- Mode: (pending — chosen after spec approval)
- Last alpha SHA: (pending — populated at first dual-PR sync)
- Last cherry-picked production SHA: (pending — populated at first dual-PR sync)
```

**Store**: `DUAL_PR`

---

## Step 10 — Load Codebase Files

For each service in `CONFIRMED_SERVICES`, attempt to read:

- `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/STACK.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/INTEGRATIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONCERNS.md`

Track which files exist and which are missing.

**Store**: `CODEBASE_CONTEXT` = map of service-id -> map of filename -> content

---

## Step 11 — Read Engineering Principles

1. Read `<WORKSPACE_PATH>/principles/ENGINEERING_PRINCIPLES.md`.
2. If the file does not exist, note it but do not block. The interview can proceed without it.

**Store**: `PRINCIPLES_CONTENT` = contents (or empty string if missing)

---

## Step 12 — Warn on Missing Context

1. If any codebase files are missing for any affected service:
   - Present a warning for each:
     ```
     Missing codebase files for <service-id>:
       - ARCHITECTURE.md
       - STACK.md
       - (etc.)
     ```
   - Offer: "Run `/jlu-map-codebase <service-id>` to generate them? Or continue without codebase context?"
   - If user chooses to map: pause this workflow, instruct user to run `/jlu-map-codebase`, then re-run `/jlu-new-task`.
   - If user chooses to continue: proceed with whatever context is available.

2. Check `.opencode/skill-registry.json` (if it exists):
   - Compare its modification time with the skill files in the plugin directory.
   - If stale: warn "Skill registry appears stale. Run `/jlu-refresh-skills` to update?"

---

## Step 13 — Review Loaded Context

Before starting the interview, confirm you have loaded:
- `TASK_DESCRIPTION` from Step 3
- `CODEBASE_CONTEXT` from Step 10
- `PRINCIPLES_CONTENT` from Step 11
- `CONFIRMED_SERVICES` from Step 8
- `DETECTED_TEMPLATES`, `MERGED_PREFILL`, `MERGED_HINTS` from Step 2c

All of these are already in memory from previous steps. No assembly needed — proceed directly to the interview.

---

## Step 14 — Interview and Write Spec

> **Tool requirement reminder**: Every question and confirmation in this step MUST use `question`. Never output questions as plain text.

### 14a — Gap Analysis (silent)

Before asking any questions, silently analyze the task description (`TASK_DESCRIPTION`) against the codebase knowledge (`CODEBASE_CONTEXT`). Identify:
- Ambiguities or missing details in the task description
- Conflicts between the task and existing architecture, conventions, or integration patterns
- Implicit assumptions that need explicit confirmation
- Edge cases, error scenarios, and security implications not addressed
- Integration points with other services or systems referenced in INTEGRATIONS.md
- Non-functional requirements (performance, scalability, observability) not mentioned
- Known concerns from CONCERNS.md that intersect with this task
- If `MERGED_HINTS` is non-empty: incorporate the merged interview hints from all auto-detected templates as high-priority gap areas. These cover domain-specific questions from each applicable template and tell you which questions are most relevant for this type of work.
- Additionally, apply domain-aware gap detection for any domains NOT already covered by detected templates:
  - **API/endpoint work**: HTTP method, URL path, auth model, request/response schema, validation rules, pagination, rate limits, partial failure handling
  - **UI/frontend work**: visual state machine (idle/loading/success/error/empty), interaction events, data source, accessibility, responsive breakpoints, animation
  - **Database/migration work**: data volume, additive vs destructive, old-code compatibility, rollback DDL, FK ordering, backfill strategy, index lock duration
  - **Event/async work**: message broker, idempotency mechanism, timeout behavior, ordering guarantees, dead letter strategy, schema versioning, consumer lag
  - **Cross-cutting tasks**: apply relevant probes from each applicable domain above

Prioritize gaps by impact: architectural decisions > behavioral requirements > edge cases > cosmetic details.

### 14b — Structured Interview

Using `question`, interview the user to resolve all identified gaps.

Rules:
- **2-4 questions per round**, grouped by theme — never random
- **Themes to cover** (in rough priority order):
  1. Technical implementation details (how will this be built? what patterns apply?)
  2. Tradeoffs & alternatives (why this approach over others? what are we giving up?)
  3. Architecture & design decisions (how does this fit into the existing system?)
  4. Behavioral requirements (what exactly should happen in each scenario?)
  5. Edge cases & error handling (what happens when things go wrong?)
  6. Security & authorization (who can do what? what's sensitive?)
  7. Performance & scalability (volume expectations, latency constraints?)
  8. Integration points (what other services/systems are affected?)
  9. UX/UI implications (if applicable — user-facing behavior)
  10. Constraints & out-of-scope (what should we explicitly NOT do?)
- **Ask non-obvious questions** — informed by what you found in the codebase context, not generic. Reference specific files, patterns, or conventions you observed.
  - Good: "INTEGRATIONS.md shows this service communicates with service-payments via async events. Should the new feature use the same event bus, or does it need a synchronous call?"
  - Bad: "What technology should we use?"
- **Go deep** — don't accept vague answers. If the user says "it should be fast", ask "what's the latency budget? p95 under 200ms?"
- **Ask about tradeoffs** — if the user chose approach A, ask why not B. Surface implicit decisions.
- **Continue until complete** — keep interviewing until you can confidently fill all 5 output sections.
- **Respect the user** — if the user says "that's enough" or "move on", stop the interview and write the spec with what you have.

### 14c — Write SPEC.md

After the interview is complete, write `<TASK_DIR>/SPEC.md` with these structured sections:

```markdown
# <Task Title>

## Problem Statement
What problem this solves and why it matters. Include business context.

## Requirements

### Functional
- FR-1: <requirement>
- FR-2: <requirement>
...

### Non-Functional
- NFR-1: <requirement> (e.g., performance, security, scalability, observability)
...

## Constraints
Technical, business, or timeline constraints that bound the solution.

## Out of Scope
Explicitly excluded from this task — things that might seem related but are NOT part of this work.

## Success Criteria
How to verify the task is complete. Concrete, testable conditions.
- SC-1: <criterion>
- SC-2: <criterion>
...
```

If `MERGED_PREFILL` is non-empty:
- Use the merged pre-filled sections as the starting structure for SPEC.md.
- Replace `<!-- FILL: ... -->` placeholders with answers from the interview.
- Preserve pre-filled requirements that are still relevant; remove any that don't apply.
- Deduplicate requirements that overlap between merged templates.
- Add new requirements discovered during the interview.

If `DETECTED_TEMPLATES` is non-empty:
- Record the detected templates in a comment at the top of SPEC.md: `<!-- Templates: <template-1>, <template-2> -->`

Rules for writing:
- Preserve the user's original intent from the task description
- Add precision and detail from interview answers
- Number requirements and criteria for traceability (FR-1, NFR-1, SC-1)
- Make every requirement concrete enough that a developer could implement it and a QA agent could verify it
- The spec must be directly usable by the proposal-agent to generate PROPOSAL.md without ambiguity

### 14d — Present for Approval

Using `question`, present the complete SPEC.md to the user:
1. A brief executive summary of what the spec covers
2. A count of requirements (FR: X, NFR: Y) and success criteria (SC: Z)
3. Any areas where you had to make judgment calls or where information was incomplete
4. Ask clearly: "Do you approve this spec to move to `planned` status?"

If the user wants changes, make them and re-present. Loop until the user approves or explicitly stops.

---

## Step 15 — Post-Interview Confirmation

After the user approves (or declines) the spec:

1. Verify that `<TASK_DIR>/SPEC.md` exists and has all 5 structured sections.
   - If not created or incomplete: warn "SPEC.md could not be completed. Review the interview output."

1b. Create the version history:
    a. Create `<TASK_DIR>/versions/` directory.
    b. Copy `<TASK_DIR>/SPEC.md` to `<TASK_DIR>/versions/SPEC-v1.md`.
    c. Write `<TASK_DIR>/versions/SPEC-changelog.md`:
       ```markdown
       # Spec Changelog

       ## v1 (<current-date>)
       Initial spec created via /jlu-new-task interview.
       Templates auto-detected: <DETECTED_TEMPLATES or "none">
       ```

2. If the user **approved** the spec:
   a. Update `<TASK_DIR>/TASKS.md`:
      - Change `Status: refining` to `Status: planned`
      - Add transition timestamp: `- Planned: <current-datetime-ISO>`
3. If the user **did not approve** or the interview ended without approval:
   a. Leave TASKS.md status as `refining`.
   b. Report: "SPEC.md was created but not yet approved. You can:"
      - "Review and edit `<TASK_DIR>/SPEC.md` manually, then re-run `/jlu-new-task <TASK_SLUG>`"
      - "Or re-run `/jlu-refine-task <TASK_SLUG>` to apply targeted changes"

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

---

## Step 16 — Final Report

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

### Worktrees Created
- <service-id-1>: <repo-path>/.worktrees/<TASK_SLUG> (branch: spec/<TASK_SLUG>)
- <service-id-2>: <repo-path>/.worktrees/<TASK_SLUG> (branch: spec/<TASK_SLUG>)
- ...

### Docker Instances
- <service-id-1>: running on port <port> (container: <id>)
- <service-id-2>: no Docker
- ...

### Warnings
- <any codebase map warnings>
- <any skill staleness warnings>
- <any unregistered service warnings>
- <any worktree creation failures>

### Next Step
Run `/jlu-execute-task` to begin implementation.
```

---

## Error Handling

| Error | Action |
|-------|--------|
| Cannot resolve workspace | Offer to create, stop if user declines |
| Service not registered | Offer to register, warn if declined |
| Task slug already exists | Auto-append numeric suffix |
| Git worktree creation fails | Background agent reports error, skip that worktree, continue |
| INTEGRATIONS.md missing | Proceed without integration-based detection, rely on user input |
| Codebase files missing | Warn, offer `/jlu-map-codebase`, allow continue without |
| Interview interrupted (session timeout, user abort) | Save any spec content written so far, report partial state |
| User cancels at any confirmation step | Save any artifacts created so far, report partial state |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| Task spec | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/SPEC.md` |
| Task tracker | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/TASKS.md` |
| Per-service dir | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/services/<service-id>/` |
| Phase dir | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/services/<service-id>/phases/` |
| User stories dir | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/services/<service-id>/uh/` |
| Worktree | `<service-repo>/.worktrees/<task-slug>` |
| Branch | `spec/<task-slug>` |
