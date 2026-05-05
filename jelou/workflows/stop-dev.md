# /jlu:stop-dev Workflow

> Purpose: Stop the daemon (no-op in Phase 2) and optionally kill the TMUX window.

Inputs:
- `argument`: optional `--kill-services` flag.

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

If `slug` starts with `AMBIGUOUS:`, prompt the user to disambiguate. If `_global`, proceed.

## Step 2 — Confirm scope

If argument is `--kill-services`, skip the prompt and use `killServices: true`.
Otherwise use `question` (single-choice): `"Stop dev environment for '<slug>'? (a) keep services running, (b) kill TMUX window too, (c) cancel"`.

If cancel, print `Cancelled.` and stop.

## Step 3 — Execute stop

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stop.mjs').then(({ stopDev }) => {
  const out = stopDev({
    workspaceId: process.argv[1],
    slug: process.argv[2],
    killServices: process.argv[3] === 'true'
  });
  process.stdout.write(JSON.stringify(out));
});
" "{workspaceId}" "{slug}" "{killServices}"
```

## Step 4 — Report

Print:
> `Stopped jlu-dev for '{slug}'. Daemon: <killed|not-running>. Window: <killed|kept>.`

## Notes

- Phase 2: daemon is not yet alive, so killDaemon is a no-op.
- `/jlu-stop-dev --kill-services` is the non-interactive shortcut.
