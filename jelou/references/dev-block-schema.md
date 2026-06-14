# `services.yaml` `dev` Block — Schema Reference

> The `dev` block is an additive extension to `services.yaml` (see `jelou/templates/services-yaml.md`). It is consumed by **the UI QA workflow** for E2E test orchestration. Other jelou-spec-plugin workflows ignore it. In `/jlu-ui-qa-run`, a non-UI affected service without a `dev` block is skipped with a clear message. `/jlu-production-like` does NOT skip a boot-order service that lacks one — it derives a block (`bin/derive-dev-block.mjs`) and asks to persist it (step 8b) rather than improvise.

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
    launcher: docker | docker-exec | npm | make | shell    # required
    command: <boot command>                  # required when launcher != docker
    teardown: <shutdown command>             # required when launcher != docker
    env_files: [.env, .env.e2e]              # optional; non-Docker launchers only
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

`docker-exec` reuses the sibling `docker` block (or an inline `dev.docker`) to name the
compose service it execs into:

```yaml
- id: datum-service
  path: ../datum-service
  stack: nestjs
  dev:
    launcher: docker-exec          # idle dev container; the app is exec'd in, not run by `up -d`
    docker:
      service: app                 # compose service to `up -d` then `exec`
      compose_file: docker-compose.yml
    command: npm run start:dev      # runs INSIDE the container — package-manager-detected, never assumed
    teardown: docker compose -f docker-compose.yml exec -T app pkill -f 'nest start' || true
    ready_signal:
      type: stdout_match            # checked against the exec log; NestJS root `/` 404s, so http_200 on / would false-fail
      pattern: "Nest application successfully started"
    ready_timeout_s: 90
    ram_estimate_mb: 350
    data_isolation: none            # stateless app container (its DB lives in a separate container)
```

## Launcher precedence (`launcher: docker`)

When `launcher: docker`, the plugin **derives** `command` and `teardown` from the sibling `docker` block. This avoids duplication:

- `command` = `docker-compose -f <docker.compose_file> up -d <docker.service>`
- `teardown` = `docker-compose -f <docker.compose_file> stop <docker.service>`
- Listening port is read from `<docker.port_env>` at runtime.

Specifying `command` or `teardown` explicitly when `launcher: docker` is allowed and overrides the derivation.

## Launcher precedence (`launcher: docker-exec`)

For services whose dev container **idles** — `Dockerfile.dev` ends in `CMD sleep infinity`
(or `tail -f /dev/null`) with the source volume-mounted, so the app is started *inside* the
already-running container, not by `docker compose up`. This is the common Jelou backend
pattern (NestJS dev containers on `devlabs_mynetwork`). `launcher: docker` alone would only
`up -d` the container and leave it idling — the app would never start.

- `command` is the dev-server command run **inside** the container (e.g. `npm run start:dev`).
  It MUST use the service's real package manager — `/jlu-production-like` derives it from the
  lockfile (`bin/derive-dev-block.mjs`); it is never assumed. Booting a yarn command on an npm
  project (or vice-versa) is the exact failure this launcher exists to prevent.
- Boot is: `docker compose -f <compose_file> up -d <service>` (idempotent), then — only if the
  readiness signal does not already pass — `docker compose -f <compose_file> exec -T <service> sh -lc '<command>'`
  with stdout/stderr captured to the launch log, then wait for the readiness signal.
- **Readiness is checked from the HOST** (the container's mapped port), never from inside.
  For NestJS prefer `stdout_match` on `Nest application successfully started`: the app's root
  route usually 404s, so `http_200` on `/` would false-fail, and `port_open` fires before the
  app is actually serving.
- `teardown` stops the dev process started by the run (e.g.
  `docker compose -f <compose_file> exec -T <service> pkill -f 'nest start'`). It MUST NOT
  `docker compose down`/remove the container — these are long-lived dev containers the
  developer owns; the run leaves them as it found them (idle). Teardown is skipped entirely
  when boot found the app already serving (it didn't start it).

## Readiness — `health_url` vs `ready_signal`

Exactly one of `health_url` or `ready_signal` is required.

- **`health_url`** — the orchestrator polls this URL on a 1s interval. Any 2xx response means ready. Use this for HTTP services that expose a `/health` endpoint.
- **`ready_signal.type: stdout_match`** — the orchestrator tails the launcher's stdout/stderr and matches `pattern` as a regex. Use for dev servers like Next.js or Vite that print "compiled successfully" or "Local:" before they're listening.
- **`ready_signal.type: port_open`** — the orchestrator attempts a TCP connect to `localhost:<port>`. First success means ready. Use for services without HTTP semantics.
- **`ready_signal.type: http_200`** — like `health_url` but takes a port + optional path instead of a full URL.

If readiness is not signaled within `ready_timeout_s` seconds, the orchestrator aborts the run with `STATUS: BLOCKED, reason: ready_timeout`.

## `env_files`

Optional list of env files (relative to the worktree) the orchestrator sources before executing `command`. Files are loaded in order; later files override earlier ones. Missing files are skipped silently — the field declares intent, not a hard requirement.

- **Default:** `[.env, .env.e2e]` for `launcher: npm | make | shell`. Docker launchers ignore this field — they source env via Compose's `env_file` directive at the service level.
- **Loaded as:** `set -a; . ./<file>; set +a` (POSIX export-all-assignments). Bash-only syntax in the file (e.g., heredocs, `$()`) is the consumer's responsibility.
- **Why exist:** Next.js, Vite, and similar dev servers auto-load `.env`, but raw shell or `make` launchers do not. Without this field the spawned dev server starts with an empty environment, which then breaks both the dev server and downstream Playwright vars that resolve through it.

The Playwright runner itself separately sources `.env` / `.env.e2e` from the **UI service's** worktree before launching — see `jelou/references/e2e-environment.md` and `jelou/workflows/ui-qa-run.md` Phase 3 step 15. `env_files` here is about boot-time environment for non-Docker dev servers, not test-time environment for Playwright.

## `ram_estimate_mb`

An advisory per-service RAM estimate, summed by the UI QA pre-flight check. Defaults to `0` (counts as unknown — pre-flight uses a conservative fallback). Realistic numbers prevent false negatives (gate fires constantly on 16GB MacBooks) and false positives (gate passes, OS kills the suite mid-run).

Recommended starting points:
- A Postgres container in dev: ~200MB
- A Redis container: ~50MB
- A NestJS API in dev mode: ~350MB (`nest start --watch` / swc; matches the docker-exec examples)
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
- `jelou/references/e2e-environment.md` — how `.env` flows into the Playwright runner; complements `env_files` (which targets the dev server) for the test runtime side.
