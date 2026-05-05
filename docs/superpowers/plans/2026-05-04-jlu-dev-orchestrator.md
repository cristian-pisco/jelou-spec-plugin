# JLU Dev Orchestrator — Phase 1 (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation for the dev orchestrator: JSON config schema + validator, workspace and task-context resolvers, state directory primitives, and the first user-facing skill — `/jlu:register-service` (with its OpenCode mirror) — so users can author and validate `jlu-services.json` end-to-end. No TMUX, no daemon yet (those land in Phase 2 and 3 plans).

**Architecture:** All Phase 1 logic lives in pure-Node `bin/lib/dev-orchestrator/*.mjs` modules. The single user-facing skill `register-service` ships in both runtimes (Claude Code `skills/register-service/SKILL.md` + OpenCode `.opencode/commands/jlu-register-service.md`) sharing one workflow at `jelou/workflows/register-service.md`. JSON validation is hand-rolled (no new deps). Workspace and task-slug resolution follow the rules in the spec § "Task and Workspace Resolution".

**Tech Stack:** Node 20+ ESM (`.mjs`). `node:test` for unit tests. Hand-rolled JSON Schema validation. All child-process calls use `spawnSync`/`spawn` with array args (never shell-string `exec`). Claude Code Skill format + OpenCode command format (existing dual-runtime contract in `jelou/references/claude-code-runtime.md`).

**Spec:** `docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md`

**Phase 1 deliverable (shippable on its own):** A user can run `/jlu:register-service` (or `/jlu-register-service` in OpenCode) inside any project, answer the interview, and end up with a valid `jlu-services.json` at the workspace root. State directory primitives are in place for Phase 2/3 to spawn daemons. No TMUX integration, no daemon, no diagnose flow yet.

**Out of scope for this plan (covered by later plans):**
- Phase 2: TMUX wrapper + minimal `start-dev`/`stop-dev`.
- Phase 3: Daemon loop + readiness probes + notifications + `add-failure-pattern`.
- Phase 4: Diagnose agent + `add-service` + `logs`.
- Phase 5: Smart inference polish, README updates, OpenCode parity audit suite.

Each later phase will get its own plan file under `docs/superpowers/plans/`.

---

## File Structure (Phase 1 only)

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `bin/lib/dev-orchestrator/config.mjs` | Read/write/validate `jlu-services.json`. Atomic writes. |
| `bin/lib/dev-orchestrator/workspace.mjs` | Resolve workspace root (walk-up). Compute `workspace-id`. |
| `bin/lib/dev-orchestrator/task-context.mjs` | Resolve task-slug from cwd / branch / TASKS.md. |
| `bin/lib/dev-orchestrator/state.mjs` | State directory primitives under `~/.jlu/workspaces/.../`. |
| `bin/lib/dev-orchestrator/register.mjs` | Implements `/jlu:register-service` core (validation, atomic write, inference helpers). |
| `jelou/references/jlu-services.schema.json` | JSON Schema for `jlu-services.json`. |
| `jelou/workflows/register-service.md` | Shared workflow for `register-service`. |
| `skills/register-service/SKILL.md` | Claude Code launcher. |
| `.opencode/commands/jlu-register-service.md` | OpenCode launcher. |
| `tests/unit/dev-orchestrator-config.test.mjs` | Unit tests for `config.mjs`. |
| `tests/unit/dev-orchestrator-workspace.test.mjs` | Unit tests for `workspace.mjs`. |
| `tests/unit/dev-orchestrator-task-context.test.mjs` | Unit tests for `task-context.mjs`. |
| `tests/unit/dev-orchestrator-state.test.mjs` | Unit tests for `state.mjs`. |
| `tests/unit/dev-orchestrator-register.test.mjs` | Unit tests for `register.mjs` inference helpers. |
| `tests/fixtures/dev-orchestrator/configs/valid-minimal.json` | Smallest valid config. |
| `tests/fixtures/dev-orchestrator/configs/valid-full.json` | Full-feature config. |
| `tests/fixtures/dev-orchestrator/configs/invalid-duplicate-name.json` | Schema validation fixture. |
| `tests/fixtures/dev-orchestrator/configs/invalid-bad-regex.json` | Schema validation fixture. |
| `tests/fixtures/dev-orchestrator/configs/invalid-runtime.json` | Schema validation fixture. |

### Files to MODIFY

| Path | Change |
|------|--------|
| (none in Phase 1) | README and `tests/pressure/skills.test.mjs` updates land in Phase 5 plan. |

### Workspace-side artifacts (runtime, NOT in plugin repo)

```
<workspace-root>/jlu-services.json
~/.jlu/
└── workspaces/
    └── <workspace-id>/
        ├── meta.json
        └── <task-slug>/  (or _global)
            ├── daemon.pid
            ├── daemon.lock
            ├── daemon.stderr
            ├── dev-events.log
            ├── window-name
            └── pane-map.json
```

### Coding rule (applies to every Node module)

Every child-process call MUST use `spawnSync`/`spawn` with an array of args — never the shell-string `exec`/`execSync` form. Pattern:

```javascript
import { spawnSync } from 'node:child_process';
const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
if (r.status !== 0) { /* handle */ }
const stdout = r.stdout.trim();
```

This avoids shell-injection vulnerabilities and is what the codebase's pre-commit hook expects.

---

## Task 0: Pre-flight — clean base, tools available

**Files:** none (verification only).

- [ ] **Step 1: Confirm clean working tree on main**

Run:
```bash
git status --short
git rev-parse --abbrev-ref HEAD
```

Expected: empty status output and branch `main`. If not, stop and resolve before continuing.

- [ ] **Step 2: Sync with remote main**

Run:
```bash
git fetch origin
git rebase origin/main
```

Expected: "Successfully rebased and updated" or "Current branch main is up to date." If conflicts surface, **stop and surface to user** — do not continue with stale base.

- [ ] **Step 3: Verify required tools**

Run:
```bash
node --version
tmux -V
which notify-send 2>/dev/null || which osascript 2>/dev/null || echo "no notifier (warn only)"
```

Expected: Node 20.x+, tmux 3.0+. Notifier missing is acceptable.

- [ ] **Step 4: Create the working branch**

Run:
```bash
git checkout -b feature/dev-orchestrator
```

Expected: `Switched to a new branch 'feature/dev-orchestrator'`.

---

## Task 1: JSON Schema validator — RED

**Files:**
- Create: `tests/unit/dev-orchestrator-config.test.mjs`
- Create: `tests/fixtures/dev-orchestrator/configs/valid-minimal.json`
- Create: `tests/fixtures/dev-orchestrator/configs/valid-full.json`
- Create: `tests/fixtures/dev-orchestrator/configs/invalid-duplicate-name.json`
- Create: `tests/fixtures/dev-orchestrator/configs/invalid-bad-regex.json`
- Create: `tests/fixtures/dev-orchestrator/configs/invalid-runtime.json`

The validator accepts a parsed JSON object and returns `{ valid: boolean, errors: string[] }`. Schema rules from spec §`jlu-services.json` Schema (v1).

