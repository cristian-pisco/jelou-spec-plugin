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

Every service in the boot order MUST have a `dev` block (declared, or just-derived-and-persisted
by the orchestrator — see `production-like.md` Phase 1). **Booting an unregistered service by
improvising a launcher/command is forbidden** — guessing `yarn` on an npm project is the exact
failure this contract prevents.

**The boot order includes `depends_on`.** Before booting, expand the order with each service's
optional `depends_on` list (`dev-block-schema.md`) — its runtime/auth dependencies, e.g. a UI
service's login backend and that backend's session-validation API — transitively, ordered before
the dependents. These are booted like any other service; omitting them leaves a healthy stack
returning `401` at request time (the dependents are up, the auth chain is not).

**Reuse vs reboot is env-aware.** Boot probes each service first and reuses a healthy one without
tearing it down — EXCEPT a service whose launcher sources `env_files` (npm/make/shell). For those,
reuse only if no `env_file` is newer than the running process (`env_file` mtime vs the process
start time). Env vars are baked at dev-server start (e.g. a Vite API base URL), so a
healthy-but-**stale** process keeps serving the old env; if any `env_file` changed since boot,
treat it as stale and reboot fresh.

**A frontend (build-time-baked env) is NEVER reused — always boot it fresh.** A service whose
`stack` is a frontend framework (`react`/`nextjs`/`vue`/`angular`/`svelte`) inlines its config
(API base URLs, feature flags like Turnstile) into the served bundle at dev-server start — the
build tool reads `.env`/`.env.local` and `process.env`, **not** the `.env.e2e` overlay. The mtime
heuristic above only catches an `env_file` edited after *this run's* boot; it CANNOT detect the
common case — a developer's own `yarn dev`, already running and "newer" than every `env_file`, that
was started by `. ./.env` alone and **never sourced `.env.e2e`**. Reusing it silently runs the
suite against a bundle baked with the app's `.env` (production URLs, real Turnstile): the login then
POSTs to prod and is rejected (HTTP 422 / Turnstile) even though `.env.e2e` is correct on disk.
So for a frontend service: stop any healthy process found, boot it fresh with `env_files`
(incl. `.env.e2e`) sourced via `set -a` so the overlay lands in `process.env` before the dev server
inlines it, and register it in `BOOTED[]` so teardown reclaims it. Only a fresh boot guarantees the
bundle baked the E2E config.

**Boot and teardown share one shell.** The boot routine, the test execution, and the teardown
trap all run in the **same** long-lived shell — the one that holds the lock fd (`exec 9>…; flock`)
and registers `trap … EXIT INT TERM`. This matters for `docker-exec`: a backgrounded
`docker compose exec` keeps the in-container dev server alive only while its host-side client
process lives, so boot must not run in a separate Bash invocation from the suite.

Boot records what it starts in the two arrays the teardown trap consumes (`declare -A` them in
this shell, alongside the trap):
- `BOOTED+=(<service>)` — order, for teardown iteration.
- `TEARDOWN_CMD[<service>]="<per-launcher teardown command>"` — what to run to stop it.

A service is added to these arrays **only when this run actually started it** — so a `docker-exec`
service that boot found already serving is never torn down by this run.

For each service in order, branch on `dev.launcher`:

