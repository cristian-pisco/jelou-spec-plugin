# /jlu:start-dev Workflow

> Purpose: Launch all registered services in a TMUX window dedicated to the active task slug.

> **Deprecated:** the tmux path (Steps 1–6 below) is deprecated in favor of the plan-driven `--jelou-stack` boot (see "Task-aware Jelou-stack boot" below), which reuses the developer's docker containers and wires task worktrees. The tmux path runs ONLY in a workspace whose root holds a `jlu-services.json`; a workspace on the unified registry has no such file and MUST use `--jelou-stack`. Step 0 routes this for you — never offer the tmux path to a registry-based workspace.

Inputs:
- `cwd`: the user's current working directory.

## Step 0 — Route to the boot path

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs').then(({ resolveWorkspace, bootPathFor }) => {
  const ws = resolveWorkspace(process.argv[1]);
  process.stdout.write(JSON.stringify({ ...ws, bootPath: bootPathFor(ws) }));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

If the script exits non-zero, surface its message verbatim and stop — do NOT guess a root and do NOT offer either boot path.

Capture `{ root, configPath, workspaceId, bootPath }`. This is the ONLY workspace resolution in this workflow; every later step reuses these values. Then route on `bootPath`:

- `jelou-stack` → skip Steps 1–6 entirely and go straight to "Task-aware Jelou-stack boot" below. This is not a question for the user; the workspace has no `jlu-services.json`, so the tmux path cannot run at all.
- `tmux` → continue with Step 1. If the user passed `--jelou-stack` explicitly, honor that and jump to the Jelou-stack section instead.

## Step 1 — Read the tmux-path config

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
- If `status: "created"`, print: `Started <paneCount> services in TMUX window '<windowName>' (layout: <layout>). Daemon pid: <daemonPid>.`

If `skipped` is non-empty, list the skipped services with reasons.

## Notes

- `startDev` spawns the real daemon: its `daemonSpawn` callback defaults to `daemonSpawn` from `bin/lib/dev-orchestrator/daemon-spawn.mjs`, which spawns `daemon.mjs` detached and returns its pid as `daemonPid` in the result. Tests inject a fake; nothing else overrides it.
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

Steps B0 and C1 below record several mutations in one pass and use their own fuller scripts; Steps E, F, H, and the observer each record one mutation and reference this pattern with a concrete `{mutationJson}`. `{workspaceId}` is the value captured in Step 0.

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

Then resolve the source mode. This path is entered directly, so it must produce its own `{sourceMode}` — never assume Step 2.5 of the deprecated tmux path ran. Read the allowed choices from the same shared contract:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/source-mode.mjs').then(({ sourceModeChoices }) => {
  process.stdout.write(JSON.stringify(sourceModeChoices({ hasActiveTask: process.argv[1] !== '_global' })));
});
" "{slug}"
```

Ask the user which source mode to use, offering `main` and `task-aware` exactly as returned. If no task is active, `task-aware` is disabled with the explanation `No active task is available`, so only `main` is selectable. Capture the selected normalized value as `{sourceMode}` — this is the value Step B passes to `build-boot-plan.mjs --source-mode`.

Create the run identity for this invocation the same way Step 2.5 does:

```bash
node -e "
import('node:crypto').then(({ randomUUID }) => process.stdout.write(randomUUID()));
"
```

Capture the output as `{runId}` and reuse it — with `runIdentity = { workspaceId, taskSlug: slug, runId }` — for every lifecycle emitter, execution descriptor, journal write, and cleanup call below.

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

**Skip any entry whose `dev.launcher` is neither `docker` nor `docker-exec`** (check with `isContainerLauncher(entry.launcher)`, `{plugin-root}/bin/lib/boot-engine/launcher.mjs`) before this loop. A host-launched entry (e.g. `npm`) can show up here with `policy: 'task-isolated'` when its worktree exists — `compile-registry.mjs` includes any `services.yaml` dev block even when `jelou-registry.yaml` never declared it, which is how the frontend's own entry (`jelou-apps`) ends up in `plan.services` alongside its dedicated `plan.frontend` block. `planEntryToCommands` never throws on it (every field just interpolates as `undefined`), so the failure mode is a `docker compose -p undefined ... up -d` invocation, not a clean error — skip it before that happens. This loop is for the Docker-based backend boot only; a host-launched frontend entry belongs to Steps D–H (`plan.frontend`), never to this one.

Then boot each remaining entry by following the `## Plan-driven boot` contract in `jelou/references/env-lifecycle.md`: for each entry, obtain its descriptor with `planEntryToCommands(entry, { runIdentity })` and execute it —

