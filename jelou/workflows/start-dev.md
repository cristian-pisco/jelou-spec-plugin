# /jlu:start-dev Workflow

> Purpose: Launch all registered services in a TMUX window dedicated to the active task slug.

> **Deprecated:** the tmux path (Steps 1–6 below) is deprecated in favor of the plan-driven `--jelou-stack` boot (see "Task-aware Jelou-stack boot" below), which reuses the developer's docker containers and wires task worktrees. The tmux path runs ONLY in a workspace whose `jlu-services.json` actually registers services and that has no unified registry; every registry-based workspace MUST use `--jelou-stack`, including one that still carries a leftover empty `jlu-services.json`. Step 0 routes this for you — never offer the tmux path to a registry-based workspace.

Inputs:
- `cwd`: the user's current working directory.
- `taskSlugArgument`: the first non-flag argument the user passed to `/jlu:start-dev`, if any
  (e.g. `/jlu:start-dev restore-agent-execution-feedback-after-reload`). It is an EXPLICIT slug
  override and outranks every cwd/branch heuristic — carry it into every `resolveTaskSlug` call
  below as `override`. Empty when the user passed no slug.

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

- `jelou-stack` → skip Steps 1–6 entirely and go straight to "Task-aware Jelou-stack boot" below. This is not a question for the user; the tmux path cannot boot this workspace at all.
- `tmux` → continue with Step 1. If the user passed `--jelou-stack` explicitly, honor that and jump to the Jelou-stack section instead.

`bootPathFor` routes on what the workspace can actually boot, not on which files happen to exist: a `registry/` (unified registry) always wins, and a `jlu-services.json` that registers **zero** services routes to `jelou-stack` too. A registry workspace that also carries an empty `jlu-services.json` — the common shape after migrating off the tmux path — used to take the tmux branch and boot nothing.

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
  const slug = resolveTaskSlug({ workspaceRoot: process.argv[1], cwd: process.argv[2], override: process.argv[3] || undefined });
  process.stdout.write(slug);
});
" "{root}" "{cwd}" "{taskSlugArgument}"
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
  const slug = resolveTaskSlug({ workspaceRoot: process.argv[1], cwd: process.argv[2], override: process.argv[3] || undefined });
  process.stdout.write(slug);
});
" "{root}" "{cwd}" "{taskSlugArgument}"
```

Pass `{taskSlugArgument}` verbatim. When the user names the slug on the command line, that IS the answer — the cwd/branch heuristics only run when they did not. Invoking from a canonical checkout (not a worktree) on `main` is the normal case for a multi-service task, and without the override it resolves to `_global`, which boots the wrong stack silently.

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

Then run Step A0, and only then build and validate the plan with the Step B command. Report every selected source before any runtime mutation as a table with `serviceId`, `sourcePath`, and `commit` from each entry's source descriptor. If validation fails, stop without entering Step B0 or writing stack state.

### Step A0 — Reconcile a previous run that never closed

`stack-state.json` carries a `currentRun` marker plus that run's persisted port allocations. A boot that was interrupted (the session ended, the machine slept, the orchestrator crashed) leaves both behind with dead PIDs and live containers, and the next boot then fails twice over: `build-boot-plan.mjs` refuses with `<service> persisted port <n> has an unrelated live owner`, and every stack-state write throws `RUN_MARKER_MISMATCH`. Reconcile it BEFORE building the plan:

```bash
node {plugin-root}/bin/reconcile-stack-run.mjs --workspace-id {workspaceId} --slug {slug}
```

- `{"status":"clean"}` (exit 0) → nothing to do; continue.
- `{"status":"reconciled",...}` (exit 0) → the previous run's processes were all dead, so it was torn down for you (containers down, `.env`s restored, overlays removed). Report the `teardown` summary and continue with the fresh `{runId}`.
- `{"status":"active",...}` (exit 1) → the previous run still has live processes. Do NOT take it over. Tell the user to run `/jlu:stop-dev` for this slug first, and stop.

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

Then execute the plan. **Do NOT reimplement the boot loop.** `bin/boot-stack.mjs` is the executable form of the `## Plan-driven boot` contract in `jelou/references/env-lifecycle.md` — it calls `planEntryToCommands` per entry, writes `descriptor.files[]` (the field is `content`, singular), runs `up` → `install` → `exec`/`restart`, polls `descriptor.readiness`, and **leaves everything it started running**:

