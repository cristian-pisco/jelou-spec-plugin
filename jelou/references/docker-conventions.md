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

Each task worktree gets its own Docker instance on a unique host port to avoid collisions with other running tasks.

1. Base port: **3100**
2. Run `docker ps --format '{{.Ports}}'` to find currently occupied host ports.
3. Parse port numbers from the output.
4. Select the next free port starting from 3100, incrementing by 1, skipping any port found in `docker ps` output.
5. Write the assigned port into the worktree's `.env` file under the service's `port_env` variable (default: `APP_PORT`).

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