- [ ] **Step 1: Create the valid-minimal fixture**

```json
// tests/fixtures/dev-orchestrator/configs/valid-minimal.json
{
  "version": 1,
  "services": [
    { "name": "api", "path": "./api", "command": "npm run dev" }
  ]
}
```

- [ ] **Step 2: Create the valid-full fixture**

```json
// tests/fixtures/dev-orchestrator/configs/valid-full.json
{
  "version": 1,
  "defaults": {
    "log_failure_patterns": ["EADDRINUSE", "Cannot find module"],
    "readiness_timeout_seconds": 30,
    "log_capture_lines": 100,
    "poll_interval_ms": 2000,
    "notification_cooldown_seconds": 60,
    "window_prefix": ""
  },
  "services": [
    {
      "name": "redis",
      "path": ".",
      "command": "docker compose up redis",
      "env_file": null,
      "depends_on": [],
      "readiness": { "type": "tcp", "host": "localhost", "port": 6379, "timeout_seconds": 15 },
      "log_failure_patterns": [],
      "panel": { "title": "redis", "color": "yellow" }
    },
    {
      "name": "api",
      "path": "./services/api",
      "runtime": {
        "type": "docker-compose",
        "compose_file": "./docker-compose.yml",
        "compose_service": "api",
        "exec_template": "docker compose -f {compose_file} exec {compose_service} {cmd}"
      },
      "command": "docker compose up -d && docker compose exec api npm run start:dev",
      "env_file": ".env",
      "depends_on": ["redis"],
      "readiness": { "type": "http", "url": "http://localhost:3000/health", "expect_status": 200, "timeout_seconds": 30 },
      "log_failure_patterns": ["ECONNREFUSED.*redis"],
      "panel": { "title": "API", "color": "cyan" }
    }
  ]
}
```

- [ ] **Step 3: Create the invalid-duplicate-name fixture**

```json
// tests/fixtures/dev-orchestrator/configs/invalid-duplicate-name.json
{
  "version": 1,
  "services": [
    { "name": "api", "path": "./a", "command": "x" },
    { "name": "api", "path": "./b", "command": "y" }
  ]
}
```

- [ ] **Step 4: Create the invalid-bad-regex fixture**

```json
// tests/fixtures/dev-orchestrator/configs/invalid-bad-regex.json
{
  "version": 1,
  "services": [
    { "name": "api", "path": "./a", "command": "x", "log_failure_patterns": ["[unclosed"] }
  ]
}
```

- [ ] **Step 5: Create the invalid-runtime fixture (docker-compose without compose_service)**

```json
// tests/fixtures/dev-orchestrator/configs/invalid-runtime.json
{
  "version": 1,
  "services": [
    {
      "name": "api",
      "path": "./api",
      "command": "x",
      "runtime": { "type": "docker-compose", "compose_file": "./docker-compose.yml" }
    }
  ]
}
```

- [ ] **Step 6: Create the test file**

```javascript
// tests/unit/dev-orchestrator-config.test.mjs
//
// Run: `node --test tests/unit/dev-orchestrator-config.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateConfig } from '../../bin/lib/dev-orchestrator/config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures', 'dev-orchestrator', 'configs');

