# Environment Lifecycle — Shared Boot / Gate / Teardown Contract

> The single source of truth for the production-like dev-environment lifecycle.
> Consumed by `jelou/workflows/ui-qa-run.md` and `jelou/workflows/goal.md`.
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
by the orchestrator — see `goal.md` Phase 1). **Booting an unregistered service by
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
  # Inject env via a robust parser, NEVER bash `source`. `set -a; . ./.env` breaks on a real
  # .env that has an unquoted value (bash tries to EXECUTE the fragment, e.g. line
  # `KEY=foo bar&baz`) and the guard-env-reads hook blocks the source for exactly that reason.
  # When the source is skipped, the dev server starts with only the app's baked `.env` — a Vite
  # frontend then bakes prod API base URLs and IGNORES the `.env.e2e` overlay (the datum-legacy
  # 422: login POSTed to api.apps.jelou.ai). bin/boot-dev-server.mjs parses dev.env_files
  # (default [.env, .env.e2e], later overrides earlier) with a dotenv-style parser and execs the
  # command with the merged env, so build-time vars bake the E2E config and no value reaches a shell.
  node <plugin-root>/bin/boot-dev-server.mjs --worktree <worktree> \
    --env-files "<dev.env_files joined by ','>" --cmd '<dev.command>' \
    > <LOG_DIR>/launch-<service>.log 2>&1 &
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
- `goal.md` runs `preflight_gate` (1300 for fullstack, 0 for full-backend),
  `boot` once, and `teardown` once, around its delegated execution phases.
- `test-suite.md` calls none — it runs on the host and only needs the infra reachable.

## Plan-driven boot (consolidation #3a)

The boot decisions above — which launcher, which command, reuse-or-reboot, per-service
teardown, task-isolated worktree containers — are consolidated behind a single **boot plan**
emitted by `bin/build-boot-plan.mjs` and executed via `bin/lib/boot-engine/execute.mjs`. This
section is REAL: a `boot()` that consumes the plan runs the steps below. (The live workflow
wiring — `start-dev.md` calling `build-boot-plan.mjs` → this boot — is consolidation #3b; #3a
made this path real and tested but has not yet re-routed a workflow through it.)