```bash
node {plugin-root}/bin/boot-stack.mjs --workspace-id {workspaceId} --slug {slug} --run-id {runId} --plan-file {planFile}
```

Write `{planJson}` to a file first and pass it with `--plan-file` (it also accepts the plan on stdin). It prints `{ services, skipped, green, degraded, down, mutations, lifecycle }` and exits 0 only when `down` is empty.

- `green` / `down` are the lists this workflow tracks from here on; `degraded` names services that answered on their port but never matched their declared `ready_signal` — report each one as `⚠ <service>: serving, but its registry ready_signal is stale (fix `ready_signal` in registry/services.yaml)`.
- `skipped` names entries the runner refused to boot and why. A host-launched entry (e.g. `npm`) shows up in `plan.services` with `policy: 'task-isolated'` when its worktree exists — `compile-registry.mjs` includes any `services.yaml` dev block even when `jelou-registry.yaml` never declared it, which is how the frontend's own entry (`jelou-apps`) lands there alongside its dedicated `plan.frontend` block. It belongs to Steps D–H, never to this one, and the runner drops it instead of issuing `docker compose -p undefined … up -d`.
- `mutations` are the container teardown records for Step C1 — do not derive them yourself.
- For a `down` entry, surface its log: task-isolated reads `descriptor.readiness.logSource`, which is `{ mode: 'exec-file', container, path }` or `{ mode: 'docker-logs', container }` (`docker exec <container> tail -n 30 <path>` or `docker logs --tail 30 <container>`); the runner already returns the last error lines in `services[].error_hints`.

**Never use `verifySharedReuse` to boot.** It is a *verifier*: it tears down in a `finally` everything it started, so a stack booted through it is down the moment it returns. The booting entry point is `bootSharedReuse` (same module), and `boot-stack.mjs` is the thing that calls it.

For each `shared-reuse` entry, resolve its dev container id for the observer (Step below) by running, in the service `cwd`:

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
  import('{plugin-root}/bin/lib/dev-orchestrator/readiness.mjs'),
  import('node:child_process')
]).then(([{ hostByService }, { probeTcp }, { spawnSync }]) => {
  const plan = JSON.parse(process.argv[1]);
  const registry = JSON.parse(process.argv[2]);
  const ps = spawnSync('docker', ['ps', '--format', '{{.Ports}}'], { encoding: 'utf8' }).stdout || '';
  const occupiedOnHost = [...new Set([...ps.matchAll(/0\.0\.0\.0:(\d+)->/g)].map((m) => Number(m[1])))];
  const live = new Map();
  const probeHostPort = (port) => live.get(port);
  const ports = new Set(occupiedOnHost);
  Promise.all([...ports].map((port) => probeTcp({ host: 'localhost', port }).then((r) => live.set(port, Boolean(r && r.ok)))))
    .then(() => process.stdout.write(JSON.stringify(hostByService({ plan, registry, occupiedOnHost, probeHostPort }))));
});
" '{planJson}' '{registryJson}'
```

This returns `{ hostByService: { <id>: host }, occupied: [host…], unresolved: [id…], corrected: [{id,declaredInternal,servingInternal,host}…] }` — `hostByService[id]` is the allocated primary host for a task-isolated service, and for a shared-reuse service the **published** host port read from its running container (`docker compose port`), which is not the same number as the registry's internal port: the registry records what the process listens on inside the container (`8080` for nearly every Jelou service), while the developer's container publishes it on a distinct host port (`8383`, `8229`, `8902`…). Reporting or injecting the internal port would point the whole frontend at one wrong port. Run this step only AFTER Step B, so every shared-reuse container is already up and its port is resolvable.

`occupied` includes every host port docker has published, not just this plan's allocations, so Step D cannot hand the frontend a port a leftover task container from another slug is already holding.

For each id in `unresolved`, warn: `⚠ <service>: no published host port answers — falling back to the internal port <n>, which is almost certainly not reachable from the host.` Treat an unresolved `frontend.envLocal` target as a boot failure rather than writing a wrong URL into the frontend `.env`.

For each entry in `corrected`, warn: `⚠ <service>: registry declares internal port <declaredInternal>, but the container serves on <servingInternal> (published <host>) — fix dev.ports in registry/services.yaml.` The map already carries the port that answers; the warning exists so the registry gets fixed instead of the mismatch being re-diagnosed every boot. Without the probe, `docker compose port` happily returns a mapping for a port nothing listens on, and the whole run reports a dead port as the service's address.

- If `green`: report each service as `<service>: http://localhost:<hostByService[service]>`.
- For each `down` service, surface its log before failing: task-isolated → the command implied by its `descriptor.readiness.logSource` (Step B); shared-reuse → `docker logs --tail 30 <resolved dev container id from Step B>`.

