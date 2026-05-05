# /jlu:add-failure-pattern Workflow

> Purpose: Append a regex to a service's log_failure_patterns and reload the daemon if running.

Inputs:
- `argument`: optional, of the form `<service> <pattern>` or just `<service>`.
- `cwd`: the user's current working directory.

## Step 1 — Resolve workspace + slug

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs')
]).then(([w, t]) => {
  const ws = w.resolveWorkspace(process.argv[1]);
  const slug = t.resolveTaskSlug({ workspaceRoot: ws.root, cwd: process.argv[1] });
  process.stdout.write(JSON.stringify({ ws, slug }));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

Capture `{ ws: { root, configPath, workspaceId }, slug }`. If `ws` returns `NO_WORKSPACE`, surface:

> `No workspace root. Run /jlu:register-service first to create jlu-services.json.`

If `slug` starts with `AMBIGUOUS:`, parse the comma-separated list and ask via `question` (single-choice). Append `_global` as a "no task" option.

## Step 2 — Ask for service + pattern

If `argument` provided, parse `<service> <pattern>` (whitespace split, first token = service, remainder = pattern). Otherwise:

- Read available service names:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs').then(({ readConfig }) => {
  const cfg = readConfig(process.argv[1]);
  process.stdout.write((cfg.services || []).map(s => s.name).join(','));
});
" "{configPath}"
```

- `question` (single-choice from existing services): `"Service to extend?"`
- `question` (free-text): `"Regex pattern (case-insensitive)"`

## Step 3 — Append + signal

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/patterns.mjs').then((p) => {
  const out = p.addPattern({
    configPath: process.argv[1],
    serviceName: process.argv[2],
    pattern: process.argv[3]
  });
  process.stdout.write(JSON.stringify(out));
});
" "{configPath}" "{service}" "{pattern}"
```

If `updated: false`, surface the `reason` and stop.

If `updated: true`, signal the daemon:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/patterns.mjs').then((p) => {
  const out = p.signalDaemon({ workspaceId: process.argv[1], slug: process.argv[2] });
  process.stdout.write(JSON.stringify(out));
});
" "{workspaceId}" "{slug}"
```

## Step 4 — Report

> `Pattern '{pattern}' added to '{service}'. Daemon: <reloaded|not-running>.`

Where `reloaded` if `signaled: true`, otherwise `not-running`.

## Notes

- Use `/jlu-add-failure-pattern` in messages (works for both runtimes).
- The daemon picks up the new pattern on SIGHUP; expect a `daemon_reload` event in `dev-events.log`.