```
launcher: docker
  docker compose -f <compose_file> up -d <service>            # derived from the docker block
  Capture to <LOG_DIR>/launch-<service>.log. Wait for readiness (below).
  BOOTED+=(<service>); TEARDOWN_CMD[<service>]="docker compose -f <compose_file> stop <service>"

launcher: docker-exec        # idle dev container (CMD sleep infinity); app is exec'd in
  docker compose -f <compose_file> up -d <service>            # idempotent; brings the idle container up
  # Idempotency probe — is the dev server ALREADY running? Probe liveness independently of
  # ready_signal.type: a stdout_match signal has no log to tail before the exec, so it can never
  # report "already up". Use an in-container process check (preferred) or a host-port probe:
  #   docker compose -f <compose_file> exec -T <service> pgrep -f '<proc-from-dev.teardown>'  >/dev/null 2>&1
  If already running → skip the exec AND skip the BOOTED/TEARDOWN registration (this run did not
    start it; leave it as found). Still wait for readiness (below) to confirm it's serving.
  Else:
    docker compose -f <compose_file> exec -T <service> sh -lc '<dev.command>' \
      > <LOG_DIR>/launch-<service>.log 2>&1 &                 # start the dev server INSIDE the container
    BOOTED+=(<service>); TEARDOWN_CMD[<service>]="<dev.teardown>"   # registered ONLY because we started it
  Wait for readiness (below) from the HOST (the container's mapped port / the captured log).

launcher: npm | make | shell
  set -a; for f in dev.env_files (default [.env, .env.e2e]): [ -f "$f" ] && . "./$f"; set +a
  Run `<dev.command>` in the worktree, backgrounded. Capture to <LOG_DIR>/launch-<service>.log.
  Wait for readiness (below).
  BOOTED+=(<service>); TEARDOWN_CMD[<service>]="<dev.teardown>"
```

Readiness (all launchers):
```
  health_url    -> poll until 2xx, or ready_timeout_s
  port_open     -> TCP connect until success, or ready_timeout_s
  http_200      -> poll until 2xx on port:path, or ready_timeout_s
  stdout_match  -> tail launch log, regex-match pattern, or ready_timeout_s
On timeout: print the tail of <LOG_DIR>/launch-<service>.log (the crash reason) BEFORE aborting.
  A boot-order service — especially a `depends_on` dependency rarely run locally — often dies on a
  missing local-only env var (a login backend's AUTH_USERNAME/AUTH_PASSWORD; an API's elastic node
  / signing key), which leaves the host port unreachable and would otherwise read as an opaque hang.
  Abort with STATUS: BLOCKED, reason: ready_timeout for <service> — <quoted crash line / missing env var>.
```

For `docker-exec`, readiness is host-side: `http_200`/`port_open` use the **mapped host port**;
`stdout_match` tails the captured exec log. The app's root route often 404s (NestJS), so prefer
`stdout_match` (e.g. `Nest application successfully started`) over `http_200` on `/`. (The
idempotency probe above is a *separate*, type-independent liveness check — not the readiness
signal — precisely because a `stdout_match` signal has no log to read before the exec.)

One container per service. Services declaring `data_isolation: per-run` get a fresh
state on boot — this is the frugal isolation model; do NOT layer extra containers.

## `teardown(booted_services)`

Deterministic, on every exit path. The trap iterates the `BOOTED[]` array boot populated and runs
each service's registered `TEARDOWN_CMD[<service>]` (so a `docker-exec` service boot found already
serving — and never added — is correctly left running):

```bash
trap '
  for svc in "${BOOTED[@]}"; do
    eval "${TEARDOWN_CMD[$svc]}" >/dev/null 2>&1 || true
  done
  # … lock release …
' EXIT INT TERM
```

The per-launcher `TEARDOWN_CMD` boot registers:

```bash
# launcher: docker
docker compose -f <compose_file> stop <service>

# launcher: docker-exec
# Stop ONLY the dev process this run started; never `docker compose down`/`rm` — these are
# long-lived dev containers the developer owns. Registered (per boot) only when this run execed.
<dev.teardown>                                                 # e.g. docker compose -f <cf> exec -T <svc> pkill -f 'nest start'

# launcher: npm | make | shell
<dev.teardown>
```

## Consumers

- `ui-qa-run.md` runs `preflight_gate` (browser_overhead_mb=1300), `boot`, `teardown`
  when invoked standalone. With `--no-boot` it skips all three — the caller owns the lifecycle.
- `production-like.md` runs `preflight_gate` (1300 for fullstack, 0 for full-backend),
  `boot` once, and `teardown` once, around its delegated execution phases.
- `test-suite.md` calls none — it runs on the host and only needs the infra reachable.
