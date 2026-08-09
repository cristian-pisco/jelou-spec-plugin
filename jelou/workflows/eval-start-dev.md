# /jlu:eval-start-dev Workflow

> Purpose: decide whether `/jlu:start-dev --jelou-stack` would boot a given task **correctly**, not merely without crashing. Every check below exists because it once passed silently while the boot was wrong.

Inputs:
- `cwd`: the user's current working directory.
- `slug` (optional): the task slug. When absent, Step 0 asks whether to evaluate the main branches or a task.
- `--live` (optional): also perform a real boot and prove the static verdict.

Output: a PASS/FAIL table, one row per assertion, plus a findings list. This workflow **never edits the plugin or the registry** — it reports. Fixes are the user's call.

## The failure class this guards against

The boot plan is data-driven, so a wrong plan is indistinguishable from a right one at a glance: services come up, ports answer, logs look healthy, and the task's code is still not what is running. The assertions are ordered so the cheap structural ones fail first.

## Step 0 — Choose what to evaluate

Ask with `question` (single-choice): `"¿Qué quieres validar?"`

| Option | Meaning |
|---|---|
| `main branches` | Evaluate the stack as it boots with no task: every service on its canonical checkout, every policy `shared-reuse`, the frontend on `registry.frontend.path`. |
| `a task slug` | Evaluate the boot for one task: services with a worktree for that slug boot `task-isolated`. |

Skip this question **only** when the user already passed a slug as an argument — an explicit slug is an explicit choice. Never infer the mode from `cwd`.

On `main branches`, set `mode = 'main'` and `slug = '_global'`. On `a task slug`, set `mode = 'task'` and obtain the slug: resolve it from `cwd` with `resolveTaskSlug` (Step 1), and if that yields `AMBIGUOUS:` or nothing, ask the user for it with `question`, offering the resolvable slugs as options.

**Mode changes which assertions carry signal.** In `main` mode there are no task-isolated entries, so A1–A9 have nothing to assert and A10/A12 pass by construction. Do not print them as PASS — print them once as `N/A (main-branch mode)` and spend the report on what actually varies there: A0, A11, A13, A14 and the `unresolved` warnings. In `task` mode every row applies. Say which mode ran in the first line of the report; a GREEN in `main` mode says nothing about whether a task would boot correctly, and readers conflate the two.

## Step 1 — Resolve the workspace, slug and plan

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs').then(({ resolveWorkspace }) => {
  process.stdout.write(JSON.stringify(resolveWorkspace(process.argv[1])));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

Capture `{ root, workspaceId }`. If `NO_WORKSPACE`, stop: `No workspace root — nothing to evaluate.`

