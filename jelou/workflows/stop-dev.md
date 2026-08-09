# /jlu:stop-dev Workflow

> Purpose: Stop the daemon, tear the task stack down, and optionally kill the TMUX window.

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
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/stop.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/stack-state.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/events.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/state-daemon.mjs')
]).then(([{ stopDev }, stackState, events, daemonState]) => {
  const opts = { workspaceId: process.argv[1], slug: process.argv[2] };
  const state = stackState.readStackState(opts);
  const out = stopDev({
    ...opts,
    runId: state.currentRun?.runId,
    killServices: process.argv[3] === 'true',
    onLifecycle: (event) => events.appendLifecycleEvent(daemonState.eventsLogPath(opts), event)
  });
  process.stdout.write(JSON.stringify(out));
});
" "{workspaceId}" "{slug}" "{killServices}"
```

## Step 4 — Report

The Step 3 result includes `stack: { projects, killed, missing, restored, refused }` (all arrays for an owned journal). Report the teardown result alongside the daemon/window status. If `refused` is non-empty, name every resource and reason and report that its state was preserved for manual review.

Print:
> `Stopped jlu-dev for '{slug}'. Daemon: <killed|not-running>. Window: <killed|kept>.`
> `Stack: <N> project(s) composed down, <K> host process(es) killed (<M> already gone), <R> env file(s) restored.`

where N=`stack.projects.length`, K=`stack.killed.length`, M=`stack.missing.length`, R=`stack.restored.length`.

If `stack.projects` is empty, print `Stack: nothing to tear down (no active task stack).` INSTEAD of the second line.

## Notes

- `stopDev` calls the real `killDaemon` from `bin/lib/dev-orchestrator/daemon-spawn.mjs` (SIGTERM, then SIGKILL after 5s) against the pid `/jlu:start-dev` recorded. When no daemon pid is live it releases the lock and reports `killed: false` — a no-op only in that case, never by design.
- Teardown reads `stack-state.json` (written by `/jlu:start-dev --jelou-stack`) to know which projects, host processes, and `.env` backups to unwind, and deletes it on success — so a second `stop-dev` finds no stack state and is a clean no-op.
- `/jlu-stop-dev --kill-services` is the non-interactive shortcut.
