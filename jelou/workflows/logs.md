# /jlu:logs Workflow

> Purpose: Print the last N lines from a service's TMUX pane on demand. No analysis.

Inputs:
- `argument`: optional, of the form `<service> [--lines N]`.

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

If `argument` provided, parse `<service> [--lines N]`. Otherwise list current panes via `tmux list-panes` for the window and use `question` (single-choice).

## Step 3 — Capture

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/logs.mjs').then(({ logsFor }) => {
  const cfg = JSON.parse(process.argv[1]);
  const out = logsFor({
    slug: process.argv[2], serviceName: process.argv[3],
    lines: parseInt(process.argv[4], 10) || 100,
    allServices: cfg.services
  });
  process.stdout.write(JSON.stringify(out));
});
" '{cfg-json}' "{slug}" "{service}" "{lines}"
```

## Step 4 — Report

If `status: 'ok'`, print the capture verbatim, prefixed:
> `=== logs for {service} (last {lines} lines) ===`

Otherwise surface the appropriate not-found message.

## Notes

- Use `/jlu-logs` in messages.
- This command is read-only — never modifies state.