### Step C1 — Record booted task projects

Record the `mutations` the Step B runner returned — one per compose project it actually created. Do NOT re-derive them from `plan.services`: a `task-isolated` entry with a host launcher has no `projectName`, and recording it writes a `null` project that `/jlu:stop-dev` later tries to `compose down`. Shared-reuse services are not compose projects and record nothing (their reused container belongs to the developer).

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs').then((ss) => {
  const mutations = JSON.parse(process.argv[3]);
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  const runIdentity = { workspaceId: process.argv[1], taskSlug: process.argv[2], runId: process.argv[4] };
  let s = ss.readStackState(opts);
  for (const mutation of mutations) {
    s = ss.addProject(s, mutation.resource);
    s = ss.recordOwnedMutation(s, runIdentity, mutation);
  }
  ss.writeStackState(opts, s);
});
" "{workspaceId}" "{slug}" '{bootMutationsJson}' "{runId}"
```

`{bootMutationsJson}` is `JSON.stringify(bootResult.mutations)` from Step B.

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

When the normalized registry has `auth`, onboarding is required before login. Decide with the
registry resolved in Step A — the **normalized** one, never the raw `services.yaml`:

```bash
node -e "
import('{plugin-root}/bin/lib/registry/normalize.mjs').then(({ resolveProvisioningAdapter }) => {
  process.stdout.write(JSON.stringify(resolveProvisioningAdapter(JSON.parse(process.argv[1]))));
});
" '{normalizedRegistryJson}'
```

`required: false` → no auth block; skip to the frontend report. `ok: true` → use `adapter`.
`ok: false` → **stop** and print the returned `reason`. There are exactly two ways to fail here:

- **no `localProvisioningAdapter`** — `normalizeRegistry` defaults it to `plugin:local-jelou-provisioning`, so a normalized registry can never hit this. The bug is that an unnormalized registry reached this step; do NOT tell the user to register an adapter that is already defaulted.
- **no `local_database` block** — the adapter exists but has no target to prove. This gate is exactly why the check runs here: `proveLocalDatabaseTarget` refuses an unproven target, so without the block onboarding cannot start no matter what the adapter says. Tell the user to declare it in `registry/jelou-registry.yaml` and rerun `compile-registry.mjs`:

  ```yaml
  local_database:
      host: localhost
      port: 3306
      service: db
      dockerServiceId: dashboard-server
      composeProject: dashboard-server
      composeFile: docker-compose.yml
  ```

  `host`/`port` are enough for a loopback target; the `dockerServiceId`/`composeProject`/`composeFile`/`service` quartet is required only when the database is reached at a non-loopback host, so `proveLocalDatabaseTarget` can match it against a registered docker service.

On `ok: false` the run stops, and never skip into credential lookup. Read `localAuthProfile` from task stack state. A complete profile is offered for reuse; an incomplete profile requests only missing company or user fields; `--reconfigure` requests replacements for every selected field. Existing-company selection defaults to ID `135`. New-company plan choices are exactly `ENTERPRISE` and `SELF_SERVICE`.

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

The `auth` block and `hostByService` come from Step A and Step C. Resolve `loginUrl`, `verifyMfaUrl`, `cookieName`, `verifyUrls`, and `identityUrl` with `resolveAuthUrls`. Read `localAuthProfile` from the task stack state and stop if the profile or its `keyringIdentity` is missing. Credentials come only from `createOsKeyring`; do not read an environment credential file or place the password or cookie in arguments, environment variables, stdout, stderr, snapshots, traces, pane output, or reports.

Resolve Playwright from `registry.frontend.path` so the browser runtime is the one owned by `jelou-apps`. Launch Chromium and pass `createBrowserContext: () => browser.newContext()` into `establishAuthenticatedSession`. Pass the task state identity, the keyring-backed profile, the resolved dashboard login contract, every protected API URL, the resolved `identityUrl`, `appUrl: http://localhost:{frontendPort}/`, and `protectedPath: registry.frontend.protectedPath || '/home'`. `request` must be a `fetch` whose responses still expose `json()` — the authorization assertion in Step H reads the identity payload from that same response.

