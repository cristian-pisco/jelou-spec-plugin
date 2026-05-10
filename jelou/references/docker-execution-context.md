# Docker Execution Context Block

> Block the orchestrator injects into Bash-capable subagent prompts when the target service is Docker-enabled (`IS_DOCKER_SERVICE[service-id] == true`).

```
## Execution Environment
This service runs in Docker. When running tests or any framework command via Bash, prefix with:
  <DOCKER_EXEC_PREFIX> <command>
File reads/writes (Read, Write, Glob, Grep) operate on the host filesystem (the worktree).
Only test execution, lint, build, and dependency commands go through Docker.
```

## When to inject

Inject the block above (literal text) when dispatching:

- `jlu-test-writer` (Step 7d)
- `jlu-implementer` (Step 7e)
- `jlu-qa-agent` (Step 7h or 8c)
- `jlu-build-validator` (Step 7k)
- `jlu-test-writer` Tier 2 (Step 8a)

…and `IS_DOCKER_SERVICE[service-id]` is true.

For non-Docker services: omit the block entirely. The agent runs commands directly on the host.

## Why this is centralized

Previously the same block was duplicated 4–5 times across the execute-task workflow. Centralizing it here means:

- One place to update if the prefix scheme changes.
- Workflow stays terser, lowering per-invocation token cost.
- Subagent prompts include only the variant they need (Docker vs. non-Docker).

## Integration Runtime Policy

When integration tests require a running service process (for example NestJS e2e/integration flows), keep runtime and test execution in the same environment:

- **Docker-enabled service**: run service/framework commands via Docker, e.g.
  - `docker compose exec <APP> npm run start:dev`
  - `docker compose exec <APP> pnpm run start:dev`
- **Non-Docker service**: run service/framework commands on host, e.g.
  - `npm run start:dev`
  - `pnpm run start:dev`

Do not mix host-run services with container-run tests for the same service.
