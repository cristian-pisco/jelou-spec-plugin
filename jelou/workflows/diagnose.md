# /jlu:diagnose Workflow

> Purpose: Read recent failure events and a pane capture for one service; dispatch the diagnoser agent; surface a fix proposal that the user can confirm to run.

Inputs:
- `argument`: optional service name. If omitted, prompt with services that have recent events.

## Step 1 — Resolve workspace + slug + config + registry

`/jlu-diagnose` serves both boot paths, so it resolves both sources up front: `jlu-services.json` (`cfg.services`, the deprecated tmux path) and the per-workspace unified registry (`registry.services`, the `--jelou-stack` path, which never touches tmux). `/jlu:start-dev --jelou-stack` and `/jlu:autofix` both route the user here for registry services, so a missing tmux window must never be a hard stop for one of them.

```bash
node {plugin-root}/bin/seed-registry.mjs --workspace {root}
node {plugin-root}/bin/compile-registry.mjs --workspace {root}
```

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs'),
  import('{plugin-root}/bin/lib/registry/read.mjs')
]).then(([w, t, c, r]) => {
  const ws = w.resolveWorkspace(process.argv[1]);
  const slug = t.resolveTaskSlug({ workspaceRoot: ws.root, cwd: process.argv[1] });
  let cfg = { services: [] };
  try { cfg = c.readConfig(ws.configPath); } catch {}
  let registry = { services: [] };
  try { registry = r.readUnifiedRegistry(ws.root); } catch {}
  process.stdout.write(JSON.stringify({ ws, slug, cfg, registry }));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

If `slug` starts with `AMBIGUOUS:`, prompt via `question` exactly as `/jlu:start-dev` Step 2 does.

## Step 2 — Pick the service, then its source

If `argument` is provided and matches a service in either source, use it.

Otherwise read the events log (path computed from `state-daemon.eventsLogPath`), group events by service, present services with at least one `pane_dead`/`pattern_match`/`readiness_failed` in the last 50 events as multi-choice via `question`. If none, exit with `No recent failures. Try /jlu:logs <service> to inspect manually.`

Then decide the **source branch** for the selected service and carry it through Steps 3, 4, and 7:

- **`cfg` branch** — `cfg.services.find(s => s.name === service)` matched. Use the tmux path (Step 3a / Step 4a).
- **`registry` branch** — no `cfg` match but `registryEntry = registry.services.find(s => s.id === service)` matched. Use the container path (Step 3b / Step 4b).
- Neither matched: stop with `Service '{service}' is in neither jlu-services.json nor the unified registry.`

When the service appears in both, prefer the `cfg` branch only if a live tmux window exists for `{slug}`; otherwise fall through to the `registry` branch.

## Step 3 — Capture the evidence

### Step 3a — `cfg` branch: capture the pane

Find the window via `findWindow`, the pane by title (matches `service.panel.title || service.name`), then capture the last 100 lines via the tmux wrapper.

If the window doesn't exist, surface: `No active jlu-dev window for slug '{slug}'. Run /jlu:start-dev first.`

### Step 3b — `registry` branch: capture the container logs

Mirrors `/jlu:autofix` Steps 1–2a — same plan, same observer entry, same log source. Build the boot plan and take the target's observer entry:

```bash
node {plugin-root}/bin/build-boot-plan.mjs --workspace {root} --slug {slug}
```

Capture it as `{planJson}`, then:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/observer-plan.mjs').then(({ observerPlanFromBootPlan }) => {
  const plan = JSON.parse(process.argv[1]);
  const target = observerPlanFromBootPlan(plan).find((e) => e.name === process.argv[2]);
  process.stdout.write(JSON.stringify(target));
});
" '{planJson}' "{service}"
```

If the target `observerEntry.policy === 'shared-reuse'`, resolve its dev container id with `docker compose -f <registryEntry.dev.docker.compose_file> ps -q <registryEntry.dev.docker.service>` (run in the plan entry's `cwd`) and set `observerEntry.container` to it. If that resolves empty, surface `Could not resolve {service}'s running dev container — is the stack booted? Run /jlu:start-dev --jelou-stack first.` and stop.

Fresh capture, merging stdout and stderr into one text blob — task-isolated tails the dev log inside the container, shared-reuse reads `docker logs`:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/observer-source.mjs').then(({ logSourceArgs }) => {
  const { spawnSync } = require('node:child_process');
  const args = logSourceArgs(JSON.parse(process.argv[1]));
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  process.stdout.write((r.stdout || '') + (r.stderr || ''));
});
" '{observerEntryJson}'
```

Never print `.env` contents, and redact anything in the capture that looks like a credential, token, or cookie before showing excerpts to the user.

## Step 4 — Build agent input

### Step 4a — `cfg` branch

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ readRecentEvents, buildDiagnoseInput }) => {
  const cfg = JSON.parse(process.argv[3]);
  const service = (cfg.services || []).find(s => s.name === process.argv[2]);
  const events = readRecentEvents({ logPath: process.argv[1], service: process.argv[2] });
  const input = buildDiagnoseInput({
    service, events, capture: process.argv[4],
    allServices: cfg.services, os: process.platform, workspaceRoot: process.argv[5]
  });
  process.stdout.write(JSON.stringify(input));
});
" "{logPath}" "{service}" '{cfg-json}' "{capture}" "{root}"
```

