# /jlu:start-dev Workflow

> Purpose: Launch all registered services in a TMUX window dedicated to the active task slug.

> **Deprecated:** the default tmux path (Steps 1–6 below) is deprecated in favor of the plan-driven `--jelou-stack` boot (see "Task-aware Jelou-stack boot" below), which reuses the developer's docker containers and wires task worktrees. The tmux path still works and `jlu-services.json` is untouched, but new work should pass `--jelou-stack`.

Inputs:
- `cwd`: the user's current working directory.

## Step 1 — Resolve workspace and config

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs').then(({ resolveWorkspace }) => {
  process.stdout.write(JSON.stringify(resolveWorkspace(process.argv[1])));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

Capture `{ root, configPath, workspaceId }`. If `NO_WORKSPACE`, surface:

> `No workspace root. Run /jlu:register-service first to create jlu-services.json.`

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs').then(({ readConfig }) => {
  process.stdout.write(JSON.stringify(readConfig(process.argv[1])));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{configPath}"
```

If `readConfig` throws (file missing), surface: `No services registered yet. Run /jlu:register-service.` and stop.

## Step 2 — Resolve task slug

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs').then(({ resolveTaskSlug }) => {
  const slug = resolveTaskSlug({ workspaceRoot: process.argv[1], cwd: process.argv[2] });
  process.stdout.write(slug);
});
" "{root}" "{cwd}"
```

If output starts with `AMBIGUOUS:`, parse the comma-separated list and use `question` (single-choice) to ask the user which task to use. Append `_global` as a "no task" option.

## Step 2.5 — Select the source mode

Read the allowed choices from the shared source-mode contract:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/source-mode.mjs').then(({ sourceModeChoices }) => {
  process.stdout.write(JSON.stringify(sourceModeChoices({ hasActiveTask: process.argv[1] !== '_global' })));
});
" "{slug}"
```

For every interactive invocation, ask the user which source mode to use. Offer `main` and `task-aware` exactly as returned. If no task is active, `task-aware` is disabled with the explanation `No active task is available`, so only `main` is selectable. Capture the selected normalized value as `{sourceMode}`.

Create one run identity after the source mode is selected and retain it for the entire invocation:

```bash
node -e "
import('node:crypto').then(({ randomUUID }) => process.stdout.write(randomUUID()));
"
```

Capture the output as `{runId}`. Every lifecycle emitter, execution descriptor, journal write, and cleanup call in this invocation uses the same `runIdentity = { workspaceId, taskSlug: slug, runId }`.

## Step 3 — Verify tmux availability

```bash
tmux -V || echo "TMUX_MISSING"
```

If `TMUX_MISSING`, surface: `tmux is required. Install: brew install tmux (macOS) / apt install tmux (Linux).` Stop.

## Step 4 — Plan the start (dry-run preview)

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/start.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs')
]).then(([s, c]) => {
  const cfg = c.readConfig(process.argv[1]);
  const plan = s.planStart({ config: cfg, workspaceRoot: process.argv[2], slug: process.argv[3] });
  process.stdout.write(JSON.stringify(plan));
});
" "{configPath}" "{root}" "{slug}"
```

Display: window name, layout, list of panes (name + cwd + first 60 chars of command). If `plan.skipped` is non-empty, list those services and the reason.

## Step 5 — Confirm and execute

Use `question` (single-choice): `"Start dev environment in window '{plan.windowName}'?"` with options `start` / `cancel`.

If cancel: print `Cancelled. No changes made.` and stop.