The slug is already fixed by Step 0. When Step 0 needs to resolve one from the working directory, this is the resolver:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs').then(({ resolveTaskSlug }) => {
  process.stdout.write(resolveTaskSlug({ workspaceRoot: process.argv[1], cwd: process.argv[2] }));
});
" "{root}" "{cwd}"
```

Then compile the registry and build the plan — both idempotent, neither mutates the developer's environment:

```bash
node {plugin-root}/bin/seed-registry.mjs --workspace {root}
node {plugin-root}/bin/compile-registry.mjs --workspace {root}
node {plugin-root}/bin/build-boot-plan.mjs --workspace {root} --slug {slug}
```

Capture the plan as `{planJson}` and the normalized registry (`readUnifiedRegistry({root})`) as `{registryJson}`. A non-zero exit from `build-boot-plan` is itself assertion **A0 FAIL** — report the cause (an unsafe teardown is the usual one) and stop.

Note any line `compile-registry: services.yaml declares dev blocks not present in jelou-registry.yaml (not booted): <ids>`. Those services are catalogued but never booted; if one of them has a worktree for this slug, that is finding **F-CATALOG-ONLY** — the task's code in that repo will not run.

## Step 2 — Static assertions

Run this pass and render its rows verbatim. It is pure analysis over the plan, the registry and the filesystem.

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/boot-engine/execute.mjs'),
  import('{plugin-root}/bin/lib/boot-engine/launcher.mjs'),
  import('node:fs')
]).then(([{ planEntryToCommands }, { startsDevOnUp, isContainerLauncher }, fs]) => {
  const plan = JSON.parse(process.argv[1]);
  const registry = JSON.parse(process.argv[2]);
  const slug = process.argv[3];
  const rows = [];
  const add = (id, ok, detail, level = 'FAIL') => rows.push({ id, level: ok ? 'PASS' : level, detail });
  const byId = Object.fromEntries(registry.services.map((s) => [s.id, s]));

  const isolated = plan.services.filter((e) => e.policy === 'task-isolated');
  add('A1 worktree->policy', isolated.every((e) => e.cwd.includes('/.worktrees/' + slug)),
    isolated.map((e) => e.id).join(',') || 'none');

  for (const s of registry.services) {
    const wt = s.path + '/.worktrees/' + slug;
    if (fs.existsSync(wt) && !isolated.some((e) => e.id === s.id)) add('A1 worktree->policy', false, s.id + ' has a worktree but boots shared-reuse');
  }

  add('A2 dns-safe names', isolated.every((e) => e.projectName.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\$/.test(e.projectName)),
    isolated.map((e) => e.projectName + '(' + e.projectName.length + ')').join(' '));

  add('A3 image reused', isolated.every((e) => e.imageResolved), isolated.filter((e) => !e.imageResolved).map((e) => e.id).join(',') || 'all resolved');

  for (const e of isolated) {
    const d = planEntryToCommands(e);
    const selfStarting = startsDevOnUp(e.launcher);
    add('A4 dev process started', selfStarting ? d.exec === null : Array.isArray(d.exec),
      e.id + ' launcher=' + e.launcher + (selfStarting ? ' (image CMD)' : ' (exec)'));
    const src = d.readiness.logSource || {};
    add('A5 readiness log source', selfStarting ? src.mode === 'docker-logs' : src.mode === 'exec-file',
      e.id + ' -> ' + src.mode);
    add('A6 install ordering', !(selfStarting && d.install && !d.restart),
      e.id + (d.install ? ' install=' + d.install.runs_in : ' install=none'));
    add('A7 deps provenance', !d.depsUnverified, e.id + ' source=' + (e.depsProvision && e.depsProvision.source), 'WARN');
    add('A8 container launcher', isContainerLauncher(e.launcher), e.id + ' launcher=' + e.launcher);
  }

  for (const e of isolated) {
    const declared = registry.services.filter((s) => Object.keys(s.peers || {}).includes(e.id)).map((s) => s.id);
    const undeclared = [];
    for (const s of registry.services) {
      if (Object.keys(s.peers || {}).includes(e.id)) continue;
      let env = '';
      try { env = fs.readFileSync(s.path + '/.env', 'utf8'); } catch { continue; }
      const hit = env.split('\n').map((l) => l.split('=')[0].trim())
        .filter((k) => k && new RegExp(e.id.replace(/-service\$/, '').replace(/-/g, '[_-]?'), 'i').test(k));
      if (hit.length) undeclared.push(s.id + ':' + hit.join('/'));
    }
    add('A9 peer wiring', declared.length > 0 && undeclared.length === 0,
      e.id + ' declared-by=[' + declared.join(',') + '] undeclared-candidates=[' + undeclared.join(' ') + ']');
  }

  const f = plan.frontend;
  if (f) {
    const wt = f.canonicalPath + '/.worktrees/' + slug;
    add('A10 frontend worktree', !fs.existsSync(wt) || f.isWorktree, 'path=' + f.path);
    add('A11 frontend env seed', !!f.envSeed && fs.existsSync(f.envSeed), 'seed=' + f.envSeed);
    add('A12 frontend deps', !f.isWorktree || f.depsPresent, 'depsPresent=' + f.depsPresent);
  }

  process.stdout.write(JSON.stringify(rows));
});
" '{planJson}' '{registryJson}' '{slug}'
```

What each row means when it FAILs:

| Row | Failure means |
|---|---|
| A1 | A repo has the task's code in a worktree but boots the canonical checkout — the task's changes are not running. |
| A2 | `<serviceId>-<slug>` exceeds the 63-char DNS label limit or is otherwise not a legal label. The container boots and its host port answers, but **no peer can resolve it** and `wiredEnv` writes that unresolvable host into their `.env`. This is the single most deceptive failure in the whole path. |
| A3 | The base image is missing, so the boot would build one. Report as a local setup precondition; never auto-build. |
| A4 | Nothing will start the dev command (an idle container with no exec), or a command is exec'd into a container that already runs one. |
| A5 | Readiness would poll a log that nothing writes — the service is reported `down` at timeout even though it is serving. |
| A6 | A self-starting container installs dependencies after its CMD already ran; without a restart the process keeps the pre-install dependency tree. |
| A7 | Dependencies resolve from the base image, not the branch's lockfile. Advisory, not fatal: WARN and tell the user to rebuild the base image if the service misbehaves. |
| A8 | A host-launcher service was granted a container-only policy. |
| A9 | Either nobody declares this service as a peer (so no caller is rewired to the task container — it boots and receives no traffic), or a caller has an env var that looks like this service's URL but is not declared in `peers`, in which case the rewrite silently no-ops. Cross-check the candidate against the caller's source before calling it a defect. |
| A10 | Same as A1, for the frontend. Vite would serve main-branch code. |
| A11 | The frontend `.env` would be written from nothing, dropping every variable the developer has locally. |
| A12 | The worktree has no `node_modules`; Vite cannot start there. Tell the user to install; never install for them. |