- **task-isolated**: write `descriptor.files[]` → `docker <descriptor.up>` (image reused, no rebuild) → if `descriptor.install` non-null run it per step 4b of the boot contract (blocking, bounded by `install.timeoutMs`; a non-zero exit means this entry is `down` with cause `deps_install_failed` and its dev command is never started) → if `descriptor.exec` non-null `docker <descriptor.exec>`, else if `descriptor.restart` non-null `docker <descriptor.restart>` → poll `descriptor.readiness` (http/port on the allocated host port; stdout_match reads the log source below) → register `docker <descriptor.teardown>` (ALWAYS). WARN if `descriptor.imageResolved` is false, and WARN if `descriptor.depsUnverified` is true (the container resolves `node_modules` from its base image, so a lockfile newer than the image serves stale dependencies — rebuild the base image if the service misbehaves).

  Whether the entry is idle-then-exec'd or self-starting is decided by its `dev.launcher`, and `planEntryToCommands` has already resolved it: `docker-exec` yields a `descriptor.exec` (the override makes the container idle, the dev command is exec'd into it and redirected to `descriptor.readiness.logPath`); `docker` yields `exec: null` because the image's own CMD starts the dev command when the container comes up — there is no `logPath`, and a deps install has to be followed by `descriptor.restart` so the CMD re-runs against the installed dependencies. Never assume a `/tmp/<projectName>.dev.log` exists: read `descriptor.readiness.logSource`, which is `{ mode: 'exec-file', container, path }` or `{ mode: 'docker-logs', container }`, and tail with `docker exec <container> tail -n 30 <path>` or `docker logs --tail 30 <container>` accordingly.
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
Promise.all([
  import('{plugin-root}/bin/lib/boot-engine/host-map.mjs'),
  import('node:child_process')
]).then(([{ hostByService }, { spawnSync }]) => {
  const plan = JSON.parse(process.argv[1]);
  const registry = JSON.parse(process.argv[2]);
  const ps = spawnSync('docker', ['ps', '--format', '{{.Ports}}'], { encoding: 'utf8' }).stdout || '';
  const occupiedOnHost = [...new Set([...ps.matchAll(/0\.0\.0\.0:(\d+)->/g)].map((m) => Number(m[1])))];
  process.stdout.write(JSON.stringify(hostByService({ plan, registry, occupiedOnHost })));
});
" '{planJson}' '{registryJson}'
```

This returns `{ hostByService: { <id>: host }, occupied: [host…], unresolved: [id…] }` — `hostByService[id]` is the allocated primary host for a task-isolated service, and for a shared-reuse service the **published** host port read from its running container (`docker compose port`), which is not the same number as the registry's internal port: the registry records what the process listens on inside the container (`8080` for nearly every Jelou service), while the developer's container publishes it on a distinct host port (`8383`, `8229`, `8902`…). Reporting or injecting the internal port would point the whole frontend at one wrong port. Run this step only AFTER Step B, so every shared-reuse container is already up and its port is resolvable.

`occupied` includes every host port docker has published, not just this plan's allocations, so Step D cannot hand the frontend a port a leftover task container from another slug is already holding. For each id in `unresolved`, warn: `⚠ <service>: no published host port — its container is not running, falling back to the internal port <n>, which is almost certainly not reachable from the host.` Treat an unresolved `frontend.envLocal` target as a boot failure rather than writing a wrong URL into the frontend `.env`.

- If `green`: report each service as `<service>: http://localhost:<hostByService[service]>`.
- For each `down` service, surface its log before failing: task-isolated → the command implied by its `descriptor.readiness.logSource` (Step B); shared-reuse → `docker logs --tail 30 <resolved dev container id from Step B>`.

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

