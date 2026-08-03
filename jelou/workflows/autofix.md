# /jlu:autofix Workflow

> Purpose: a bounded, opt-in auto-fix loop for one failing service in the task-aware Jelou-stack (the `--jelou-stack` boot). The orchestrator owns the loop — evidence, diagnose, apply, decide, verify — and dispatches exactly ONE fix per attempt. It NEVER silently gives up: low diagnostic confidence, a dirty main checkout, a blocking fix-agent status, a repeated hunk, or an exhausted attempt budget all end in an explicit escalation to the user, never a quiet stop.

Inputs:
- `argument`: required service name (must be registered in the unified registry — `registry.services[].id`).
- `cwd`: the user's current working directory.

**Resolve the plugin root before the first step.** Steps below run a `bin/*.mjs` script. Derive it
per `jelou/references/plugin-root.md`: this file lives at `<root>/jelou/workflows/autofix.md`, so the
plugin root is the directory **two levels above it**. Substitute that absolute path wherever this
workflow writes `<plugin-root>` or `{plugin-root}`. Never fall back to `$PLUGIN_ROOT`, which no
runtime exports.

## Step 1 — Resolve workspace, slug, registry, and the target service

Ensure the unified registry exists and is compiled for this workspace (idempotent), then read it — the same Step A pattern as `/jlu:start-dev --jelou-stack`:

```bash
node {plugin-root}/bin/seed-registry.mjs --workspace {root}
node {plugin-root}/bin/compile-registry.mjs --workspace {root}
```

Resolve the workspace, slug, config, and registry:

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
  const cfg = c.readConfig(ws.configPath);
  const registry = r.readUnifiedRegistry(ws.root);
  process.stdout.write(JSON.stringify({ ws, slug, cfg, registry }));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

If `slug` starts with `AMBIGUOUS:`, prompt via `question` exactly as `/jlu:start-dev` Step 2 does.

**Resolve the target service.** `registryEntry = registry.services.find(s => s.id === argument)`. If not found, stop with:

> `Service '{argument}' is not registered in the unified registry. /jlu:autofix only operates on the task-aware Jelou-stack (--jelou-stack boot). Registered services: <comma-joined registry.services ids>.`

**Build `worktreePaths`.** Same rule as `/jlu:start-dev`'s Step A: for every `registry.services` entry, check whether `<service.path>/.worktrees/<slug>` exists; if so, map `worktreePaths[service.id]` to that absolute path. Services with no worktree for this slug are omitted.

**Build the boot `plan`** (the same plan `/jlu:start-dev --jelou-stack` builds, computed fresh here since autofix runs as its own command invocation):

```bash
node {plugin-root}/bin/build-boot-plan.mjs --workspace {root} --slug {slug}
```

Capture it as `{planJson}`. `entry = plan.services.find(e => e.id === argument)` — a common `{ id, cwd, command, readiness, policy, wiredEnv }` plus, when `policy === 'task-isolated'`, `{ projectName, composeFile, ports, overrideYaml }`. This `entry` is reused, unchanged, for every attempt of the loop below.

**Build the target's observer entry** (drives Evidence 2a + the Verify observer pass). Start from `observerPlanFromBootPlan(plan)`, take the target's entry, and — when it is `shared-reuse` — resolve its running dev container id and set it as `container`:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/observer-plan.mjs').then(({ observerPlanFromBootPlan }) => {
  const plan = JSON.parse(process.argv[1]);
  const target = observerPlanFromBootPlan(plan).find((e) => e.name === process.argv[2]);
  process.stdout.write(JSON.stringify(target));
});
" '{planJson}' "{argument}"
```

If the target `observerEntry.policy === 'shared-reuse'`, resolve its dev container id with `docker compose -f <registryEntry.dev.docker.compose_file> ps -q <registryEntry.dev.docker.service>` (run in `entry.cwd`) and set `observerEntry.container` to it. If that resolves empty → **ESCALATE**: `Could not resolve {argument}'s running dev container — is the stack booted? Run /jlu:start-dev --jelou-stack first.` and stop.

**Compute the target's reachable host** (for readiness polling in Verify):