## Step 3 — Published-port assertions

The registry records **internal** ports; the developer's containers publish them on different host ports. Resolve and check:

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
  const r = hostByService({ plan, registry, occupiedOnHost });
  const targets = Object.values((plan.frontend && plan.frontend.envLocal) || {}).map((v) => v.service);
  process.stdout.write(JSON.stringify({
    hostByService: r.hostByService,
    unresolved: r.unresolved,
    frontendTargetsUnresolved: targets.filter((t) => r.unresolved.includes(t)),
    collisions: Object.entries(r.hostByService).filter(([, p]) => occupiedOnHost.includes(p) === false && p < 1024)
  }));
});
" '{planJson}' '{registryJson}'
```

- **A13 frontend targets reachable** — FAIL if `frontendTargetsUnresolved` is non-empty. Those containers are not running, so the frontend `.env` would be written with internal ports (`8080` for nearly every Jelou service) and the whole UI would talk to the wrong place. The fix is to start those containers, not to change the plan.
- **A14 no duplicate hosts** — FAIL if two different services map to the same host port. That is the signature of the internal-port fallback.
- For every other id in `unresolved`, emit a WARN row; a non-frontend service that is simply not running is a legitimate state.

## Step 4 — Live proof (`--live` only)

Without `--live`, stop here and report. The static pass catches every failure class above except a genuinely broken image or app.

In `main` mode, `--live` has no task-isolated entry to boot: L1–L4 are N/A, and L5 would start the frontend from the canonical checkout, rewriting the developer's real `.env`. Confirm that with `question` before touching it — in `task` mode the rewrite lands on a disposable worktree, here it does not. L6 still applies in full.

With `--live` in `task` mode, for **each task-isolated entry**, in order:

1. Write `descriptor.files[]`, run `docker <descriptor.up>` from `descriptor.cwd`.
2. Poll `descriptor.readiness` through `descriptor.readiness.logSource` — `docker logs --tail 200 <container>` or `docker exec <container> tail -n 200 <path>`. **L1 readiness** = the pattern appeared within `ready_timeout_s`.
3. **L2 host port** — `curl` the allocated primary host port. Any HTTP answer counts; a connection refusal does not.
4. **L3 bind mount is the worktree** — `docker inspect <container> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'` must show the worktree path bound at the code target. This is the assertion that proves the task's code is what is running; nothing else does. (`git -C /app rev-parse` does **not** work inside a worktree mount — a worktree's `.git` is a file pointing outside the mount.)
5. **L4 peer DNS** — from a *different* container on the same network, fetch `http://<projectName>:<internalPort>/`. Resolution failure here with L2 passing is exactly the A2 failure, and it is why A2 exists.

Then the frontend, if `plan.frontend.isWorktree`:

6. Back up `plan.frontend.path/<envFile>`, rewrite it with `rewriteFrontendEnv` using the Step 3 `hostByService`, and confirm each `envLocal` key resolved to a **distinct, published** port.
7. **L5 frontend serves** — start `plan.frontend.command --port <allocated> --strictPort` from `plan.frontend.path`, poll until it answers HTTP. Vite's first compile in a fresh worktree takes 30–90s.

Finally **L6 teardown is clean** — `docker compose -p <projectName> down` for each entry, restore every `.env` from its backup, remove each `docker-compose.jlu.yml` the boot wrote into a worktree, kill the Vite process **by the PID captured at launch or by the one holding its port**, then assert no container matching the slug survives, no `.env` is left rewritten and the worktrees are `git status` clean. A boot that cannot be undone is a failed boot.

Never kill the frontend with `pkill -f "<its command>"`: the pattern matches the very shell running the `pkill`, so the audit kills itself mid-teardown and leaves the containers up. Match on the port or the recorded PID.

Report which sibling compose services came up alongside the primary one. The override targets only `dev.docker.service`, so any sibling in the same compose file is created **without** the pinned image and will be rebuilt — note it as **F-SIBLING-REBUILD** with the sibling names.

## Step 5 — Report

Open with the mode and its target: `main branches` (and that no task code is under test) or `task <slug>` (and which repos have a worktree for it). Then print the assertion table (id, PASS/FAIL/WARN/N-A, detail), then a findings section: one entry per FAIL with what it would look like at runtime if shipped, and one per WARN. Close with a one-line verdict:

- **GREEN** — every assertion passed; `/jlu-start-dev --jelou-stack` will boot this task correctly.
- **GREEN WITH WARNINGS** — no FAIL, some WARN; safe to boot, list what to watch.
- **RED** — at least one FAIL; state plainly what would silently be wrong, and do not recommend booting until it is fixed.

Never repair anything as part of this workflow. Reporting and fixing are separate acts, and a repair made mid-audit invalidates the audit.