Pass `postJson` and `readOtpFromRedis(auth.otpFallback)` from `auth-runtime.mjs`, `request: fetch`, and an `onLifecycle` adapter that calls `appendLifecycleEvent(eventsLogPath({ workspaceId, slug }), { ...event, taskSlug: slug })`. Close Chromium in `finally`.

`establishAuthenticatedSession` first probes a stored task cookie. A valid cookie is reused without a credential lookup. A missing, expired, redirected, or rejected cookie permits exactly one keyring-backed login against the configured dashboard. Only a genuine `jelou_auth` response is eligible for verification and atomic `0600` persistence. Invalid credentials, a missing expected cookie, or a rejected refreshed cookie clears rejected task state, never injects the stale value, and returns the actionable `--reconfigure` failure.

### Step H — Verify protected browser and API access, then authorization

The session module injects the genuine cookie directly through the Playwright browser context for the `jelou-apps` origin. It requests every configured protected API with manual redirect handling, then opens the configured protected route. Authentication succeeds only when every API returns HTTP `200` and the final browser URL remains outside `/login`. The returned result contains status, source, API statuses, final URL, and permission count only; it never contains the password or cookie.

Authentication is not authorization. A session for an account with no roles answers every protected API with `200` and never redirects to `/login`, yet renders a fully greyed-out `jelou-apps` sidebar — the routes are built from `userSession.permissions`. So when `identityUrl` is resolved, the module also reads the permission set from that identity response and refuses the session before opening the browser: an empty set fails as `no-permissions`, a payload exposing no permission array at all fails as `identity-unreadable`. Neither is retried with a second login — a fresh login for the same account returns the same empty set — and both failures name the account so the fix is unambiguous. Never report a permission-less session as a green stack.

### Step I — Report the authenticated stack

Report whether the session source was `stored`, `login`, or `refreshed`, together with the protected API statuses, the final non-login route, and the permission count. Do not include request headers, browser storage, the keyring value, or the cookie file contents.

Whenever the auth steps do not finish green — blocked, skipped, or failed — the report MUST state the email of the account the stack expects (`localAuthProfile.user.email`) and warn that logging in manually with any other account renders the sidebar without permissions. Never leave the user with an open browser and no indication of which account to use.

### Step I.5 — Hand the verified session to a browser the user drives

Step G's Chromium is a verifier and is closed in `finally`. Without this step the run ends with
a genuine session on disk and none in any browser, so the next page the user opens redirects to
`/login`. Run this step ONLY when Step H finished green.

