# `services.yaml` `dev` Block — Schema Reference

> The `dev` block is an additive extension to `services.yaml` (see `jelou/templates/services-yaml.md`). It is consumed by **the UI QA workflow** for E2E test orchestration. Other jelou-spec-plugin workflows ignore it. Services without a `dev` block are skipped by E2E orchestration with a clear message.

## Purpose

E2E test orchestration needs a launcher-agnostic, service-by-service way to:

1. Boot a service for testing (docker-compose, `npm run dev`, `make dev`, or a raw shell command).
2. Wait for it to be ready (HTTP health check, regex-on-stdout, port-open, or 2xx-on-path).
3. Tear it down deterministically on every exit path.
4. Estimate its RAM cost so a pre-flight budget check can refuse to run on under-resourced machines.
5. Declare data-isolation behavior so concurrent runs don't stomp on each other.

The block is intentionally narrow. It does not describe how the service builds, deploys, or exposes its API contract — those concerns belong elsewhere.

## Schema

```yaml
- id: service-auth
  path: ../service-auth
  stack: nestjs
  docker:                          # existing block, unchanged
    service: auth-api
    compose_file: docker-compose.yml
    port_env: APP_PORT
  dev:                             # new, additive
    launcher: docker | npm | make | shell    # required
    command: <boot command>                  # required when launcher != docker
    teardown: <shutdown command>             # required when launcher != docker
    health_url: http://localhost:4001/health # OR ready_signal below
    ready_signal:
      type: stdout_match | port_open | http_200
      pattern: "compiled successfully"       # required when type=stdout_match
      port: 3000                             # required when type=port_open or http_200
      path: "/"                              # optional when type=http_200; default "/"
    ready_timeout_s: 30                      # default 30
    ram_estimate_mb: 400                     # advisory; consumed by pre-flight resource check
    data_isolation: shared | per-run | none  # required
```

## Launcher precedence (`launcher: docker`)

When `launcher: docker`, the plugin **derives** `command` and `teardown` from the sibling `docker` block. This avoids duplication:

- `command` = `docker-compose -f <docker.compose_file> up -d <docker.service>`
- `teardown` = `docker-compose -f <docker.compose_file> stop <docker.service>`
- Listening port is read from `<docker.port_env>` at runtime.

Specifying `command` or `teardown` explicitly when `launcher: docker` is allowed and overrides the derivation.

## Readiness — `health_url` vs `ready_signal`

Exactly one of `health_url` or `ready_signal` is required.

- **`health_url`** — the orchestrator polls this URL on a 1s interval. Any 2xx response means ready. Use this for HTTP services that expose a `/health` endpoint.
- **`ready_signal.type: stdout_match`** — the orchestrator tails the launcher's stdout/stderr and matches `pattern` as a regex. Use for dev servers like Next.js or Vite that print "compiled successfully" or "Local:" before they're listening.
- **`ready_signal.type: port_open`** — the orchestrator attempts a TCP connect to `localhost:<port>`. First success means ready. Use for services without HTTP semantics.
- **`ready_signal.type: http_200`** — like `health_url` but takes a port + optional path instead of a full URL.

If readiness is not signaled within `ready_timeout_s` seconds, the orchestrator aborts the run with `STATUS: BLOCKED, reason: ready_timeout`.

## `ram_estimate_mb`

An advisory per-service RAM estimate, summed by the UI QA pre-flight check. Defaults to `0` (counts as unknown — pre-flight uses a conservative fallback). Realistic numbers prevent false negatives (gate fires constantly on 16GB MacBooks) and false positives (gate passes, OS kills the suite mid-run).

Recommended starting points:
- A Postgres container in dev: ~200MB
- A Redis container: ~50MB
- A NestJS API in dev mode: ~250MB
- A Laravel API in dev mode: ~200MB
- A Next.js dev server: ~600MB (HMR is RAM-hungry)
- A Vite dev server: ~400MB

Tune from observation, not guesswork.

## `data_isolation`

Declares how the service's persistent state behaves across concurrent E2E runs:

- **`per-run`** — each run gets a fresh data state (e.g., a Postgres container started clean, a service that seeds its own DB on boot). Safe for concurrent invocations.
- **`shared`** — runs share the same backing store (e.g., a long-lived staging DB the dev server points at). **Refused by `/jlu-ui-qa-run` without `--allow-shared-data`** because two concurrent runs will corrupt each other's data.
- **`none`** — service is stateless; no isolation needed (e.g., a static-content service, a stateless API gateway).

When `--allow-shared-data` is set, the user accepts the risk and is responsible for ensuring the runs don't collide on data.

## Backwards compatibility

The `dev` block is **strictly additive**. Existing `services.yaml` files without `dev` blocks remain valid. The only consumer of `dev` is the UI QA workflow; absence of `dev` means the service is skipped by E2E orchestration with a clear message.

## See also

- `jelou/templates/services-yaml.md` — full schema for the registry, including the `dev` block field-by-field reference.
- `jelou/references/docker-conventions.md` — Docker-specific conventions for the sibling `docker` block.
- `jelou/references/worktree-resolution.md` — how to map a service id to its active source path during a task. the UI QA workflow uses this resolver, not `services.yaml[*].path` directly.