**The plan shape.** `bin/build-boot-plan.mjs --workspace <root> --slug <slug>` writes
`{ services: [entry], network, slug }` to stdout. Every `entry` carries
`{ id, launcher, cwd, command, readiness, teardownCmd, ramEstimateMb, policy, wiredEnv }`; a
`task-isolated` entry additionally carries
`{ projectName, composeFile, overrideYaml, image, imageResolved, ports: [{ internal, host, portEnv, primary }], depsProvision }`.
`depsProvision` is `{ source, lockFile, lockHash, volumeName, mountTarget, satisfied, install }`
(or `null` when the worktree has no lockfile) — see step 4b of the task-isolated boot.
`wiredEnv` is `null` unless the service peers a `task-isolated` service (a main-branch service
A can carry a non-null `wiredEnv` pointing at a worktree peer B's task URL).

**Do not build commands by hand.** For each plan entry, obtain its execution descriptor from
`planEntryToCommands` — it owns all argv/file assembly, so the prose never hand-writes a
`docker` flag or an `sh -lc` string:

```bash
node -e "
import('{plugin-root}/bin/lib/boot-engine/execute.mjs').then(({ planEntryToCommands }) => {
  process.stdout.write(JSON.stringify(planEntryToCommands(JSON.parse(process.argv[1]))));
});
" '{entryJson}'
```

The descriptor is `{ policy, cwd, files, ... }`. `files` is an array of `{ path, content }` to
write verbatim. Branch on `descriptor.policy`:

**`policy: task-isolated`** — this run ALWAYS creates the container (a per-task throwaway), so
it is ALWAYS registered for teardown:
1. Write every `descriptor.files[]` entry (`docker-compose.jlu.yml`, and `.env` when a
   `wiredEnv` was present).
2. The override already carries a `volumes:` mount of the canonical checkout's `node_modules`
   at `/app/node_modules` when the worktree has none of its own; if `entry.nodeModulesMissing`
   is true (or the worktree lacks `.env`), WARN that the container may fail to start because its
   dependencies/env are unavailable. The `volumes:` block also mounts each
   `entry.runtimeMounts[]` (declared canonical runtime dirs the worktree lacks, e.g.
   `config/secrets`) at its `/app/<path>`.
3. If `descriptor.imageResolved` is `false`, WARN: the base image was not found, so the
   `compose up` has no local image to reuse and the container may fail to start.
4. `docker <descriptor.up>` — brings up the idle container (`compose -p <projectName> -f
   <composeFile> -f docker-compose.jlu.yml up -d`); the base image is reused, NO rebuild.
4b. **Dependency provisioning — the lockfile is the source of truth.** If
   `descriptor.install` is non-null, run it now, BEFORE the dev command and therefore outside
   the readiness clock:
   - `install.runs_in: 'container'` → `docker <descriptor.install.exec>` (a blocking
     `docker exec` into the idle container — never `-d`), bounded by
     `install.timeoutMs`. The command is self-guarding and idempotent: it exits 0 immediately
     when `node_modules/.jlu-lock-hash` already matches the lockfile hash, so a warm boot pays
     one `cat`. It installs **inside the container**, which is what compiles native modules for
     the container's platform.
   - `install.runs_in: 'host'` → run `install.cmd` in `install.cwd` (a host launcher's
     worktree). NEVER redirect this at the canonical checkout: it is shared with the developer.
   - Non-zero exit → this service is NOT bootable this run. Report the cause with
     `install.logPath` (`docker exec <projectName> cat <logPath>` for a container install) and
     apply the caller's non-bootable policy. Do NOT exec the dev command: a boot whose
     dependencies failed to install can only fail readiness 90 s later with a `Cannot find
     module` no one reads.
   `entry.depsProvision` explains what was decided and why: `source` is `named-volume` (the
   base compose declares a volume over `<codeTarget>/node_modules`, so the container would
   otherwise resolve dependencies from the **image**, not from any checkout — we take that
   target over with a lock-keyed named volume), `image` (the same shadowed `node_modules`, but
   the launcher starts the dev process at `up` so the volume cannot be lock-keyed — the install
   reconciles the image's dependencies against the lockfile in place, and the descriptor's
   `restart` re-launches the dev process afterwards), `worktree-bind`, `canonical` (the branch did
   not change the lockfile, so the canonical mount is by definition correct — no install), or
   `worktree` (host launcher). A `named-volume` name embeds the service, slug and lockfile
   hash, so it is per-task and per-lockfile: the install is paid once per task, a lockfile
   change earns a fresh volume automatically, and two tasks never write the same volume.
   `depsProvision` is `null` when the worktree has no lockfile — then provisioning is
   unchanged from before this contract.
5. If `descriptor.exec` is non-null, `docker <descriptor.exec>` — execs the dev command into
   the idle container, redirecting to `/tmp/<projectName>.dev.log`. (`exec` is null for a
   non-`docker-exec` launcher, whose container runs its command from its own entrypoint.)
6. Wait for readiness per `descriptor.readiness`: an `http_200`/`port_open` polls the allocated
   host port (`descriptor.readiness.port`); a `stdout_match` tails `descriptor.readiness.logPath`
   (`/tmp/<projectName>.dev.log`) for the pattern.
7. Register teardown = `docker <descriptor.teardown>` (`compose -p <projectName> down`) in
   `BOOTED[]`/`TEARDOWN_CMD[]`, ALWAYS.

**`policy: shared-reuse`** — REUSE the developer's running container/process:
1. If `descriptor.files` is non-empty, write it (the `wiredEnv` `.env`) BEFORE the reuse
   check, so this main-branch service picks up a worktree peer's task URL.
2. Then the EXISTING `docker-exec` / `npm` | `make` | `shell` reuse-or-reboot path
   (`descriptor.launcher` / `descriptor.command` / `descriptor.cwd`), UNCHANGED: probe the
   running container/process, reuse it if healthy, reboot fresh only if it is unhealthy/stale
   (or ALWAYS, for a frontend — build-time-baked env). The reuse-or-reboot DECISION is a
   runtime health branch that lives here, not in `planEntryToCommands`.
3. Wait for readiness per `descriptor.readiness` (the dev-block signal on the service's normal
   dev port).
4. Register teardown = `descriptor.teardown` (kill-what-started) ONLY if this run actually
   (re)booted it. NEVER `compose down` a container this run reused — it belongs to the
   developer.

**Teardown** iterates the registered entries in reverse: a `task-isolated` entry runs its
`compose -p <projectName> down` (safe — a per-task throwaway this run created); a
`shared-reuse` entry runs its kill-what-started `teardown` string only if this run started it.
This mirrors the F3-c stack-state teardown (`stack-teardown.mjs`), which #3b feeds by recording
each plan `projectName` into stack-state.

This path is the sole boot substrate: the F-series execution modules (`boot-commands` / `boot-exec` / `boot-stack` / `boot-runtime` / `task-stack` / `readiness-url` / `registry`) and `jelou-stack.json` were retired in consolidation #3c; `start-dev` (#3b) and `autofix` (#3c) both drive this plan.
