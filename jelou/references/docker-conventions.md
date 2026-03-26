# Docker Conventions

> Defines Docker-first execution rules, command classification, port allocation, and teardown policy for Docker-enabled services. Docker support is opt-in per service via the `docker` block in `services.yaml`.

## Docker-First Execution Rule

All dependency and framework commands (`npm`, `nest`, `npx`, `yarn`, `composer`, `artisan`, `go`, `cargo`) must run inside the service container via `docker compose exec <service> <command>`. File I/O and git operations always run on the host.

## Command Classification

| Type | Where | Example |
|------|-------|---------|
| File I/O | Host | `Read`, `Write`, `Glob`, `Grep` |
| Git | Host | `git add`, `git commit`, `git push` |
| Dependency install | Container | `docker compose exec <svc> npm install` |
| Tests | Container | `docker compose exec <svc> npm test` |
| Lint/format | Container | `docker compose exec <svc> npx eslint .` |
| Build/CLI | Container | `docker compose exec <svc> npm run build` |

**Rule of thumb**: If the command invokes a language runtime or package manager, it runs in the container. If it reads/writes files or interacts with git, it runs on the host.

## Port Allocation Algorithm

Each task worktree gets its own Docker instance on unique host ports to avoid collisions with other running tasks.

1. Base port: **3100**
2. Run `docker ps --format '{{.Ports}}'` to find currently occupied host ports.
3. Parse port numbers from the output.
4. Read the base compose file to discover **all** port mappings for each container (a single container may expose multiple ports, e.g., `8080` for the server and `9001` for a debugger).
5. Allocate one host port **per port mapping** from the next free port starting from 3100, incrementing by 1, skipping any port in the allocated set or found in `docker ps` output. Add each allocated port to the set before processing the next mapping.
6. Write the primary port (the one matching `port_env`) into the worktree's `.env` file under the service's `port_env` variable (default: `APP_PORT`). Secondary port mappings are only used in the override file.

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

## Override Generation

For each Docker-enabled service worktree, generate a `docker-compose.override.yml` that overrides:

- **`name`**: `<service-id>-<TASK_SLUG>` (sets the Docker Compose project name, preventing cross-service collisions)
- **`container_name`**: `<service-id>-<TASK_SLUG>`
- **Host port mappings**: One re-mapped port per base compose port mapping, using `!override` to fully replace the base list
- **Network alias**: `<service-id>-<TASK_SLUG>` on the existing `app-network`

`app-network` is the compose-internal network name that maps to the external `devlabs_mynetwork` network. All services use this same pattern.

**Why `!override`?** Without it, Docker Compose **merges** the override ports with the base ports, leaving the original host ports bound. When multiple worktrees of the same service run simultaneously, all would try to bind the same original host ports, causing conflicts. `!override` ensures only the allocated ports are mapped.

Example for `api-gateway-service`, task `add-oauth-flow`, allocated ports `3100` and `3101` (base has `8998:8080` and `13214:9001`):

```yaml
name: api-gateway-service-add-oauth-flow

services:
  app:
    container_name: api-gateway-service-add-oauth-flow
    ports: !override
      - "3100:8080"
      - "3101:9001"
    networks:
      app-network:
        aliases:
          - api-gateway-service-add-oauth-flow
```

### Secondary Containers

Services with multiple containers in their compose file (e.g., `orchestrator-service` has `app` and `router-vector-db`) must override **all** container definitions. Process every `services:` key in the base compose file, not just the one matching `docker.service` in `services.yaml`.

Secondary containers get:
- `container_name`: `<original-container-name>-<TASK_SLUG>`
- `ports: !override` with one allocated port per base port mapping (same algorithm as primary)
- No network alias needed (secondary containers are typically databases, not addressed by service URLs)

Example for `orchestrator-service`, task `add-oauth-flow`, app ports `3101`+`3102`, DB port `5433` (base app has `8080` and `9001`, base DB has `5432`):

```yaml
name: orchestrator-service-add-oauth-flow

services:
  app:
    container_name: orchestrator-service-add-oauth-flow
    ports: !override
      - "3101:8080"
      - "3102:9001"
    networks:
      app-network:
        aliases:
          - orchestrator-service-add-oauth-flow
  router-vector-db:
    container_name: router-vector-db-add-oauth-flow
    ports: !override
      - "5433:5432"
```

### Rules

- If a `docker-compose.override.yml` already exists in the repo root, do NOT copy it to the worktree. The generated override takes precedence.
- The internal container port (e.g., `8080`, `5432`) stays the same — only the host port changes.
- Extract container names and internal ports by reading the base compose file specified in `services.yaml` (`docker.compose_file`).
- If the base compose file has no explicit `container_name` for a service, use Docker Compose default naming (`<project>-<service>-1`) and suffix with `-<TASK_SLUG>`.

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

## Teardown Policy

When a task closes, Docker resources must be destroyed **before** the worktree is removed (the compose file lives in the worktree):

```bash
cd <worktree> && docker compose down -v --rmi all --remove-orphans
```

This removes:
- All containers defined in the compose file
- All associated volumes (`-v`)
- All images built for the compose services (`--rmi all`)
- Any orphaned containers (`--remove-orphans`)

## Docker Exec Prefix

During TDD execution, the orchestrator computes a `DOCKER_EXEC_PREFIX` for each Docker-enabled service:

```
cd <worktree> && docker compose exec <docker-service>
```

This prefix is injected into agent prompts (test-writer, implementer, QA). Agents must prefix all test, lint, build, and dependency commands with it.

## Non-Docker Services

If a service's entry in `services.yaml` does not have a `docker` block, all commands run directly on the host. No Docker prompts, port allocation, or teardown steps apply. The plugin behavior is identical to the pre-Docker baseline.