If start, run startDev:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/start.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/events.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/state-daemon.mjs')
]).then(([s, c, events, daemonState]) => {
  const cfg = c.readConfig(process.argv[1]);
  const workspaceId = process.argv[4];
  const slug = process.argv[3];
  const out = s.startDev({
    config: cfg,
    workspaceRoot: process.argv[2],
    workspaceId,
    slug,
    env: process.env,
    onLifecycle: (event) => events.appendLifecycleEvent(daemonState.eventsLogPath({ workspaceId, slug }), event)
  });
  process.stdout.write(JSON.stringify(out));
});
" "{configPath}" "{root}" "{slug}" "{workspaceId}"
```

## Step 6 — Report

Capture the JSON output.

- If `status: "tmux-missing"`, that should already have been caught at Step 3; surface as an error.
- If `status: "exists"`, ask via `question`: `"Window '{name}' already exists. (a) reuse and exit, (b) kill-and-restart, (c) cancel"`. On (b), kill the window via Bash (`tmux kill-window -t <name>`) and re-run Step 5.
- If `status: "created"`, print: `Started <paneCount> services in TMUX window '<windowName>' (layout: <layout>). Daemon will be wired in Phase 3.`

If `skipped` is non-empty, list the skipped services with reasons.

## Notes

- Phase 2 deliberately does NOT spawn a daemon. The `daemonSpawn` callback in `startDev` defaults to a stub returning `{ pid: 0 }`. Phase 3 will wire in the real daemon.
- Use `/jlu-start-dev` in messages (works for both runtimes).
- If the user is not inside tmux, the orchestrator creates a default `jlu-dev` session. The user may need to `tmux attach -t jlu-dev` afterwards.

## Task-aware Jelou-stack boot (--jelou-stack)

> Purpose: boot the registered Jelou backend services for the active task — services that have a worktree for this slug boot as fresh per-task docker containers (`<service>-<slug>`, own allocated host ports, peer env wiring); services on main branch REUSE the developer's healthy running container on its normal dev port. Use this path when the user passes `--jelou-stack` (or equivalent) to `/jlu:start-dev`, or asks to boot the Jelou backend stack for the current task.

This path reads the per-workspace **unified registry** (`readUnifiedRegistry(<workspaceRoot>)`), boots via `bin/build-boot-plan.mjs` + the plan-driven boot contract in `jelou/references/env-lifecycle.md` (`## Plan-driven boot`), and does not touch tmux. Per service the plan chooses `task-isolated` (worktree present) or `shared-reuse` (main branch) — see the env-lifecycle contract for how each is executed.

### Stack-state recording

The `--jelou-stack` path records a durable stack-state at each boot point so `/jlu:stop-dev` can tear it down. Wherever a single mutation is recorded below, use this reusable state-append pattern (read → pure mutate → write):

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs').then((m) => {
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  let s = m.readStackState(opts);
  const mutation = JSON.parse(process.argv[3]);
  const runIdentity = { workspaceId: process.argv[1], taskSlug: process.argv[2], runId: process.argv[4] };
  if (mutation.kind === 'process') s = m.addHostPid(s, mutation.resource);
  else if (mutation.kind === 'container') s = m.addProject(s, mutation.resource);
  else if (mutation.kind === 'frontendEnv') s = m.setFrontendEnv(s, mutation.value);
  else if (mutation.kind === 'backendEnvBackup') s = m.addBackendEnvBackup(s, mutation.value);
  s = m.recordOwnedMutation(s, runIdentity, mutation.cleanup);
  m.writeStackState(opts, s);
});
" "{workspaceId}" "{slug}" '{mutationJson}' "{runId}"
```

Steps B0 and C1 below record several mutations in one pass and use their own fuller scripts; Steps E, F, H, and the observer each record one mutation and reference this pattern with a concrete `{mutationJson}`. `{workspaceId}` is the value captured in Step 1.

### Step A — Resolve the registry, task slug, and source mode

First ensure the unified registry exists and is compiled for this workspace (both idempotent — safe every run), then read it:

```bash
node {plugin-root}/bin/seed-registry.mjs --workspace {root}
node {plugin-root}/bin/compile-registry.mjs --workspace {root}
```

Read the normalized registry with `readUnifiedRegistry({root})` (`{plugin-root}/bin/lib/registry/read.mjs`) — this yields `{ services, auth, frontend, network }` and is the source for every `{registry.*}` substitution below (there is no more `jelou-stack.json` on this path). Each `service` carries `{ id, path (resolved absolute), peers, dev }`; the `dev` block carries `docker.{service,compose_file}`, `port_env`, `extra_ports`, `ports` (env→internal), `ready_signal`, `teardown`.

Then resolve the slug:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs').then(({ resolveTaskSlug }) => {
  const slug = resolveTaskSlug({ workspaceRoot: process.argv[1], cwd: process.argv[2] });
  process.stdout.write(slug);
});
" "{root}" "{cwd}"
```

If the output starts with `AMBIGUOUS:`, prompt the user the same way as Step 2 of the generic path above.

