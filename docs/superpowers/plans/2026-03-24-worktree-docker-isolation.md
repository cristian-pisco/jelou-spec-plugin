# Worktree Docker Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Docker container conflicts and missing config files when creating worktrees for multi-service tasks.

**Architecture:** Modify the `new-task.md` workflow Step 9 to copy untracked files (`.env`, `.npmrc`), generate a `docker-compose.override.yml` with unique container names and network aliases, and wire inter-service URLs in `.env` before starting Docker. Update `docker-conventions.md` with the new rules.

**Tech Stack:** Markdown workflow specs, Docker Compose overrides, bash

---

## File Structure

| File | Responsibility |
|------|---------------|
| `jelou/workflows/new-task.md` | Workflow definition — Step 9 restructured into 5 phases |
| `jelou/references/docker-conventions.md` | Reference doc — adds override generation rules, untracked file list, network alias conventions |

---

### Task 1: Update `docker-conventions.md` with untracked file and override rules

**Files:**
- Modify: `jelou/references/docker-conventions.md`

- [ ] **Step 1: Read the current file**

Read `jelou/references/docker-conventions.md` to confirm current contents match what's in the plan.

- [ ] **Step 2: Add "Untracked Files" section after "Port Allocation Algorithm"**

Insert before the `## Teardown Policy` section (after Port Allocation Algorithm):

```markdown
## Untracked File Copying

Git worktrees only contain tracked files. The following untracked/gitignored files must be copied from the service repo root to the worktree after `git worktree add`:

| File | Purpose |
|------|---------|
| `.env` | Runtime configuration, port assignment, inter-service URLs |
| `.npmrc` | GitHub package registry authentication tokens |

If a file does not exist in the repo root, skip it silently.

```bash
for file in .env .npmrc; do
  [ -f <repo>/$file ] && cp <repo>/$file <worktree>/$file
done
```
```

- [ ] **Step 3: Add "Override Generation" section after "Untracked File Copying"**

```markdown
## Override Generation

For each Docker-enabled service worktree, generate a `docker-compose.override.yml` that overrides:

- **`container_name`**: `<service-id>-<TASK_SLUG>`
- **Host port mapping**: `<allocated-port>:<internal-port>`
- **Network alias**: `<service-id>-<TASK_SLUG>` on the existing `app-network`

`app-network` is the compose-internal network name that maps to the external `devlabs_mynetwork` network. All services use this same pattern.

Example for `marketplace-service`, task `add-oauth-flow`, allocated port `3100`:

```yaml
services:
  app:
    container_name: marketplace-service-add-oauth-flow
    ports:
      - "3100:8080"
    networks:
      app-network:
        aliases:
          - marketplace-service-add-oauth-flow
```

### Secondary Containers

Services with multiple containers in their compose file (e.g., `orchestrator-service` has `app` and `router-vector-db`) must override **all** container definitions. Process every `services:` key in the base compose file, not just the one matching `docker.service` in `services.yaml`.

Secondary containers get:
- `container_name`: `<original-container-name>-<TASK_SLUG>`
- Unique port allocation (same algorithm as primary)
- No network alias needed (secondary containers are typically databases, not addressed by service URLs)

Example for `orchestrator-service`, task `add-oauth-flow`, app port `3101`, DB port `5433`:

```yaml
services:
  app:
    container_name: orchestrator-service-add-oauth-flow
    ports:
      - "3101:8080"
    networks:
      app-network:
        aliases:
          - orchestrator-service-add-oauth-flow
  router-vector-db:
    container_name: router-vector-db-add-oauth-flow
    ports:
      - "5433:5432"
```

### Rules

- If a `docker-compose.override.yml` already exists in the repo root, do NOT copy it to the worktree. The generated override takes precedence.
- The internal container port (e.g., `8080`, `5432`) stays the same — only the host port changes.
- Extract container names and internal ports by reading the base compose file specified in `services.yaml` (`docker.compose_file`).
- If the base compose file has no explicit `container_name` for a service, use Docker Compose default naming (`<project>-<service>-1`) and suffix with `-<TASK_SLUG>`.
```

- [ ] **Step 4: Add "Inter-Service URL Wiring" section after "Override Generation"**