```bash
node -e "
import('{plugin-root}/bin/lib/boot-engine/host-map.mjs').then(({ hostByService }) => {
  const out = hostByService({ plan: JSON.parse(process.argv[1]), registry: JSON.parse(process.argv[2]) });
  process.stdout.write(String(out.hostByService[process.argv[3]]));
});
" '{planJson}' '{registryJson}' "{argument}"
```

Call this `{targetHost}`.

**Adapt the registry entry into the shape `diagnose.mjs` and `fix-target.mjs` expect.** These libraries were built against a service schema with `runtime.type`/`depends_on`; every unified-registry service is a Docker container, so synthesize:

```js
const serviceForDiagnose = {
  name: registryEntry.id,
  path: registryEntry.path,
  depends_on: Object.keys(registryEntry.peers || {}),
  readiness: registryEntry.dev.ready_signal,
  runtime: { type: 'docker-compose', compose_file: registryEntry.dev.docker.compose_file, compose_service: registryEntry.dev.docker.service },
  log_failure_patterns: []
};
const allServicesForDiagnose = registry.services.map((s) => ({
  name: s.id,
  path: s.path,
  readiness: s.dev.ready_signal,
  runtime: { type: 'docker-compose', compose_file: s.dev.docker.compose_file, compose_service: s.dev.docker.service }
}));
```

If the service is not in `cfg.services` (`jlu-services.json`), that is expected and fine — `serviceForDiagnose` above is self-sufficient; `cfg` is only used for `effectiveDefaults`/`effectiveFailurePatterns` (poll interval, readiness timeout, cooldown, global failure patterns).

## Step 2 — The bounded loop

`maxAttempts = 3`, `priorHunks = []`. For `attempt` in `1..maxAttempts`:

### 2a — Evidence

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ readRecentEvents }) => {
  const events = readRecentEvents({ logPath: process.argv[1], service: process.argv[2], limit: 50 });
  process.stdout.write(JSON.stringify(events));
});
" "{eventsLogPath}" "{argument}"
```

`eventsLogPath` is `eventsLogPath({ workspaceId: ws.workspaceId, slug })` from `state-daemon.mjs`.

Fresh capture, merging stdout and stderr into one text blob for the diagnoser. The log source is the target's `observerEntry` from Step 1 — task-isolated tails `/tmp/<projectName>.dev.log` via `docker exec`; shared-reuse reads `docker logs <container>`:

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

### 2b — Diagnose

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ buildDiagnoseInput }) => {
  const input = buildDiagnoseInput({
    service: JSON.parse(process.argv[1]),
    events: JSON.parse(process.argv[2]),
    capture: process.argv[3],
    allServices: JSON.parse(process.argv[4]),
    os: process.platform,
    workspaceRoot: process.argv[5]
  });
  process.stdout.write(JSON.stringify(input));
});
" '{serviceForDiagnoseJson}' '{eventsJson}' "{capture}" '{allServicesForDiagnoseJson}' "{root}"
```

Dispatch `Agent` with `subagent_type: "jlu:jlu-dev-diagnoser"` (retry once with the bare `jlu-dev-diagnoser` if unregistered), passing the input JSON as the prompt. Capture the raw response, then:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ parseDiagnoseOutput }) => {
  process.stdout.write(JSON.stringify(parseDiagnoseOutput(process.argv[1])));
});
" '{agent-raw-output}'
```

If the parse throws, **ESCALATE**: `Diagnoser returned malformed output. Raw: <first 200 chars>` and stop.

If `diagnosis.confidence === 'low'` OR `diagnosis.proposed_fix == null` → **ESCALATE**: print `cause`, `evidence`, and `alternative_fixes`, then stop the whole command (not just this attempt).

### 2c — Apply

Branch on `diagnosis.proposed_fix.runs_in`. The two branches diverge at Decide — read both before implementing either.

**Container fix branch** (`runs_in === 'container'`):

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ substituteFix }) => {
  const out = substituteFix({ service: JSON.parse(process.argv[1]), fix: JSON.parse(process.argv[2]) });
  process.stdout.write(out === null ? 'NULL' : out);
});
" '{serviceForDiagnoseJson}' '{proposedFixJson}'
```