Build and validate the plan with the Step B command before continuing. Report every selected source before any runtime mutation as a table with `serviceId`, `sourcePath`, and `commit` from each entry's source descriptor. If validation fails, stop without entering Step B0 or writing stack state.

### Step B0 — Back up the `.env`s of shared-reuse services that get a wiredEnv

Build the plan once (Step B does this too; reuse the same JSON). A `shared-reuse` plan entry with a non-null `wiredEnv` will have its real repo `.env` rewritten to point a peer var at a worktree peer's task URL — back up each such `.env` first so `/jlu:stop-dev` can restore it. Task-isolated services write to their disposable worktree `.env`, so they are skipped. Journal every backup and generated overlay with the current run marker:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs'),
  import('node:fs')
]).then(([ss, fs]) => {
  const plan = JSON.parse(process.argv[3]);
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  const runIdentity = { workspaceId: process.argv[1], taskSlug: process.argv[2], runId: process.argv[4] };
  let s = ss.readStackState(opts);
  for (const entry of plan.services) {
    if (entry.policy !== 'shared-reuse' || !entry.wiredEnv) continue;
    const path = entry.cwd + '/.env';
    const backupPath = entry.cwd + '/.env.jelou-local-stack.bak';
    if (fs.existsSync(path) && !fs.existsSync(backupPath)) {
      fs.copyFileSync(path, backupPath);
      s = ss.addBackendEnvBackup(s, { path, backupPath });
      s = ss.recordOwnedMutation(s, runIdentity, { kind: 'restore', resource: { from: backupPath, to: path } });
    }
  }
  for (const overlay of plan.overlayFiles || []) {
    s = ss.recordOwnedMutation(s, runIdentity, { kind: 'overlay', resource: { path: overlay.path } });
  }
  ss.writeStackState(opts, s);
});
" "{workspaceId}" "{slug}" '{planJson}' "{runId}"
```

`{planJson}` is the plan JSON from Step B.

### Step B — Build the plan and boot each service

Build the boot plan from the unified registry:

```bash
node {plugin-root}/bin/build-boot-plan.mjs --workspace {root} --slug {slug} --source-mode {sourceMode}
```

This prints `{ services: [entry], network, slug }` — capture it as `{planJson}` (also used by Steps B0, C, C1, D, and the observer). Each `entry` has a `policy` of `task-isolated` or `shared-reuse`.

Then boot each entry by following the `## Plan-driven boot` contract in `jelou/references/env-lifecycle.md`: for each entry, obtain its descriptor with `planEntryToCommands(entry, { runIdentity })` and execute it —

- **task-isolated**: write `descriptor.files[]` → `docker <descriptor.up>` (idle container, image reused, no rebuild) → if `descriptor.install` non-null run it per step 4b of the boot contract (blocking, before the dev command, bounded by `install.timeoutMs`; a non-zero exit means this entry is `down` with cause `deps_install_failed` and its dev command is never exec'd) → if `descriptor.exec` non-null `docker <descriptor.exec>` → poll `descriptor.readiness` (http/port on the allocated host port; stdout_match tails `descriptor.readiness.logPath`) → register `docker <descriptor.teardown>` (ALWAYS). WARN if `descriptor.imageResolved` is false.
- **shared-reuse**: write `descriptor.files[]` (the `wiredEnv` `.env`) if present → the existing reuse-or-reboot path (`descriptor.launcher`/`command`/`cwd`): probe the developer's container, reuse if healthy, reboot only if unhealthy/stale → poll `descriptor.readiness` (the service's normal dev port) → register `descriptor.teardown` (kill-what-started) ONLY if this run rebooted it.

Track `green` (every entry reached readiness) and `down` (the entries that did not). For each `shared-reuse` entry, resolve its dev container id for the observer (Step below) by running, in the service `cwd`:

```bash
docker compose -f <dev.docker.compose_file> ps -q <dev.docker.service>
```

Remember the resulting container id keyed by service id (used when building the observer plan). If it is empty, note that service's observer entry will be dropped (boot still proceeds).

### Step B1 — Peer-var warning (non-blocking)