```markdown
## Inter-Service URL Wiring

After all worktree overrides are generated, update each worktree's `.env` to replace references to sibling task services with their task-specific network aliases.

**Replacement rule:** For each sibling service in the task, find occurrences of the **original `container_name`** (from the base compose file) in the `.env` and replace with the task alias `<service-id>-<TASK_SLUG>`.

**Key rules:**
- Only replace references to services that are **part of the same task**. Services not in the task keep their original container names (pointing to main instances).
- The internal port in the URL stays the same (e.g., `:8080`). Aliases resolve inside the Docker network.
- The replacement uses the original `container_name` from the base compose file as the search pattern, not the service-id.
- If the `.env` has no references to sibling services, no replacements are needed — skip.

Example — task affects `api-gateway-service` (container: `jelou-api-gateway`) and `marketplace-service` (container: `marketplace-service`):

In `api-gateway-service` worktree `.env`:
```diff
- MARKETPLACE_SERVER_URL=http://marketplace-service:8080
+ MARKETPLACE_SERVER_URL=http://marketplace-service-add-oauth-flow:8080
```
```

- [ ] **Step 5: Verify the full file reads correctly**

Read `jelou/references/docker-conventions.md` top to bottom and confirm all sections flow logically: Docker-First Execution Rule → Command Classification → Port Allocation Algorithm → Untracked File Copying → Override Generation → Inter-Service URL Wiring → Teardown Policy → Docker Exec Prefix → Non-Docker Services.

- [ ] **Step 6: Commit**

```bash
git add jelou/references/docker-conventions.md
git commit -m "Add untracked file, override generation, and inter-service wiring conventions"
```

---

### Task 2: Restructure Step 9 of `new-task.md` into 5 phases

**Files:**
- Modify: `jelou/workflows/new-task.md` (Step 9 section — from `## Step 9` through the `---` separator before Step 10)

- [ ] **Step 1: Read the current Step 9**

Read `jelou/workflows/new-task.md` and locate the `## Step 9` section (currently around line 205). Confirm it ends with a `---` separator before Step 10.

- [ ] **Step 2: Replace Step 9 with the 5-phase structure**

Replace the entire Step 9 section (from `## Step 9` through the `---` separator before Step 10) with:

```markdown
## Step 9 — Launch Background Worktree Creation

Notify the user before launching:
```
Launching worktree creation in background for <N> services...
```

Spawn a **background Agent** (`run_in_background: true`) using the `jlu-git-agent` with:
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

For each service that has a `docker` config in `services.yaml` AND a successfully created worktree:

1. Run `docker ps --format '{{.Ports}}'` to find occupied host ports.
2. Parse port numbers, select next free port starting from 3100 (increment by 1, skip occupied ports).
3. Read the service's base compose file (from `docker.compose_file` in `services.yaml`) to discover all container definitions.
4. Allocate one port per container: the primary service container gets the first port, secondary containers (e.g., databases) get subsequent ports.
5. Update the worktree's `.env`: replace `^<PORT_ENV>=.*` with `<PORT_ENV>=<allocated-primary-port>`.
6. Secondary container ports are NOT written to `.env` — they are only used in the override file generated in Phase 3.

### Phase 3 — Generate `docker-compose.override.yml` (parallel, per service)

For each Docker-enabled service with a successfully created worktree:

1. Read the base compose file to extract all `container_name` values and their port mappings.
2. Generate `<worktree>/docker-compose.override.yml` with:
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
```

- [ ] **Step 3: Verify the edit reads correctly**

Read `jelou/workflows/new-task.md` from the `## Step 9` heading through `## Step 10` to confirm the new Step 9 is well-formed and flows into Step 10.

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "Restructure Step 9 into 5-phase worktree creation with Docker isolation"
```

---

### Task 3: Verify consistency between both files

**Files:**
- Read: `jelou/references/docker-conventions.md`
- Read: `jelou/workflows/new-task.md`

- [ ] **Step 1: Cross-reference the workflow and conventions**

Read both files and verify:
- The workflow Step 9 phases reference the correct convention sections
- The untracked file list matches between both files (`.env`, `.npmrc`)
- The override generation rules are consistent (container naming, port mapping, network alias)
- The inter-service wiring rules are consistent (replacement using original `container_name`, only sibling services)
- Phase ordering matches: worktrees → ports → overrides → wiring → Docker start

- [ ] **Step 2: Fix any inconsistencies found**

If any mismatches are found, fix them in whichever file is less authoritative (the conventions doc is the source of truth for rules; the workflow is the source of truth for ordering).

- [ ] **Step 3: Final commit if fixes were needed**

```bash
git add jelou/references/docker-conventions.md jelou/workflows/new-task.md
git commit -m "Fix consistency between workflow and conventions"
```
