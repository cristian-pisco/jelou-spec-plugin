# Workflow: ui-qa-cleanup

Best-effort recovery for state left behind by a crashed `/jlu-ui-qa-run`: orphan dev servers, running docker-compose services, held flock files, leftover trace.zip files past the retention window. The EXIT trap inside `/jlu-ui-qa-run` is supposed to handle this — `cleanup` exists for the cases where it didn't (SIGKILL, kernel panic, pulled the power cord, OS killed Chromium for OOM and the parent shell never returned).

## Inputs

- Optional argument: task slug. When omitted, sweeps every task discovered via marker files under `.spec-workspace/specs/*/*/TASKS.md`.

## Process

### 1. Locate workspace + tasks

Walk up from the current service repo to find `.spec-workspace/`. List the task directories to sweep (derive each `TASK_DIR` from marker files, not directory globs):

- If `<task-slug>` was passed: sweep only that one task.
- If omitted: sweep all tasks whose lifecycle is `implementing` or `validating` (read from `TASKS.md` Status section; skip `done` and `closed` tasks).

For each task in scope, run steps 2-6 below.

### 2. Release stale lock

```bash
LOCK_FILE="$TASK_DIR/.ui-qa.lock"
PID_FILE="$LOCK_FILE.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Releasing stale lock (PID $PID is dead)."
    rm -f "$PID_FILE" "$LOCK_FILE"
  else
    echo "Active /jlu-ui-qa-run holds the lock (PID $PID). Skipping cleanup for this task."
    continue
  fi
fi
```

Refuses to act on a task whose lock is held by a live process — that would race against an active run.

### 3. Stop any dev servers this task booted

Read each `dev` block in `.spec-workspace/registry/services.yaml` for the services declared in this task's `affected_services` (frontmatter or markdown fallback). For each:

```bash
case "$LAUNCHER" in
  docker)
    docker compose -f "$COMPOSE_FILE" stop "$DOCKER_SERVICE" 2>/dev/null || true
    ;;
  npm|make|shell)
    eval "$TEARDOWN" 2>/dev/null || true
    ;;
esac
```

`|| true` is intentional. We're cleaning up; if the service is already stopped, that's fine.

### 4. Free any port the task's services declared

```bash
for PORT in "${TASK_PORTS[@]}"; do
  HOLDER_PID=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
  if [ -n "$HOLDER_PID" ]; then
    HOLDER_CMD=$(ps -o comm= -p "$HOLDER_PID" 2>/dev/null || echo "unknown")
    echo "Port $PORT held by PID $HOLDER_PID ($HOLDER_CMD)."
  fi
done
```

If a port is held by a process that doesn't match the task's expected `dev.command` (e.g., port 3000 held by the engineer's IDE running an unrelated dev server), surface via AskUserQuestion before any destructive action. Never auto-kill without confirmation.

### 5. Sweep stale temporary worktrees

Per `jelou/references/worktree-resolution.md`, dual-PR runs can leave a `.worktrees/<slug>-staging-tmp/` if `/jlu-ship` crashed mid-cherry-pick. If older than 1 hour:

```bash
find "$SERVICE_REPO/.worktrees" -maxdepth 1 -type d -name "*-staging-tmp" -mmin +60 -print | while read -r d; do
  echo "Removing stale staging worktree: $d"
  git -C "$SERVICE_REPO" worktree remove --force "$d" 2>/dev/null || rm -rf "$d"
done
```

### 6. Trim old traces

```bash
find "$TASK_DIR/services" -path '*/e2e/trace/*.zip' -mtime +14 -print -delete

# E2E videos (playwright-output/**/*.webm) are large and local-only (gitignored). Sweep them on
# the same cadence as traces, using the retention window from the plugin's E2E settings
# (~/.jlu/e2e-settings.json → retentionDays, default 14). $PLUGIN_ROOT is resolved by the skill
# bootstrap; the `|| echo 14` keeps the sweep working if it is unset.
RETENTION_DAYS="$(node "$PLUGIN_ROOT/bin/seed-e2e-settings.mjs" --print-retention 2>/dev/null || echo 14)"
find "$TASK_DIR/services" -path '*/e2e/playwright-output/*' -name '*.webm' -mtime +"$RETENTION_DAYS" -print -delete
```

Don't sweep `.png` screenshots or `.json` trace summaries — those are committed and small. The
`.webm` videos ARE swept (they are large, gitignored, and reproducible on the next run).

## Output

```
Cleanup summary
───────────────
Tasks swept:    <N>
Locks released: <N>
Services stopped:
  - service-auth (docker)
  - service-frontend (npm)
Ports freed:
  - 3000 (was: next dev, PID 12345)
Stale worktrees: 0
Old traces deleted: 4 (47.2 MB freed)
Old videos deleted: 6 (118.4 MB freed)

Status: clean
```

If anything required user confirmation and was skipped, list it under "Skipped (needs human)".

Exit code: 0 always. This workflow is best-effort; failure to stop a service is a warning, not an error.

## When NOT to use this

- During an active `/jlu-ui-qa-run` — let the EXIT trap handle teardown.
- Right after a successful run — the EXIT trap already ran.
- To kill arbitrary processes — only declared dev servers are touched.

## See also

- `jelou/workflows/ui-qa-run.md` — the workflow this recovers from
- `jelou/references/dev-server-readiness.md` — explains the teardown commands per stack