function load(name) {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

describe('validateConfig — happy path', () => {
  test('accepts the minimal valid config', () => {
    const result = validateConfig(load('valid-minimal.json'));
    assert.equal(result.valid, true, `errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.errors, []);
  });

  test('accepts the full valid config', () => {
    const result = validateConfig(load('valid-full.json'));
    assert.equal(result.valid, true, `errors: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(result.errors, []);
  });
});

describe('validateConfig — invalid configs', () => {
  test('rejects duplicate service names', () => {
    const result = validateConfig(load('invalid-duplicate-name.json'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('duplicate')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects unparseable regex in log_failure_patterns', () => {
    const result = validateConfig(load('invalid-bad-regex.json'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.toLowerCase().includes('regex')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects docker-compose runtime without compose_service', () => {
    const result = validateConfig(load('invalid-runtime.json'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('compose_service')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects missing required services field', () => {
    const result = validateConfig({ version: 1 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('services')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects wrong version', () => {
    const result = validateConfig({ version: 2, services: [] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('version')), `errors: ${result.errors.join(', ')}`);
  });

  test('rejects invalid name pattern', () => {
    const result = validateConfig({
      version: 1,
      services: [{ name: 'API_GATEWAY', path: '.', command: 'x' }]
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('name')), `errors: ${result.errors.join(', ')}`);
  });
});
```

- [ ] **Step 7: Run tests — confirm fail**

Run: `node --test tests/unit/dev-orchestrator-config.test.mjs`

Expected: `Cannot find module .../config.mjs` or `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 8: Commit RED**

```bash
git add tests/unit/dev-orchestrator-config.test.mjs tests/fixtures/dev-orchestrator/
git commit -m "test(dev-orchestrator/config): red — validator contract"
```

---

## Task 2: JSON Schema validator — GREEN

**Files:**
- Create: `bin/lib/dev-orchestrator/config.mjs`
- Create: `jelou/references/jlu-services.schema.json`

- [ ] **Step 1: Write the JSON Schema reference doc**

```json
// jelou/references/jlu-services.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://jelou.github.io/jlu-services.schema.json",
  "title": "jlu-services.json",
  "type": "object",
  "required": ["version", "services"],
  "properties": {
    "version": { "const": 1 },
    "defaults": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "log_failure_patterns": { "type": "array", "items": { "type": "string" } },
        "readiness_timeout_seconds": { "type": "integer", "minimum": 1 },
        "log_capture_lines": { "type": "integer", "minimum": 1 },
        "poll_interval_ms": { "type": "integer", "minimum": 250 },
        "notification_cooldown_seconds": { "type": "integer", "minimum": 0 },
        "window_prefix": { "type": "string" }
      }
    },
    "services": { "type": "array", "items": { "$ref": "#/$defs/service" } }
  },
  "$defs": {
    "service": {
      "type": "object",
      "required": ["name", "path", "command"],
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
        "path": { "type": "string", "minLength": 1 },
        "command": { "type": "string", "minLength": 1 },
        "env_file": { "type": ["string", "null"] },
        "depends_on": { "type": "array", "items": { "type": "string" } },
        "readiness": {
          "oneOf": [
            { "type": "object", "required": ["type", "url"], "properties": {
              "type": { "const": "http" },
              "url": { "type": "string", "format": "uri" },
              "expect_status": { "type": "integer" },
              "timeout_seconds": { "type": "integer", "minimum": 1 }
            }},
            { "type": "object", "required": ["type", "host", "port"], "properties": {
              "type": { "const": "tcp" },
              "host": { "type": "string" },
              "port": { "type": "integer", "minimum": 1, "maximum": 65535 },
              "timeout_seconds": { "type": "integer", "minimum": 1 }
            }}
          ]
        },
        "runtime": {
          "type": "object",
          "required": ["type"],
          "properties": {
            "type": { "enum": ["host", "docker-compose"] },
            "compose_file": { "type": "string" },
            "compose_service": { "type": "string" },
            "exec_template": { "type": "string" }
          },
          "if": { "properties": { "type": { "const": "docker-compose" } } },
          "then": { "required": ["compose_file", "compose_service"] }
        },
        "log_failure_patterns": { "type": "array", "items": { "type": "string" } },
        "panel": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "title": { "type": "string" },
            "color": { "type": "string" }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the validator module**

```javascript
// bin/lib/dev-orchestrator/config.mjs
//
// Read / write / validate jlu-services.json. Atomic writes via tmpfile + rename.
// Hand-rolled validation (no external deps) covering the rules in the schema doc.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export const DEFAULTS = Object.freeze({
  log_failure_patterns: [
    'EADDRINUSE',
    'Cannot find module',
    'ENOENT.*node_modules',
    'ECONNREFUSED',
    'no such file or directory',
    'container .* not running',
    'service ".*" is not running'
  ],
  readiness_timeout_seconds: 30,
  log_capture_lines: 100,
  poll_interval_ms: 2000,
  notification_cooldown_seconds: 60,
  window_prefix: ''
});

export function validateConfig(cfg) {
  const errors = [];

  if (!cfg || typeof cfg !== 'object') {
    return { valid: false, errors: ['config must be an object'] };
  }

  if (cfg.version !== 1) {
    errors.push(`version must be 1 (got ${JSON.stringify(cfg.version)})`);
  }

  if (!Array.isArray(cfg.services)) {
    errors.push('services must be an array');
    return { valid: false, errors };
  }

  const seen = new Set();
  cfg.services.forEach((svc, idx) => {
    const ctx = `services[${idx}]`;
    if (!svc || typeof svc !== 'object') {
      errors.push(`${ctx} must be an object`);
      return;
    }
    if (typeof svc.name !== 'string' || !NAME_RE.test(svc.name)) {
      errors.push(`${ctx}.name must match /^[a-z0-9][a-z0-9-]*$/ (got ${JSON.stringify(svc.name)})`);
    } else if (seen.has(svc.name)) {
      errors.push(`${ctx}.name duplicate: ${svc.name}`);
    } else {
      seen.add(svc.name);
    }
    if (typeof svc.path !== 'string' || !svc.path.length) errors.push(`${ctx}.path must be a non-empty string`);
    if (typeof svc.command !== 'string' || !svc.command.length) errors.push(`${ctx}.command must be a non-empty string`);
    if (svc.env_file !== undefined && svc.env_file !== null && typeof svc.env_file !== 'string') {
      errors.push(`${ctx}.env_file must be string or null`);
    }
    if (svc.depends_on !== undefined && !Array.isArray(svc.depends_on)) {
      errors.push(`${ctx}.depends_on must be an array of strings`);
    }
    if (svc.log_failure_patterns) {
      if (!Array.isArray(svc.log_failure_patterns)) {
        errors.push(`${ctx}.log_failure_patterns must be an array`);
      } else {
        svc.log_failure_patterns.forEach((p, pi) => {
          try { new RegExp(p, 'i'); }
          catch (e) { errors.push(`${ctx}.log_failure_patterns[${pi}] invalid regex: ${e.message}`); }
        });
      }
    }
    if (svc.runtime) {
      const r = svc.runtime;
      if (r.type !== 'host' && r.type !== 'docker-compose') {
        errors.push(`${ctx}.runtime.type must be "host" or "docker-compose"`);
      }
      if (r.type === 'docker-compose') {
        if (typeof r.compose_file !== 'string' || !r.compose_file) errors.push(`${ctx}.runtime.compose_file required for docker-compose`);
        if (typeof r.compose_service !== 'string' || !r.compose_service) errors.push(`${ctx}.runtime.compose_service required for docker-compose`);
      }
    }
    if (svc.readiness) {
      const r = svc.readiness;
      if (r.type === 'http') {
        if (typeof r.url !== 'string') errors.push(`${ctx}.readiness.url required for http`);
      } else if (r.type === 'tcp') {
        if (typeof r.host !== 'string') errors.push(`${ctx}.readiness.host required for tcp`);
        if (!Number.isInteger(r.port)) errors.push(`${ctx}.readiness.port required for tcp`);
      } else {
        errors.push(`${ctx}.readiness.type must be "http" or "tcp"`);
      }
    }
  });

  if (cfg.defaults && cfg.defaults.log_failure_patterns) {
    cfg.defaults.log_failure_patterns.forEach((p, i) => {
      try { new RegExp(p, 'i'); }
      catch (e) { errors.push(`defaults.log_failure_patterns[${i}] invalid regex: ${e.message}`); }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function readConfig(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

export function writeConfigAtomic(absPath, cfg) {
  const v = validateConfig(cfg);
  if (!v.valid) {
    const err = new Error(`refusing to write invalid config:\n${v.errors.join('\n')}`);
    err.code = 'INVALID_CONFIG';
    throw err;
  }
  const dir = dirname(absPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${absPath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  renameSync(tmp, absPath);
}

export function effectiveDefaults(cfg) {
  return { ...DEFAULTS, ...(cfg.defaults || {}) };
}

export function effectiveFailurePatterns(cfg, service) {
  const eff = effectiveDefaults(cfg);
  const merged = [...(eff.log_failure_patterns || []), ...(service.log_failure_patterns || [])];
  return [...new Set(merged)];
}
```

- [ ] **Step 3: Run tests — confirm pass**

Run: `node --test tests/unit/dev-orchestrator-config.test.mjs`

Expected: `tests 8 passed 8`.

- [ ] **Step 4: Commit GREEN**

```bash
git add bin/lib/dev-orchestrator/config.mjs jelou/references/jlu-services.schema.json
git commit -m "feat(dev-orchestrator/config): green — JSON schema + validator + atomic write"
```

---

## Task 3: Workspace resolver — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-workspace.test.mjs`
- Create: `bin/lib/dev-orchestrator/workspace.mjs`

The resolver walks up from `cwd` looking for (in order): a directory with `jlu-services.json`, a directory with both `registry/services.yaml` and `tasks/`, or the git toplevel. Returns `{ root, configPath, workspaceId }` where `workspaceId` is the first 12 chars of `sha256(absolute root)`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/dev-orchestrator-workspace.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveWorkspace, computeWorkspaceId } from '../../bin/lib/dev-orchestrator/workspace.mjs';

function mktree() { return mkdtempSync(join(tmpdir(), 'jlu-ws-')); }

describe('resolveWorkspace — direct config hit', () => {
  test('finds jlu-services.json in cwd', () => {
    const root = mktree();
    writeFileSync(join(root, 'jlu-services.json'), '{}');
    const r = resolveWorkspace(root);
    assert.equal(r.root, root);
    assert.equal(r.configPath, join(root, 'jlu-services.json'));
  });

  test('finds jlu-services.json in ancestor', () => {
    const root = mktree();
    writeFileSync(join(root, 'jlu-services.json'), '{}');
    const sub = join(root, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    const r = resolveWorkspace(sub);
    assert.equal(r.root, root);
  });
});

describe('resolveWorkspace — canonical workspace structure', () => {
  test('finds registry/services.yaml + tasks/ pair', () => {
    const root = mktree();
    mkdirSync(join(root, 'registry'));
    writeFileSync(join(root, 'registry', 'services.yaml'), 'services: []');
    mkdirSync(join(root, 'tasks'));
    const r = resolveWorkspace(root);
    assert.equal(r.root, root);
    assert.equal(r.configPath, join(root, 'jlu-services.json'));
  });
});

describe('computeWorkspaceId', () => {
  test('returns first 12 chars of sha256 of absolute path', () => {
    const id = computeWorkspaceId('/abs/path');
    const expected = createHash('sha256').update('/abs/path').digest('hex').slice(0, 12);
    assert.equal(id, expected);
    assert.equal(id.length, 12);
  });

  test('is deterministic', () => {
    assert.equal(computeWorkspaceId('/x'), computeWorkspaceId('/x'));
  });
});
```

- [ ] **Step 2: Run test — confirm fail**

Run: `node --test tests/unit/dev-orchestrator-workspace.test.mjs`

Expected: `Cannot find module .../workspace.mjs`.

- [ ] **Step 3: Implement the module**

```javascript
// bin/lib/dev-orchestrator/workspace.mjs
//
// Workspace root resolver + workspace ID. Walk-up from cwd in priority order:
//   1. directory containing jlu-services.json
//   2. directory containing registry/services.yaml AND tasks/
//   3. git rev-parse --show-toplevel
// Returns { root, configPath, workspaceId }.
// All child-process calls use spawnSync with array args (no shell).

import { existsSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function computeWorkspaceId(absolutePath) {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 12);
}

function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

function gitToplevel(cwd) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

export function resolveWorkspace(startDir) {
  const start = isAbsolute(startDir) ? startDir : resolve(startDir);
  let cur = start;

  while (true) {
    if (isFile(join(cur, 'jlu-services.json'))) return finalize(cur);
    if (isFile(join(cur, 'registry', 'services.yaml')) && isDir(join(cur, 'tasks'))) return finalize(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  const top = gitToplevel(start);
  if (top) return finalize(top);

  const err = new Error('no workspace root found — run /jlu:register-service from inside a project');
  err.code = 'NO_WORKSPACE';
  throw err;
}

function finalize(root) {
  return {
    root,
    configPath: join(root, 'jlu-services.json'),
    workspaceId: computeWorkspaceId(root)
  };
}
```

- [ ] **Step 4: Run test — confirm pass**

Run: `node --test tests/unit/dev-orchestrator-workspace.test.mjs`

Expected: `tests 4 passed 4`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/dev-orchestrator-workspace.test.mjs bin/lib/dev-orchestrator/workspace.mjs
git commit -m "feat(dev-orchestrator/workspace): resolve workspace root + compute id"
```

---

## Task 4: Task context resolver — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-task-context.test.mjs`
- Create: `bin/lib/dev-orchestrator/task-context.mjs`

Resolves `task-slug` in priority order: explicit override → `.worktrees/<slug>/` path → branch matching `task/<slug>`/`spec/<slug>`/`<slug>` → workspace TASKS.md scan → `_global`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/dev-orchestrator-task-context.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTaskSlug } from '../../bin/lib/dev-orchestrator/task-context.mjs';

function mkws() {
  const root = mkdtempSync(join(tmpdir(), 'jlu-tc-'));
  mkdirSync(join(root, 'tasks'), { recursive: true });
  return root;
}

describe('resolveTaskSlug — explicit override wins', () => {
  test('returns the explicit override', () => {
    const root = mkws();
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, override: 'my-task' });
    assert.equal(slug, 'my-task');
  });
});

describe('resolveTaskSlug — worktree path detection', () => {
  test('extracts slug from .worktrees/<slug>/ path', () => {
    const root = mkws();
    const cwd = join(root, 'service-a', '.worktrees', 'auth-refactor', 'sub');
    mkdirSync(cwd, { recursive: true });
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd });
    assert.equal(slug, 'auth-refactor');
  });
});

describe('resolveTaskSlug — branch-name detection', () => {
  test('matches task/<slug> branch with TASKS.md present', () => {
    const root = mkws();
    mkdirSync(join(root, 'tasks', 'auth-refactor'));
    writeFileSync(join(root, 'tasks', 'auth-refactor', 'TASKS.md'), '# State: implementing');
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'task/auth-refactor' });
    assert.equal(slug, 'auth-refactor');
  });

  test('matches spec/<slug> branch', () => {
    const root = mkws();
    mkdirSync(join(root, 'tasks', 'foo'));
    writeFileSync(join(root, 'tasks', 'foo', 'TASKS.md'), '# State: planned');
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'spec/foo' });
    assert.equal(slug, 'foo');
  });
});

describe('resolveTaskSlug — TASKS.md scan single in-flight', () => {
  test('returns the unique task in implementing state', () => {
    const root = mkws();
    mkdirSync(join(root, 'tasks', 'alpha'));
    writeFileSync(join(root, 'tasks', 'alpha', 'TASKS.md'), '## State\nState: implementing');
    mkdirSync(join(root, 'tasks', 'beta'));
    writeFileSync(join(root, 'tasks', 'beta', 'TASKS.md'), '## State\nState: closed');
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'main' });
    assert.equal(slug, 'alpha');
  });
});

describe('resolveTaskSlug — fallback', () => {
  test('returns _global when nothing matches', () => {
    const root = mkws();
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'main' });
    assert.equal(slug, '_global');
  });

  test('returns AMBIGUOUS marker when multiple in-flight', () => {
    const root = mkws();
    for (const s of ['a', 'b']) {
      mkdirSync(join(root, 'tasks', s));
      writeFileSync(join(root, 'tasks', s, 'TASKS.md'), 'State: implementing');
    }
    const slug = resolveTaskSlug({ workspaceRoot: root, cwd: root, branch: 'main' });
    assert.equal(slug, 'AMBIGUOUS:a,b');
  });
});
```

- [ ] **Step 2: Run test — confirm fail**

Run: `node --test tests/unit/dev-orchestrator-task-context.test.mjs`
Expected: `Cannot find module .../task-context.mjs`.

- [ ] **Step 3: Implement the resolver**

```javascript
// bin/lib/dev-orchestrator/task-context.mjs
//
// Resolves the active task slug in priority order:
//   1. override
//   2. cwd matches /.worktrees/<slug>/
//   3. branch matches task/<slug>, spec/<slug>, or <slug> with tasks/<slug>/TASKS.md
//   4. workspace tasks/*/TASKS.md scan: unique implementing|validating wins
//   5. _global
// When multiple tasks are in-flight at step 4, returns "AMBIGUOUS:s1,s2,..."
// (caller must prompt the user).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const WORKTREE_RE = /\/\.worktrees\/([a-z0-9][a-z0-9-]*)(?:\/|$)/;
const BRANCH_PREFIXED_RE = /^(?:task|spec)\/([a-z0-9][a-z0-9-]*)$/;
const BRANCH_BARE_RE = /^[a-z0-9][a-z0-9-]*$/;
const STATE_RE = /State:\s*(implementing|validating)/i;

export function getCurrentBranch(cwd) {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function inFlightSlugs(workspaceRoot) {
  const tasksDir = join(workspaceRoot, 'tasks');
  if (!existsSync(tasksDir)) return [];
  const out = [];
  for (const name of readdirSync(tasksDir)) {
    const tmd = join(tasksDir, name, 'TASKS.md');
    if (!existsSync(tmd)) continue;
    const body = readFileSync(tmd, 'utf8');
    if (STATE_RE.test(body)) out.push(name);
  }
  return out;
}

export function resolveTaskSlug({ workspaceRoot, cwd, branch, override }) {
  if (override) return override;

  const m = WORKTREE_RE.exec(cwd);
  if (m) return m[1];

  const br = branch ?? getCurrentBranch(cwd);
  if (br) {
    const pm = BRANCH_PREFIXED_RE.exec(br);
    if (pm) return pm[1];
    if (BRANCH_BARE_RE.test(br) && existsSync(join(workspaceRoot, 'tasks', br, 'TASKS.md'))) {
      return br;
    }
  }

  const inflight = inFlightSlugs(workspaceRoot);
  if (inflight.length === 1) return inflight[0];
  if (inflight.length > 1) return `AMBIGUOUS:${inflight.join(',')}`;

  return '_global';
}
```

- [ ] **Step 4: Run test — confirm pass**

Run: `node --test tests/unit/dev-orchestrator-task-context.test.mjs`

Expected: `tests 7 passed 7`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/dev-orchestrator-task-context.test.mjs bin/lib/dev-orchestrator/task-context.mjs
git commit -m "feat(dev-orchestrator/task-context): resolve task slug across worktree/branch/TASKS.md"
```

---

## Task 5: State directory primitives — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-state.test.mjs`
- Create: `bin/lib/dev-orchestrator/state.mjs`

`state.mjs` exposes path helpers and directory creation for the per-workspace, per-task state directory. No flock or PID logic yet — that arrives in Phase 3 with the daemon. Phase 1 only needs:
- `stateDir({ workspaceId, slug })` → absolute path to `~/.jlu/workspaces/<id>/<slug>/`.
- `ensureStateDir(...)` → creates the directory if needed (recursive).
- `writeMeta({ workspaceId, workspaceRoot })` → writes `~/.jlu/workspaces/<id>/meta.json` with workspace path + name.
- `currentSymlinkPath()` → path of `~/.jlu/current` (used in Phase 2+ to point at the active workspace).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/dev-orchestrator-state.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { stateDir, ensureStateDir, writeMeta, currentSymlinkPath } from '../../bin/lib/dev-orchestrator/state.mjs';

describe('stateDir', () => {
  test('joins ~/.jlu/workspaces/<id>/<slug>/', () => {
    const p = stateDir({ workspaceId: 'abc123', slug: 'my-task' });
    assert.equal(p, join(homedir(), '.jlu', 'workspaces', 'abc123', 'my-task'));
  });

  test('uses _global slug when omitted', () => {
    const p = stateDir({ workspaceId: 'abc123' });
    assert.equal(p, join(homedir(), '.jlu', 'workspaces', 'abc123', '_global'));
  });
});

describe('ensureStateDir', () => {
  test('creates the directory if missing', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'jlu-state-'));
    const p = ensureStateDir({ workspaceId: 'wid', slug: 'slg', baseDir: fakeHome });
    assert.equal(existsSync(p), true);
    assert.equal(p, join(fakeHome, 'workspaces', 'wid', 'slg'));
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

describe('writeMeta', () => {
  test('writes meta.json with workspace path', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'jlu-meta-'));
    writeMeta({ workspaceId: 'wid', workspaceRoot: '/x/y', baseDir: fakeHome });
    const meta = JSON.parse(readFileSync(join(fakeHome, 'workspaces', 'wid', 'meta.json'), 'utf8'));
    assert.equal(meta.path, '/x/y');
    assert.ok(typeof meta.name === 'string');
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

describe('currentSymlinkPath', () => {
  test('returns ~/.jlu/current path', () => {
    assert.equal(currentSymlinkPath(), join(homedir(), '.jlu', 'current'));
  });
});
```

- [ ] **Step 2: Run test — confirm fail**

Run: `node --test tests/unit/dev-orchestrator-state.test.mjs`

Expected: `Cannot find module .../state.mjs`.

- [ ] **Step 3: Implement the module**

```javascript
// bin/lib/dev-orchestrator/state.mjs
//
// State directory layout: ~/.jlu/workspaces/<workspace-id>/<slug>/.
// Phase 1 only exposes path helpers and ensureStateDir + writeMeta.
// Daemon-related primitives (PID file, flock, log paths) land in Phase 3.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_BASE = join(homedir(), '.jlu');

function base(opts) {
  return (opts && opts.baseDir) || DEFAULT_BASE;
}

export function stateDir({ workspaceId, slug = '_global', baseDir }) {
  return join(base({ baseDir }), 'workspaces', workspaceId, slug);
}

export function ensureStateDir({ workspaceId, slug = '_global', baseDir }) {
  const p = stateDir({ workspaceId, slug, baseDir });
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
}

export function writeMeta({ workspaceId, workspaceRoot, baseDir }) {
  const dir = join(base({ baseDir }), 'workspaces', workspaceId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const meta = { path: workspaceRoot, name: basename(workspaceRoot), updated_at: new Date().toISOString() };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

export function currentSymlinkPath(baseDir) {
  return join(base({ baseDir }), 'current');
}
```

- [ ] **Step 4: Run test — confirm pass**

Run: `node --test tests/unit/dev-orchestrator-state.test.mjs`

Expected: `tests 5 passed 5`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/dev-orchestrator-state.test.mjs bin/lib/dev-orchestrator/state.mjs
git commit -m "feat(dev-orchestrator/state): phase 1 state directory primitives"
```

---

## Task 6: register.mjs core — RED

**Files:**
- Create: `tests/unit/dev-orchestrator-register.test.mjs`

`register.mjs` exposes:
- `loadOrInitConfig(configPath)` → returns existing parsed config, or a fresh `{ version: 1, defaults: DEFAULTS, services: [] }` skeleton.
- `addOrUpdateService(cfg, service)` → returns a new config object with that service either appended (new name) or updated (existing name).
- `inferDefaults(absDir)` → returns `{ packageManager, suggestedCommand, dotEnvFiles, composeServices }` from the directory contents.
- `inferComposeServices(composeFilePath)` → reads a `docker-compose.yml` (very loose YAML parse — only `services:` top-level keys) and returns the list of service names.

This task writes only the failing test. Implementation lands in Task 7.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/dev-orchestrator-register.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadOrInitConfig,
  addOrUpdateService,
  inferDefaults,
  inferComposeServices
} from '../../bin/lib/dev-orchestrator/register.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-reg-')); }

describe('loadOrInitConfig', () => {
  test('returns fresh skeleton when file is missing', () => {
    const cfg = loadOrInitConfig(join(tmp(), 'no.json'));
    assert.equal(cfg.version, 1);
    assert.deepEqual(cfg.services, []);
    assert.ok(cfg.defaults);
  });

  test('returns parsed file when present', () => {
    const dir = tmp();
    const path = join(dir, 'jlu-services.json');
    writeFileSync(path, JSON.stringify({ version: 1, services: [{ name: 'x', path: '.', command: 'y' }] }));
    const cfg = loadOrInitConfig(path);
    assert.equal(cfg.services.length, 1);
    assert.equal(cfg.services[0].name, 'x');
  });
});

describe('addOrUpdateService', () => {
  test('appends a new service', () => {
    const cfg = { version: 1, services: [] };
    const next = addOrUpdateService(cfg, { name: 'a', path: '.', command: 'x' });
    assert.equal(next.services.length, 1);
    assert.equal(next.services[0].name, 'a');
  });

  test('updates an existing service in place', () => {
    const cfg = { version: 1, services: [{ name: 'a', path: '.', command: 'old' }] };
    const next = addOrUpdateService(cfg, { name: 'a', path: '.', command: 'new' });
    assert.equal(next.services.length, 1);
    assert.equal(next.services[0].command, 'new');
  });

  test('preserves order on update', () => {
    const cfg = { version: 1, services: [
      { name: 'a', path: '.', command: 'a' },
      { name: 'b', path: '.', command: 'b' }
    ] };
    const next = addOrUpdateService(cfg, { name: 'a', path: '.', command: 'A' });
    assert.deepEqual(next.services.map(s => s.name), ['a', 'b']);
  });
});

describe('inferDefaults', () => {
  test('detects pnpm by lockfile', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 6');
    writeFileSync(join(dir, 'package.json'), '{}');
    const inf = inferDefaults(dir);
    assert.equal(inf.packageManager, 'pnpm');
    assert.equal(inf.suggestedCommand, 'pnpm dev');
  });

  test('detects yarn by lockfile', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'yarn.lock'), '');
    writeFileSync(join(dir, 'package.json'), '{}');
    const inf = inferDefaults(dir);
    assert.equal(inf.packageManager, 'yarn');
    assert.equal(inf.suggestedCommand, 'yarn dev');
  });

  test('falls back to npm', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'package.json'), '{}');
    const inf = inferDefaults(dir);
    assert.equal(inf.packageManager, 'npm');
    assert.equal(inf.suggestedCommand, 'npm run dev');
  });

  test('lists .env files', () => {
    const dir = tmp();
    writeFileSync(join(dir, '.env'), '');
    writeFileSync(join(dir, '.env.local'), '');
    writeFileSync(join(dir, 'README.md'), '');
    const inf = inferDefaults(dir);
    assert.ok(inf.dotEnvFiles.includes('.env'));
    assert.ok(inf.dotEnvFiles.includes('.env.local'));
    assert.ok(!inf.dotEnvFiles.includes('README.md'));
  });

  test('detects compose services when compose file exists', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'docker-compose.yml'), 'services:\n  api:\n    image: x\n  redis:\n    image: y\n');
    const inf = inferDefaults(dir);
    assert.deepEqual(inf.composeServices.sort(), ['api', 'redis']);
  });

  test('returns empty composeServices when no compose file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'package.json'), '{}');
    const inf = inferDefaults(dir);
    assert.deepEqual(inf.composeServices, []);
  });
});