The plan's `wiredEnv` rewrites a peer's URL only when the peer var already exists in that service's `.env`. Run a non-blocking advisory pass over the unified registry services: for each service with a non-empty `peers` map, read its `.env` text and run `missingPeerVars({ envText, peers })`. If any are missing, warn; never fail the boot.

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/peer-warn.mjs'),
  import('node:fs')
]).then(([{ missingPeerVars }, fs]) => {
  const services = JSON.parse(process.argv[1]);
  for (const svc of services) {
    const peers = svc.peers || {};
    if (Object.keys(peers).length === 0) continue;
    const envPath = svc.path + '/.env';
    const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const missing = missingPeerVars({ envText, peers });
    if (missing.length > 0) process.stdout.write('WARN ' + svc.id + ' ' + missing.join(',') + '\n');
  }
});
" '{registry.servicesJson}'
```

`{registry.servicesJson}` is `JSON.stringify(registry.services)` from Step A. For each `WARN <service> <LIST>` line, surface: `⚠ <service>: declared peer var(s) <LIST> not present in its .env — cross-service rewiring will silently no-op for those (service will keep its existing/prod URL).`

### Step C — Report

Compute the policy-aware reachable host for each service:

```bash
node -e "
import('{plugin-root}/bin/lib/boot-engine/host-map.mjs').then(({ hostByService }) => {
  const plan = JSON.parse(process.argv[1]);
  const registry = JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify(hostByService({ plan, registry })));
});
" '{planJson}' '{registryJson}'
```

This returns `{ hostByService: { <id>: host }, occupied: [host…] }` — `hostByService[id]` is the allocated primary host for a task-isolated service, or the normal dev port for a shared-reuse service. Reuse it in every step below.

- If `green`: report each service as `<service>: http://localhost:<hostByService[service]>`.
- For each `down` service, surface its log before failing: task-isolated → `docker exec <service>-<slug> tail -n 30 /tmp/<service>-<slug>.dev.log`; shared-reuse → `docker logs --tail 30 <resolved dev container id from Step B>`.

### Step C1 — Record booted task projects

For each `task-isolated` plan entry, append one `project` mutation so `/jlu:stop-dev` tears down its compose project. The fields come straight from the plan entry (no `buildTaskStack`). Shared-reuse services are not compose projects and record nothing (their reused container belongs to the developer).

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs').then((ss) => {
  const plan = JSON.parse(process.argv[3]);
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  const runIdentity = { workspaceId: process.argv[1], taskSlug: process.argv[2], runId: process.argv[4] };
  let s = ss.readStackState(opts);
  for (const e of plan.services) {
    if (e.policy !== 'task-isolated') continue;
    const resource = { projectName: e.projectName, cwd: e.cwd, composeFile: e.composeFile, overrideFile: 'docker-compose.jlu.yml' };
    s = ss.addProject(s, resource);
    s = ss.recordOwnedMutation(s, runIdentity, { kind: 'container', resource });
  }
  ss.writeStackState(opts, s);
});
" "{workspaceId}" "{slug}" '{planJson}' "{runId}"
```

`{registryJson}` is `JSON.stringify(registry)` (the full normalized registry from Step A); `{planJson}` is the plan JSON from Step B.

### Precondition — base images

This path assumes the Jelou dev containers' base images already exist (idle images that `sleep infinity` until a command is exec'd into them). If a per-task container cannot be created because its base image was never built, treat that as a one-time local setup precondition to report to the user — do not attempt to auto-build the image.

A **stale** base image is a different case and is NOT a setup precondition: when the base compose declares a volume over `<codeTarget>/node_modules`, the container resolves its dependencies from the image rather than from any checkout, so an image built before the branch's lockfile serves outdated dependencies. Step 4b of the boot contract already handles this by taking that mount target over with a lock-keyed named volume and installing inside the container — never by rebuilding the image, and never by installing on the host, which the container cannot see.

### Observer — background log watch (F3-a) + optional auto-fix (F3-b)

> Once Step C reports `green`, start a backgrounded log observer over the booted stack. This runs independently of Steps D–I (frontend + auth) below — start it right after the backend-boot green report, then proceed with D–I in parallel.

**`--auto-fix` flag.** The `--jelou-stack` boot accepts an optional `--auto-fix` flag alongside it (e.g. `/jlu:start-dev --jelou-stack --auto-fix`). This is opt-in and off by default. When NOT passed, the observer behaves exactly as documented below — it only reports (appends `pattern_match` events) and notifies; nothing auto-edits code. When passed, it additionally drives the bounded `/jlu:autofix <service>` loop (`jelou/workflows/autofix.md`) for any service the observer flags — **`--auto-fix` performs unattended code edits**; it is opt-in specifically because of that. `/jlu:autofix <service>` is always available as a manual, on-demand command regardless of this flag.

The observer needs a per-service `plan` describing where to read each service's logs. Build it from the boot plan with `observerPlanFromBootPlan` (task-isolated → `logMode:'exec-file'` on `<service>-<slug>`; shared-reuse → `logMode:'docker-logs'`), then merge in each shared-reuse service's resolved dev container id (from Step B); drop any shared-reuse entry whose container did not resolve:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/observer-plan.mjs').then(({ observerPlanFromBootPlan }) => {
  const plan = JSON.parse(process.argv[1]);
  const containers = JSON.parse(process.argv[2]);
  const out = observerPlanFromBootPlan(plan)
    .map((e) => e.policy === 'shared-reuse' ? { ...e, container: containers[e.name] } : e)
    .filter((e) => e.policy !== 'shared-reuse' || e.container);
  process.stdout.write(JSON.stringify(out));
});
" '{planJson}' '{sharedReuseContainersJson}' > /tmp/jlu-observer-plan-{slug}.json
```