The frontend obeys the same task-isolation rule as the backend services: `plan.frontend` (Step B) is the unified registry's `frontend` block with its `path` already re-pointed at `<registry.frontend.path>/.worktrees/<slug>` when that worktree exists (`isWorktree: true`, `policy: 'task-isolated'`), and left on the canonical checkout otherwise. **Every frontend step below — the `.env` backup, the rewrite, the Vite boot, the stack-state record — uses `plan.frontend.path`, never `registry.frontend.path`.** Booting the canonical checkout for a slug that has a frontend worktree serves main-branch code and silently invalidates the whole run. If `plan.frontend.isWorktree` is true and `plan.frontend.depsPresent` is false, stop and tell the user to install dependencies in that worktree — do not install them yourself.

Back up `plan.frontend.path`/`plan.frontend.envFile` to `plan.frontend.path`/`plan.frontend.envBackup` if that backup does not already exist. Read the current `.env` contents from `plan.frontend.envSeed` (the worktree's own `.env` when it has one, otherwise the canonical checkout's — a fresh worktree inherits the developer's environment rather than starting blank), empty string if that file is absent too, then:

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
" "{currentEnvText}" '{JSON.stringify(plan.frontend.envLocal)}' '{JSON.stringify(plan.frontend.envBlank)}' '{JSON.stringify(hostByService)}'
```

The substitution values come from `plan.frontend` (Step B) and the Step C `hostByService` map: `JSON.stringify(plan.frontend.envLocal)`, `JSON.stringify(plan.frontend.envBlank)`, and `JSON.stringify(hostByService)`.

Write the result back over `plan.frontend.path`/`plan.frontend.envFile`.

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
" "{workspaceId}" "{slug}" '{"path":"<plan.frontend.path>","envFile":"<plan.frontend.envFile>","envBackup":"<plan.frontend.envBackup>"}' "{runId}"
```

Recording `plan.frontend.path` (not the canonical path) is what lets `/jlu:stop-dev` restore the `.env` it actually overwrote.

### Step F — Boot Vite on the host

From `<plan.frontend.path>`, run `<plan.frontend.command> --port <frontendPort> --strictPort` in the background with `&`, redirecting stdout/stderr to a runtime log file. Poll `http://localhost:<frontendPort>/` until it answers an HTTP request — Vite's first compile typically takes 30–90s, so re-poll roughly every 15s rather than failing fast.

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

### Step F0 — Reconcile the local authentication profile

When the normalized registry has `auth`, onboarding is required before login. If `auth && !auth.localProvisioningAdapter`, stop with remediation to register the local database/bcrypt adapter; never skip into credential lookup. Read `localAuthProfile` from task stack state. A complete profile is offered for reuse; an incomplete profile requests only missing company or user fields; `--reconfigure` requests replacements for every selected field. Existing-company selection defaults to ID `135`. New-company plan choices are exactly `ENTERPRISE` and `SELF_SERVICE`.

Invoke the onboarding CLI with the registered adapter module path and send one JSON request through stdin. The request contains `{ workspaceId, taskSlug, runId, target, topology, storedProfile, input }`. The password is entered through stdin and must never appear in arguments, environment variables, runtime files, generated overlays, lifecycle events, or displayed command text. Forward the invocation's `--reconfigure` option to this CLI only when selected.

```bash
node {plugin-root}/bin/local-auth-onboarding.mjs --adapter-module {registry.auth.localProvisioningAdapter} [--reconfigure]
```

Write the JSON request directly to the child process stdin without echoing or logging it. The CLI validates every onboarding field and keyring availability, proves the local database target independently, then reconciles the profile. A nonlocal target, unavailable keyring, or validation failure stops this run before Step G.

Parse the sanitized JSON response. Persist `response.profile` with `setLocalAuthProfile`. For each entry in `response.cleanupResources`, call `recordOwnedMutation` using the unchanged `runIdentity`; do not infer or manufacture cleanup records from input data.

```javascript
import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs').then((state) => {
  const opts = { workspaceId, slug };
  let current = state.readStackState(opts);
  current = state.setLocalAuthProfile(current, response.profile);
  for (const mutation of response.cleanupResources) {
    current = state.recordOwnedMutation(current, runIdentity, mutation);
  }
  state.writeStackState(opts, current);
});
```

Emit the provisioning lifecycle outcome through the existing redacted lifecycle boundary. Do not print the request, credential, hash, or unsanitized graph.

### Step G — Establish the genuine authenticated session

The `auth` block and `hostByService` come from Step A and Step C. Resolve `loginUrl`, `verifyMfaUrl`, `cookieName`, and `verifyUrls` with `resolveAuthUrls`. Read `localAuthProfile` from the task stack state and stop if the profile or its `keyringIdentity` is missing. Credentials come only from `createOsKeyring`; do not read an environment credential file or place the password or cookie in arguments, environment variables, stdout, stderr, snapshots, traces, pane output, or reports.

Resolve Playwright from `registry.frontend.path` so the browser runtime is the one owned by `jelou-apps`. Launch Chromium and pass `createBrowserContext: () => browser.newContext()` into `establishAuthenticatedSession`. Pass the task state identity, the keyring-backed profile, the resolved dashboard login contract, every protected API URL, `appUrl: http://localhost:{frontendPort}/`, and `protectedPath: registry.frontend.protectedPath || '/home'`.

Pass `postJson` and `readOtpFromRedis(auth.otpFallback)` from `auth-runtime.mjs`, `request: fetch`, and an `onLifecycle` adapter that calls `appendLifecycleEvent(eventsLogPath({ workspaceId, slug }), { ...event, taskSlug: slug })`. Close Chromium in `finally`.

`establishAuthenticatedSession` first probes a stored task cookie. A valid cookie is reused without a credential lookup. A missing, expired, redirected, or rejected cookie permits exactly one keyring-backed login against the configured dashboard. Only a genuine `jelou_auth` response is eligible for verification and atomic `0600` persistence. Invalid credentials, a missing expected cookie, or a rejected refreshed cookie clears rejected task state, never injects the stale value, and returns the actionable `--reconfigure` failure.

### Step H — Verify protected browser and API access

The session module injects the genuine cookie directly through the Playwright browser context for the `jelou-apps` origin. It requests every configured protected API with manual redirect handling, then opens the configured protected route. Authentication succeeds only when every API returns HTTP `200` and the final browser URL remains outside `/login`. The returned result contains status, source, API statuses, and final URL only; it never contains the password or cookie.

### Step I — Report the authenticated stack

Report whether the session source was `stored`, `login`, or `refreshed`, together with the protected API statuses and final non-login route. Do not include request headers, browser storage, the keyring value, or the cookie file contents.

### Notes — frontend + auth

- **Browser boundary.** Resolve Playwright through the `jelou-apps` checkout selected by the boot plan. Do not substitute an HTML cookie injector or a globally installed browser package.
- **OTP key mismatch (informational).** `bin/lib/api-login.mjs`'s own CLI path uses `mfa-code-<email>` as the Redis key, while this path reads the registry's `auth.otpFallback.keyPrefix` (`2fa-code-`), per `jelou-local-stack`. The configured E2E account has 2FA disabled, so the OTP branch is normally never exercised — if 2FA is ever armed on that account, confirm which key prefix the auth-service actually writes before trusting `readOtpFromRedis`.
