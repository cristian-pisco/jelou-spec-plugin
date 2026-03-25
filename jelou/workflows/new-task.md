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

Spawn a **background Agent** (`run_in_background: true`) using the `jlu-git-agent` with model: **haiku** and:
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

3. Read the service's base compose file (from `docker.compose_file` in `services.yaml`) to discover all container definitions.
4. Allocate one port per container from the next free port starting from 3100 (increment by 1, skip any port in the allocated set). Add each allocated port to the set before processing the next container.
5. Update the worktree's `.env`: replace `^<PORT_ENV>=.*` with `<PORT_ENV>=<allocated-primary-port>`.
6. Secondary container ports are NOT written to `.env` — they are only used in the override file generated in Phase 3.

### Phase 3 — Generate `docker-compose.override.yml` (parallel, per service)

For each Docker-enabled service with a successfully created worktree:

1. Read the base compose file to extract all `container_name` values and their port mappings.
2. Generate `<worktree>/docker-compose.override.yml` with:
   - Top-level `name: <service-id>-<TASK_SLUG>` (sets Docker Compose project name)
   - For the primary container (`docker.service` from `services.yaml`):
     - `container_name: <service-id>-<TASK_SLUG>`
     - `ports: ["<allocated-port>:<internal-port>"]`
     - `networks.app-network.aliases: [<service-id>-<TASK_SLUG>]`
   - For each secondary container:
     - `container_name: <original-container-name>-<TASK_SLUG>`
     - `ports: ["<allocated-port>:<internal-port>"]`

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

## Step 13 — Build Composite Context

Assemble the full context string that will be injected into the spec-interviewer agent's prompt. Order matters for clarity:

```
=== Task Description ===
<TASK_DESCRIPTION>

=== Engineering Principles ===
<PRINCIPLES_CONTENT>

=== Service: <service-id-1> ===

--- ARCHITECTURE.md ---
<content>

--- STACK.md ---
<content>

--- CONVENTIONS.md ---
<content>

--- INTEGRATIONS.md ---
<content>

--- STRUCTURE.md ---
<content>

--- CONCERNS.md ---
<content>

=== Service: <service-id-2> ===
(repeat for each affected service)
```

**Store**: `COMPOSITE_CONTEXT` = the full assembled context string

---

## Step 14 — Spawn Spec-Interviewer Agent

Notify the user before spawning:
```
Spawning spec-interviewer agent (Opus) to analyze the codebase and interview you about requirements...
```

Spawn a single `jlu-spec-interviewer` agent with model: **opus**.

**Agent prompt construction**:

1. Read the agent definition from `<plugin-root>/agents/jlu-spec-interviewer.md`.
2. Prepend `COMPOSITE_CONTEXT` before the agent instructions.
3. Append task metadata:
   ```
   Task slug: <TASK_SLUG>
   Task directory: <TASK_DIR>
   SPEC.md path: <TASK_DIR>/SPEC.md
   Affected services: <comma-separated list>
   ```

**What the agent does** (defined in its agent file, summarized here for reference):

1. **Gap analysis** (silent) — Analyzes the task description against codebase knowledge. Identifies ambiguities, conflicts, implicit assumptions, edge cases, integration points, NFRs, and known concerns.
2. **Structured interview** — Asks the user 2-4 themed questions per round. Themes: architecture, behavior, edge cases, security, performance, integrations, UX, constraints. Questions are informed by codebase context (non-obvious, specific). Continues until the agent has enough to fill all 5 sections.
3. **Write SPEC.md** — Writes `<TASK_DIR>/SPEC.md` with structured sections: Problem Statement, Requirements (FR/NFR), Constraints, Out of Scope, Success Criteria. Requirements are numbered (FR-1, NFR-1, SC-1) for traceability.
4. **Present for approval** — Shows the complete spec to the user. User must explicitly approve.

**Important**: The orchestrator does NOT perform the interview or write the spec. It delegates entirely to the spec-interviewer agent. The orchestrator's job is to load context and spawn the agent.

---

## Step 15 — Post-Agent Confirmation

After the spec-interviewer agent completes:

1. Verify that `<TASK_DIR>/SPEC.md` exists and has all 5 structured sections.
   - If not created or incomplete: warn "The spec-interviewer did not appear to complete SPEC.md. Review the agent output."

2. Check the agent's output for approval status:
   - If the user **approved** the spec:
     a. Update `<TASK_DIR>/TASKS.md`:
        - Change `Status: refining` to `Status: planned`
        - Add transition timestamp: `- Planned: <current-datetime-ISO>`
     b. Check `WORKTREE_AGENT_TASK` result:
        - If the background worktree agent completed successfully: log the created worktrees.
        - If it failed or is still running: report the worktree errors and note the user can create worktrees manually.
   - If the user **did not approve** or the agent ended without approval:
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
