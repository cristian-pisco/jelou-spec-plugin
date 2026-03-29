# Workflow: new-task

> Orchestrator workflow for `/jlu:new-task [task description]`
> Creates a new task, runs the spec interview inline, and creates worktrees in the background.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.

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
4. Use `MODEL_CONFIG.operational` (default: haiku) for the git-agent spawn in Step 9.

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

### 2c. Template Selection

1. Check if `<WORKSPACE_PATH>/templates/` directory exists.
   - If not, create it and copy built-in templates from `<PLUGIN_ROOT>/jelou/templates/spec-templates/` to `<WORKSPACE_PATH>/templates/`.
2. Scan `<WORKSPACE_PATH>/templates/` for `.md` files.
3. For each file, read the `## Description` section to extract the one-line description.
4. Present the template selector via AskUserQuestion:
   ```
   Select a spec template to start with:

   1. REST API Endpoint — New REST API endpoint with request/response schema, validation, and auth.
   2. UI Component — New UI component with states, interactions, accessibility, and responsive behavior.
   3. Database Migration — Schema change with data transformation, rollback strategy, and zero-downtime deployment.
   4. Event Consumer — Async event consumer with idempotency, retry logic, and dead letter handling.
   5. <any custom templates found>
   6. Blank (no template)
   ```
5. If a template is selected (not "Blank"):
   a. Read the full template file.
   b. Extract the `## Pre-filled Sections` content.
   c. Store the `## Interview Hints` content.
   d. Set `SELECTED_TEMPLATE` = template name, `TEMPLATE_PREFILL` = pre-filled sections, `INTERVIEW_HINTS` = hints content.
6. If "Blank" is selected:
   a. Set `SELECTED_TEMPLATE` = "none", `TEMPLATE_PREFILL` = empty, `INTERVIEW_HINTS` = empty.

**Store**: `SELECTED_TEMPLATE`, `TEMPLATE_PREFILL`, `INTERVIEW_HINTS`

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
(pending — will be generated by /jlu:execute-task)

## Testing
(pending)