If the output is `NULL` → **ESCALATE**: `Agent proposed a host fix for a containerized service. Manual review recommended.` and stop. Otherwise run the substituted command via `Bash` with working directory `{entry.cwd}` (so a relative `compose_file` resolves correctly). Capture stdout, stderr, and the exit code.

This branch never produces a `STATUS:` line — the substituted command is raw shell output, not an implementer response — so it skips Decide's STATUS parse entirely:
- Exit code non-zero → **ESCALATE**: `Container fix command failed (exit <code>): <captured stdout+stderr>` and stop.
- Exit code 0 → go DIRECTLY to **Verify (2e)**, bypassing `parseFixStatus`, the same-hunk-twice check, and `nextAction` (there is no `STATUS:` line and no `hunk_hash` to extract).

**Code fix branch** (`runs_in !== 'container'`, dispatched to `jlu-implementer`):

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/fix-target.mjs').then(({ resolveFixTarget }) => {
  const target = resolveFixTarget({ service: process.argv[1], worktreePaths: JSON.parse(process.argv[2]), repoPath: process.argv[3] });
  process.stdout.write(JSON.stringify(target));
});
" "{argument}" '{worktreePathsJson}' "{stackEntry.path}"
```

If `target.needsCleanGuard` is true, run the clean-tree check via `Bash`, using the canonical porcelain args from `gitStatusPorcelainArgs()` (`stack/clean-tree.mjs`) rather than inlining flags — `git -C {target.path} <gitStatusPorcelainArgs() joined with spaces>` (i.e. `git -C {target.path} status --porcelain`) — then:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/clean-tree.mjs').then(({ isCleanTree }) => {
  process.stdout.write(isCleanTree(process.argv[1]) ? 'CLEAN' : 'DIRTY');
});
" "{porcelainOutput}"
```

If `DIRTY` → **ESCALATE**: `{argument}'s main checkout at {target.path} has uncommitted changes — won't edit a dirty main checkout. Commit or stash first.` and stop.

Otherwise dispatch `Agent` with `subagent_type: "jlu:jlu-implementer"` (retry once with the bare `jlu-implementer` if unregistered). Constrain the prompt to `{target.path}` and include:
- The diagnosis (`cause`, `evidence`, `proposed_fix`).
- Any prior attempts on this same service this run (file + hunk_hash from `priorHunks`), so the implementer avoids repeating a dead-end edit.
- The instruction: make exactly ONE atomic edit to fix `<cause>`, confined to `{target.path}`, no line-by-line comments, and return a final line following the fix-loop STATUS contract (`agents/jlu-ui-fix-loop.md`) — `STATUS: DONE — file=<path> hunk_hash=<hash> ...` (or `DONE_WITH_CONCERNS` / `BLOCKED reason=...` / `flagged reason=...`), including a `hunk_hash` computed as the SHA-1 of `<file>|<start line>|<replaced text>`.

Capture the final `STATUS:` line, then proceed to **Decide (2d)** — only this branch runs Decide.

### 2d — Decide (code-fix branch only)

