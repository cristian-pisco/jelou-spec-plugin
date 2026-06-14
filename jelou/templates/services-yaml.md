# services.yaml Schema Reference

> The service registry lives at `.spec-workspace/registry/services.yaml`. It uses a minimal schema (Decision #11: Layered discovery) — only `id`, `path`, and `stack`. Detailed inter-service relationships are discovered dynamically by reading each service's `INTEGRATIONS.md`.

## Schema

```yaml
services:
  - id: {{service-id}}
    path: {{relative-path}}
    stack: {{stack-name}}
    docker:                        # optional — absence = no Docker
      service: {{compose-service}} # docker compose service name
      compose_file: docker-compose.yml  # relative to repo root; default
      port_env: APP_PORT           # env var for the exposed port; default
    dev:                           # optional — required by /jlu-ui-qa-run; absence = service is skipped by E2E orchestration
      launcher: docker             # docker | docker-exec | npm | make | shell
      command: npm run dev         # required when launcher != docker; runs INSIDE the container when launcher: docker-exec
      teardown: pkill -f 'npm run dev'   # required when launcher != docker; derived from `docker` when launcher: docker
      health_url: http://localhost:4001/health  # OR ready_signal below
      ready_signal:
        type: stdout_match         # stdout_match | port_open | http_200
        pattern: "compiled successfully"  # required when type=stdout_match
        port: 3000                 # required when type=port_open or http_200
        path: "/"                  # optional when type=http_200; default "/"
      ready_timeout_s: 30          # default 30
      ram_estimate_mb: 400         # advisory; consumed by pre-flight resource check
      data_isolation: per-run      # shared | per-run | none
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique service identifier. Convention: `service-<name>` (e.g., `service-auth`, `service-payments`). |
| `path` | string | yes | Relative path from `.spec-workspace/` to the service repo root (e.g., `../service-auth`). |
| `stack` | string | yes | Primary technology stack. One of the supported stacks (e.g., `nestjs`, `laravel`, `react`, `go`, `rust`, `nextjs`, `vue`, `angular`). |
| `docker` | object | no | Docker configuration. Absence means the service does not use Docker. See sub-fields below. |
| `docker.service` | string | conditional | Docker Compose service name (required if `docker` is present). |
| `docker.compose_file` | string | no | Path to the Compose file relative to the repo root. Default: `docker-compose.yml`. |
| `docker.port_env` | string | no | Environment variable name for the exposed host port. Default: `APP_PORT`. |
| `dev` | object | no | Dev-server orchestration block. Required by the UI QA workflow's `/jlu-ui-qa-run`; ignored by other workflows. Services without a `dev` block are skipped by E2E orchestration. See `jelou/references/dev-block-schema.md` for the full contract. |
| `dev.launcher` | enum | conditional | `docker` \| `docker-exec` \| `npm` \| `make` \| `shell`. Required if `dev` is present. When `docker`, `command`/`teardown`/port are derived from the sibling `docker` block. `docker-exec` is for idle dev containers (`CMD sleep infinity`): boot `up -d`s the container then execs `command` inside it. |
| `dev.command` | string | conditional | Boot command. Required when `launcher != docker`. For `docker-exec`, runs **inside** the container (must use the service's real package manager). |
| `dev.teardown` | string | conditional | Shutdown command. Required when `launcher != docker`. |
| `dev.health_url` | string | conditional | HTTP URL polled for 2xx response as the readiness signal. Either this or `ready_signal` is required. |
| `dev.ready_signal` | object | conditional | Alternative to `health_url`. Either this or `health_url` is required. |
| `dev.ready_signal.type` | enum | yes (when `ready_signal` present) | `stdout_match` (regex against launcher stdout/stderr) \| `port_open` (TCP connect succeeds) \| `http_200` (any 2xx on path). |
| `dev.ready_signal.pattern` | string | conditional | Required when `type=stdout_match`. |
| `dev.ready_signal.port` | int | conditional | Required when `type=port_open` or `type=http_200`. |
| `dev.ready_signal.path` | string | no | URL path for `type=http_200`. Default `/`. |
| `dev.ready_timeout_s` | int | no | Seconds to wait for readiness before aborting. Default `30`. |
| `dev.ram_estimate_mb` | int | no | Advisory per-service RAM estimate. Summed by the UI QA pre-flight check. Default `0` (counts as unknown). |
| `dev.data_isolation` | enum | yes (when `dev` present) | `shared` \| `per-run` \| `none`. `shared` is refused by `/jlu-ui-qa-run` without `--allow-shared-data`. |

## Example

```yaml
services:
  - id: service-auth
    path: ../service-auth
    stack: nestjs
    docker:
      service: auth-api
      compose_file: docker-compose.yml
      port_env: APP_PORT
    dev:
      launcher: docker
      health_url: http://localhost:4001/health
      ready_timeout_s: 30
      ram_estimate_mb: 400
      data_isolation: per-run

  - id: service-frontend
    path: ../service-frontend
    stack: nextjs
    dev:
      launcher: npm
      command: npm run dev
      teardown: pkill -f 'next dev'
      ready_signal:
        type: stdout_match
        pattern: "compiled successfully"
        port: 3000
      ready_timeout_s: 60
      ram_estimate_mb: 600
      data_isolation: none

  - id: datum-service
    path: ../datum-service
    stack: nestjs
    dev:                            # idle dev container: `up -d` then exec the dev server in
      launcher: docker-exec
      docker:
        service: app
        compose_file: docker-compose.yml
      command: npm run start:dev    # package-manager-detected, never assumed
      teardown: docker compose -f docker-compose.yml exec -T app pkill -f 'nest start' || true
      ready_signal:
        type: stdout_match
        pattern: "Nest application successfully started"
      ready_timeout_s: 90
      ram_estimate_mb: 350
      data_isolation: none

  - id: service-payments
    path: ../service-payments
    stack: laravel
    docker:
      service: payments-api
```

## Notes

- The registry is the single source of truth for which services exist in the workspace.
- Paths are relative to the `.spec-workspace/` directory.
- Relationships between services (API calls, events, shared schemas) are not stored here. They are discovered by reading each service's `INTEGRATIONS.md` under `.spec-workspace/services/<service-id>/codebase/`.
- If a spec or codebase doc references a service not in the registry, the plugin warns and offers to register it (Decision #39).
- The `dev` block is consumed by the UI QA workflow for E2E test orchestration. Other jelou workflows ignore it. Services without a `dev` block remain valid; `/jlu-ui-qa-run` skips a non-UI service that lacks one, while `/jlu-production-like` derives and (with your OK) persists one for any boot-order service that is missing it (step 8b) instead of skipping.
