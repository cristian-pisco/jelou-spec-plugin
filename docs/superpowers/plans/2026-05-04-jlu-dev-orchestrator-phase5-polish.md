# JLU Dev Orchestrator — Phase 5 (Polish + parity audit + PR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Final hardening for the JLU Dev Orchestrator before merge: smart-inference enhancements in `register-service` (port detection from source code), layout overrides in the JSON schema, configurable window prefix, README updates, an operator-facing reference doc, OpenCode parity test suite extension, and a final cross-phase code review. After this phase, the branch is ready to push and open a PR.

**Architecture:** Pure docs + small additive code changes. The `register-service` smart inference grows new probes (port-in-source detection). `start.mjs` reads `defaults.window_prefix` and `services[].panel.layout` from config. README and a new `jelou/references/dev-orchestrator.md` document the feature for users. A new `tests/pressure/opencode-parity.test.mjs` audits all seven new dev-orchestrator skills.

**Tech Stack:** Node 20+ ESM. `node:test`. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md`
**Phase 1–4 plans:** `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator{,-phase2-tmux,-phase3-daemon,-phase4-diagnose}.md`

**Branch:** `feature/dev-orchestrator` (continues from Phase 4). Same single PR — opened at the END of this phase.

**Phase 5 deliverable:** Polished feature, complete docs, comprehensive tests, single PR ready for review.

---

## Pre-flight

```bash
git status --short
git rev-parse --abbrev-ref HEAD     # must be feature/dev-orchestrator
npm test                            # must be green per Phase 4 baseline
node --test tests/integration/dev-orchestrator/*.test.mjs
```

If suite is red, stop.

---

## File Structure (Phase 5)

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `jelou/references/dev-orchestrator.md` | Operator-facing reference: how to register, start, stop, diagnose, troubleshoot |
| `tests/pressure/opencode-parity.test.mjs` | Audit suite for the seven new skills |
| `tests/unit/dev-orchestrator-register-port.test.mjs` | Tests for new port-detection inference helper |

### Files to MODIFY

| Path | Change |
|------|--------|
| `bin/lib/dev-orchestrator/register.mjs` | Add `inferPortFromSource(absDir)` helper; expose in `inferDefaults` return |
| `bin/lib/dev-orchestrator/start.mjs` | Read `defaults.window_prefix`; honor `services[].panel.layout` override |
| `bin/lib/dev-orchestrator/config.mjs` | Add `panel.layout` to allowed keys + validate enum value |
| `jelou/references/jlu-services.schema.json` | Reflect the same `panel.layout` addition |
| `jelou/workflows/register-service.md` | Use `suggestedReadinessUrl` from inference as default for readiness URL prompt |
| `README.md` | Add a section describing the seven new commands + a quickstart |
| `tests/pressure/skills.test.mjs` | If this file exists and has a hard-coded list, register the seven new skill names |
| `tests/unit/dev-orchestrator-config.test.mjs` | Extend with a test for the new `panel.layout` validation |
| `tests/unit/dev-orchestrator-start.test.mjs` | Extend with prefix + layout override tests |

### Coding rules

- Node 20+ ESM. No new deps.
- Tests FLAT in `tests/unit/`. Pressure tests in `tests/pressure/`.
- Every commit ends with `[skip-bump]`.

---

## Task 1: Port-detection helper in register.mjs — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-register-port.test.mjs`
- Modify: `bin/lib/dev-orchestrator/register.mjs`

Add a helper `inferPortFromSource(absDir)` that scans common source files for port hints. Returns the first match as a number, or `null`.

Patterns (case-insensitive):
- `PORT=<digits>` in `.env` files
- `"start": "PORT=<digits> ..."` in package.json scripts
- `app.listen(<digits>` / `server.listen(<digits>` / `.listen(<digits>` in JS/TS
- `process.env.PORT` references → no concrete number, ignore

Limit scan to top-level files under 64KB (no recursion).

- [ ] **Step 1: Test**

```javascript
// tests/unit/dev-orchestrator-register-port.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferPortFromSource } from '../../bin/lib/dev-orchestrator/register.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-port-')); }

describe('inferPortFromSource', () => {
  test('detects PORT in .env', () => {
    const dir = tmp();
    writeFileSync(join(dir, '.env'), 'PORT=3001\nFOO=bar\n');
    assert.equal(inferPortFromSource(dir), 3001);
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects app.listen(N) in JS file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'index.js'), 'const app = require("express")();\napp.listen(4242, () => {});\n');
    assert.equal(inferPortFromSource(dir), 4242);
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects PORT=N in package.json scripts', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { start: 'PORT=8080 node index.js' }
    }));
    assert.equal(inferPortFromSource(dir), 8080);
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns null when no port found', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'README.md'), 'just docs\n');
    assert.equal(inferPortFromSource(dir), null);
    rmSync(dir, { recursive: true, force: true });
  });

  test('does not recurse into subdirectories', () => {
    const dir = tmp();
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, '.env'), 'PORT=9999\n');
    assert.equal(inferPortFromSource(dir), null);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Implementation — extend `bin/lib/dev-orchestrator/register.mjs`**

Add this export near the existing inference helpers, plus a `safeRead` helper:

```javascript
const PORT_RE_DOTENV = /^PORT\s*=\s*(\d{2,5})\s*$/m;
const PORT_RE_LISTEN = /\.listen\s*\(\s*(\d{2,5})/;
const PORT_RE_SCRIPT = /PORT\s*=\s*(\d{2,5})/;

function safeRead(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    return readFileSync(path, 'utf8');
  } catch { return null; }
}

export function inferPortFromSource(absDir) {
  if (!existsSync(absDir)) return null;
  const entries = readdirSync(absDir, { withFileTypes: true });

  // .env first (highest priority).
  for (const e of entries) {
    if (e.isFile() && (e.name === '.env' || e.name.startsWith('.env.'))) {
      const body = safeRead(join(absDir, e.name));
      const m = body && PORT_RE_DOTENV.exec(body);
      if (m) return parseInt(m[1], 10);
    }
  }

  // package.json scripts (next priority).
  const pkg = safeRead(join(absDir, 'package.json'));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      const scripts = (parsed && parsed.scripts) || {};
      for (const v of Object.values(scripts)) {
        const m = PORT_RE_SCRIPT.exec(String(v));
        if (m) return parseInt(m[1], 10);
      }
    } catch { /* skip */ }
  }

  // Top-level JS/TS files.
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.(js|mjs|cjs|ts|tsx)$/.test(e.name)) continue;
    const body = safeRead(join(absDir, e.name));
    const m = body && PORT_RE_LISTEN.exec(body);
    if (m) return parseInt(m[1], 10);
  }

  return null;
}
```

Also extend `inferDefaults` return:

```javascript
export function inferDefaults(absDir) {
  const pm = detectPackageManager(absDir);
  const compose = findComposeFile(absDir);
  const port = inferPortFromSource(absDir);
  return {
    directoryName: basename(absDir),
    packageManager: pm,
    suggestedCommand: suggestedCommandFor(pm),
    dotEnvFiles: listDotEnvFiles(absDir),
    composeFile: compose,
    composeServices: compose ? inferComposeServices(compose) : [],
    detectedPort: port,
    suggestedReadinessUrl: port ? `http://localhost:${port}/health` : null
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-register-port.test.mjs
npm test
git add tests/unit/dev-orchestrator-register-port.test.mjs bin/lib/dev-orchestrator/register.mjs
git commit -m "feat(dev-orchestrator/register): port detection from source for readiness suggestion [skip-bump]"
```

---

## Task 2: window_prefix + panel.layout — RED + GREEN

**Files:**
- Modify: `bin/lib/dev-orchestrator/config.mjs` — add `panel.layout` to allowed keys + enum validation
- Modify: `jelou/references/jlu-services.schema.json` — add `panel.layout` enum
- Modify: `bin/lib/dev-orchestrator/start.mjs` — read `defaults.window_prefix`, honor first-service `panel.layout` override
- Modify: `tests/unit/dev-orchestrator-config.test.mjs` — extend with panel.layout validation
- Modify: `tests/unit/dev-orchestrator-start.test.mjs` — extend with prefix + layout override

`panel.layout` enum: `tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`, `main-vertical`, `single-pane`. Setting `panel.layout` on the FIRST service entry overrides the auto-chosen layout for the whole window.

`defaults.window_prefix` is already part of the schema; wire it in to `start.mjs`.

- [ ] **Step 1: Extend config.mjs validation**

In the existing `ALLOWED_PANEL_KEYS` set, add `'layout'`. Add validation:

```javascript
const ALLOWED_LAYOUTS = new Set(['tiled', 'even-horizontal', 'even-vertical', 'main-horizontal', 'main-vertical', 'single-pane']);

// Inside the per-service validation loop, after assertAllowedKeys for panel:
if (svc.panel && svc.panel.layout !== undefined) {
  if (typeof svc.panel.layout !== 'string' || !ALLOWED_LAYOUTS.has(svc.panel.layout)) {
    errors.push(`${ctx}.panel.layout must be one of: ${[...ALLOWED_LAYOUTS].join(', ')}`);
  }
}
```

- [ ] **Step 2: Extend the JSON Schema doc**

In `jelou/references/jlu-services.schema.json`, under `$defs.service.properties.panel.properties`, add:

```json
"layout": { "enum": ["tiled", "even-horizontal", "even-vertical", "main-horizontal", "main-vertical", "single-pane"] }
```

- [ ] **Step 3: Extend start.mjs to read overrides**

In `bin/lib/dev-orchestrator/start.mjs`:

```javascript
import { effectiveDefaults } from './config.mjs';

function windowNameFor(slug, prefix = '') {
  const safe = slug || '_global';
  return `${prefix}jlu-dev-${safe}`;
}

function pickLayout(services, n) {
  const overridden = services.find(s => s.panel && s.panel.layout);
  if (overridden) return overridden.panel.layout;
  return chooseLayout(n);
}

// In planStart, replace `layout: chooseLayout(panes.length)` with:
//   layout: pickLayout((config.services || []), panes.length)
//
// In startDev, before computing windowName:
//   const prefix = effectiveDefaults(config).window_prefix || '';
//   const windowName = windowNameFor(slug, prefix);
```

- [ ] **Step 4: Extend tests**

In `tests/unit/dev-orchestrator-config.test.mjs`, add:

```javascript
test('rejects unknown panel.layout', () => {
  const result = validateConfig({
    version: 1,
    services: [{ name: 'a', path: '.', command: 'x', panel: { layout: 'nope' } }]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('layout')));
});

test('accepts known panel.layout', () => {
  const result = validateConfig({
    version: 1,
    services: [{ name: 'a', path: '.', command: 'x', panel: { layout: 'main-horizontal' } }]
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
```

In `tests/unit/dev-orchestrator-start.test.mjs`, add:

```javascript
test('window_prefix prepends to window name', () => {
  const calls = [];
  const runner = (args) => {
    calls.push([...args]);
    if (args[0] === '-V') return { status: 0, stdout: 'tmux 3.5\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const cfg = { version: 1, defaults: { window_prefix: 'foo-' }, services: [{ name: 'a', path: './a', command: 'x' }] };
  const result = startDev({
    config: cfg, workspaceRoot: '/work', slug: 'bar',
    env: { TMUX: '/tmp/x,1,2' }, runner, daemonSpawn: () => ({ pid: 0 })
  });
  assert.equal(result.windowName, 'foo-jlu-dev-bar');
});

test('panel.layout on first service overrides chosen layout', () => {
  const cfg = {
    version: 1,
    services: [
      { name: 'a', path: './a', command: 'x', panel: { layout: 'main-horizontal' } },
      { name: 'b', path: './b', command: 'y' }
    ]
  };
  const plan = planStart({ config: cfg, workspaceRoot: '/work', slug: '_global', windowName: 'jlu-dev-_global' });
  assert.equal(plan.layout, 'main-horizontal');
});
```

- [ ] **Step 5: Run + commit**

```bash
npm test
git add bin/lib/dev-orchestrator/config.mjs bin/lib/dev-orchestrator/start.mjs jelou/references/jlu-services.schema.json tests/unit/dev-orchestrator-config.test.mjs tests/unit/dev-orchestrator-start.test.mjs
git commit -m "feat(dev-orchestrator): window_prefix + panel.layout overrides [skip-bump]"
```

---

## Task 3: register-service workflow — wire port suggestion

**Files:**
- Modify: `jelou/workflows/register-service.md`

In Step 10 ("Ask for readiness"), use the `suggestedReadinessUrl` from `inferDefaults` output as the default for the http URL prompt.

- [ ] **Step 1: Edit Step 10 of the workflow**

Replace:

> `http: <url>` — follow-up free-text for the URL (default `http://localhost:3000/health`).

with:

> `http: <url>` — follow-up free-text for the URL. Default = `inferDefaults.suggestedReadinessUrl` if non-null, otherwise `http://localhost:3000/health`.

The `node -e` snippet in Step 4 already returns `suggestedReadinessUrl` (after Phase 5 Task 1) — pass it through to Step 10.

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/register-service.md
git commit -m "feat(register-service workflow): use inferred port for readiness URL default [skip-bump]"
```

---

## Task 4: README updates

**Files:**
- Modify: `README.md`

Add a section under existing skill documentation describing the dev orchestrator. Keep it concise — link to the reference doc (Task 5) for the deep dive.

- [ ] **Step 1: Read existing README**

```bash
head -50 README.md
```

Find where existing skills are documented; add the new section there.

- [ ] **Step 2: Append the new section**

```markdown
## Dev Environment Orchestrator (TMUX)

Spin up a multi-service dev environment in TMUX with one command, monitor for failures, and diagnose with structured fix proposals. Configure once via `jlu-services.json` at the workspace root.

### Quickstart

1. Register your services interactively:
   ```bash
   /jlu:register-service api
   /jlu:register-service web
   ```
2. Launch them:
   ```bash
   /jlu:start-dev
   ```
   Creates a TMUX window `jlu-dev-<task-slug>` (or `jlu-dev-_global` if no task is active), splits it into one pane per service, runs each command, and spawns a background daemon that monitors pane death + log patterns + readiness probes.
3. When a service fails, diagnose:
   ```bash
   /jlu:diagnose api
   ```
   Claude reads the recent events + a 100-line pane capture, returns a structured fix proposal (host or container) you can confirm to run.
4. Add a service mid-session:
   ```bash
   /jlu:add-service worker
   ```
5. Inspect logs anytime:
   ```bash
   /jlu:logs api --lines 50
   ```
6. Tear down:
   ```bash
   /jlu:stop-dev --kill-services
   ```

### Commands

| Command | Purpose |
|---|---|
| `/jlu:register-service [name]` | Interactive registration with smart inference |
| `/jlu:start-dev` | Boot all registered services in a TMUX window |
| `/jlu:stop-dev [--kill-services]` | Stop daemon; optionally kill window |
| `/jlu:add-service [name]` | Add a pane to a running window |
| `/jlu:logs [name] [--lines N]` | Print recent pane output, read-only |
| `/jlu:diagnose [name]` | Analyze a failing service and propose a fix |
| `/jlu:add-failure-pattern <service> <pattern>` | Append a regex; daemon hot-reloads via SIGHUP |

### Docker Compose support

For services running inside containers, declare a `runtime` block:

```json
{
  "name": "api",
  "runtime": {
    "type": "docker-compose",
    "compose_file": "./docker-compose.yml",
    "compose_service": "api"
  },
  "command": "docker compose up -d && docker compose -f ./docker-compose.yml exec api npm run start:dev"
}
```

The diagnoser will automatically run proposed fixes inside the container instead of on the host.

### Reference

See `jelou/references/dev-orchestrator.md` for full configuration schema, troubleshooting, and design rationale.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(README): document the JLU dev orchestrator commands [skip-bump]"
```

---

## Task 5: Operator-facing reference doc

**Files:**
- Create: `jelou/references/dev-orchestrator.md`

A complete operator reference: schema, command flow, troubleshooting, design rationale.

- [ ] **Step 1: Create the doc**

```markdown
# JLU Dev Orchestrator Reference

> Operator-facing documentation for the TMUX-based dev environment orchestrator. For the design rationale, see `docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md`.

## Configuration: `jlu-services.json`

The config lives at the workspace root. Schema reference: `jelou/references/jlu-services.schema.json`.

Minimal config:

\`\`\`json
{
  "version": 1,
  "services": [
    { "name": "api", "path": "./api", "command": "npm run dev" }
  ]
}
\`\`\`

Full-feature config: see `tests/fixtures/dev-orchestrator/configs/valid-full.json`.

### Top-level keys

- `version` (required, must be `1`).
- `defaults` (optional): defaults applied when per-service fields are omitted.
- `services` (required, array): one entry per service.

### `defaults` keys

- `log_failure_patterns` (string array of regexes; merged with per-service patterns).
- `readiness_timeout_seconds` (default 30).
- `log_capture_lines` (default 100; used by `/jlu:diagnose` and `/jlu:logs`).
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
- `panel` (object, optional): cosmetic. `{ title, color, layout }`.

## Command flow

### `/jlu:register-service [name]`

Interactive interview that detects:
- Package manager (pnpm/yarn/bun/npm) by lockfile.
- Docker Compose service name (when a compose file exists in the service's path).
- Common `.env*` files.
- HTTP port from source code (PORT env var, listen calls, package.json scripts).

Writes atomically to `jlu-services.json`.

### `/jlu:start-dev`

1. Resolves workspace root + task slug.
2. Plans the layout (single-pane / even-horizontal / tiled or per-service override).
3. Creates TMUX window `<window_prefix>jlu-dev-<task-slug>`.
4. Splits panes, sets titles + colors, runs each `cd <path> && [source <env_file> &&] <command>`.
5. Spawns the daemon detached.
6. Selects the new window.

### `/jlu:stop-dev [--kill-services]`

1. Reads PID file; sends SIGTERM (then SIGKILL after 5s).
2. Truncates `dev-events.log` (preserves inode for tailers).
3. With `--kill-services`, kills the TMUX window.

### `/jlu:diagnose [name]`

1. Reads the last 50 events for the service from `dev-events.log`.
2. Captures the last 100 lines of the service's pane.
3. Dispatches the `jlu-dev-diagnoser` agent with structured input.
4. Parses the structured output, displays cause + evidence + fix.
5. On user confirmation, runs the fix in the right context (host or container).
6. Optionally restarts the pane.
7. Optionally registers any newly identified pattern.

### `/jlu:add-service [name]`

Adds a pane to the running window without restarting other services. The daemon picks up the new pane on the next tick (no manual reload needed).

### `/jlu:logs [name] [--lines N]`

Read-only: prints the last N lines from the service's pane via `tmux capture-pane`.

### `/jlu:add-failure-pattern <service> <pattern>`

1. Appends the regex to `services[<service>].log_failure_patterns` (deduped).
2. Validates the regex compiles under `new RegExp(pattern, 'i')`.
3. Atomically writes the config.
4. Sends SIGHUP to the daemon if running. Daemon emits a `daemon_reload` event in the next tick.

## State directory

Per-workspace, per-task state lives at:

\`\`\`
~/.jlu/workspaces/<workspace-id>/<task-slug>/
├── daemon.pid          # PID file (1 line)
├── daemon.lock         # JSON: { pid, ts }
├── daemon.stderr       # Daemon's stderr, rotates at 1MB
├── dev-events.log      # JSONL append-only event stream
├── window-name         # tmux window name (1 line)
└── pane-map.json       # Cache: { service_name: pane_id }
\`\`\`

`<workspace-id>` is `sha256(absolute_workspace_path).slice(0, 12)`.
`<task-slug>` is resolved per the 5-layer detection (override → worktree path → branch → TASKS.md scan → `_global`).

## Daemon model

The daemon is a long-running Node process spawned detached by `/jlu:start-dev`. Each tick (default 2s):

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

\`\`\`json
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
\`\`\`

When the diagnoser proposes a fix for a `docker-compose` service, the command is automatically substituted into the container's exec template (default: `docker compose -f {compose_file} exec {compose_service} {cmd}`). Host-side install commands are never proposed for containerized services.

## Troubleshooting

### "tmux: command not found"

Install tmux: `brew install tmux` (macOS) or `apt install tmux` (Linux). Minimum version: 3.0.

### Daemon not picking up a new failure pattern

Verify the daemon is running: `cat ~/.jlu/workspaces/<id>/<slug>/daemon.pid` and `kill -0 $(cat ...)`. Then send SIGHUP manually: `kill -HUP $(cat ...)`. The daemon should emit `daemon_reload` to `dev-events.log` within one tick.

### Window already exists, can't restart

`/jlu:start-dev` will detect the existing window and ask whether to reuse, kill+restart, or cancel. To force a clean restart from outside Claude: `tmux kill-window -t jlu-dev-<slug>`, then re-run `/jlu:start-dev`.

### Daemon orphaned after I closed the window manually

The daemon polls the window every tick; when it disappears, the daemon exits cleanly within one tick (default 2s). If the lock file is stale, the next `/jlu:start-dev` will take over the lock automatically.

### Multi-task isolation

Two parallel tasks (worktrees or branches) get separate state directories under `~/.jlu/workspaces/<workspace-id>/<task-slug>/`. The daemon for each is independent; their TMUX windows are named distinctly.

## Design references

- Spec: \`docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md\`
- Phase 1 plan (foundations): \`docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator.md\`
- Phase 2 plan (TMUX): \`docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase2-tmux.md\`
- Phase 3 plan (daemon): \`docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase3-daemon.md\`
- Phase 4 plan (diagnose + add + logs): \`docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase4-diagnose.md\`
- Phase 5 plan (this polish): \`docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase5-polish.md\`
```

- [ ] **Step 2: Commit**

```bash
git add jelou/references/dev-orchestrator.md
git commit -m "docs(reference/dev-orchestrator): operator-facing reference [skip-bump]"
```

---

## Task 6: OpenCode parity audit suite

**Files:**
- Create: `tests/pressure/opencode-parity.test.mjs`

A pressure test that audits every dev-orchestrator skill: confirms `skills/<name>/SKILL.md`, `jelou/workflows/<name>.md`, and `.opencode/commands/jlu-<name>.md` exist with valid frontmatter. Also confirms the diagnoser agent is dual-published.

- [ ] **Step 1: Write the audit**

```javascript
// tests/pressure/opencode-parity.test.mjs
//
// Pressure test: every JLU dev-orchestrator skill ships its three runtime
// files, and the diagnoser agent ships in both runtimes.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEV_ORCHESTRATOR_SKILLS = [
  'register-service',
  'start-dev',
  'stop-dev',
  'add-service',
  'diagnose',
  'logs',
  'add-failure-pattern'
];

function readFm(path) {
  const body = readFileSync(path, 'utf8');
  const m = /^---\n([\s\S]*?)\n---/.exec(body);
  if (!m) throw new Error(`no frontmatter in ${path}`);
  return m[1];
}

describe('dev-orchestrator skills — full trio per skill', () => {
  for (const name of DEV_ORCHESTRATOR_SKILLS) {
    test(`${name}: skill + workflow + opencode all present`, () => {
      const skill = join(ROOT, 'skills', name, 'SKILL.md');
      const workflow = join(ROOT, 'jelou', 'workflows', `${name}.md`);
      const opencode = join(ROOT, '.opencode', 'commands', `jlu-${name}.md`);
      assert.equal(existsSync(skill), true, `missing ${skill}`);
      assert.equal(existsSync(workflow), true, `missing ${workflow}`);
      assert.equal(existsSync(opencode), true, `missing ${opencode}`);
    });

    test(`${name}: skill frontmatter has name + description + allowed-tools`, () => {
      const skill = join(ROOT, 'skills', name, 'SKILL.md');
      const fm = readFm(skill);
      assert.match(fm, new RegExp(`name:\\s*${name}\\s*$`, 'm'));
      assert.match(fm, /description:/);
      assert.match(fm, /allowed-tools:/);
    });

    test(`${name}: opencode command frontmatter has agent: build`, () => {
      const opencode = join(ROOT, '.opencode', 'commands', `jlu-${name}.md`);
      const fm = readFm(opencode);
      assert.match(fm, /agent:\s*build/);
    });
  }
});

describe('jlu-dev-diagnoser agent — dual-published', () => {
  test('claude code agents/jlu-dev-diagnoser.md exists', () => {
    assert.equal(existsSync(join(ROOT, 'agents', 'jlu-dev-diagnoser.md')), true);
  });

  test('opencode .opencode/agents/jlu-dev-diagnoser.md exists', () => {
    assert.equal(existsSync(join(ROOT, '.opencode', 'agents', 'jlu-dev-diagnoser.md')), true);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
node --test tests/pressure/opencode-parity.test.mjs
git add tests/pressure/opencode-parity.test.mjs
git commit -m "test(pressure/opencode-parity): audit dev-orchestrator skill trios + diagnoser dual-publish [skip-bump]"
```

---

## Task 7: Register new skills in skills.test.mjs (conditional)

**Files:**
- Modify: `tests/pressure/skills.test.mjs` (only if it exists and asserts a known-skill list)

- [ ] **Step 1: Check whether the test exists**

```bash
ls tests/pressure/skills.test.mjs 2>/dev/null && head -30 tests/pressure/skills.test.mjs
```

If the file does NOT exist, skip this task entirely and proceed to Task 8.

If it exists and contains a hard-coded list of skill names, add the seven new ones: `register-service`, `start-dev`, `stop-dev`, `add-service`, `diagnose`, `logs`, `add-failure-pattern`.

If it exists but only enumerates the directory dynamically, nothing to do.

- [ ] **Step 2: Run + commit (only if you modified the file)**

```bash
npm test
git add tests/pressure/skills.test.mjs
git commit -m "test(pressure/skills): register seven new dev-orchestrator skills [skip-bump]"
```

---

## Task 8: Final cross-phase code review

**Files:** none (review only).

- [ ] **Step 1: Dispatch the final reviewer**

Use a fresh `superpowers:code-reviewer` subagent with this brief:

> Final pre-merge review of `feature/dev-orchestrator` covering five phases. Branch contains foundations (Phase 1), TMUX integration (Phase 2), daemon (Phase 3), diagnose + add + logs (Phase 4), and polish (Phase 5).
>
> SHAs: `dd090fd` (origin/main when branch was created) → HEAD.
>
> Verify:
> 1. `npm test` green; integration tests pass or skip cleanly without tmux.
> 2. `tests/unit/harness-parity.test.mjs` and `tests/pressure/opencode-parity.test.mjs` both green.
> 3. No leftover `TODO`/`TBD`/scaffolding in any file.
> 4. Coding rules respected throughout: ESM `.mjs`, `spawnSync` with array args, no shell-string forms, `[skip-bump]` on every commit.
> 5. CHANGELOG entries reasonable per release commit.
> 6. README and reference doc match what shipped.
>
> Report: Strengths, Issues (Critical/Important/Minor), Final verdict (ready to merge / needs changes).

- [ ] **Step 2: Address any Critical/Important issues**

If the reviewer flags issues, dispatch fix subagents per phase. Then re-run the reviewer until verdict is `ready to merge`.

- [ ] **Step 3: Commit any review fixes**

Each fix lands as a separate commit ending with `[skip-bump]`.

---

## Task 9: Push the branch and open the PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
git push -u origin feature/dev-orchestrator
```

- [ ] **Step 2: Open the PR via gh CLI**

Title (under 70 chars): `feat: TMUX dev environment orchestrator (5 phases)`

Body via HEREDOC:

```bash
gh pr create --title "feat: TMUX dev environment orchestrator (5 phases)" --body "$(cat <<'EOF'
## Summary

Adds a TMUX-based dev environment orchestrator to the plugin: 7 new commands, 1 specialized agent, a long-running monitor daemon, and full Claude Code + OpenCode runtime parity. Spec-driven, TDD-built, shipped across 5 self-contained phases on this branch.

- Phase 1 (foundations): JSON Schema validator, workspace + task-slug resolvers, state primitives, and \`/jlu:register-service\` interactive registration.
- Phase 2 (TMUX): tmux wrapper + \`/jlu:start-dev\` + \`/jlu:stop-dev\` (no daemon yet).
- Phase 3 (daemon): long-running monitor with HTTP/TCP readiness probes, log-pattern matching, OS notifications for hard failures, hot-reload via SIGHUP, plus \`/jlu:add-failure-pattern\`.
- Phase 4 (diagnose + add + logs): \`jlu-dev-diagnoser\` agent (Opus tier), \`/jlu:diagnose\`, \`/jlu:add-service\`, \`/jlu:logs\`. Hard rule: container fixes always run via \`exec_template\`.
- Phase 5 (polish): port detection in register, layout overrides, README + reference doc, parity audit, final review.

Documents:
- Spec: docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md
- Per-phase plans under docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator*.md
- Operator reference: jelou/references/dev-orchestrator.md

## Test plan

- [ ] npm test green (unit suite, including new dev-orchestrator suites + harness/parity audits).
- [ ] node --test tests/integration/dev-orchestrator/*.test.mjs green (skips cleanly without tmux).
- [ ] Manual smoke in Claude Code: register two services, start, kill a pane, diagnose, add-service, logs, stop.
- [ ] Manual smoke in OpenCode: same flow with /jlu-* command names.
EOF
)"
```

- [ ] **Step 3: Capture the PR URL** and surface to the user.

---

## Self-Review

| Spec section / Phase 5 deliverable | Implemented in |
|---|---|
| Smart inference: port detection from source | Task 1 |
| `defaults.window_prefix` honored at runtime | Task 2 |
| `services[].panel.layout` override | Task 2 |
| README updates | Task 4 |
| Operator-facing reference doc | Task 5 |
| OpenCode parity audit suite | Task 6 |
| pressure/skills.test.mjs registration | Task 7 (conditional) |
| Final code review across all phases | Task 8 |
| Branch push + PR | Task 9 |

**Branch state at the end of Phase 5:** ready to merge. Around 50+ commits across all five phases, ~3000+ lines of new code + tests + docs, full unit + integration suite green, parity tests green.

---

## What's NEXT (post-merge, future work)

Out of scope for this PR but worth tracking:

- `/jlu:remove-service` (kill a single pane cleanly while leaving the daemon running).
- Workspace-level `pre_boot` block to avoid redundant `docker compose up`.
- Auto-rotation of `dev-events.log` past 5MB.
- Per-task `.jlu/local-services.json` overrides on top of the workspace JSON.
- Push notifications inside Claude Code via `PushNotification` deferred tool.
- Windows-native support (would require non-tmux equivalent).