describe('inferComposeServices', () => {
  test('parses top-level service keys from a minimal compose file', () => {
    const dir = tmp();
    const path = join(dir, 'docker-compose.yml');
    writeFileSync(path, [
      'version: "3.9"',
      'services:',
      '  api:',
      '    image: x',
      '  worker:',
      '    image: y',
      'networks:',
      '  default: {}'
    ].join('\n') + '\n');
    const out = inferComposeServices(path);
    assert.deepEqual(out.sort(), ['api', 'worker']);
  });

  test('returns [] when no services key present', () => {
    const dir = tmp();
    const path = join(dir, 'docker-compose.yml');
    writeFileSync(path, 'version: "3.9"\n');
    assert.deepEqual(inferComposeServices(path), []);
  });

  test('returns [] when file does not exist', () => {
    assert.deepEqual(inferComposeServices('/no/such/file'), []);
  });
});
```

- [ ] **Step 2: Run test — confirm fail**

Run: `node --test tests/unit/dev-orchestrator-register.test.mjs`

Expected: `Cannot find module .../register.mjs`.

- [ ] **Step 3: Commit RED**

```bash
git add tests/unit/dev-orchestrator-register.test.mjs
git commit -m "test(dev-orchestrator/register): red — load/init, addOrUpdate, inference helpers"
```

---

## Task 7: register.mjs core — GREEN

**Files:**
- Create: `bin/lib/dev-orchestrator/register.mjs`

- [ ] **Step 1: Implement the module**

```javascript
// bin/lib/dev-orchestrator/register.mjs
//
// Pure helpers used by /jlu:register-service. No I/O against tmux or daemon —
// only JSON config + filesystem inspection in the target service directory.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DEFAULTS, readConfig } from './config.mjs';

