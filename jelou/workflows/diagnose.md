# /jlu:diagnose Workflow

> Purpose: Read recent failure events and a pane capture for one service; dispatch the diagnoser agent; surface a fix proposal that the user can confirm to run.

Inputs:
- `argument`: optional service name. If omitted, prompt with services that have recent events.

## Step 1 — Resolve workspace + slug + config

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs')
]).then(([w, t, c]) => {
  const ws = w.resolveWorkspace(process.argv[1]);
  const slug = t.resolveTaskSlug({ workspaceRoot: ws.root, cwd: process.argv[1] });
  const cfg = c.readConfig(ws.configPath);
  process.stdout.write(JSON.stringify({ ws, slug, cfg }));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

## Step 2 — Pick the service

If `argument` is provided and matches a service, use it.

Otherwise read the events log (path computed from `state-daemon.eventsLogPath`), group events by service, present services with at least one `pane_dead`/`pattern_match`/`readiness_failed` in the last 50 events as multi-choice via `question`. If none, exit with `No recent failures. Try /jlu:logs <service> to inspect manually.`

## Step 3 — Capture the pane

Find the window via `findWindow`, the pane by title (matches `service.panel.title || service.name`), then capture the last 100 lines via the tmux wrapper.

If the window doesn't exist, surface: `No active jlu-dev window for slug '{slug}'. Run /jlu:start-dev first.`

## Step 4 — Build agent input

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

If `run`:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ substituteFix }) => {
  const cfg = JSON.parse(process.argv[1]);
  const service = cfg.services.find(s => s.name === process.argv[2]);
  const fix = JSON.parse(process.argv[3]);
  process.stdout.write(substituteFix({ service, fix }));
});
" '{cfg-json}' "{service}" '{fix-json}'
```

Run the resulting shell command via `Bash`. Capture stdout/stderr, surface to the user.

After the fix runs, ask via `question`: `"Restart the pane to apply?"` — yes / no.
If yes, send Ctrl+C followed by the original command via tmux send-keys.

## Step 8 — Offer to register the pattern

If `register_pattern` is non-null and not already in the service's `log_failure_patterns`, ask via `question`: `"Register pattern '<regex>' for future detection?"` — yes / no.

If yes, invoke `/jlu:add-failure-pattern` semantics inline.

## Notes

- Use `/jlu-diagnose` in messages.
- The diagnoser agent must NEVER bypass the user's confirmation gate. The orchestrator runs the fix only after the user picks `run`.
- If `runtime.type === "docker-compose"` and the agent's `proposed_fix.runs_in` is "host", surface the inconsistency to the user with `Agent proposed a host fix for a containerized service. Manual review recommended.` and skip the auto-run.