## External Links
- ClickUp: (not synced)
- PR: (not created)
```

If a tasks.md template exists at `<plugin-root>/jelou/templates/tasks.md`, use it as the base. Otherwise, use the format above.

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

## Step 9 — Launch Background Worktree Creation

Notify the user before launching:
```
Launching worktree creation in background for <N> services...
```

Spawn a **background Agent** (`run_in_background: true`) using the `jlu-git-agent` with model: **MODEL_CONFIG.operational** (default: haiku) and:
- The confirmed services list (`CONFIRMED_SERVICES`)
- The task slug (`TASK_SLUG`)
- The repo path for each service from `services.yaml`

The background agent executes 5 phases in order:

### Phase 1 — Create worktrees and copy untracked files (parallel, per service)

For each service in `CONFIRMED_SERVICES`:

1. Look up the service's repo path from `services.yaml`.
2. Navigate to that repo path.
3. Create a worktree:
   ```bash
   git worktree add .worktrees/<TASK_SLUG> -b spec/<TASK_SLUG>
   ```
4. If the branch `spec/<TASK_SLUG>` already exists: use the existing branch.
5. Copy untracked files from repo root to worktree (skip if file doesn't exist):
   ```bash
   for file in .env .npmrc; do
     [ -f <repo>/$file ] && cp <repo>/$file <worktree>/$file
   done
   ```
6. Record the worktree path.

**Error handling**: If `git worktree add` fails (dirty working tree, branch conflicts), report the error but do NOT block the workflow. Continue with whatever worktrees succeed.

### Phase 2 — Port allocation (sequential)

1. Run `docker ps --format '{{.Ports}}'` once to get the initial set of occupied host ports.
2. Initialize an in-memory set of allocated ports from the `docker ps` output.

For each service that has a `docker` config in `services.yaml` AND a successfully created worktree:

3. Read the service's base compose file (from `docker.compose_file` in `services.yaml`) to discover all container definitions and their port mappings.
4. Allocate one host port **per port mapping** (not per container) from the next free port starting from 3100 (increment by 1, skip any port in the allocated set). A container with two port mappings (e.g., `8080` + `9001`) gets two allocated ports. Add each allocated port to the set before processing the next mapping.
5. Update the worktree's `.env`: replace `^<PORT_ENV>=.*` with `<PORT_ENV>=<allocated-primary-port>`.
6. Secondary port mappings and secondary container ports are NOT written to `.env` — they are only used in the override file generated in Phase 3.

### Phase 3 — Generate `docker-compose.override.yml` (parallel, per service)

For each Docker-enabled service with a successfully created worktree:

1. Read the base compose file to extract all `container_name` values and their port mappings.
2. Generate `<worktree>/docker-compose.override.yml` with:
   - Top-level `name: <service-id>-<TASK_SLUG>` (sets Docker Compose project name)
   - For the primary container (`docker.service` from `services.yaml`):
     - `container_name: <service-id>-<TASK_SLUG>`
     - `ports: !override` with one `"<allocated-port>:<internal-port>"` entry per base port mapping
     - `networks.app-network.aliases: [<service-id>-<TASK_SLUG>]`
   - For each secondary container:
     - `container_name: <original-container-name>-<TASK_SLUG>`
     - `ports: !override` with one `"<allocated-port>:<internal-port>"` entry per base port mapping

See `jelou/references/docker-conventions.md` → "Override Generation" for full rules and examples.

### Phase 4 — Wire inter-service URLs (sequential)

For each Docker-enabled service in the task:

1. Build a replacement map: for each **other** Docker-enabled service in the task, map its original `container_name` → `<service-id>-<TASK_SLUG>`.
2. In the worktree's `.env`, find-and-replace each original `container_name` with its task alias.
3. Only replace references to services that are part of the same task. Services not in the task keep their original container names.

See `jelou/references/docker-conventions.md` → "Inter-Service URL Wiring" for full rules and examples.

### Phase 5 — Start Docker (parallel, per service)

For each Docker-enabled service with a successfully created worktree:

1. Start Docker: `cd <worktree> && docker compose up -d`
2. Verify container is running: `docker compose ps` (poll up to 30s).
3. Record container ID + port for the final report.

**If no `docker` config**: skip Phases 2-5 for that service (only Phase 1 applies).

**Store**: `WORKTREE_AGENT_TASK` = reference to the background agent task (to check later in Step 15)

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
   - Offer: "Run `/jlu:map-codebase <service-id>` to generate them? Or continue without codebase context?"
   - If user chooses to map: pause this workflow, instruct user to run `/jlu:map-codebase`, then re-run `/jlu:new-task`.
   - If user chooses to continue: proceed with whatever context is available.

2. Check `.claude/skill-registry.json` (if it exists):
   - Compare its modification time with the skill files in the plugin directory.
   - If stale: warn "Skill registry appears stale. Run `/jlu:refresh-skills` to update?"

---

## Step 13 — Review Loaded Context

Before starting the interview, confirm you have loaded:
- `TASK_DESCRIPTION` from Step 3
- `CODEBASE_CONTEXT` from Step 10
- `PRINCIPLES_CONTENT` from Step 11
- `CONFIRMED_SERVICES` from Step 8

All of these are already in memory from previous steps. No assembly needed — proceed directly to the interview.

---

## Step 14 — Interview and Write Spec

> **Tool requirement reminder**: Every question and confirmation in this step MUST use `AskUserQuestion`. Never output questions as plain text.

### 14a — Gap Analysis (silent)

Before asking any questions, silently analyze the task description (`TASK_DESCRIPTION`) against the codebase knowledge (`CODEBASE_CONTEXT`). Identify:
- Ambiguities or missing details in the task description
- Conflicts between the task and existing architecture, conventions, or integration patterns
- Implicit assumptions that need explicit confirmation
- Edge cases, error scenarios, and security implications not addressed
- Integration points with other services or systems referenced in INTEGRATIONS.md
- Non-functional requirements (performance, scalability, observability) not mentioned
- Known concerns from CONCERNS.md that intersect with this task
- If `INTERVIEW_HINTS` is non-empty: incorporate the template's interview hints as high-priority gap areas. These tell you which questions are most relevant for this type of work.

Prioritize gaps by impact: architectural decisions > behavioral requirements > edge cases > cosmetic details.

### 14b — Structured Interview

Using `AskUserQuestion`, interview the user to resolve all identified gaps.

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

If `TEMPLATE_PREFILL` is non-empty:
- Use the template's pre-filled sections as the starting structure for SPEC.md.
- Replace `<!-- FILL: ... -->` placeholders with answers from the interview.
- Preserve pre-filled requirements that are still relevant; remove any that don't apply.
- Add new requirements discovered during the interview.

If `SELECTED_TEMPLATE` is not "none":
- Record the template name in a comment at the top of SPEC.md: `<!-- Template: <SELECTED_TEMPLATE> -->`

Rules for writing:
- Preserve the user's original intent from the task description
- Add precision and detail from interview answers
- Number requirements and criteria for traceability (FR-1, NFR-1, SC-1)
- Make every requirement concrete enough that a developer could implement it and a QA agent could verify it
- The spec must be directly usable by the proposal-agent to generate PROPOSAL.md without ambiguity

### 14d — Present for Approval

Using `AskUserQuestion`, present the complete SPEC.md to the user:
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
       Initial spec created via /jlu:new-task interview.
       Template used: <SELECTED_TEMPLATE or "none">
       ```

2. If the user **approved** the spec:
   a. Update `<TASK_DIR>/TASKS.md`:
      - Change `Status: refining` to `Status: planned`
      - Add transition timestamp: `- Planned: <current-datetime-ISO>`
   b. Check `WORKTREE_AGENT_TASK` result:
      - If the background worktree agent completed successfully: log the created worktrees.
      - If it failed or is still running: report the worktree errors and note the user can create worktrees manually.
3. If the user **did not approve** or the interview ended without approval:
   a. Leave TASKS.md status as `refining`.
   b. Report: "SPEC.md was created but not yet approved. You can:"
      - "Review and edit `<TASK_DIR>/SPEC.md` manually, then re-run `/jlu:new-task <TASK_SLUG>`"
      - "Or re-run `/jlu:refine-task <TASK_SLUG>` to apply targeted changes"

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
Run `/jlu:execute-task` to begin implementation.
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
| Codebase files missing | Warn, offer `/jlu:map-codebase`, allow continue without |
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