### Step 4b — `registry` branch

`diagnose.mjs` was built against the `jlu-services.json` schema (`runtime.type`/`depends_on`), so synthesize that shape from the registry entry — the same adaptation `/jlu:autofix` Step 1 performs. Every unified-registry service is a Docker container:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ readRecentEvents, buildDiagnoseInput }) => {
  const registry = JSON.parse(process.argv[3]);
  const adapt = (s) => ({
    name: s.id,
    path: s.path,
    depends_on: Object.keys(s.peers || {}),
    readiness: s.dev.ready_signal,
    runtime: { type: 'docker-compose', compose_file: s.dev.docker.compose_file, compose_service: s.dev.docker.service },
    log_failure_patterns: []
  });
  const service = adapt(registry.services.find(s => s.id === process.argv[2]));
  const events = readRecentEvents({ logPath: process.argv[1], service: process.argv[2] });
  const input = buildDiagnoseInput({
    service, events, capture: process.argv[4],
    allServices: registry.services.map(adapt), os: process.platform, workspaceRoot: process.argv[5]
  });
  process.stdout.write(JSON.stringify(input));
});
" "{logPath}" "{service}" '{registry-json}' "{capture}" "{root}"
```

A registry service absent from `cfg.services` is expected and fine — the synthesized entry is self-sufficient; `cfg` only supplies `effectiveDefaults`/`effectiveFailurePatterns` (poll interval, readiness timeout, cooldown, global failure patterns).

## Step 5 — Dispatch the diagnoser agent

Use `task` (OpenCode) / `Agent` (Claude Code) to invoke `jlu-dev-diagnoser` with the input from Step 4 as the prompt body. Capture the response string.

Then parse it:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ parseDiagnoseOutput }) => {
  const out = parseDiagnoseOutput(process.argv[1]);
  process.stdout.write(JSON.stringify(out));
});
" '{agent-raw-output}'
```

If the parse throws, surface: `Diagnoser returned malformed output. Raw: <first 200 chars>` and stop.

## Step 6 — Present the diagnosis

Print the cause, confidence, and evidence list.

If `proposed_fix` is null (low confidence), list `alternative_fixes` and stop.

Otherwise, display the substituted command (via `substituteFix`), where it runs (host or container), and the rationale.

Use `question` (single-choice): `"Run this fix?"` — options: `run` / `show` (just print and exit) / `skip`.

## Step 7 — Run the fix

If `run`, substitute the fix against the same service object Step 4 built for the active branch — `cfg.services` on the `cfg` branch, the synthesized registry entry on the `registry` branch:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ substituteFix }) => {
  const service = JSON.parse(process.argv[1]);
  const fix = JSON.parse(process.argv[2]);
  process.stdout.write(substituteFix({ service, fix }));
});
" '{service-json}' '{fix-json}'
```

Run the resulting shell command via `Bash`. Capture stdout/stderr, surface to the user.

After the fix runs:

- **`cfg` branch**: ask via `question`: `"Restart the pane to apply?"` — yes / no. If yes, send Ctrl+C followed by the original command via tmux send-keys.
- **`registry` branch**: there is no pane. Ask via `question`: `"Restart the container to apply?"` — yes / no. If yes, restart it the way its policy dictates — `docker restart <observerEntry.container>` for `shared-reuse`, and for `task-isolated` re-run the plan entry's descriptor `exec`/`restart` per the `## Plan-driven boot` contract in `jelou/references/env-lifecycle.md`. Then re-poll the entry's readiness.

## Step 8 — Offer to register the pattern

Only on the `cfg` branch: if `register_pattern` is non-null and not already in the service's `log_failure_patterns`, ask via `question`: `"Register pattern '<regex>' for future detection?"` — yes / no.

If yes, invoke `/jlu:add-failure-pattern` semantics inline.

On the `registry` branch, skip this step — unified-registry services carry no `log_failure_patterns` of their own; report the suggested pattern to the user instead.

## Notes

- Use `/jlu-diagnose` in messages.
- The diagnoser agent must NEVER bypass the user's confirmation gate. The orchestrator runs the fix only after the user picks `run`.
- If `runtime.type === "docker-compose"` and the agent's `proposed_fix.runs_in` is "host", surface the inconsistency to the user with `Agent proposed a host fix for a containerized service. Manual review recommended.` and skip the auto-run.