export function loadOrInitConfig(configPath) {
  if (existsSync(configPath)) return readConfig(configPath);
  return { version: 1, defaults: { ...DEFAULTS }, services: [] };
}

export function addOrUpdateService(cfg, service) {
  const services = (cfg.services || []).slice();
  const idx = services.findIndex(s => s.name === service.name);
  if (idx === -1) {
    services.push(service);
  } else {
    services[idx] = service;
  }
  return { ...cfg, services };
}

function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

function detectPackageManager(absDir) {
  if (isFile(join(absDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (isFile(join(absDir, 'yarn.lock'))) return 'yarn';
  if (isFile(join(absDir, 'bun.lockb'))) return 'bun';
  if (isFile(join(absDir, 'package-lock.json'))) return 'npm';
  if (isFile(join(absDir, 'package.json'))) return 'npm';
  return null;
}

function suggestedCommandFor(pm) {
  switch (pm) {
    case 'pnpm': return 'pnpm dev';
    case 'yarn': return 'yarn dev';
    case 'bun':  return 'bun dev';
    case 'npm':  return 'npm run dev';
    default:     return null;
  }
}

function listDotEnvFiles(absDir) {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir).filter(n => n === '.env' || n.startsWith('.env.'));
}

const SERVICE_KEY_RE = /^ {2}([A-Za-z0-9_.-]+):\s*$/;

export function inferComposeServices(composeFilePath) {
  if (!existsSync(composeFilePath)) return [];
  const lines = readFileSync(composeFilePath, 'utf8').split(/\r?\n/);
  let inServices = false;
  const out = [];
  for (const raw of lines) {
    if (/^services:\s*$/.test(raw)) { inServices = true; continue; }
    if (inServices && /^[A-Za-z0-9_.-]+:\s*$/.test(raw)) {
      // top-level non-services key — section ended
      inServices = false;
      continue;
    }
    if (inServices) {
      const m = SERVICE_KEY_RE.exec(raw);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

function findComposeFile(absDir) {
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const p = join(absDir, name);
    if (isFile(p)) return p;
  }
  return null;
}

export function inferDefaults(absDir) {
  const pm = detectPackageManager(absDir);
  const compose = findComposeFile(absDir);
  return {
    directoryName: basename(absDir),
    packageManager: pm,
    suggestedCommand: suggestedCommandFor(pm),
    dotEnvFiles: listDotEnvFiles(absDir),
    composeFile: compose,
    composeServices: compose ? inferComposeServices(compose) : []
  };
}
```

- [ ] **Step 2: Run test — confirm pass**

Run: `node --test tests/unit/dev-orchestrator-register.test.mjs`

Expected: `tests 13 passed 13`.

- [ ] **Step 3: Commit GREEN**

```bash
git add bin/lib/dev-orchestrator/register.mjs
git commit -m "feat(dev-orchestrator/register): green — load/init, addOrUpdate, inference helpers"
```

---

## Task 8: Workflow — `jelou/workflows/register-service.md`

**Files:**
- Create: `jelou/workflows/register-service.md`

The workflow is shared between Claude Code and OpenCode. Authored OpenCode-style: uses `question` for prompts (translated by the Claude Code SKILL.md to `AskUserQuestion`).

- [ ] **Step 1: Create the workflow**

````markdown
# /jlu:register-service Workflow

> Purpose: Interactively register (or update) a single service in the workspace's `jlu-services.json`.

Inputs:
- `argument`: optional service name. If provided, skip the name prompt and treat it as the target.
- `cwd`: the user's current working directory.

## Step 1 — Resolve workspace and existing config

Run inline (single bash call):
```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs').then(({ resolveWorkspace }) => {
  const r = resolveWorkspace(process.argv[1]);
  process.stdout.write(JSON.stringify(r) + '\n');
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

If the script exits non-zero with `NO_WORKSPACE`, surface this message to the user verbatim and stop:
> `No workspace root found in {cwd}. Run /jlu:register-service from inside a project directory.`

Otherwise capture `{ root, configPath, workspaceId }`.

## Step 2 — Load or init config

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/register.mjs').then(({ loadOrInitConfig }) => {
  process.stdout.write(JSON.stringify(loadOrInitConfig(process.argv[1])) + '\n');
});
" "{configPath}"
```

Capture the parsed config. Note existing service names (used for the next prompt).

## Step 3 — Ask for the service name

Use `question` (single-choice if `argument` is provided and matches an existing service; otherwise free-text):

- Prompt: `"Service name (kebab-case, [a-z0-9-]+)"`
- If `argument` is provided, pre-fill it.
- Validation: must match `^[a-z0-9][a-z0-9-]*$`. If not, re-prompt.

If the name matches an existing service, ask: *"This service is already registered. Update it?"* (yes / cancel).

## Step 4 — Ask for the path

Default = relative path from workspace root to `cwd`. Compute via `path.relative(root, cwd)` (use `.` if equal). Use `question` (free-text with default).

After the user answers, run:
```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/register.mjs').then(({ inferDefaults }) => {
  process.stdout.write(JSON.stringify(inferDefaults(process.argv[1])) + '\n');
});
" "{root}/{path}"
```

Capture `{ packageManager, suggestedCommand, dotEnvFiles, composeFile, composeServices }`.

## Step 5 — Ask for runtime type

Use `question` (single-choice):

- `host` — service runs directly on the host (default if no compose file detected).
- `docker-compose` — service runs inside a Docker Compose container (default if compose file detected).

## Step 6 — If `docker-compose`, ask for compose details

Two `question` calls:

1. `"Compose file path (relative to {root})"` — default = the detected compose file path; free-text.
2. `"Compose service name"` — single-choice from `composeServices` if any were detected; otherwise free-text.

## Step 7 — Ask for command

Use `question` (free-text). Default depends on runtime:

- `host`: `suggestedCommand` from inference, or empty.
- `docker-compose`: `docker compose -f {compose_file} up -d && docker compose -f {compose_file} exec {compose_service} npm run start:dev` (use the compose values from Step 6).

## Step 8 — Ask for env_file

Use `question` (single-choice + custom):

- Default `.env` if `.env` is present in the dotEnvFiles inference.
- Other detected files (`.env.local`, `.env.development`, etc.) listed as choices.
- Option: `none (null)`.

## Step 9 — Ask for depends_on

Use `question` (multi-choice). Choices = existing service names from the loaded config (excluding the current one). Skip the question if the list is empty.

## Step 10 — Ask for readiness

Use `question` (single-choice):

- `none`
- `http: <url>` — follow-up free-text for the URL (default `http://localhost:3000/health`).
- `tcp: <host>:<port>` — follow-up free-text for `host:port` (default `localhost:3000`).

