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
  depends_on: [dashboard-server, jelou-api]   # optional; runtime/auth deps booted before this service
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

## `depends_on`

Optional, service-level (a sibling of `dev`/`docker`, not inside `dev`) list of other service ids
this service needs **running at request time** — not to build, but to serve real traffic. The
canonical case is a UI service that authenticates: its login backend and that backend's
session-validation API. These are usually NOT in `affected_services` and may be absent from a
`user-flow.md` `Service Boot Order`, so without `depends_on` they never boot and the live flow
returns `401` while the service-under-test itself looks healthy (the datum-legacy run's gateway-401
root cause).

`/jlu-production-like` (Phase 1 step 8a) and `/jlu-ui-qa-run` expand the boot order with
`depends_on` **transitively** (a dependency's own `depends_on` is folded in too), ordering each
dependency before its dependents. Every folded dependency must have a `dev` block, exactly like any
other boot-order service (`bin/derive-dev-block.mjs` + step 8b resolve missing ones). Other
workflows ignore `depends_on`.

```yaml
- id: jelou-apps                              # the React frontend
  depends_on: [dashboard-server, jelou-api]  # login backend + session-validation API
  dev:
    launcher: npm
    command: yarn dev
    env_files: [.env, .env.e2e]
    # …
```

## Backwards compatibility

The `dev` block is **strictly additive**. Existing `services.yaml` files without `dev` blocks remain valid. The only consumer of `dev` is the UI QA workflow; absence of `dev` means the service is skipped by E2E orchestration with a clear message.

## See also

- `jelou/templates/services-yaml.md` — full schema for the registry, including the `dev` block field-by-field reference.
- `jelou/references/docker-conventions.md` — Docker-specific conventions for the sibling `docker` block.
- `jelou/references/worktree-resolution.md` — how to map a service id to its active source path during a task. the UI QA workflow uses this resolver, not `services.yaml[*].path` directly.
- `jelou/references/e2e-environment.md` — how `.env` flows into the Playwright runner; complements `env_files` (which targets the dev server) for the test runtime side.

## Unified registry (consolidation #1)

A separate, per-workspace registry — distinct from `services.yaml` and from `jelou-stack.json` — is now available: `<workspace>/registry/jelou-registry.yaml`. It is authored by a human (or seeded from a canonical template) in a strict YAML subset, **compiled** by `bin/compile-registry.mjs` (or seeded-then-compiled by `bin/seed-registry.mjs`) into `<workspace>/registry/registry.json`, and read at runtime by `readUnifiedRegistry(workspaceRoot)` (`bin/lib/registry/read.mjs`), which just `JSON.parse`s the compiled file. The canonical template ships at `jelou/config/jelou-registry.template.yaml`.

This is **consolidation sub-project #1** — a step toward a single registry format. As of this writing, `/jlu-start-dev` and `/jlu-production-like` are **not yet migrated** onto it: they still read their existing registries (`jlu-services.json`, the `services.yaml` `dev` blocks documented above, and `jelou-stack.json`, respectively). This section documents the new format only; it does not change any existing workflow's behavior.

### Additive fields (over the `dev` block above)

The unified registry's per-service and top-level shape overlaps heavily with the `dev` block above, plus a few fields new to this format:

- Per-service **`peers: { <targetServiceId>: <ENV_VAR> }`** — cross-service rewiring: which env var on this service holds another service's task URL, keyed by the target service's id.
- Per-service **`dev.extra_ports: [<ENV_VAR>, ...]`** — secondary ports beyond the primary `dev.port_env` (e.g. a gRPC port, a debug port, a supervisor port). Sibling of `dev.docker` and `dev.port_env`, not nested inside `dev.docker`.
- Top-level **`auth`** block:
  ```yaml
  auth:
    cookieName: jelou_auth
    dashboardService: dashboard-server
    loginPath: /api/v1/auth/login
    verifyMfaPath: /api/v1/auth/login/verify_mfa
    verify:
      jelou-api: /v1/company
      dashboard-server: /api/v1/auth/me
    otpFallback:
      redisContainer: redis
      redisDb: 0
      keyPrefix: "2fa-code-"
    credentials:
      envFile: ../jelou-apps/.env.e2e
      emailVar: E2E_USER_EMAIL
      passwordVar: E2E_USER_PASSWORD
  ```
- Top-level **`frontend`** block:
  ```yaml
  frontend:
    path: ../jelou-apps
    command: "yarn start --host 127.0.0.1"
    port: 5175
    envFile: .env
    envBackup: .env.jelou-local-stack.bak
    envLocal:
      NX_REACT_APP_JELOU_API_BASE:
        service: jelou-api
        suffix: ""
      NX_REACT_APP_DASHBOARD_SERVER_BASE:
        service: dashboard-server
        suffix: "/api"
    envBlank: [NX_REACT_APP_API_GATEWAY_TEMPORAL_API_KEY]
  ```
- Top-level **`base_port`** (int) and **`compose_network_alias`** (string).

### `jelou-stack.json` → unified registry mapping

| `jelou-stack.json` | unified registry |
|---|---|
| `mode: exec` | `dev.launcher: docker-exec` |
| `mode: start` | `dev.launcher: npm` |
| `mode: compose` | `dev.launcher: docker` |
| `compose_service` | `dev.docker.service` |
| `compose_file` | `dev.docker.compose_file` |
| `command` | `dev.command` |
| `readiness.url` | `dev.ready_signal` (NestJS: `stdout_match` on "Nest application successfully started") |
| `port_mappings[primary].port_env` | `dev.port_env` |
| `port_mappings[!primary].port_env` | `dev.extra_ports[]` |
| `peers` | per-service `peers` |
| top-level `auth`/`frontend`/`basePort`/`composeNetworkAlias` | top-level `auth`/`frontend`/`base_port`/`compose_network_alias` |

> Note: `port_env` and `extra_ports` live directly under `dev` (siblings of `dev.docker`), not nested inside `dev.docker` — `dev.docker` itself carries only `service` and `compose_file`. See `jelou/config/jelou-registry.template.yaml` for a fully worked example across all current services.

### Strict YAML subset

`jelou-registry.yaml` (the template and any user edit of a seeded copy) MUST stay within a strict subset, because the hand-rolled parser (`bin/lib/registry/yaml-lite.mjs`) only understands it:

- 2-space indentation, nested block maps only.
- Scalars: bare words, `"double"` or `'single'` quoted strings, integers, `true`/`false`, `null`/`~`. Quote any value containing a `:` (e.g. `command: "yarn start:dev"`, `keyPrefix: "2fa-code-"`) — an unquoted `:` inside a value is parsed as a new key separator.
- Flow scalar lists ONLY, written on one line: `extra_ports: [SUPERVISOR_PORT]`.
- **No block `- ` lists and no list-of-maps.** Any collection that would naturally be a list — services, `auth.verify`, `frontend.envLocal` — is instead expressed as a **map keyed by id/name/key** (e.g. `services.<id>`, `auth.verify.<serviceId>`, `frontend.envLocal.<ENV_VAR>`).
- `#` comments are allowed (a `#` starting a token outside quotes, at line-start or after a space).
