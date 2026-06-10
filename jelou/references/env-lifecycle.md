# Environment Lifecycle — Shared Boot / Gate / Teardown Contract

> The single source of truth for the production-like dev-environment lifecycle.
> Consumed by `jelou/workflows/ui-qa-run.md` and `jelou/workflows/production-like.md`.
> It describes three operations — a pre-flight gate, an ephemeral boot, and a
> deterministic teardown — over services that declare a `dev` block
> (`jelou/references/dev-block-schema.md`). It does NOT spin up Testcontainers:
> one container per service, never per test.

## `preflight_gate(services, { workers, browser_overhead_mb })`

Refuses to run on an under-resourced machine and on colliding ports/shared data.
`browser_overhead_mb` is `1300` when a browser (Playwright) will run, `0` otherwise.

```bash
WORKERS=${WORKERS:-1}
BROWSER_OVERHEAD_MB=${BROWSER_OVERHEAD_MB:-0}
if ! [[ "$WORKERS" =~ ^[0-9]+$ ]] || [ "$WORKERS" -lt 1 ]; then
  echo "ERROR: --workers must be an integer >= 1 (got '$WORKERS')."; exit 1
fi

OS=$(uname -s)
if [ "$OS" = "Linux" ] && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
  OS_VARIANT="WSL2"; else OS_VARIANT="$OS"; fi

case "$OS_VARIANT" in
  Linux|WSL2)
    AVAIL_MB=$(awk '/MemAvailable/ {print $2 / 1024}' /proc/meminfo 2>/dev/null)
    [ -z "$AVAIL_MB" ] && AVAIL_MB=$(awk '/MemFree/ {f=$2} /^Cached/ {c=$2} END {print (f+c) / 1024}' /proc/meminfo)
    CPU_CORES=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN) ;;
  Darwin)
    PAGE_SIZE=$(sysctl -n hw.pagesize)
    FREE_PAGES=$(vm_stat | awk '/Pages free/ {gsub(/\./,"",$3); print $3}')
    SPEC_PAGES=$(vm_stat | awk '/Pages speculative/ {gsub(/\./,"",$3); print $3}')
    INACTIVE_PAGES=$(vm_stat | awk '/Pages inactive/ {gsub(/\./,"",$3); print $3}')
    AVAIL_MB=$(( (FREE_PAGES + SPEC_PAGES + INACTIVE_PAGES) * PAGE_SIZE / 1024 / 1024 ))
    CPU_CORES=$(sysctl -n hw.logicalcpu) ;;
  *)
    echo "ERROR: unsupported OS '$OS'. Linux + macOS + WSL2 supported."; exit 1 ;;
esac

MAX_WORKERS_BY_CPU=$(( CPU_CORES / 2 ))
[ "$MAX_WORKERS_BY_CPU" -lt 1 ] && MAX_WORKERS_BY_CPU=1
[ "$MAX_WORKERS_BY_CPU" -gt 4 ] && MAX_WORKERS_BY_CPU=4
if [ "$WORKERS" -gt "$MAX_WORKERS_BY_CPU" ] && [ -z "$FORCE" ]; then
  echo "ERROR: requested --workers=$WORKERS exceeds CPU safety cap ($MAX_WORKERS_BY_CPU with $CPU_CORES logical cores)."
  echo "  Use fewer workers or pass --force to override."; exit 1
fi

REQUIRED_MB=$(( SUM_DEV_RAM_ESTIMATES + BROWSER_OVERHEAD_MB + ((WORKERS - 1) * 700) ))
if [ "$AVAIL_MB" -lt "$REQUIRED_MB" ] && [ -z "$FORCE" ]; then
  echo "ERROR: pre-flight resource check failed."
  echo "  available: ${AVAIL_MB}MB"; echo "  required:  ${REQUIRED_MB}MB"
  echo "  workers:   ${WORKERS} (cpu cap: ${MAX_WORKERS_BY_CPU})"
  echo "  Close apps or pass --force to override."; exit 1
fi
```

Port-availability check — for each service's port (from `dev.health_url` or `dev.ready_signal.port`):

```bash
if lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n 2>/dev/null | grep -q LISTEN; then
  echo "ERROR: port $PORT is already bound. Run /jlu-ui-qa-cleanup or kill the holder manually."; exit 1
fi
```

Data-isolation guard — if any service declares `dev.data_isolation: shared` and
`--allow-shared-data` was NOT passed, refuse:

> "service `<id>` declares `data_isolation: shared`. Concurrent runs will corrupt data. Pass `--allow-shared-data` to override."

## `boot(service_boot_order)`

For each service in order:

```
Run dev.command (or derived `docker compose -f <compose_file> up -d <service>` when launcher: docker)
Capture stdout/stderr to <LOG_DIR>/launch-<service>.log
Wait for readiness:
  health_url    -> poll until 2xx, or ready_timeout_s
  port_open     -> TCP connect until success, or ready_timeout_s
  http_200      -> poll until 2xx on port:path, or ready_timeout_s
  stdout_match  -> tail launch log, regex-match pattern, or ready_timeout_s
On timeout: abort with STATUS: BLOCKED, reason: ready_timeout for <service>.
```

One container per service. Services declaring `data_isolation: per-run` get a fresh
state on boot — this is the frugal isolation model; do NOT layer extra containers.

## `teardown(booted_services)`

Deterministic, on every exit path (`trap '<teardown>' EXIT INT TERM`):

```bash
# launcher: docker
cd <worktree> && docker compose -f <compose_file> stop <service>
# launcher: npm | make | shell
<dev.teardown>
```

## Consumers

- `ui-qa-run.md` runs `preflight_gate` (browser_overhead_mb=1300), `boot`, `teardown`
  when invoked standalone. With `--no-boot` it skips all three — the caller owns the lifecycle.
- `production-like.md` runs `preflight_gate` (1300 for fullstack, 0 for full-backend),
  `boot` once, and `teardown` once, around its delegated execution phases.
- `test-suite.md` calls none — it runs on the host and only needs the infra reachable.
