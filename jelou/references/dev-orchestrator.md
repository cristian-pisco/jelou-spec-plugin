# JLU Dev Orchestrator Reference

> Operator-facing documentation for the TMUX-based dev environment orchestrator. For the design rationale, see `docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md`.

## Configuration: `jlu-services.json`

The config lives at the workspace root. Schema reference: `jelou/references/jlu-services.schema.json`.

Minimal config:

```json
{
  "version": 1,
  "services": [
    { "name": "api", "path": "./api", "command": "npm run dev" }
  ]
}
```

Full-feature config: see `tests/fixtures/dev-orchestrator/configs/valid-full.json`.

### Top-level keys

- `version` (required, must be `1`).
- `defaults` (optional): defaults applied when per-service fields are omitted.
- `services` (required, array): one entry per service.

### `defaults` keys

- `log_failure_patterns` (string array of regexes; merged with per-service patterns).
- `readiness_timeout_seconds` (default 30).
- `log_capture_lines` (default 100; used by `/jlu-logs`).
- `poll_interval_ms` (default 2000; daemon tick).
- `notification_cooldown_seconds` (default 60; per (service, severity) cooldown).
- `window_prefix` (string, default ""; prepended to TMUX window name).

### `services[]` keys

- `name` (required, kebab-case): unique service identifier.
- `path` (required): relative to workspace root; resolved per `worktree-resolution.md` if a task is active.
- `command` (required): shell command to run in the pane.
- `env_file` (default `.env`; set to `null` to opt out): sourced before the command.
- `depends_on` (string array): services this one depends on. Used as context by the diagnoser, not as orchestration.
- `readiness` (object, optional): HTTP or TCP probe.
- `runtime` (object, optional): host or docker-compose. See Docker section below.
- `log_failure_patterns` (string array of regexes): merged with `defaults.log_failure_patterns`.
- `panel` (object, optional): cosmetic. `{ title, color, layout }`. Setting `layout` on any service overrides the auto-chosen layout for the whole window.

## Command flow

### `/jlu-register-service [name]`

