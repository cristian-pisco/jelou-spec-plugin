# JLU Dev Orchestrator — Design

> Status: Draft for plan
> Date: 2026-05-04
> Companion features: `/jlu:start-dev`, `/jlu:stop-dev`, `/jlu:register-service`, `/jlu:add-service`, `/jlu:diagnose`, `/jlu:logs`, `/jlu:add-failure-pattern`

## Goal

Add a TMUX-based dev environment orchestrator to the plugin. A single source-of-truth JSON describes services (host or Docker Compose), and a small set of `/jlu:*` skills wrap TMUX operations so the user can boot, observe, diagnose and extend a multi-service dev environment from a single window. A lightweight Node daemon monitors panes, captures failures, and feeds Claude with structured context for diagnosis. The orchestrator is task-aware: state is keyed by the active task slug, so multiple parallel tasks (worktree- or branch-based) never collide.

## Constraints (decided during brainstorm)

| Decision | Choice |
|----------|--------|
| Failure detection model | A+B+C combined: `pane_dead` always, plus optional log-pattern matching and HTTP/TCP readiness probes |
| Service start order | All services start in parallel. `depends_on` is *context for diagnose*, not orchestration |
| Missing dependency policy | When a service fails because a dep isn't up, the diagnose agent proposes auto-bringing the dep up (with confirmation) or asks the user |
| Pattern editability | The agent can append entries to `services[].log_failure_patterns` via `/jlu:add-failure-pattern`; daemon hot-reloads via SIGHUP |
| TMUX session lifecycle | Dedicated **window** `jlu-dev-<task-slug>` inside the user's current session (B). Auto-creates a session if not in TMUX |
| Notification model | A+B: pull-only by default (`/jlu:diagnose`), plus OS-native notifications (`notify-send` / `osascript`) for `severity: "hard"` events |
| Monitor process model | Background Node daemon (option B), spawned detached by `start-dev`, killed by `stop-dev`. Auto-exits if the window dies |
| State location | `~/.jlu/workspaces/<workspace-id>/<task-slug>/` (slug `_global` when no active task). `<workspace-id>` = SHA-256[:12] of the workspace abs path |
| `env_file` default | `.env` (relative to `services[].path`). User can override or set to `null` to disable |
| Docker Compose support | `runtime` block declares `compose_file`, `compose_service`, and `exec_template`. Diagnose runs proposed fixes inside the container when applicable |
| Mid-session add | `/jlu:add-service` adds a pane to the running window without restarting; daemon picks it up automatically next tick |
| Cleanup scope | `/jlu:stop-dev` kills daemon and truncates `dev-events.log`. `--kill-services` flag kills the TMUX window too |
| Platforms | Linux + macOS (primary). WSL works as Linux. Windows-native out of scope (no TMUX) |
| Language | Node `.mjs` (ESM), matching the existing `bin/*.mjs` pattern |
| Runtime support | **Both Claude Code and OpenCode**, following the existing dual-runtime contract (`jelou/references/claude-code-runtime.md`). Each new skill ships with a Claude Code `SKILL.md` and an OpenCode `.opencode/commands/jlu-<name>.md`, sharing the same workflow file. The diagnose agent ships in both `agents/` and `.opencode/agents/` |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code (sesión)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Skills (orquestadores delgados)                          │   │
│  │   /jlu:register-service  /jlu:start-dev                  │   │
│  │   /jlu:stop-dev          /jlu:diagnose [service]         │   │
│  │   /jlu:logs [service]    /jlu:add-failure-pattern        │   │
│  │   /jlu:add-service                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │ (delegan a)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  bin/lib/dev-orchestrator/  (Node .mjs, autocontenido)           │
│   ├── tmux.mjs        — wrap de tmux (split, layout, capture)   │
│   ├── config.mjs      — read/write/validate jlu-services.json   │
│   ├── task-context.mjs — detecta task-slug activo               │
│   ├── workspace.mjs   — resuelve workspace-root + workspace-id  │
│   ├── start.mjs       — implementa /jlu:start-dev               │
│   ├── stop.mjs        — implementa /jlu:stop-dev                │
│   ├── add.mjs         — implementa /jlu:add-service             │
│   ├── register.mjs    — implementa /jlu:register-service        │
│   ├── diagnose.mjs    — implementa /jlu:diagnose                │
│   ├── logs.mjs        — implementa /jlu:logs                    │
│   ├── patterns.mjs    — implementa /jlu:add-failure-pattern     │
│   ├── daemon.mjs      — el monitor (ejecutable, long-running)   │
│   ├── readiness.mjs   — HTTP/TCP probes                          │
│   ├── notify.mjs      — notify-send / osascript                  │
│   └── state.mjs       — PID files, lock files en ~/.jlu/...     │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  TMUX (sesión actual del usuario)                                │
│   └── window: jlu-dev-<task-slug>                                │
│        ├── pane 0: api-gateway                                   │
│        ├── pane 1: workflows                                     │
│        └── pane N: ...                                           │
└─────────────────────────────────────────────────────────────────┘
```

## File Layout

Every new skill ships in **both** runtime entry points sharing one workflow file. Every new agent ships in both runtime agent directories.

```
jelou-spec-plugin/
├── skills/                                        # Claude Code entry points
│   ├── register-service/SKILL.md
│   ├── start-dev/SKILL.md
│   ├── stop-dev/SKILL.md
│   ├── add-service/SKILL.md
│   ├── diagnose/SKILL.md
│   ├── logs/SKILL.md
│   └── add-failure-pattern/SKILL.md
├── .opencode/                                     # OpenCode entry points (mirrors)
│   ├── commands/
│   │   ├── jlu-register-service.md
│   │   ├── jlu-start-dev.md
│   │   ├── jlu-stop-dev.md
│   │   ├── jlu-add-service.md
│   │   ├── jlu-diagnose.md
│   │   ├── jlu-logs.md
│   │   └── jlu-add-failure-pattern.md
│   └── agents/
│       └── jlu-dev-diagnoser.md
├── agents/
│   └── jlu-dev-diagnoser.md                       # NEW — failure analysis (opus)
├── jelou/
│   ├── workflows/                                 # Shared, runtime-agnostic
│   │   ├── register-service.md
│   │   ├── start-dev.md
│   │   ├── stop-dev.md
│   │   ├── add-service.md
│   │   ├── diagnose.md
│   │   ├── logs.md
│   │   └── add-failure-pattern.md
│   └── references/
│       ├── jlu-services.schema.json               # JSON Schema for the config
│       └── dev-orchestrator.md                    # Operator-facing reference
├── bin/lib/dev-orchestrator/
│   ├── tmux.mjs
│   ├── config.mjs
│   ├── task-context.mjs
│   ├── workspace.mjs
│   ├── start.mjs
│   ├── stop.mjs
│   ├── add.mjs
│   ├── register.mjs
│   ├── diagnose.mjs
│   ├── logs.mjs
│   ├── patterns.mjs
│   ├── daemon.mjs
│   ├── readiness.mjs
│   ├── notify.mjs
│   └── state.mjs
└── tests/
    ├── unit/dev-orchestrator/
    │   ├── config.test.mjs
    │   ├── task-context.test.mjs
    │   ├── workspace.test.mjs
    │   ├── patterns.test.mjs
    │   └── readiness.test.mjs
    ├── integration/dev-orchestrator/
    │   ├── tmux.test.mjs
    │   └── daemon.test.mjs
    └── fixtures/dev-orchestrator/
        └── configs/*.json
```

## Runtime Compatibility (Claude Code + OpenCode)

The plugin already supports both runtimes through a documented dual-entry pattern (see `jelou/references/claude-code-runtime.md`). Every new skill in this design **must** follow it:

### Workflow file (shared)

Lives at `jelou/workflows/<name>.md`. Authored OpenCode-style:
- Uses `question` for user prompts.
- Uses `task` for subagent dispatches.
- Never references runtime-specific tool names directly.

### Claude Code entry — `skills/<name>/SKILL.md`

Frontmatter declares `allowed-tools` (must include `AskUserQuestion`, `ToolSearch`, `Bash`, plus `Agent` for skills that dispatch). Bootstrap (mirroring `skills/new-task/SKILL.md`) does in parallel:

1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`.
2. `Read`: `<plugin-root>/jelou/workflows/<name>.md`.
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1) — mandatory before any `AskUserQuestion` call.

Then executes the workflow inline (no subagent dispatch — keeps `AskUserQuestion` working at L2). Tool name translation: `question` → `AskUserQuestion`, `task` → `Agent`.

### OpenCode entry — `.opencode/commands/jlu-<name>.md`

Mirror frontmatter (minimal):

```yaml
---
description: <short>
agent: build
---
Execute this workflow exactly: @jelou/workflows/<name>.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of question).
Use `task` for subagent dispatches (OpenCode equivalent of task tool).
Always reference commands with the `jlu-` prefix (never `jlu:`).
```

### Agents (dual-published)

`agents/jlu-dev-diagnoser.md` and `.opencode/agents/jlu-dev-diagnoser.md` ship the same prompt. Frontmatter differs (Claude Code uses `name`/`description`/`tools`; OpenCode uses its own format — match the existing siblings like `jlu-spec-interviewer.md` in both directories).

### User-facing command names

| Runtime | Form | Example |
|---|---|---|
| Claude Code | `/jlu:<name>` (colon-namespaced via plugin) | `/jlu:start-dev` |
| OpenCode | `/jlu-<name>` (hyphenated, no namespace) | `/jlu-start-dev` |

Internal docs and notification messages reference the **OpenCode form** (`/jlu-<name>`) per the existing `.opencode/commands/jlu-new-task.md` convention; Claude Code users mentally substitute the colon. This keeps copy-pasteable instructions runtime-portable.

### What is naturally runtime-agnostic

The "heavy" surface — `bin/lib/dev-orchestrator/*.mjs`, the daemon process, TMUX commands, `jlu-services.json`, OS notifications, state in `~/.jlu/`, JSON Schema validation, regex matching, readiness probes — is all invoked via `Bash` and runs identically under both runtimes. No runtime branching in the implementation.

### What is NOT supported in this v1

`PushNotification` (Claude-Code-specific deferred tool) was excluded in the brainstorm; this also keeps OpenCode parity easy. Notifications go through OS-native `notify-send`/`osascript` only.

## `jlu-services.json` Schema (v1)

Lives at the workspace root (resolved via the algorithm in *Workspace Resolution* below).

```json
{
  "$schema": "https://jelou.github.io/jlu-services.schema.json",
  "version": 1,
  "defaults": {
    "log_failure_patterns": [
      "EADDRINUSE",
      "Cannot find module",
      "ENOENT.*node_modules",
      "ECONNREFUSED",
      "no such file or directory",
      "container .* not running",
      "service \".*\" is not running"
    ],
    "readiness_timeout_seconds": 30,
    "log_capture_lines": 100,
    "poll_interval_ms": 2000,
    "notification_cooldown_seconds": 60,
    "window_prefix": ""
  },
  "services": [
    {
      "name": "api-gateway",
      "path": "./services/api-gateway",
      "runtime": {
        "type": "docker-compose",
        "compose_file": "./docker-compose.yml",
        "compose_service": "api",
        "exec_template": "docker compose -f {compose_file} exec {compose_service} {cmd}"
      },
      "command": "docker compose -f ./docker-compose.yml up -d && docker compose -f ./docker-compose.yml exec api npm run start:dev",
      "env_file": ".env",
      "depends_on": ["redis"],
      "readiness": {
        "type": "http",
        "url": "http://localhost:3000/health",
        "expect_status": 200,
        "timeout_seconds": 30
      },
      "log_failure_patterns": ["ECONNREFUSED.*redis"],
      "panel": { "title": "API", "color": "cyan" }
    }
  ]
}
```

### Field rules

| Field | Required | Notes |
|---|---|---|
| `version` | yes | Currently `1`; allows future migrations |
| `defaults.log_failure_patterns` | no | *Merged with* per-service patterns, not overridden |
| `defaults.readiness_timeout_seconds` | no | Default 30 |
| `defaults.log_capture_lines` | no | Default 100; used by `diagnose` and `logs` |
| `defaults.poll_interval_ms` | no | Default 2000 |
| `defaults.notification_cooldown_seconds` | no | Default 60. Per `(service, type)` |
| `services[].name` | yes | `[a-z0-9-]+`, unique. Used as event ID and CLI argument |
| `services[].path` | yes | Relative to workspace root. Per-service worktree resolution delegates to the existing `jelou/references/worktree-resolution.md` algorithm — if the active task is `Mode: worktree` and `<workspace>/<path>/.worktrees/<task-slug>/` exists, that worktree path is used; otherwise the main repo path. Missing path = warning, service is skipped |
| `services[].command` | yes | Shell command string, executed with `bash -lc` so `nvm`/`pyenv`/etc. load |
| `services[].env_file` | no | Default `".env"` (relative to `path`). Set to `null` to opt out. Missing file = warning, not error |
| `services[].depends_on` | no | Refs to other `services[].name`. *Context for diagnose only* |
| `services[].readiness` | no | If absent, only `pane_dead` and patterns are watched |
| `services[].readiness.type` | yes if `readiness` set | `"http"` \| `"tcp"` |
| `services[].log_failure_patterns` | no | Regex strings (case-insensitive). Combined with defaults |
| `services[].runtime.type` | no | `"host"` (default) or `"docker-compose"` |
| `services[].runtime.compose_file` | yes if docker-compose | Relative to workspace root. Default `./docker-compose.yml` |
| `services[].runtime.compose_service` | yes if docker-compose | Compose-side service name (NOT `services[].name`) |
| `services[].runtime.exec_template` | no | Default `"docker compose -f {compose_file} exec {compose_service} {cmd}"`. Substitution variables: `{compose_file}`, `{compose_service}`, `{cmd}`. Used by diagnose for sub-commands |
| `services[].panel.title` | no | Sets pane title via `tmux select-pane -T` |
| `services[].panel.color` | no | Sets pane border via `tmux select-pane -P bg=...` |

### Validation rules

- Schema-validated (Ajv or hand-rolled) before any write.
- Atomic writes (`tmpfile + rename`).
- `services[].name` must be unique.
- Each regex in `log_failure_patterns` must compile under `new RegExp(p, 'i')`; otherwise the write is rejected.
- `depends_on` referencing a non-existent service is a **warning, not an error** (covers external deps not declared in JSON).

## Skills Surface

### `/jlu:register-service [name]`

Interactive registration writing to `jlu-services.json`. Pre-infers from cwd:

- `pnpm`/`npm`/`yarn` from lockfile → suggests command.
- `docker-compose.yml` / `compose.yml` → suggests `runtime.type: "docker-compose"` and lists compose services.
- `.env*` files → fills `env_file`.
- `PORT=` / `listen(N)` patterns → suggests `readiness.url`.

Asks (one at a time via AskUserQuestion): `name`, `path`, `runtime.type`, `compose_file`/`compose_service` (if docker-compose), `command`, `env_file`, `depends_on`, `readiness`, `log_failure_patterns`. Shows preview, atomic write, offers `git add`.

### `/jlu:start-dev`

1. Resolve workspace root + `jlu-services.json`.
2. Resolve task-slug.
3. Resolve TMUX (create session if needed).
4. If `jlu-dev-<slug>` window exists → ask reuse / kill+restart / cancel.
5. Create window with N panes (layout: `single-pane` for N=1, `even-horizontal` for N=2-3, `tiled` for N≥4).
6. Per service: `cd <path> && [source <env_file> &&] <command>`. Set pane title and optional color.
7. Spawn daemon detached. Pass `--slug`, `--config`, `--window`. Daemon writes its PID to `~/.jlu/.../daemon.pid` and acquires `daemon.lock`.
8. `tmux select-window -t jlu-dev-<slug>`. Print summary.

### `/jlu:stop-dev [--kill-services]`

1. Resolve task-slug.
2. Read `daemon.pid`, send SIGTERM, wait up to 5s, SIGKILL if still alive.
3. Truncate `dev-events.log` (preserve inode).
4. Clean PID/lock files.
5. If `--kill-services`: `tmux kill-window -t jlu-dev-<slug>`.

### `/jlu:add-service [service]`

1. Verify window `jlu-dev-<slug>` exists; otherwise instruct user to run `start-dev`.
2. If service omitted → multi-choice from JSON minus services with active panes.
3. If service not in JSON → offer `/jlu:register-service` first.
4. If pane with that title exists → reuse / kill+restart / cancel.
5. `tmux split-window -t jlu-dev-<slug>`. Set title/color, send `cd <path> && [source <env_file> &&] <command>`.
6. `tmux select-layout -t jlu-dev-<slug> tiled`. Focus new pane.
7. Daemon picks it up next tick (no SIGHUP needed).

### `/jlu:diagnose [service]`

1. Read recent events from `dev-events.log`.
2. If service omitted → present services with recent failures.
3. Capture pane: `tmux capture-pane -p -S -<defaults.log_capture_lines> -t <pane>`.
4. Dispatch `jlu-dev-diagnoser` agent with: events + capture + service config + runtime info + `depends_on` resolved configs.
5. Agent returns structured diagnosis: `cause`, `confidence`, `proposed_fix`, `fix_runs_in: "host" | "container"`.
6. Skill confirms with the user (run / show command / skip).
7. If run: execute via `bash -lc` (host) or `<exec_template>` (container). Then `tmux send-keys -t <pane> C-c` and re-run the original command in the pane.
8. Offer `/jlu:add-failure-pattern` if a new pattern was identified.

**Critical rule for the agent prompt:** when `runtime.type === "docker-compose"`, *never* propose a host-side install/exec; always use `exec_template`.

### `/jlu:logs [service] [--lines N]`

`tmux capture-pane -p -S -<N|defaults.log_capture_lines> -t <pane>`. No analysis. Pure on-demand inspection.

### `/jlu:add-failure-pattern <service> <pattern>`

1. Read JSON, locate service, append to `log_failure_patterns` (deduped).
2. Compile regex via `new RegExp(pattern, 'i')`; reject if invalid.
3. Schema-validate, atomic write.
4. If daemon alive (PID file + lock held): send `SIGHUP`. Daemon emits `daemon_reload` event in next tick.

## Daemon

### Process

- Spawned as `node bin/lib/dev-orchestrator/daemon.mjs --slug <slug> --config <abs> --window <name>` with `detached: true, stdio: ['ignore', logFd, logFd], .unref()`.
- PID file at `~/.jlu/workspaces/<workspace-id>/<task-slug>/daemon.pid`.
- Exclusive `flock` on `daemon.lock`. Second instance refuses to start.
- Stdout/stderr → `~/.jlu/.../daemon.stderr`, simple rotation past 1MB.
- Auto-exit when target window disappears.

### Loop

Tick interval = `defaults.poll_interval_ms`. Each tick:

1. `tmux list-windows -F '#{window_name}' | grep jlu-dev-<slug>` → if missing, cleanup + exit 0.
2. `tmux list-panes -t <window> -F '#{pane_id}:#{pane_title}:#{pane_dead}'`.
3. If pane set hash changed → rebuild `pane-map.json`, emit `panes_changed` with diff (added/removed services).
4. For each tracked service:
   - If `pane_dead == 1` → emit `pane_dead`, mark stopped (skip future ticks until new pane).
   - `tmux capture-pane -p -S -200 -t <pane>` → diff against last capture, regex-test new lines, emit `pattern_match` per hit.
   - If `readiness` declared and not yet `ready`: probe with 1s timeout. Pass → emit `ready`. Cumulative timeout exceeded → emit `readiness_failed`, mark `ready=false`.
5. Process pending signals (SIGHUP → reload config; SIGTERM → cleanup + exit).

### Event format (JSONL)

```json
{"ts":"2026-05-04T18:30:12.123Z","slug":"auth-refactor","service":"api-gateway","type":"pane_dead","pane_id":"%23","exit_status":1,"severity":"hard"}
```

| `type` | `severity` |
|---|---|
| `daemon_started` | info |
| `pane_started` | info |
| `panes_changed` | info |
| `ready` | info |
| `daemon_reload` | info |
| `pattern_match` | soft |
| `pane_dead` | hard |
| `readiness_failed` | hard |

### Notifications

- `severity: "hard"` only.
- Linux: `notify-send -u critical "jlu-dev: <service> failed" "<reason>\nRun /jlu:diagnose <service>"`.
- macOS: `osascript -e 'display notification "<reason>" with title "jlu-dev: <service> failed"'`.
- Per-`(service, type)` cooldown = `notification_cooldown_seconds`.
- Missing notifier binary → silent fallback to log.

### Hot reload

`SIGHUP` → re-read JSON, recompile regex set (defaults + per-service), apply on next tick, emit `daemon_reload`.

### State directory

```
~/.jlu/workspaces/<workspace-id>/<task-slug>/
├── daemon.pid          # PID (1 line)
├── daemon.lock         # flock target
├── daemon.stderr       # rotated at 1MB
├── dev-events.log      # JSONL append-only, truncated by stop-dev
├── window-name         # tmux window name (1 line)
└── pane-map.json       # cache: { service_name: pane_id }
```

`<workspace-id>` = `sha256(absolute_workspace_path)[:12]`. A `~/.jlu/current` symlink points to the active workspace dir for ergonomic inspection.

## Task and Workspace Resolution

### Task slug (priority order)

1. Explicit `--task <slug>` arg or skill prompt.
2. cwd matches `.../.worktrees/<slug>/...` → slug = matched group.
3. Branch matches `task/<slug>`, `spec/<slug>`, or `<slug>` when `<workspace>/tasks/<slug>/TASKS.md` exists.
4. Workspace TASKS.md scan: tasks in `implementing` or `validating`. One → use it. Many → AskUserQuestion (multi-choice + "none, use global"). None → next.
5. Fallback: `_global`.

This satisfies "task-aware regardless of worktree-vs-branch mode".

### Workspace root (priority order)

Walk up from cwd, take the first hit:

1. A directory containing `jlu-services.json`.
2. A directory containing both `registry/services.yaml` and `tasks/` (canonical JLU workspace).
3. `git rev-parse --show-toplevel`.

If none → fail with: *"Run /jlu:register-service from inside a project to bootstrap jlu-services.json"*.

## Diagnose Agent (`agents/jlu-dev-diagnoser.md`)

- **Tier:** Opus (interactive interview tier, matches `spec-interviewer`).
- **Input:** events (last N for the service), pane capture, service config, runtime info, `depends_on` resolved configs, OS info.
- **Output (JSON):**
  ```json
  {
    "cause": "missing node_modules in container",
    "confidence": "high",
    "evidence": ["Cannot find module 'express'", "container running but exec failed"],
    "proposed_fix": {
      "command": "npm ci",
      "runs_in": "container",
      "rationale": "runtime.type is docker-compose; install must happen inside the container"
    },
    "alternative_fixes": [...],
    "register_pattern": "Cannot find module"
  }
  ```
- **Hard rules in prompt:**
  - When `runtime.type === "docker-compose"`, all proposed fixes use `exec_template`.
  - When the failure cause is "missing dep that is itself a JSON service", propose to bring up that dep (with confirmation).
  - Always provide `evidence` referencing specific log lines.
  - Confidence levels: `high | medium | low`. `low` => suggest the user investigate manually rather than auto-running.

## Edge Cases

| Case | Behavior |
|---|---|
| Not in TMUX | Auto-create session `jlu-dev`, attach at the end |
| TMUX not installed | Fail early with install hint |
| Not in a git repo, but `jlu-services.json` exists upstream | Walk-up still resolves; works |
| User closes window manually | Daemon detects in next tick, exit 0, cleanup |
| User kills a single pane | Daemon emits `pane_dead`, monitors the rest |
| `start-dev` second run | Lock detected → reuse / kill+restart / cancel |
| Daemon crash | Kernel releases lock; next `start-dev` recovers |
| Branch switch mid-session | State frozen by slug; switching tasks creates a separate state dir, daemons coexist |
| Same task in two TMUX sessions | `daemon.lock` blocks the second; window detection stays on the first window seen |
| Service `path` worktree resolution | Delegated to `worktree-resolution.md`. Worktree present → use it. Missing → main repo. Both missing → warn and skip that service |
| `docker compose up` port conflict | Pane shows error → `pane_dead` → diagnose proposes `lsof -ti :<port> \| xargs kill` (with confirmation) |
| `dev-events.log` growth | Truncated by `stop-dev`. Auto-rotation at 5MB is a v2 concern |
| `notify-send` not installed | Silent fallback |
| Multi-monitor / lost windows | `~/.jlu/current` symlink + `meta.json` enable a future `/jlu:report-task` extension |

## Testing Strategy

| Layer | Strategy | Location |
|---|---|---|
| JSON schema | Valid/invalid fixtures (required missing, regex invalid, duplicate name, runtime inconsistency) | `tests/unit/dev-orchestrator/config.test.mjs` |
| Task slug resolution | Mocked filesystem (worktree paths, branch names, TASKS.md states) | `tests/unit/dev-orchestrator/task-context.test.mjs` |
| Workspace resolution | Mocked filesystem walk-up | `tests/unit/dev-orchestrator/workspace.test.mjs` |
| Pattern matching | Synthetic line streams + pattern lists, assert events + cooldown | `tests/unit/dev-orchestrator/patterns.test.mjs` |
| Readiness | Mock HTTP + TCP servers; test pass/fail/timeout/refused | `tests/unit/dev-orchestrator/readiness.test.mjs` |
| TMUX wrapper | Real TMUX session `tmux-test-<random>`, exercise commands, teardown. Skip if no tmux in CI | `tests/integration/dev-orchestrator/tmux.test.mjs` |
| Daemon E2E | Daemon against a real window with `sleep 5; exit 0` and `sleep 5; exit 1`; assert events | `tests/integration/dev-orchestrator/daemon.test.mjs` |
| Skills smoke | Frontmatter + allowed-tools for `skills/<name>/SKILL.md`. Extend existing pattern | `tests/pressure/skills.test.mjs` |
| OpenCode parity | For each new skill, verify `.opencode/commands/jlu-<name>.md` exists, references the same workflow file, and has valid frontmatter. Same for `.opencode/agents/jlu-dev-diagnoser.md` | `tests/pressure/opencode-parity.test.mjs` (extend or create) |

Not automated (accepted risk):

- Real OS notifications (visual smoke before release).
- LLM responses for diagnose (golden inputs/outputs, no live calls in CI).
- Real `docker compose` interactions (canned outputs in fixtures).

## Implementation Phases

Targets for `writing-plans` to materialize as TDD phases.

**Phase 1 — Foundations.** Schema + validator. `task-context.mjs`, `workspace.mjs`. `register-service` skill. Unit tests.

**Phase 2 — TMUX integration + minimal `start-dev`/`stop-dev`.** `tmux.mjs`. `start.mjs` without daemon. `stop.mjs` without daemon. Integration tests.

**Phase 3 — Daemon.** Loop, readiness probes, pattern matching, PID/lock, signal handlers. `notify.mjs`. Wire into `start-dev`/`stop-dev`/`add-failure-pattern`.

**Phase 4 — Diagnose + add-service + logs.** `jlu-dev-diagnoser` agent. `diagnose`, `add-service`, `logs` skills.

**Phase 5 — Polish.** `register-service` smart inference. Layout overrides. Window prefix configurable. Reference docs. **OpenCode parity audit:** verify each new skill has its `.opencode/commands/jlu-<name>.md` mirror and that the diagnose agent is dual-published.

## Pre-Implementation Checklist

Before invoking `writing-plans` and starting Phase 1, the implementing session must verify:

- [ ] Current branch is `main` and working tree is clean (`git status`).
- [ ] `git fetch origin && git rebase origin/main`.
- [ ] No conflicts. If any, the implementing session must **stop** and surface them; do not continue with stale base.
- [ ] CHANGELOG.md and version state inspected (the plugin uses `[skip-bump]` releases; do not collide with an in-flight bump).
- [ ] `tmux --version` available locally for integration tests (>= 3.0 recommended for hooks/format).
- [ ] Node version matches what `bin/*.mjs` already uses (>= 18 ESM expected).

These checks are part of the implementation plan's pre-flight, not part of the spec itself.

## Out of Scope (v1)

- `/jlu:remove-service` (trivial follow-up).
- Workspace-level `pre_boot` block to avoid redundant `docker compose up`.
- Auto-rotation of `dev-events.log`.
- Per-task `.jlu/local-services.json` overrides on top of the workspace JSON.
- Push notifications inside Claude Code via `PushNotification` deferred tool.
- Windows-native support.

## Open Questions for Implementation

- Schema validator: Ajv (new dep) vs hand-rolled JS. Implementer decides.
- Tmux pane color API: `select-pane -P bg=...` only works on tmux 3.0+. If targeting 2.x, drop `panel.color` or feature-detect.
- Whether to render the daemon log location to the user on `start-dev` end (helpful but verbose). Recommendation: yes, behind `--verbose`.