The container-fix branch never reaches this step — it already resolved to Verify or Escalate in 2c.

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/fix-status.mjs').then(({ parseFixStatus, nextAction }) => {
  const parsed = parseFixStatus(process.argv[1]);
  const action = nextAction({ status: parsed.status, attempt: Number(process.argv[2]), maxAttempts: Number(process.argv[3]) });
  process.stdout.write(JSON.stringify({ ...parsed, action }));
});
" "{statusLine}" "{attempt}" "{maxAttempts}"
```

Extract `hunk_hash` from `{statusLine}` (`/hunk_hash=([A-Za-z0-9]+)/`). If it is present and already in `priorHunks` → **ESCALATE**: `Same hunk edited twice ({hunk_hash}) — the implementer is repeating a dead-end fix.` and stop. Otherwise push it onto `priorHunks`.

If `action === 'escalate'` → **ESCALATE**: surface `status` and `reason` (and any `details=` in `{statusLine}`) and stop — this covers any non-`DONE`/`DONE_WITH_CONCERNS` status (`BLOCKED`, `flagged`, `NEEDS_CONTEXT`, `UNKNOWN`), regardless of which attempt this is.

If `action === 'rerun'` → proceed to Verify — a `DONE`/`DONE_WITH_CONCERNS` status always goes to Verify, on any attempt including the last; the attempt budget is enforced by the Step 2 loop itself (Step 3), not by this decision.

### 2e — Verify

Restart the target, per its policy:
- **task-isolated** (`entry.policy === 'task-isolated'`): `docker exec -d {entry.projectName} sh -lc "cd /app && {entry.command} > /tmp/{entry.projectName}.dev.log 2>&1"`.
- **shared-reuse**: `docker compose -f {registryEntry.dev.docker.compose_file} restart {registryEntry.dev.docker.service}`, run with working directory `{entry.cwd}`. This restarts the developer's container (re-running its entrypoint) — it does NOT re-exec a second dev process, and `docker logs <container>` stays the evidence source.

Wait briefly (a few seconds) for the process to come back up, then run exactly one observer pass scoped to this service, using the target's `observerEntry` (so the log source matches its policy) with a throwaway cooldown/capture state (this confirmatory pass is not the background F3-a observer):

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/observer-runtime.mjs').then(({ runObserverPass, Cooldown }) => {
  const plan = [JSON.parse(process.argv[1])];
  const config = JSON.parse(process.argv[2]);
  runObserverPass({
    plan, config,
    workspaceId: process.argv[3], slug: process.argv[4],
    cooldown: Cooldown(0), prevCaptures: {}
  });
});
" '{observerEntryJson}' '{cfgJson}' "{ws.workspaceId}" "{slug}"
```

Compare `readRecentEvents({ logPath: eventsLogPath, service: argument, limit: 50 })` taken right before this pass against the same call taken right after — if a new `pattern_match` entry was appended, the service is still failing.

Then check readiness. Build the poll URL from the target's readiness + host:

```bash
node -e "
import('{plugin-root}/bin/lib/boot-engine/readiness-target.mjs').then(({ readinessPollUrl }) => {
  const url = readinessPollUrl({ readiness: JSON.parse(process.argv[1]), host: Number(process.argv[2]) });
  process.stdout.write(url === null ? 'NONE' : url);
});
" '{entry.readinessJson}' "{targetHost}"
```

If the output is a URL, poll it for up to `effectiveDefaults(cfg).readiness_timeout_seconds` seconds (a `200` — or any answer for a `port_open` — is green). If the output is `NONE` (a `stdout_match` readiness), the observer pass above IS the readiness check — no URL poll is needed.

If NO new `pattern_match` for the service AND (readiness polled green OR readiness was `NONE`) → **report DONE**: `Fixed {argument} in {attempt} attempt(s).` List every applied change (file/command per attempt) and stop — this is the only success exit.

Otherwise, continue to the next `attempt` (loop back to Evidence with the freshly restarted container's state).

## Step 3 — Loop exhausted

If the loop finishes all `maxAttempts` attempts without a verified fix — every attempt reached Verify (2e) and Verify still failed each time — → **ESCALATE**: summarize every attempt (diagnosis cause + what was applied + why verify still failed, where known), print the last diagnosis in full, and suggest `/jlu-diagnose {argument}` for manual follow-up.

## Notes

- This is an opt-in, unattended loop — it applies fixes without a per-fix confirmation prompt (unlike `/jlu-diagnose`, which always gates on `question`). The trade is bounded, always-escalating behavior: low confidence, a dirty main tree, any blocking/flagged/needs-context STATUS, a repeated hunk, or an exhausted attempt budget always escalate to the user — the loop never silently gives up and never silently declares success without a verify pass.
- Never print secrets. The evidence capture is raw container log/log-tail text and may occasionally echo an environment value; redact anything that looks like a credential, token, or cookie before printing capture excerpts to the user. Never print `.env` contents.
- `/jlu:autofix <service>` is always available as a manual, on-demand command — see `jelou/workflows/start-dev.md`'s `--auto-fix` flag for how the observer can invoke this workflow automatically after a `pattern_match`.
- Use `/jlu-autofix` in messages.