## Step 11 — Ask for log_failure_patterns

Use `question` (free-text, optional). One regex per line. Empty input = use only the defaults inherited from the global `defaults` block.

## Step 12 — Build the service object and validate

Build the service entry from the answers (omit fields the user left blank/none). Then validate by writing through:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/register.mjs').then(({ addOrUpdateService }) => {
  const cfg = JSON.parse(process.argv[1]);
  const svc = JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify(addOrUpdateService(cfg, svc)) + '\n');
});
" '{cfg-json}' '{service-json}'
```

Then call validateConfig + writeConfigAtomic in one invocation:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs')
]).then(([m]) => {
  const cfg = JSON.parse(process.argv[1]);
  const v = m.validateConfig(cfg);
  if (!v.valid) { process.stderr.write(v.errors.join('\n') + '\n'); process.exit(2); }
  m.writeConfigAtomic(process.argv[2], cfg);
  process.stdout.write('OK\n');
});
" '{merged-cfg-json}' "{configPath}"
```

If validation fails, surface the errors to the user and ask whether they want to retry the interview (back to Step 3) or cancel.

## Step 13 — Confirm and offer git add

Print a one-line summary:
> `Wrote service "{name}" to {configPath}.`

Use `question` (single-choice): *"Stage `{configPath}` for commit?"* (yes / no).