Interactive interview that detects:
- Package manager (pnpm/yarn/bun/npm) by lockfile.
- Docker Compose service name (when a compose file exists in the service's path).
- Common `.env*` files.
- HTTP port from source code (PORT env var, listen calls, package.json scripts).

Writes atomically to `jlu-services.json`.

### `/jlu-start-dev`

1. Resolves workspace root + task slug.
2. Plans the layout (single-pane / even-horizontal / tiled or per-service override).
3. Creates TMUX window `<window_prefix>jlu-dev-<task-slug>`.
4. Splits panes, sets titles + colors, runs each `cd <path> && [source <env_file> &&] <command>`.
5. Spawns the daemon detached.
6. Selects the new window.

### `/jlu-stop-dev [--kill-services]`

1. Reads PID file; sends SIGTERM (then SIGKILL after 5s).
2. Truncates `dev-events.log` (preserves inode for tailers).
3. With `--kill-services`, kills the TMUX window.

### Diagnosis (`jlu-dev-diagnoser`)

1. Reads the last 50 events for the service from `dev-events.log`.
2. Captures the last 100 lines of the service's pane.
3. Dispatches the `jlu-dev-diagnoser` agent with structured input.
4. Parses the structured output, displays cause + evidence + fix.
5. On user confirmation, runs the fix in the right context (host or container).
6. Optionally restarts the pane.
7. Optionally registers any newly identified pattern.

### `/jlu-add-service [name]`

Adds a pane to the running window without restarting other services. The daemon picks up the new pane on the next tick (no manual reload needed).

### `/jlu-logs [name] [--lines N]`

Read-only: prints the last N lines from the service's pane via `tmux capture-pane`.

### `/jlu-add-failure-pattern <service> <pattern>`

1. Appends the regex to `services[<service>].log_failure_patterns` (deduped).
2. Validates the regex compiles under `new RegExp(pattern, 'i')`.
3. Atomically writes the config.
4. Sends SIGHUP to the daemon if running. Daemon emits a `daemon_reload` event in the next tick.

## State directory

Per-workspace, per-task state lives at:

```
~/.jlu/workspaces/<workspace-id>/<task-slug>/
├── daemon.pid          # PID file (1 line)
├── daemon.lock         # JSON: { pid, ts }
├── daemon.stderr       # Daemon's stderr, rotates at 1MB
├── dev-events.log      # JSONL append-only event stream
├── window-name         # tmux window name (1 line)
└── pane-map.json       # Cache: { service_name: pane_id }
```

`<workspace-id>` is `sha256(absolute_workspace_path).slice(0, 12)`.
`<task-slug>` is resolved per the 5-layer detection (override → worktree path → branch → TASKS.md scan → `_global`).

## Daemon model

The daemon is a long-running Node process spawned detached by `/jlu-start-dev`. Each tick (default 2s):

1. Verify the target window still exists. If not, exit cleanly.
2. List panes; emit `panes_changed` if the set differs from the previous tick.
3. For each tracked service:
   - If pane is dead → emit `pane_dead`, fire OS notification (cooldown-respecting), stop tracking.
   - Capture pane output; diff against previous capture; match against compiled patterns; emit `pattern_match` per hit.
   - If readiness declared and not yet ready: probe (HTTP or TCP, 1s timeout). Pass → emit `ready`. Cumulative timeout exceeded → emit `readiness_failed`.
4. Process pending signals: SIGHUP reloads config and emits `daemon_reload`; SIGTERM exits cleanly.

### Event schema

Each event is one JSON line in `dev-events.log` with keys: `ts` (ISO 8601), `type`, `severity` (info|soft|hard), `service`, plus type-specific fields.

Event types and severities:

| Type | Severity |
|---|---|
| `daemon_started` | info |
| `pane_started` | info |
| `panes_changed` | info |
| `ready` | info |
| `daemon_reload` | info |
| `pattern_match` | soft |
| `pane_dead` | hard |
| `readiness_failed` | hard |

OS notifications fire only for severity `hard`, with per `(service, type)` cooldown.

## Docker Compose support

For services running inside containers:

```json
{
  "name": "api",
  "path": "./services/api",
  "runtime": {
    "type": "docker-compose",
    "compose_file": "./docker-compose.yml",
    "compose_service": "api"
  },
  "command": "docker compose -f ./docker-compose.yml up -d && docker compose -f ./docker-compose.yml exec api npm run start:dev"
}
```

When the diagnoser proposes a fix for a `docker-compose` service, the command is automatically substituted into the container's exec template (default: `docker compose -f {compose_file} exec {compose_service} {cmd}`). Host-side install commands are never proposed for containerized services.

## Troubleshooting

### "tmux: command not found"

Install tmux: `brew install tmux` (macOS) or `apt install tmux` (Linux). Minimum version: 3.0.

### Daemon not picking up a new failure pattern

Verify the daemon is running: `cat ~/.jlu/workspaces/<id>/<slug>/daemon.pid` and `kill -0 $(cat ...)`. Then send SIGHUP manually: `kill -HUP $(cat ...)`. The daemon should emit `daemon_reload` to `dev-events.log` within one tick.

### Window already exists, can't restart

`/jlu-start-dev` will detect the existing window and ask whether to reuse, kill+restart, or cancel. To force a clean restart from outside Claude: `tmux kill-window -t jlu-dev-<slug>`, then re-run `/jlu-start-dev`.

### Daemon orphaned after I closed the window manually

The daemon polls the window every tick; when it disappears, the daemon exits cleanly within one tick (default 2s). If the lock file is stale, the next `/jlu-start-dev` will take over the lock automatically.

### Multi-task isolation

Two parallel tasks (worktrees or branches) get separate state directories under `~/.jlu/workspaces/<workspace-id>/<task-slug>/`. The daemon for each is independent; their TMUX windows are named distinctly.

## Design references

- Spec: `docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md`
- Phase 1 plan (foundations): `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator.md`
- Phase 2 plan (TMUX): `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase2-tmux.md`
- Phase 3 plan (daemon): `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase3-daemon.md`
- Phase 4 plan (diagnose + add + logs): `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase4-diagnose.md`
- Phase 5 plan (this polish): `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase5-polish.md`
