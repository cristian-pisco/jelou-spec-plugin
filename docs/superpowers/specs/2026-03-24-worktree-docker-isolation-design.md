# Worktree Docker Isolation Design

## Problem

When `jlu:new-task` creates worktrees for multi-service tasks, two categories of issues arise:

1. **Missing untracked files.** Git worktrees only contain tracked files. Untracked/gitignored files like `.env` and `.npmrc` are not present in the worktree, causing runtime failures (missing config) and build failures (private package registry auth).

2. **Docker container conflicts.** Each service's `docker-compose.yml` has a hardcoded `container_name`. When a worktree starts Docker, it collides with the main repo's container (or another worktree's container) because the name is already in use. Port conflicts are partially addressed by the current spec's port allocation, but `container_name` and inter-service URL wiring are not handled.

## Approach

**Override file + .env patching.** Layer a generated `docker-compose.override.yml` on top of existing compose files without modifying them. Copy required untracked files. Patch `.env` for port allocation and inter-service wiring using Docker network aliases.

### Why this approach

- Non-destructive: override files don't touch the base compose
- Clean separation: worktree config is self-contained
- Compatible: all services already share the external `devlabs_mynetwork` network (referenced as `app-network` in each service's compose file), so aliases resolve automatically

### Alternatives considered

- **Full compose rewrite**: Copy and modify the entire compose file. Rejected because the worktree copy becomes stale if the branch modifies the compose file.
- **Task-level shared compose**: A single compose file for all task services. Rejected as a major departure from the per-service model.

## Design

### 1. Untracked File Copying

After `git worktree add`, copy these files from the service repo root to the worktree:

| File | Purpose |
|------|---------|
| `.env` | Runtime configuration, port assignment, inter-service URLs |
| `.npmrc` | GitHub package registry authentication tokens |

If a file doesn't exist in the repo root, skip silently.

```bash
for file in .env .npmrc; do
  [ -f <repo>/$file ] && cp <repo>/$file <worktree>/$file
done
```

### 2. `docker-compose.override.yml` Generation

For each Docker-enabled service, generate a `docker-compose.override.yml` in the worktree that overrides:

- **`container_name`**: `<service-id>-<TASK_SLUG>`
- **Host port mapping**: `<allocated-port>:<internal-port>`
- **Network alias**: `<service-id>-<TASK_SLUG>` on the existing `app-network`

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

**Secondary containers** (e.g., `orchestrator-service`'s `router-vector-db`) are also suffixed with `-<TASK_SLUG>` to avoid collisions. Example for `orchestrator-service` with task `add-oauth-flow`, allocated port `3101`, DB port `5433`:

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

**Note:** `app-network` is the compose-internal network name that maps to the external `devlabs_mynetwork` network. All services use this same pattern.

If a `docker-compose.override.yml` already exists in the repo root, it is NOT copied. The generated one in the worktree takes precedence.

### 3. Inter-Service `.env` Wiring

After all worktrees are created and ports allocated, a second pass updates each worktree's `.env` to replace references to sibling task services with their task-specific network aliases.

**Replacement rule:** For each sibling service in the task, find occurrences of the **original `container_name`** (from the base compose file) in the `.env` and replace with the task alias `<service-id>-<TASK_SLUG>`.

Example — task affects `api-gateway-service` and `marketplace-service`:

| Service | Original `container_name` | Task alias |
|---------|--------------------------|------------|
| marketplace-service | `marketplace-service` | `marketplace-service-add-oauth-flow` |
| api-gateway-service | `jelou-api-gateway` | `api-gateway-service-add-oauth-flow` |

In `api-gateway-service` worktree `.env`:
```diff
- MARKETPLACE_SERVER_URL=http://marketplace-service:8080
+ MARKETPLACE_SERVER_URL=http://marketplace-service-add-oauth-flow:8080
```

**Key rules:**
- Only replace references to services that are **part of the same task**. Services not in the task keep their original container names (pointing to main instances).
- The internal port in the URL stays the same (e.g., `:8080`). Aliases resolve inside the Docker network.
- The replacement uses the original `container_name` from the base compose file as the search pattern, not the service-id.

### 4. Updated Workflow Sequence

The modified Step 9 of `new-task.md` is restructured into 5 phases:

```
Phase 1 — Create worktrees (parallel, per service)
  1. git worktree add .worktrees/<TASK_SLUG> -b spec/<TASK_SLUG>
  2. Copy untracked files: .env, .npmrc (skip if missing)

Phase 2 — Port allocation (sequential)
  3. For each Docker-enabled service:
     a. Run docker ps --format '{{.Ports}}' to find occupied ports
     b. Allocate next free port starting from 3100
     c. Update worktree .env: replace ^<PORT_ENV>=.* with allocated port

Phase 3 — Generate overrides (parallel, per service)
  4. For each Docker-enabled service:
     a. Read base compose file to extract container_name(s) and internal port
     b. Generate docker-compose.override.yml in worktree:
        - container_name: <service-id>-<TASK_SLUG>
        - ports: <allocated-port>:<internal-port>
        - network alias: <service-id>-<TASK_SLUG>
        - Same for secondary containers (suffixed with -<TASK_SLUG>)

Phase 4 — Wire inter-service URLs (sequential, after all overrides exist)
  5. For each Docker-enabled service in the task:
     a. In worktree .env, replace original container_name references
        to sibling task services with their task-specific aliases

Phase 5 — Start Docker (parallel, per service)
  6. cd <worktree> && docker compose up -d
  7. Verify container running (poll up to 30s)
```

**Key change from current spec:** The current spec does worktree creation, .env copy, port patching, and Docker start in one shot per service. The new design requires a two-pass approach because inter-service wiring (Phase 4) needs all port allocations and override files to exist first.

## Files Modified

| File | Change |
|------|--------|
| `jelou/workflows/new-task.md` | Restructure Step 9 into 5 phases with untracked file copying, override generation, and inter-service wiring |
| `jelou/references/docker-conventions.md` | Add override generation rules, network alias conventions, and untracked file list |

## Error Handling

| Scenario | Action |
|----------|--------|
| `.env` or `.npmrc` missing in repo root | Skip silently, continue |
| Base compose file has no `container_name` | Use Docker Compose default naming (`<project>-<service>-1`), suffix with `-<TASK_SLUG>` |
| `docker-compose.override.yml` already exists in worktree | Overwrite with generated version |
| Secondary container port conflicts | Allocate unique ports for secondary containers too (e.g., `router-vector-db` gets its own port) |
| `.env` has no references to sibling services | No replacements needed, skip |