If yes, run:
```bash
git -C "{root}" add "{configPath}"
```

Print `Staged.` or surface any error.

## Notes

- Always reference the user-facing command as `/jlu-register-service` in messages (works in both runtimes; Claude Code users mentally substitute the colon).
- Never invoke any tmux command in this workflow — that's Phase 2.
- If the user cancels at any prompt, do nothing destructive: leave the existing config untouched and print `Cancelled. No changes made.`.
````

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/register-service.md
git commit -m "docs(workflows/register-service): shared workflow for both runtimes"
```

---

## Task 9: Claude Code skill — `skills/register-service/SKILL.md`

**Files:**
- Create: `skills/register-service/SKILL.md`

Mirrors the bootstrap pattern of `skills/new-task/SKILL.md`.

- [ ] **Step 1: Create the SKILL.md**

````markdown
---
name: register-service
description: Use to interactively register or update a service in jlu-services.json. Triggers "register service", "add a service to jlu", "update jlu service entry"
argument-hint: "[service-name]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu:register-service` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/register-service/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion` (deferred — preload below).
- Workflow says `task` → invoke `Agent` (subagent dispatch). Not used in this workflow.
- Never narrate questions as plain text. Never skip a prescribed question.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/register-service.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1) — mandatory before any `AskUserQuestion` call.

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion`, fall back to printing each question as plain text and warn the user that the skill cannot run correctly without `AskUserQuestion` in this Claude Code version.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent — execute the workflow yourself in this session.

