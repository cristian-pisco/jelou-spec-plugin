# /jlu:add-service Workflow

> Purpose: Add a service's pane to an existing jlu-dev window without restarting other services.

Inputs:
- `argument`: optional service name.

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

If `argument` is provided and present in config, use it.

Otherwise, list services NOT currently running. Use `tmux list-panes` via Bash to enumerate running panes' titles, then filter the config's services by exclusion. Use `question` (single-choice) on the candidates. If empty, surface: `All registered services are already running.`

If the chosen service is not in the config, ask via `question` whether to invoke `/jlu:register-service` first.

## Step 3 — Add the pane

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/add.mjs').then(({ addService }) => {
  const cfg = JSON.parse(process.argv[1]);
  const out = addService({
    config: cfg, workspaceRoot: process.argv[2], slug: process.argv[3], serviceName: process.argv[4]
  });
  process.stdout.write(JSON.stringify(out));
});
" '{cfg-json}' "{root}" "{slug}" "{service}"
```

## Step 4 — Report

Cases:
- `status: 'added'`: print `Added '{service}' as pane {paneIndex} in jlu-dev-{slug}. Daemon will pick it up shortly.`
- `status: 'no-window'`: surface `No active jlu-dev window. Run /jlu:start-dev first.`
- `status: 'not-registered'`: ask `Register '{service}' first?` → invoke `/jlu:register-service` if yes, then re-run Step 3.
- `status: 'pane-exists'`: ask `Pane already exists. (a) reuse, (b) kill+recreate, (c) cancel`. On (b), kill the pane via Bash and re-run.