`{sharedReuseContainersJson}` is the `{ <serviceId>: <containerId> }` map assembled from the Step B `compose ps -q` resolutions.

Then start the interval loop as a **backgrounded** process — like Steps F and H, a synchronous invocation would block the orchestrator. Construct `cooldown = Cooldown(effectiveDefaults(config).notification_cooldown_seconds)` and `prevCaptures = {}` **once each**, outside the loop, so both cooldown state and per-service capture state are shared and retained across every pass, and poll on `effectiveDefaults(config).poll_interval_ms`:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/observer-runtime.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs'),
  import('node:fs')
]).then(([{ runObserverPass, Cooldown }, { readConfig, effectiveDefaults }, fs]) => {
  const config = readConfig(process.argv[1]);
  const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const workspaceId = process.argv[3];
  const slug = process.argv[4];
  const errLog = process.argv[5];
  const defaults = effectiveDefaults(config);
  const cooldown = Cooldown(defaults.notification_cooldown_seconds);
  const prevCaptures = {};
  setInterval(() => {
    try {
      runObserverPass({ plan, config, workspaceId, slug, cooldown, prevCaptures });
    } catch (e) {
      fs.appendFileSync(errLog, \`observer-pass-error: \${e.message}\n\`);
    }
  }, defaults.poll_interval_ms);
});
" "{configPath}" "/tmp/jlu-observer-plan-{slug}.json" "{workspaceId}" "{slug}" "/tmp/jlu-observer-{slug}.log" > /tmp/jlu-observer-{slug}.log 2>&1 &
```

`runObserverPass` (`stack/observer-runtime.mjs`) reads each service's docker log source (via `logSourceArgs`: `exec-file` services are tailed with `docker exec <projectName> tail`; `docker-logs` services are read with `docker logs <container>`), diffs it against the previous pass, and matches new lines against that service's effective failure patterns (`effectiveFailurePatterns` — the config's global `defaults.log_failure_patterns` plus any per-service override). Every match appends a `pattern_match` event to `eventsLogPath({ workspaceId, slug })` — the exact same JSONL file the existing `/jlu-diagnose` command reads — and, gated by the shared `cooldown`, fires a cooldown-gated OS notification (`notifyOs`) naming the failing service.

Immediately after the observer launches with `&`, capture its PID in the same shell (`OBSERVER_PID=$!`), then record its PID into stack-state (`kind: 'hostPid'`, role `observer`) so `/jlu:stop-dev` tears it down:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs').then((m) => {
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  let s = m.readStackState(opts);
  const resource = JSON.parse(process.argv[3]);
  const runIdentity = { workspaceId: process.argv[1], taskSlug: process.argv[2], runId: process.argv[4] };
  s = m.addHostPid(s, resource);
  s = m.recordOwnedMutation(s, runIdentity, { kind: 'process', resource });
  m.writeStackState(opts, s);
});
" "{workspaceId}" "{slug}" '{"role":"observer","pid":<OBSERVER_PID>}' "{runId}"
```

Autofix is NOT recorded as a host PID — when `--auto-fix` is set it runs as an in-session `Agent` dispatch (see below), not a detached host process, so there is no separate process for teardown to kill.

Tell the user: the observer is now watching the booted stack's container logs in the background. Any service it flags can be inspected with the existing `/jlu-diagnose <service>` command, which reads the same events log this observer writes to. If `--auto-fix` was passed, also tell the user the auto-fix loop is armed for this session and will invoke `/jlu-autofix <service>` automatically on a flagged service, always with an escalation back to them if it can't resolve it cleanly.

**`--auto-fix` wiring (F3-b).** The backgrounded observer script itself only ever appends events and fires OS notifications — a detached background process has no way to invoke the `Agent`/`Bash` tools that `/jlu-autofix` needs, so the auto-fix trigger has to live with the orchestrator (this session), not inside the `setInterval` loop. When `--auto-fix` is set:

1. Maintain, for the lifetime of this session, an in-flight set (`autofixInFlight`, service names currently being auto-fixed) and a SEPARATE `autofixCooldown = Cooldown(effectiveDefaults(config).notification_cooldown_seconds)` object, keyed `<service>:autofix` — this is independent of the observer's own notifier cooldown (keyed `<service>:soft`); the two `Cooldown` instances track their keys independently, so being inside one window says nothing about the other.
2. At natural checkpoints during this session (after reporting the boot as green, and again whenever you next act on the user's behalf — e.g. before responding to their next message, or when explicitly asked to check the stack), read the tail of `eventsLogPath({ workspaceId, slug })` for new `pattern_match` events since the last checkpoint.
3. For each service with a new `pattern_match`: if that service is already in `autofixInFlight`, skip (an autofix run is already active for it — never double-dispatch). If `autofixCooldown.allow('<service>:autofix')` returns `false`, skip (still within the autofix's own cooldown window). Otherwise add the service to `autofixInFlight` and dispatch the `/jlu:autofix <service>` workflow (`jelou/workflows/autofix.md`) for it.
4. When that dispatch reports DONE or ESCALATE (autofix's own bounded loop always ends in one of those two — see `autofix.md`), remove the service from `autofixInFlight` and surface the result to the user. A DONE report closes the loop for that occurrence; an ESCALATE report hands it back to the user exactly as `/jlu:autofix` would if invoked manually.

This keeps the debounce guarantee to what actually holds: at most one autofix run in-flight per service at any time, plus the autofix's own `<service>:autofix` cooldown window — it does NOT mean a service inside the observer's notification cooldown window (`<service>:soft`) is skipped for auto-fix; that is a separate, independently-tracked key.

**Duplicate-event handling.** The duplicate-event problem from an earlier version of this step is fixed: `prevCaptures` is constructed once, outside the loop (alongside `cooldown`, as above), and threaded into every `runObserverPass` call, so capture state is retained across passes — a failing line matches exactly once on first appearance, and steady state (an unchanged tail) yields no re-match. The one remaining bounded limitation, shared with the existing daemon, is the tail window itself: a failing line older than the `--tail`/`tail -n` window (200 lines) that scrolls off and later reappears at the tail can re-match, since it looks like a new line to a capture diff that only ever sees the last 200 lines.

### Step D — Allocate frontend + inject host ports

`occupied` and `hostByService` come from the Step C `hostByService({ plan, registry })` result — `occupied` already holds every task-isolated allocated host. Allocate the frontend and inject-server ports against it, using `network.basePort` and `network.authInjectPort` from the registry:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/ports.mjs').then(({ allocateHostPorts }) => {
  const occupied = new Set(JSON.parse(process.argv[1]));
  const frontend = allocateHostPorts({ mappings: [{ internal: 0 }], occupied, basePort: Number(process.argv[2]) })[0].host;
  occupied.add(frontend);
  const inject = allocateHostPorts({ mappings: [{ internal: 0 }], occupied, basePort: Number(process.argv[3]) })[0].host;
  process.stdout.write(JSON.stringify({ frontendPort: frontend, injectPort: inject }));
});
" '{occupiedJson}' '{registry.network.basePort}' '{registry.network.authInjectPort}'
```

`{occupiedJson}` is the `occupied` array from Step C. `process.argv` values are strings, so both basePort arguments must be coerced with `Number(...)` — a string `basePort` defeats collision-skipping. `hostByService` (from Step C) is the name→host map reused by every step below.

### Step E — Rewrite the frontend `.env`

Back up `registry.frontend.path`/`registry.frontend.envFile` to `registry.frontend.path`/`registry.frontend.envBackup` if that backup does not already exist — these fields come from the unified registry `frontend` block (Step A). Read the current `.env` contents (empty string if the file is absent), then:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/frontend-env.mjs').then(({ rewriteFrontendEnv }) => {
  const out = rewriteFrontendEnv({
    envText: process.argv[1],
    envLocal: JSON.parse(process.argv[2]),
    envBlank: JSON.parse(process.argv[3]),
    hostByService: JSON.parse(process.argv[4])
  });
  process.stdout.write(out);
});
" "{currentEnvText}" '{JSON.stringify(registry.frontend.envLocal)}' '{JSON.stringify(registry.frontend.envBlank)}' '{JSON.stringify(hostByService)}'
```

The substitution values come from the unified registry `frontend` block (Step A) and the Step C `hostByService` map: `JSON.stringify(registry.frontend.envLocal)`, `JSON.stringify(registry.frontend.envBlank)`, and `JSON.stringify(hostByService)`.

Write the result back over `registry.frontend.path`/`registry.frontend.envFile`.

Once the `.env` has been backed up and rewritten, record the backup into stack-state (`kind: 'frontendEnv'`) so `/jlu:stop-dev` can restore the original:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs').then((m) => {
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  let s = m.readStackState(opts);
  const value = JSON.parse(process.argv[3]);
  const runIdentity = { workspaceId: process.argv[1], taskSlug: process.argv[2], runId: process.argv[4] };
  s = m.setFrontendEnv(s, value);
  s = m.recordOwnedMutation(s, runIdentity, { kind: 'restore', resource: { from: value.path + '/' + value.envBackup, to: value.path + '/' + value.envFile } });
  m.writeStackState(opts, s);
});
" "{workspaceId}" "{slug}" '{"path":"<frontend.path>","envFile":"<frontend.envFile>","envBackup":"<frontend.envBackup>"}' "{runId}"
```

`registry.frontend.path`, `registry.frontend.envFile`, and `registry.frontend.envBackup` come from the unified registry's `frontend` block (Step A).

### Step F — Boot Vite on the host

From `<frontend.path>`, run `<frontend.command> --port <frontendPort> --strictPort` in the background with `&`, redirecting stdout/stderr to a runtime log file. Poll `http://localhost:<frontendPort>/` until it answers an HTTP request — Vite's first compile typically takes 30–90s, so re-poll roughly every 15s rather than failing fast.

Because the boot is backgrounded with `&`, capture its PID in the same shell (`VITE_PID=$!`), then record its PID into stack-state (`kind: 'hostPid'`, role `vite`) so `/jlu:stop-dev` tears it down:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs').then((m) => {
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  let s = m.readStackState(opts);
  const resource = JSON.parse(process.argv[3]);
  const runIdentity = { workspaceId: process.argv[1], taskSlug: process.argv[2], runId: process.argv[4] };
  s = m.addHostPid(s, resource);
  s = m.recordOwnedMutation(s, runIdentity, { kind: 'process', resource });
  m.writeStackState(opts, s);
});
" "{workspaceId}" "{slug}" '{"role":"vite","pid":<VITE_PID>}' "{runId}"
```

### Step G — Login for the auth cookie

The `auth` block and `hostByService` come from Step A (`readUnifiedRegistry`) and Step C respectively; `resolveAuthUrls` consumes the normalized `auth.verify` array and `auth.dashboardService`'s policy-aware host.

Read `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` from `<auth.credentials.envFile>` — never print these values or the resulting cookie. Resolve the auth URLs, then perform the login, passing the password via the `E2E_PASSWORD` environment variable rather than `process.argv` (argv is visible in `ps` output and in the logged Bash tool-call input; env vars are not):

```bash
E2E_PASSWORD="{password}" node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/auth-urls.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/login-cookie.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/auth-runtime.mjs')
]).then(async ([{ resolveAuthUrls }, { loginForCookie }, { postJson, readOtpFromRedis }]) => {
  const auth = JSON.parse(process.argv[1]);
  const hostByService = JSON.parse(process.argv[2]);
  const { loginUrl, verifyMfaUrl, cookieName } = resolveAuthUrls({ auth, hostByService });
  const result = await loginForCookie({
    loginUrl, verifyMfaUrl, cookieName,
    email: process.argv[3], password: process.env.E2E_PASSWORD,
    postJson,
    readOtp: readOtpFromRedis(auth.otpFallback)
  });
  process.stdout.write(JSON.stringify({ status: result.status }));
});
" '{registry.authJson}' '{hostByServiceJson}' "{email}"
```

Capture the cookie value out-of-band (never echoed to stdout/logs). If `status` is not `ok`, map the cause and stop before touching the browser: `rejected` → bad credentials or an inactive account; `otp-missing` → no OTP found at the configured Redis key; `otp-rejected` → the OTP was read but the dashboard rejected it.

### Step H — Inject the cookie and open the browser

Start the inject server. `startInjectServer` calls `server.listen(...)` and keeps the Node event loop alive, so this must be launched as a **backgrounded** process (the same way Step F backgrounds the Vite boot) — a synchronous `node -e` invocation would never return and would hang the orchestrator. Pass the cookie value via the `JLU_INJECT_COOKIE` environment variable rather than `process.argv` (argv is visible in `ps` output and in the logged Bash tool-call input; env vars are not):

```bash
JLU_INJECT_COOKIE="{cookieValue}" node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/inject-page.mjs').then(({ renderInjectPage, startInjectServer }) => {
  const page = renderInjectPage({
    cookieName: process.argv[1],
    cookieValue: process.env.JLU_INJECT_COOKIE,
    appUrl: process.argv[2],
    account: process.argv[3]
  });
  startInjectServer({ port: Number(process.argv[4]), page });
});
" "{cookieName}" "http://localhost:{frontendPort}/" "{email}" "{injectPort}" > /tmp/jlu-inject-server-{slug}.log 2>&1 &
```

Immediately after the inject server launches with `&`, capture its PID in the same shell (`INJECT_PID=$!`), then record its PID into stack-state (`kind: 'hostPid'`, role `inject`) so `/jlu:stop-dev` tears it down:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs').then((m) => {
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  let s = m.readStackState(opts);
  const resource = JSON.parse(process.argv[3]);
  const runIdentity = { workspaceId: process.argv[1], taskSlug: process.argv[2], runId: process.argv[4] };
  s = m.addHostPid(s, resource);
  s = m.recordOwnedMutation(s, runIdentity, { kind: 'process', resource });
  m.writeStackState(opts, s);
});
" "{workspaceId}" "{slug}" '{"role":"inject","pid":<INJECT_PID>}' "{runId}"
```

