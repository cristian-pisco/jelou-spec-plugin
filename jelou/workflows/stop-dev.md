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

Regardless of the `--kill-services` choice, stopping a `--jelou-stack` session always tears the task stack down: it (a) `docker compose down`s every per-task project, (b) kills the host-side Vite/inject/observer processes, and (c) restores the frontend + non-worktree backend `.env` files from their backups. The `--kill-services` flag still only controls the TMUX window; it does not affect teardown. If no stack-state file exists (a non-stack session), teardown is a harmless no-op.

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

The Step 3 result includes `stack: { projects, killed, missing, restored }` (all arrays). Report the teardown result alongside the daemon/window status.

Print:
> `Stopped jlu-dev for '{slug}'. Daemon: <killed|not-running>. Window: <killed|kept>.`
> `Stack: <N> project(s) composed down, <K> host process(es) killed (<M> already gone), <R> env file(s) restored.`

where N=`stack.projects.length`, K=`stack.killed.length`, M=`stack.missing.length`, R=`stack.restored.length`.

If `stack.projects` is empty, print `Stack: nothing to tear down (no active task stack).` INSTEAD of the second line.

## Notes

- Phase 2: daemon is not yet alive, so killDaemon is a no-op.
- Teardown reads `stack-state.json` (written by `/jlu:start-dev --jelou-stack`) to know which projects, host processes, and `.env` backups to unwind, and deletes it on success — so a second `stop-dev` finds no stack state and is a clean no-op.
- `/jlu-stop-dev --kill-services` is the non-interactive shortcut.
