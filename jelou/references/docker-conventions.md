# Docker Conventions

> Defines port allocation, override generation, inter-service URL wiring, and teardown policy for Docker-enabled services. Docker support is opt-in per service via the `docker` block in `services.yaml`.
>
> **Scope:** these rules apply only to dev services started by `/jlu-start-dev`. The TDD pipeline (tests, build, lint, format) always runs on the host runtime — never via `docker compose exec`. See "Command Classification" below.

## Command Classification

The TDD pipeline runs entirely on the host. Containers are reserved for the long-running dev services managed by `/jlu-start-dev`.

| Type | Where | Example |
|------|-------|---------|
| File I/O | Host | `Read`, `Write`, `Glob`, `Grep` |
| Git | Host | `git add`, `git commit`, `git push` |
| Tests (any tier) | Host | `npm test`, `pytest`, `go test ./...` |
| Lint/format | Host | `npx eslint .`, `npx prettier --write` |
| Build/CLI | Host | `npm run build`, `tsc --noEmit` |
| Dependency install | **Service runtime** | host for `runtime.type: host`; **inside the container** for `runtime.type: docker-compose` — always via `bin/install-dep.mjs` |
| Dev server (long-running) | Container (when `docker.compose_file` is set) | `docker compose up -d <svc>` via `/jlu-start-dev` |

**Rule of thumb**: anything that *reads* the dependency graph (tests, build, lint, format) runs on the host. Installing a dependency *mutates* the graph the running service consumes, so it must run wherever that service runs — the host for a host-runtime service, the container for a docker-compose-runtime service. Only the long-running dev process for a service with a `docker` block goes through Docker, and only when `/jlu-start-dev` boots it.

## Installing Dependencies

Never run a raw `npm install` / `yarn add` / `pnpm add` to add a package to a service. Always go through the helper:

```bash
node "${PLUGIN_ROOT:-.}/bin/install-dep.mjs" <service-name> <pkg>[@version] [<pkg> …] [--dev]
```

It reads the service's `runtime` block from `jlu-services.json` and:

- **`runtime.type: host`** (or an unregistered service) → installs on the host, in the service directory. This is the unchanged default.
- **`runtime.type: docker-compose`** → checks whether `compose_service` is running (`docker compose ps`), boots it idempotently with `docker compose up -d <service>` if it is not, then installs **inside the container** via the runtime's `exec_template` (default `docker compose -f {compose_file} exec {compose_service} {cmd}`).

The package manager is detected from the lockfile (pnpm/yarn/bun/npm) — never assumed. This is the one place the TDD pipeline is allowed to exec into a container; see the carve-out in `subagent-base.md`.

## Build in the ship preflight

The general rule (build reads the dep graph → runs on host) has one scoped
exception: the `/jlu-ship` preflight builds docker-compose-runtime services
*inside* their container, because their node_modules and Node version live there.
This is resolved per service via `bin/runtime-exec.mjs` and applies ONLY to the
ship preflight — never to the TDD per-phase build check. For task-isolated worktree
boots the boot plan mounts the canonical checkout's `node_modules` at `/app/node_modules`
when the worktree has none of its own, because the base compose bind-mounts the worktree
over `/app` (which would otherwise shadow the image's node_modules — and the image omits
devDependencies).

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

## Non-Docker Services

If a service's entry in `services.yaml` does not have a `docker` block, port allocation, override generation, and teardown steps do not apply. The dev workflow falls back to the `dev.command` field for booting the service. The TDD pipeline behavior is identical with or without a `docker` block — all tests/build/lint commands always run on the host either way.
