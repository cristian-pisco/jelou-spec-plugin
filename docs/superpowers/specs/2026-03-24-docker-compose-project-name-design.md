# Docker Compose Project Name in Override

## Problem

When multiple services share the same `TASK_SLUG`, their worktrees produce identical Docker Compose project names because Docker Compose uses the working directory basename as the project name.

Worktree paths follow the pattern `<repo>/.worktrees/<TASK_SLUG>`, so:

- `marketplace-service/.worktrees/add-oauth-flow/` -> project name = `add-oauth-flow`
- `api-gateway-service/.worktrees/add-oauth-flow/` -> project name = `add-oauth-flow`

When `docker compose up -d` runs in the second worktree, Docker sees project `add-oauth-flow` already has running containers (from the first service) and reconciles them — potentially recreating or removing the other service's containers.

The current design handles `container_name`, ports, and network aliases correctly, but does not control the project name.

## Prerequisites

- **Docker Compose v2** is required. The top-level `name` property is part of the Compose Specification adopted by Docker Compose v2.x (`docker compose`, with space). The legacy `docker-compose` binary (v1) silently ignores this field.

## Solution

Add `name: <service-id>-<TASK_SLUG>` as a top-level key in the generated `docker-compose.override.yml`. This gives each service worktree a unique project name, preventing Docker from cross-managing containers between services.

`<service-id>` is the key from `services.yaml` (e.g., `marketplace-service`), not the `docker.service` value (e.g., `app`).

Task slugs are unique across tasks, so two simultaneous tasks on the same service produce different project names naturally.

### Name length constraint

Docker derives resource names from the project name. Keep `<service-id>-<TASK_SLUG>` under 63 characters. Task slugs are already short by convention (see `new-task.md` Step 4), and service IDs rarely exceed 30 characters, so this limit is unlikely to be hit in practice.

### Example

For `marketplace-service`, task `add-oauth-flow`, allocated port `3100`:

```yaml
name: marketplace-service-add-oauth-flow

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

For `orchestrator-service`, task `add-oauth-flow`, app port `3101`, DB port `5433`:

```yaml
name: orchestrator-service-add-oauth-flow

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

### Teardown and debugging

The existing teardown command (`cd <worktree> && docker compose down -v --rmi all --remove-orphans`) works correctly because it runs from the worktree directory where the override with `name` lives. No changes to teardown logic are needed.

As a bonus, operators can now inspect a specific task's containers from any directory using the project flag: `docker compose -p marketplace-service-add-oauth-flow ps`.

## Files Modified

| File | Change |
|------|--------|
| `jelou/references/docker-conventions.md` | Add `name` to Override Generation section and update all YAML examples |
| `jelou/workflows/new-task.md` | Add `name: <service-id>-<TASK_SLUG>` to Phase 3 override generation |
| `docs/superpowers/specs/2026-03-24-worktree-docker-isolation-design.md` | Update YAML examples to include `name` |

## Impact

Surgical change — adds one line (`name:`) to the override template. No changes to port allocation, container naming, network aliases, inter-service wiring, or teardown logic.