Then, using `mcp__chrome-devtools__*`: `navigate_page` to `http://localhost:<injectPort>/`, `wait_for` the app to render, and if the page is blank reload once (Vite's cold-cache re-optimization can stall the first hit). Confirm the session is authenticated via `take_snapshot` — the URL must not be `/login` and real app content must be present — then close out with `take_screenshot`. Never print the cookie value in any tool output or report.

### Step I — Verify

For each URL in `resolveAuthUrls({ auth, hostByService }).verifyUrls`, issue a request with header `Cookie: <cookieName>=<cookieValue>` and confirm a `200` response. Only declare auth green once every verify URL passes.

### Notes — frontend + auth

- **Browser MCP override.** This path drives the browser exclusively through `mcp__chrome-devtools__*`. That is a deliberate, standing override of the global "use `/browse` for all web browsing" preference — the preference concerns the separate `mcp__claude-in-chrome__*` MCP and does not apply to this local-stack auth path, per the same override documented by the `jelou-local-stack` skill.
- **OTP key mismatch (informational).** `bin/lib/api-login.mjs`'s own CLI path uses `mfa-code-<email>` as the Redis key, while this path reads the registry's `auth.otpFallback.keyPrefix` (`2fa-code-`), per `jelou-local-stack`. The configured E2E account has 2FA disabled, so the OTP branch is normally never exercised — if 2FA is ever armed on that account, confirm which key prefix the auth-service actually writes before trusting `readOtpFromRedis`.