The argument is `{argument}` (optional service name). The plugin root is the path resolved above. The current working directory is `{cwd}`.
````

- [ ] **Step 2: Commit**

```bash
git add skills/register-service/SKILL.md
git commit -m "feat(skills/register-service): claude code launcher"
```

---

## Task 10: OpenCode mirror — `.opencode/commands/jlu-register-service.md`

**Files:**
- Create: `.opencode/commands/jlu-register-service.md`

Mirrors the OpenCode command pattern from `.opencode/commands/jlu-new-task.md`.

- [ ] **Step 1: Create the command file**

```markdown
---
description: Register or update a service in jlu-services.json
agent: build
---
Execute this workflow exactly: @jelou/workflows/register-service.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of question).
Use `task` for subagent dispatches (OpenCode equivalent of task tool). Not used in this workflow.
Always reference commands with the `jlu-` prefix (never `jlu:`).
Phase 1 portability mode: skip ClickUp and Slack execution steps if encountered; report them as deferred to Phase 2.
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/commands/jlu-register-service.md
git commit -m "feat(opencode/jlu-register-service): mirror command for OpenCode runtime"
```

---

## Task 11: Smoke run + sanity verification

**Files:** none (manual verification).

- [ ] **Step 1: Run the full unit-test suite for Phase 1 modules**

Run:
```bash
node --test tests/unit/dev-orchestrator-*.test.mjs
# OR equivalently:
npm test
```

Expected: all green. Report counts: config (8), workspace (4), task-context (7), state (5), register (13). Total `tests 37 passed 37` for dev-orchestrator suite (npm test will also include all pre-existing tests).

- [ ] **Step 2: Manually exercise `/jlu:register-service` against a sample workspace**

Create a scratch workspace:
```bash
mkdir -p /tmp/jlu-smoke/services/api
cd /tmp/jlu-smoke/services/api
echo '{}' > package.json
touch .env
git init -q
```

In a fresh Claude Code session inside `/tmp/jlu-smoke/services/api`, run `/jlu:register-service api`. Step through the interview: confirm name `api`, accept the suggested path `.`, runtime `host`, command `npm run dev`, env_file `.env`, no deps, no readiness, no extra patterns.

Verify:
```bash
cat /tmp/jlu-smoke/jlu-services.json
```

Expected:
- `version: 1`
- a single service `api` with command `npm run dev`, env_file `.env`, path `services/api` (relative to workspace root).

If validation passes and the file is well-formed, Phase 1 is functionally complete.

- [ ] **Step 3: Manual OpenCode smoke (optional)**

In OpenCode, run `/jlu-register-service api2` against the same workspace. Verify a second service is appended without duplicating or corrupting the first.

- [ ] **Step 4: Cleanup smoke artifacts**

```bash
rm -rf /tmp/jlu-smoke
```

- [ ] **Step 5: Final commit if anything tweaked during smoke**

If smoke surfaced no issues, no commit needed. If you fixed something, commit it as a separate `fix(...)` commit.

---

## Self-Review

After Tasks 0–11 land, run this checklist:

**1. Spec coverage (Phase 1 only):**

| Spec section | Implemented in |
|---|---|
| `jlu-services.json` Schema (v1) | Task 1 (fixtures), Task 2 (validator + schema doc) |
| Schema validation rules | Task 2 (`config.mjs`) |
| Atomic writes | Task 2 (`writeConfigAtomic`) |
| Effective defaults merge | Task 2 (`effectiveDefaults`, `effectiveFailurePatterns`) |
| Workspace root resolution | Task 3 (`workspace.mjs`) |
| `workspace-id` derivation | Task 3 (`computeWorkspaceId`) |
| Task slug resolution (5 layers) | Task 4 (`task-context.mjs`) |
| State directory layout | Task 5 (`state.mjs`) — paths only; daemon-side primitives in Phase 3 |
| `/jlu:register-service` interactive flow | Task 6 (helpers RED), Task 7 (helpers GREEN), Task 8 (workflow), Task 9 (CC skill), Task 10 (OC command) |
| Smart inference (lockfile, compose detection, env files) | Task 7 (`inferDefaults`, `inferComposeServices`) |
| Dual-runtime contract | Task 9 + Task 10 (parallel files) |
| Pre-flight rebase | Task 0 |

Any gap → add a fix-up task before declaring Phase 1 done.

**2. Placeholder scan:** none allowed. Search the plan for `TBD`, `TODO`, `fill in`, `similar to Task N`. There should be zero hits.

**3. Type consistency:** the function names you reference across tasks must match exactly. Cross-check:
- `validateConfig`, `readConfig`, `writeConfigAtomic`, `effectiveDefaults`, `effectiveFailurePatterns`, `DEFAULTS` — all from `config.mjs`.
- `resolveWorkspace`, `computeWorkspaceId` — from `workspace.mjs`.
- `resolveTaskSlug`, `getCurrentBranch` — from `task-context.mjs`.
- `stateDir`, `ensureStateDir`, `writeMeta`, `currentSymlinkPath` — from `state.mjs`.
- `loadOrInitConfig`, `addOrUpdateService`, `inferDefaults`, `inferComposeServices` — from `register.mjs`.

If any caller in a later task uses a different name, fix it inline.

**4. Ambiguity:** the schema doc accepts an `expect_status` field on http readiness — make sure the validator either enforces it or treats it as optional. Decision (locked here): optional integer; default 200 at the daemon side (Phase 3). The validator does not require it.

---

## Next Phases (separate plans)

Phase 1 leaves `jlu-services.json` authoring fully working. The remaining work is sequential and each phase produces shippable software:

| Phase | Plan filename (to create when ready) | Brief |
|---|---|---|
| 2 | `2026-05-04-jlu-dev-orchestrator-phase2-tmux.md` | `tmux.mjs` wrapper + minimal `start-dev` and `stop-dev` (no daemon yet). |
| 3 | `2026-05-04-jlu-dev-orchestrator-phase3-daemon.md` | Daemon loop, readiness probes, pattern matcher with cooldown, OS notifications, hot reload via SIGHUP, `add-failure-pattern` skill. |
| 4 | `2026-05-04-jlu-dev-orchestrator-phase4-diagnose.md` | `jlu-dev-diagnoser` agent (both runtimes), `diagnose`, `add-service`, `logs` skills. |
| 5 | `2026-05-04-jlu-dev-orchestrator-phase5-polish.md` | README updates, `dev-orchestrator.md` reference, `tests/pressure/skills.test.mjs` registration of all seven new skills, `tests/pressure/opencode-parity.test.mjs`. |

When ready to start Phase 2, invoke the writing-plans skill again pointing at the spec — it will see Phase 1 already shipped and pick up at the TMUX layer.