Build the handoff, which refuses anything that is not an already-verified genuine cookie:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/auth-cookie-state.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/browser-handoff.mjs')
]).then(([state, handoff]) => {
  const cookie = state.readAuthCookie({ workspaceId: process.argv[1], slug: process.argv[2] });
  const plan = handoff.planBrowserHandoff({
    cookie,
    appUrl: process.argv[3],
    account: process.argv[4],
    port: Number(process.argv[5]),
    sessionVerified: true,
    frontend: JSON.parse(process.argv[6])
  });
  process.stdout.write(JSON.stringify({ ok: plan.ok, reason: plan.reason, entryUrl: plan.entryUrl, sessionMarkers: plan.sessionMarkers, markerScript: plan.markerScript, probeScript: plan.probeScript }));
});
" "{workspaceId}" "{slug}" "http://localhost:{frontendPort}{protectedPath}" "{localAuthProfile.user.email}" "{handoffPort}" '{JSON.stringify(registry.frontend)}'
```

`handoffPort` is any free loopback port; it serves one page and is closed at the end of this step.

- `ok: false` with `no-genuine-cookie` → report that the session was verified but not persisted, and stop. Do not attempt a second login.
- `ok: true` → serve the page with `startInjectServer({ port: handoffPort, page: plan.page })`, then drive the browser.

Open `plan.entryUrl` through the Chrome MCP tools (`mcp__chrome-devtools__new_page`, then
`mcp__chrome-devtools__navigate_page`). **Open the `entryUrl` exactly as the plan returns it.**
It is built on `localhost`, not `127.0.0.1`: the injector page sets the cookie for the host in the
address bar, and a cookie set for `127.0.0.1` is not sent to `http://localhost:{frontendPort}`.
Substituting the loopback literal reintroduces the redirect this step exists to remove.

The page sets the cookie and redirects itself to `appUrl`.

**A cookie alone does not authenticate `jelou-apps`.** The app routes on a `localStorage` marker
(`isLogin`), and its own recovery branch reads `document.cookie` — which can never see the
httpOnly `jelou_auth`. So a run that stops at "the cookie is set" leaves a browser sitting on
`/login` while every protected API answers `200`. The marker is per-origin, so the injector page
(served on `localhost:{handoffPort}`) cannot write it for the app origin
(`localhost:{frontendPort}`); it has to be written in the app page itself, after the redirect:

1. Run `plan.markerScript` with `mcp__chrome-devtools__evaluate_script` on the app page. It sets
   every marker in `plan.sessionMarkers` and reloads, so the app re-routes with the session it now has.
2. Read the result with `mcp__chrome-devtools__evaluate_script` and `plan.probeScript`. It returns
   `{ url, storage }` — the app's own view of its session, not the orchestrator's.
3. Confirm with `handoffSucceeded({ finalUrl: result.url, sessionMarkers: plan.sessionMarkers, observedStorage: result.storage })`.

`handoffSucceeded` returns `{ ok, reason }`. `ok: false` means the session did NOT transfer:
`browser-on-login` (the app bounced back), `session-markers-missing:<keys>` (the marker did not
stick — usually a 401 from a protected API, whose axios interceptor clears `isLogin` on every
401), or `session-markers-unobserved` (you did not run the probe). Report it as a handoff failure
and say the verified session did not transfer; **never report the stack green on the strength of
Step H, or of the final URL alone.** A URL check by itself passes on an app that is about to
bounce back to `/login` one request later.

When the reason is `session-markers-missing`, the next thing to check is the peer wiring of the
API gateway: a `GRPC_*` variable carrying an `http://` URL or a service id that is not a docker
network alias makes the gateway's cookie guard fail closed, every `platform/v1/*` answer 401, and
the frontend clear its own session marker in a loop. The overlay generator addresses providers by
their compose `container_name` and strips the scheme from `GRPC_*` variables for exactly that reason.

Close the inject server in a `finally`, whatever the outcome. Leave the browser open — it is the
deliverable. Never print the cookie value, the page HTML, or the entry URL's query.

If the Chrome MCP tools are unavailable in this runtime, say so plainly and print `appUrl`
together with the expected account; do not silently fall back to a headless browser, which
leaves the user exactly as stranded as before.

### Notes — frontend + auth

- **Browser boundary.** Resolve Playwright through the `jelou-apps` checkout selected by the boot plan for Steps G and H. Do not substitute an HTML cookie injector or a globally installed browser package **for establishing or verifying the session** — its provenance must stay a genuine keyring-backed login. The injector is permitted only in Step I.5, which transfers an already-verified cookie and can never mint one.
- **OTP key mismatch (informational).** `bin/lib/api-login.mjs`'s own CLI path uses `mfa-code-<email>` as the Redis key, while this path reads the registry's `auth.otpFallback.keyPrefix` (`2fa-code-`), per `jelou-local-stack`. The configured E2E account has 2FA disabled, so the OTP branch is normally never exercised — if 2FA is ever armed on that account, confirm which key prefix the auth-service actually writes before trusting `readOtpFromRedis`.
