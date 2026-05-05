# JLU Dev Orchestrator — Phase 4 (Diagnose + add-service + logs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing diagnosis + extension surface. After this phase, when the daemon (Phase 3) reports a `pane_dead`, `pattern_match`, or `readiness_failed`, the user can run `/jlu:diagnose [service]` and Claude analyzes recent events + a pane capture, returning a structured fix proposal (host or container) requiring user confirmation. `/jlu:add-service` adds a pane to a running window without restarting the rest. `/jlu:logs` prints the last N lines of any service's pane on demand.

**Architecture:** A new specialized agent `jlu-dev-diagnoser` (Opus tier, dual-published in `agents/` and `.opencode/agents/`) ingests structured input (recent events + pane capture + service config + runtime kind + `depends_on` resolved configs) and returns structured JSON output. Critical rule baked into the prompt: when `runtime.type === 'docker-compose'`, all proposed fixes use `exec_template` and run inside the container. Three new orchestrators (`diagnose.mjs`, `add.mjs`, `logs.mjs`) plus their full runtime trios. `add.mjs` reuses the tmux wrapper to split the existing window — daemon picks up the new pane on the next tick.

**Tech Stack:** Node 20+ ESM. `node:test`. Markdown for the agent + workflows. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-04-jlu-dev-orchestrator-design.md`
**Phase 1–3 plans:** `docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator{,-phase2-tmux,-phase3-daemon}.md`

**Branch:** `feature/dev-orchestrator` (continues from Phase 3). Same single PR.

**Phase 4 deliverable:** Three new commands wired end-to-end. Diagnose returns structured fix proposals; add-service grows the window in place; logs prints captures on demand.

---

## Pre-flight

```bash
git status --short
git rev-parse --abbrev-ref HEAD     # must be feature/dev-orchestrator
npm test                            # must be green per Phase 3 baseline
node --test tests/integration/dev-orchestrator/*.test.mjs
```

If suite is red, stop.

---

## File Structure (Phase 4)

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `agents/jlu-dev-diagnoser.md` | Diagnoser agent prompt (Opus tier) — Claude Code |
| `.opencode/agents/jlu-dev-diagnoser.md` | Mirror — OpenCode |
| `bin/lib/dev-orchestrator/diagnose.mjs` | Implements `/jlu:diagnose` core: read events, build agent input, parse agent output |
| `bin/lib/dev-orchestrator/add.mjs` | Implements `/jlu:add-service` core: split window, add pane to running env |
| `bin/lib/dev-orchestrator/logs.mjs` | Implements `/jlu:logs` core: capture-pane on demand |
| `jelou/workflows/diagnose.md` | Workflow |
| `jelou/workflows/add-service.md` | Workflow |
| `jelou/workflows/logs.md` | Workflow |
| `skills/diagnose/SKILL.md` | Claude Code launcher |
| `skills/add-service/SKILL.md` | Claude Code launcher |
| `skills/logs/SKILL.md` | Claude Code launcher |
| `.opencode/commands/jlu-diagnose.md` | OpenCode mirror |
| `.opencode/commands/jlu-add-service.md` | OpenCode mirror |
| `.opencode/commands/jlu-logs.md` | OpenCode mirror |
| `tests/unit/dev-orchestrator-diagnose.test.mjs` | Unit tests (no LLM call — input-shaping only) |
| `tests/unit/dev-orchestrator-add.test.mjs` | Unit tests for split + send-keys + layout |
| `tests/unit/dev-orchestrator-logs.test.mjs` | Unit tests for capture wrapper |

### Files to MODIFY

If `bin/sync-agents.mjs` exists (Phase 1 verified it does), running `node bin/sync-agents.mjs` after creating `agents/jlu-dev-diagnoser.md` regenerates `.opencode/agents/jlu-dev-diagnoser.md` automatically. Verify with `node bin/sync-agents.mjs --check`.

### Coding rules

- Node 20+ ESM. No new deps.
- Tests FLAT in `tests/unit/`.
- Every commit ends with `[skip-bump]`.
- Diagnose unit tests do NOT call the model — they exercise input-shaping and structured-output parsing only. The actual agent runs at user invocation time.

---

## Task 1: jlu-dev-diagnoser agent (Claude Code)

**Files:**
- Create: `agents/jlu-dev-diagnoser.md`

The agent's job: take structured input + return structured JSON output. The orchestrator parses the JSON and decides whether to ask the user for confirmation and run the fix.

- [ ] **Step 1: Create the agent**

````markdown
---
name: jlu-dev-diagnoser
description: Analyzes a failing service in the JLU dev environment from a TMUX pane capture + recent daemon events, and returns a structured diagnosis with a proposed fix that runs in the right context (host or container).
model: opus
tools:
  - Read
  - Grep
  - Glob
---

You are the JLU dev-environment failure analyzer. The user's service has emitted at least one hard or soft failure event. Read the structured input below, infer the most likely root cause, and return a single structured JSON document.

## Input shape

You will receive the following keys (provided by the orchestrator):

- `service` — the service config from jlu-services.json (name, path, command, runtime, env_file, depends_on, log_failure_patterns, readiness, panel)
- `events` — last N events from dev-events.log for this service (each: ts, type, severity, ...)
- `capture` — last 100 lines of `tmux capture-pane` output for the service's pane
- `depends_on_resolved` — full configs for each dep that exists in the JSON
- `os` — `linux` or `darwin`
- `workspaceRoot` — absolute path

## Hard rules (DO NOT VIOLATE)

1. **When `service.runtime.type === "docker-compose"`, every command in `proposed_fix` and `alternative_fixes` MUST run inside the container.** Use the substitution from `service.runtime.exec_template` (default: `docker compose -f {compose_file} exec {compose_service} {cmd}`). Substitute the literal values from `service.runtime` for `{compose_file}` and `{compose_service}`. Never propose a host-side `npm install`, `pip install`, etc., when runtime is docker-compose.

2. **When the failure cause is a missing dep that is itself listed in `depends_on_resolved`** (i.e., another JSON-declared service that is not running), propose to bring it up. The proposed_fix.command should be the dep's `service.command` (or just the boot portion if it's a docker-compose service: `docker compose -f <file> up -d`). Set `runs_in: "host"` for `docker compose up -d` (it runs from the host even though it boots a container).

3. **Always include `evidence`** — an array of strings, each a short quote from the events or capture that supports your cause. Without evidence, the orchestrator will reject your output.

4. **Confidence levels:** use `"high"` only when the failure pattern is unambiguous. Use `"medium"` when plausible but not certain. Use `"low"` when guessing — and in that case, set `proposed_fix` to `null` and let the user investigate.

5. **`register_pattern`** — if the failure is a soft pattern that wasn't already in `service.log_failure_patterns`, suggest it as a regex (case-insensitive) the user can register via `/jlu:add-failure-pattern`. Skip if the matched pattern is already covered.

## Output shape (return exactly this JSON, nothing else)

Required keys: `cause` (string), `confidence` (`high`|`medium`|`low`), `evidence` (array of strings), `proposed_fix` (object or null), `alternative_fixes` (array), `register_pattern` (string or null).

`proposed_fix` shape: `{ command: string, runs_in: "host"|"container", rationale: string }`. If `confidence` is `"low"`, set `proposed_fix` to `null`.

Return ONLY the JSON document. No prose before or after. No code fences.
````

- [ ] **Step 2: Sync agents to OpenCode**

```bash
node bin/sync-agents.mjs
ls .opencode/agents/jlu-dev-diagnoser.md
node bin/sync-agents.mjs --check
```

If sync-agents does NOT auto-create the OpenCode form, manually copy the agent file to `.opencode/agents/jlu-dev-diagnoser.md`.

- [ ] **Step 3: Verify parity**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add agents/jlu-dev-diagnoser.md .opencode/agents/jlu-dev-diagnoser.md
git commit -m "feat(agents/jlu-dev-diagnoser): structured failure analyzer (opus tier) [skip-bump]"
```

---

## Task 2: diagnose.mjs core — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-diagnose.test.mjs`
- Create: `bin/lib/dev-orchestrator/diagnose.mjs`

`diagnose.mjs` does NOT call the model. It builds the structured input the workflow hands to the agent (via `task` / `Agent` dispatch). It also exposes a parse helper for the agent's output.

Required exports:

- `readRecentEvents({ logPath, service, limit = 50 })` reads `dev-events.log` (JSONL), filters to events for `service`, returns the last `limit` (chronological).
- `buildDiagnoseInput({ service, events, capture, allServices, os, workspaceRoot })` returns the JSON object the agent consumes. Resolves `depends_on_resolved` from `allServices`.
- `parseDiagnoseOutput(raw)` takes a string, strips optional code fences if present, parses JSON, and validates required fields. Throws on malformed.
- `substituteFix({ service, fix })` takes a `proposed_fix` and substitutes `{compose_file}` / `{compose_service}` / `{cmd}` in the runtime exec_template if `runs_in === "container"`. Returns the actual shell command.

- [ ] **Step 1: Test**

```javascript
// tests/unit/dev-orchestrator-diagnose.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRecentEvents, buildDiagnoseInput, parseDiagnoseOutput, substituteFix
} from '../../bin/lib/dev-orchestrator/diagnose.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-dx-')); }

describe('readRecentEvents', () => {
  test('filters to the requested service', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    writeFileSync(log, [
      JSON.stringify({ ts: '2026-05-04T10:00:00Z', type: 'pane_started', service: 'api' }),
      JSON.stringify({ ts: '2026-05-04T10:00:01Z', type: 'pane_started', service: 'web' }),
      JSON.stringify({ ts: '2026-05-04T10:01:00Z', type: 'pane_dead', service: 'api' })
    ].join('\n') + '\n');
    const events = readRecentEvents({ logPath: log, service: 'api' });
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'pane_started');
    assert.equal(events[1].type, 'pane_dead');
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns empty when log missing', () => {
    const events = readRecentEvents({ logPath: '/no/such/file', service: 'api' });
    assert.deepEqual(events, []);
  });

  test('respects limit', () => {
    const dir = tmp();
    const log = join(dir, 'dev-events.log');
    const lines = [];
    for (let i = 0; i < 100; i++) lines.push(JSON.stringify({ ts: `2026-05-04T10:00:0${i}Z`, type: 'pattern_match', service: 'api', i }));
    writeFileSync(log, lines.join('\n') + '\n');
    const events = readRecentEvents({ logPath: log, service: 'api', limit: 10 });
    assert.equal(events.length, 10);
    assert.equal(events[9].i, 99);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildDiagnoseInput', () => {
  test('resolves depends_on against allServices', () => {
    const allServices = [
      { name: 'redis', path: '.', command: 'docker compose up redis' },
      { name: 'api', path: './api', command: 'npm run dev', depends_on: ['redis', 'unknown'] }
    ];
    const out = buildDiagnoseInput({
      service: allServices[1],
      events: [],
      capture: 'foo',
      allServices,
      os: 'linux',
      workspaceRoot: '/work'
    });
    assert.equal(out.service.name, 'api');
    assert.equal(out.depends_on_resolved.length, 1);
    assert.equal(out.depends_on_resolved[0].name, 'redis');
    assert.equal(out.os, 'linux');
    assert.equal(out.workspaceRoot, '/work');
  });
});

describe('parseDiagnoseOutput', () => {
  test('parses well-formed JSON', () => {
    const raw = JSON.stringify({
      cause: 'missing module', confidence: 'high', evidence: ['Cannot find module foo'],
      proposed_fix: { command: 'npm i foo', runs_in: 'host', rationale: 'just install it' },
      alternative_fixes: [], register_pattern: null
    });
    const out = parseDiagnoseOutput(raw);
    assert.equal(out.cause, 'missing module');
  });

  test('strips code fences', () => {
    const wrapped = '```json\n' + JSON.stringify({
      cause: 'x', confidence: 'low', evidence: ['log line'],
      proposed_fix: null, alternative_fixes: []
    }) + '\n```';
    const out = parseDiagnoseOutput(wrapped);
    assert.equal(out.cause, 'x');
  });

  test('throws on missing required field', () => {
    assert.throws(() => parseDiagnoseOutput(JSON.stringify({ confidence: 'low', evidence: [] })));
  });

  test('throws on unparseable JSON', () => {
    assert.throws(() => parseDiagnoseOutput('not json'));
  });
});

describe('substituteFix', () => {
  test('host fix returns command as-is', () => {
    const out = substituteFix({
      service: { runtime: { type: 'host' } },
      fix: { command: 'npm i foo', runs_in: 'host', rationale: 'r' }
    });
    assert.equal(out, 'npm i foo');
  });

  test('container fix substitutes the compose template', () => {
    const out = substituteFix({
      service: {
        runtime: {
          type: 'docker-compose',
          compose_file: './docker-compose.yml',
          compose_service: 'api',
          exec_template: 'docker compose -f {compose_file} exec {compose_service} {cmd}'
        }
      },
      fix: { command: 'npm install', runs_in: 'container', rationale: 'r' }
    });
    assert.equal(out, 'docker compose -f ./docker-compose.yml exec api npm install');
  });

  test('container fix uses default template if not provided', () => {
    const out = substituteFix({
      service: {
        runtime: {
          type: 'docker-compose',
          compose_file: './docker-compose.yml',
          compose_service: 'api'
        }
      },
      fix: { command: 'npm install', runs_in: 'container', rationale: 'r' }
    });
    assert.equal(out, 'docker compose -f ./docker-compose.yml exec api npm install');
  });
});
```

- [ ] **Step 2: Implementation**

```javascript
// bin/lib/dev-orchestrator/diagnose.mjs
//
// Build the structured input the diagnoser agent consumes; parse its
// structured output. No model invocation here — the workflow dispatches
// the agent.

import { readFileSync, existsSync } from 'node:fs';

const DEFAULT_TEMPLATE = 'docker compose -f {compose_file} exec {compose_service} {cmd}';

export function readRecentEvents({ logPath, service, limit = 50 }) {
  if (!existsSync(logPath)) return [];
  const body = readFileSync(logPath, 'utf8');
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.service === service) out.push(evt);
    } catch { /* skip bad line */ }
  }
  return out.slice(-limit);
}

export function buildDiagnoseInput({ service, events, capture, allServices, os, workspaceRoot }) {
  const deps = service.depends_on || [];
  const resolved = deps
    .map((name) => (allServices || []).find((s) => s.name === name))
    .filter(Boolean);
  return {
    service,
    events,
    capture,
    depends_on_resolved: resolved,
    os,
    workspaceRoot
  };
}

export function parseDiagnoseOutput(raw) {
  let body = String(raw).trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const m = fence.exec(body);
  if (m) body = m[1].trim();
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object') throw new Error('diagnose output: not an object');
  for (const required of ['cause', 'confidence', 'evidence']) {
    if (!(required in parsed)) throw new Error(`diagnose output: missing field "${required}"`);
  }
  return parsed;
}

export function substituteFix({ service, fix }) {
  if (!fix) return null;
  if (fix.runs_in !== 'container') return fix.command;
  const r = service.runtime || {};
  const tmpl = r.exec_template || DEFAULT_TEMPLATE;
  return tmpl
    .replace(/\{compose_file\}/g, r.compose_file || './docker-compose.yml')
    .replace(/\{compose_service\}/g, r.compose_service || '')
    .replace(/\{cmd\}/g, fix.command);
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-diagnose.test.mjs
npm test
git add bin/lib/dev-orchestrator/diagnose.mjs tests/unit/dev-orchestrator-diagnose.test.mjs
git commit -m "feat(dev-orchestrator/diagnose): event reader, agent input, output parser, fix substitution [skip-bump]"
```

---

## Task 3: diagnose workflow + skill + opencode

**Files:**
- Create: `jelou/workflows/diagnose.md`
- Create: `skills/diagnose/SKILL.md`
- Create: `.opencode/commands/jlu-diagnose.md`

The workflow uses `task` to dispatch the `jlu-dev-diagnoser` agent. The Claude Code skill translates `task` to `Agent`.

- [ ] **Step 1: Workflow**

````markdown
# /jlu:diagnose Workflow

> Purpose: Read recent failure events and a pane capture for one service; dispatch the diagnoser agent; surface a fix proposal that the user can confirm to run.

Inputs:
- `argument`: optional service name. If omitted, prompt with services that have recent events.

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

If `argument` is provided and matches a service, use it.

Otherwise read the events log (path computed from `state-daemon.eventsLogPath`), group events by service, present services with at least one `pane_dead`/`pattern_match`/`readiness_failed` in the last 50 events as multi-choice via `question`. If none, exit with `No recent failures. Try /jlu:logs <service> to inspect manually.`

## Step 3 — Capture the pane

Find the window via `findWindow`, the pane by title (matches `service.panel.title || service.name`), then capture the last 100 lines via the tmux wrapper.

If the window doesn't exist, surface: `No active jlu-dev window for slug '{slug}'. Run /jlu:start-dev first.`

## Step 4 — Build agent input

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ readRecentEvents, buildDiagnoseInput }) => {
  const cfg = JSON.parse(process.argv[3]);
  const service = (cfg.services || []).find(s => s.name === process.argv[2]);
  const events = readRecentEvents({ logPath: process.argv[1], service: process.argv[2] });
  const input = buildDiagnoseInput({
    service, events, capture: process.argv[4],
    allServices: cfg.services, os: process.platform, workspaceRoot: process.argv[5]
  });
  process.stdout.write(JSON.stringify(input));
});
" "{logPath}" "{service}" '{cfg-json}' "{capture}" "{root}"
```

## Step 5 — Dispatch the diagnoser agent

Use `task` (OpenCode) / `Agent` (Claude Code) to invoke `jlu-dev-diagnoser` with the input from Step 4 as the prompt body. Capture the response string.

Then parse it:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ parseDiagnoseOutput }) => {
  const out = parseDiagnoseOutput(process.argv[1]);
  process.stdout.write(JSON.stringify(out));
});
" '{agent-raw-output}'
```

If the parse throws, surface: `Diagnoser returned malformed output. Raw: <first 200 chars>` and stop.

## Step 6 — Present the diagnosis

Print the cause, confidence, and evidence list.

If `proposed_fix` is null (low confidence), list `alternative_fixes` and stop.

Otherwise, display the substituted command (via `substituteFix`), where it runs (host or container), and the rationale.

Use `question` (single-choice): `"Run this fix?"` — options: `run` / `show` (just print and exit) / `skip`.

## Step 7 — Run the fix

If `run`:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/diagnose.mjs').then(({ substituteFix }) => {
  const cfg = JSON.parse(process.argv[1]);
  const service = cfg.services.find(s => s.name === process.argv[2]);
  const fix = JSON.parse(process.argv[3]);
  process.stdout.write(substituteFix({ service, fix }));
});
" '{cfg-json}' "{service}" '{fix-json}'
```

Run the resulting shell command via `Bash`. Capture stdout/stderr, surface to the user.

After the fix runs, ask via `question`: `"Restart the pane to apply?"` — yes / no.
If yes, send Ctrl+C followed by the original command via tmux send-keys.

## Step 8 — Offer to register the pattern

If `register_pattern` is non-null and not already in the service's `log_failure_patterns`, ask via `question`: `"Register pattern '<regex>' for future detection?"` — yes / no.

If yes, invoke `/jlu:add-failure-pattern` semantics inline.

## Notes

- Use `/jlu-diagnose` in messages.
- The diagnoser agent must NEVER bypass the user's confirmation gate. The orchestrator runs the fix only after the user picks `run`.
- If `runtime.type === "docker-compose"` and the agent's `proposed_fix.runs_in` is "host", surface the inconsistency to the user with `Agent proposed a host fix for a containerized service. Manual review recommended.` and skip the auto-run.
````

- [ ] **Step 2: Skill**

````markdown
---
name: diagnose
description: Use to analyze a failing service in the JLU dev environment. Reads recent events and a pane capture, dispatches the diagnoser agent, and proposes a fix that runs in the right context (host or container). Triggers "diagnose", "why is X failing", "fix the failing service"
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
  - Agent
---

You are the orchestrator for the `/jlu:diagnose` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory.
2. `~/.claude/jelou/`.

If neither resolves, stop.

**Runtime contract.** Workflow uses `question` → `AskUserQuestion`, `task` → `Agent`.

**Run these in parallel:**
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/diagnose.md`
3. `ToolSearch`: `select:AskUserQuestion`.

Update banner / fallback as in other skills.

## Phase 2 — Execute Workflow

Follow the workflow inline. Argument is `{argument}`. Cwd is `{cwd}`. Dispatch the diagnoser agent via `Agent` with subagent_type `jlu-dev-diagnoser`.
````

- [ ] **Step 3: OpenCode mirror**

```markdown
---
description: Diagnose a failing service in the JLU dev environment
agent: build
---
Execute this workflow exactly: @jelou/workflows/diagnose.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Use `task` for subagent dispatches (used to invoke jlu-dev-diagnoser).
Always reference commands with the `jlu-` prefix.
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add jelou/workflows/diagnose.md skills/diagnose/SKILL.md .opencode/commands/jlu-diagnose.md
git commit -m "feat(diagnose): workflow + skill + opencode command [skip-bump]"
```

---

## Task 4: add.mjs core — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-add.test.mjs`
- Create: `bin/lib/dev-orchestrator/add.mjs`

`add.mjs` adds a single service's pane to an existing window without restarting.

Required exports:

- `addService({ config, workspaceRoot, slug, serviceName, runner })` returns `{ status, paneIndex?, reason? }`.

Behavior:
- If window for slug doesn't exist → `{ status: 'no-window' }`.
- If service not in config → `{ status: 'not-registered' }`.
- If pane with that title already exists → `{ status: 'pane-exists' }`.
- Else: `tmux split-window -t <window>`; build pane command via `buildPaneCommand`; send-keys; set title (and color if any); apply tiled layout; return `{ status: 'added', paneIndex }`.

- [ ] **Step 1: Test**

```javascript
// tests/unit/dev-orchestrator-add.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { addService } from '../../bin/lib/dev-orchestrator/add.mjs';

function fakeRunner(handlers = {}) {
  const calls = [];
  const fn = (args) => {
    calls.push([...args]);
    if (typeof handlers[args[0]] === 'function') return handlers[args[0]](args);
    return { status: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

describe('addService', () => {
  test('adds pane to existing window', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' }),
      'list-panes': () => ({ status: 0, stdout: '%1:other:0\n', stderr: '' })
    });
    const cfg = { version: 1, services: [{ name: 'api', path: './api', command: 'cmd' }] };
    const out = addService({
      config: cfg, workspaceRoot: '/work', slug: 'foo', serviceName: 'api', runner: r
    });
    assert.equal(out.status, 'added');
    const ops = r.calls.map(c => c[0]);
    assert.ok(ops.includes('split-window'));
    assert.ok(ops.includes('send-keys'));
    assert.ok(ops.includes('select-layout'));
    assert.ok(ops.includes('select-pane'));
  });

  test('returns no-window when window missing', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: '', stderr: '' })
    });
    const cfg = { version: 1, services: [{ name: 'api', path: './api', command: 'cmd' }] };
    const out = addService({
      config: cfg, workspaceRoot: '/work', slug: 'foo', serviceName: 'api', runner: r
    });
    assert.equal(out.status, 'no-window');
  });

  test('returns not-registered when service missing in config', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' })
    });
    const cfg = { version: 1, services: [] };
    const out = addService({
      config: cfg, workspaceRoot: '/work', slug: 'foo', serviceName: 'api', runner: r
    });
    assert.equal(out.status, 'not-registered');
  });

  test('returns pane-exists when title already taken', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' }),
      'list-panes': () => ({ status: 0, stdout: '%1:api:0\n', stderr: '' })
    });
    const cfg = { version: 1, services: [{ name: 'api', path: './api', command: 'cmd' }] };
    const out = addService({
      config: cfg, workspaceRoot: '/work', slug: 'foo', serviceName: 'api', runner: r
    });
    assert.equal(out.status, 'pane-exists');
  });
});
```

- [ ] **Step 2: Implementation**

```javascript
// bin/lib/dev-orchestrator/add.mjs
//
// Implements /jlu:add-service: add one service's pane to an existing window.

import { findWindow, listPanes, splitWindow, sendKeys, selectLayout, selectPane, selectPaneTitle, setPaneStyle } from './tmux.mjs';
import { buildPaneCommand } from './start.mjs';
import { isAbsolute, resolve } from 'node:path';

function paneCwdFor(workspaceRoot, service) {
  const rel = service.path || '.';
  return isAbsolute(rel) ? rel : resolve(workspaceRoot, rel);
}

function windowNameFor(slug) { return `jlu-dev-${slug || '_global'}`; }

export function addService({ config, workspaceRoot, slug, serviceName, runner }) {
  const services = config.services || [];
  const svc = services.find(s => s.name === serviceName);
  if (!svc) return { status: 'not-registered' };

  const winName = windowNameFor(slug);
  const win = findWindow(winName, runner);
  if (!win) return { status: 'no-window' };

  const target = `${win.session}:${winName}`;
  const panes = listPanes({ window: target, runner });
  const desiredTitle = (svc.panel && svc.panel.title) || svc.name;
  if (panes.find(p => p.title === desiredTitle)) return { status: 'pane-exists' };

  splitWindow({ target }, runner);

  // After split, the new pane is the last index.
  const newIdx = panes.length;
  const paneTarget = `${target}.${newIdx}`;

  selectPaneTitle({ target: paneTarget, title: desiredTitle }, runner);
  if (svc.panel && svc.panel.color) setPaneStyle({ target: paneTarget, style: svc.panel.color }, runner);

  const cwd = paneCwdFor(workspaceRoot, svc);
  const cmd = buildPaneCommand({ service: svc, paneCwd: cwd });
  sendKeys({ target: paneTarget, keys: cmd }, runner);

  selectLayout({ target, layout: 'tiled' }, runner);
  selectPane({ target: paneTarget }, runner);

  return { status: 'added', paneIndex: newIdx };
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-add.test.mjs
npm test
git add bin/lib/dev-orchestrator/add.mjs tests/unit/dev-orchestrator-add.test.mjs
git commit -m "feat(dev-orchestrator/add): add-service core (split + send + layout) [skip-bump]"
```

---

## Task 5: add-service workflow + skill + opencode

**Files:**
- Create: `jelou/workflows/add-service.md`
- Create: `skills/add-service/SKILL.md`
- Create: `.opencode/commands/jlu-add-service.md`

- [ ] **Step 1: Workflow**

````markdown
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
````

- [ ] **Step 2: Skill**

````markdown
---
name: add-service
description: Use to add a service's pane to a running jlu-dev TMUX window without restarting the rest. Triggers "add service", "add pane", "extend dev environment"
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

You are the orchestrator for the `/jlu:add-service` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try up 2 levels then `~/.claude/jelou/`.

**Runtime contract.** `question` → `AskUserQuestion`. No subagent dispatch needed.

**Run these in parallel:**
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/add-service.md`
3. `ToolSearch`: `select:AskUserQuestion`.

Update banner / fallback as in other skills.

## Phase 2 — Execute Workflow

Follow inline. Argument `{argument}`. Cwd `{cwd}`.
````

- [ ] **Step 3: OpenCode mirror**

```markdown
---
description: Add a service's pane to a running jlu-dev TMUX window
agent: build
---
Execute this workflow exactly: @jelou/workflows/add-service.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix.
```

- [ ] **Step 4: Verify + commit**

```bash
npm test
git add jelou/workflows/add-service.md skills/add-service/SKILL.md .opencode/commands/jlu-add-service.md
git commit -m "feat(add-service): workflow + skill + opencode command [skip-bump]"
```

---

## Task 6: logs.mjs core — RED + GREEN

**Files:**
- Create: `tests/unit/dev-orchestrator-logs.test.mjs`
- Create: `bin/lib/dev-orchestrator/logs.mjs`

`logs.mjs` exports `logsFor({ slug, serviceName, lines = 100, runner, allServices })`. Returns `{ status, capture?, paneIndex? }`.

- If window missing → `{ status: 'no-window' }`.
- If service not in config → `{ status: 'not-registered' }`.
- If service has no pane → `{ status: 'no-pane' }`.
- Else: `{ status: 'ok', capture, paneIndex }`.

- [ ] **Step 1: Test**

```javascript
// tests/unit/dev-orchestrator-logs.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { logsFor } from '../../bin/lib/dev-orchestrator/logs.mjs';

function fakeRunner(handlers = {}) {
  const calls = [];
  const fn = (args) => {
    calls.push([...args]);
    if (typeof handlers[args[0]] === 'function') return handlers[args[0]](args);
    return { status: 0, stdout: '', stderr: '' };
  };
  fn.calls = calls;
  return fn;
}

describe('logsFor', () => {
  test('returns capture for a tracked pane', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' }),
      'list-panes': () => ({ status: 0, stdout: '%1:api:0\n%2:web:0\n', stderr: '' }),
      'capture-pane': () => ({ status: 0, stdout: 'log line 1\nlog line 2\n', stderr: '' })
    });
    const allServices = [
      { name: 'api', path: '.', command: 'x' },
      { name: 'web', path: '.', command: 'y' }
    ];
    const out = logsFor({ slug: 'foo', serviceName: 'api', allServices, runner: r });
    assert.equal(out.status, 'ok');
    assert.match(out.capture, /log line 1/);
  });

  test('returns no-window when window missing', () => {
    const r = fakeRunner({ 'list-windows': () => ({ status: 0, stdout: '', stderr: '' }) });
    const out = logsFor({ slug: 'foo', serviceName: 'api', allServices: [{ name: 'api', path: '.', command: 'x' }], runner: r });
    assert.equal(out.status, 'no-window');
  });

  test('returns not-registered when service missing in config', () => {
    const r = fakeRunner();
    const out = logsFor({ slug: 'foo', serviceName: 'api', allServices: [], runner: r });
    assert.equal(out.status, 'not-registered');
  });

  test('returns no-pane when service has no pane', () => {
    const r = fakeRunner({
      'list-windows': () => ({ status: 0, stdout: 'main:0:jlu-dev-foo\n', stderr: '' }),
      'list-panes': () => ({ status: 0, stdout: '%1:other:0\n', stderr: '' })
    });
    const out = logsFor({ slug: 'foo', serviceName: 'api', allServices: [{ name: 'api', path: '.', command: 'x' }], runner: r });
    assert.equal(out.status, 'no-pane');
  });
});
```

- [ ] **Step 2: Implementation**

```javascript
// bin/lib/dev-orchestrator/logs.mjs
//
// Implements /jlu:logs: capture-pane on demand for one service.

import { findWindow, listPanes, capturePane } from './tmux.mjs';

function windowNameFor(slug) { return `jlu-dev-${slug || '_global'}`; }

export function logsFor({ slug, serviceName, lines = 100, runner, allServices = [] }) {
  const svc = allServices.find(s => s.name === serviceName);
  if (!svc) return { status: 'not-registered' };

  const winName = windowNameFor(slug);
  const win = findWindow(winName, runner);
  if (!win) return { status: 'no-window' };

  const target = `${win.session}:${winName}`;
  const panes = listPanes({ window: target, runner });
  const title = (svc.panel && svc.panel.title) || svc.name;
  const idx = panes.findIndex(p => p.title === title);
  if (idx < 0) return { status: 'no-pane' };

  const capture = capturePane({ target: `${target}.${idx}`, lines }, runner);
  return { status: 'ok', capture, paneIndex: idx };
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/unit/dev-orchestrator-logs.test.mjs
npm test
git add bin/lib/dev-orchestrator/logs.mjs tests/unit/dev-orchestrator-logs.test.mjs
git commit -m "feat(dev-orchestrator/logs): on-demand pane capture core [skip-bump]"
```

---

## Task 7: logs workflow + skill + opencode

**Files:**
- Create: `jelou/workflows/logs.md`
- Create: `skills/logs/SKILL.md`
- Create: `.opencode/commands/jlu-logs.md`

- [ ] **Step 1: Workflow**

````markdown
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
````

- [ ] **Step 2: Skill**

````markdown
---
name: logs
description: Use to print the last N lines from a service's TMUX pane on demand. Read-only. Triggers "show logs", "logs for X", "tail service"
argument-hint: "[<service> [--lines N]]"
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

You are the orchestrator for the `/jlu:logs` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try up 2 levels then `~/.claude/jelou/`.

**Runtime contract.** `question` → `AskUserQuestion`.

**Run these in parallel:**
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/logs.md`
3. `ToolSearch`: `select:AskUserQuestion`.

Update banner / fallback as in other skills.

## Phase 2 — Execute Workflow

Follow inline. Argument `{argument}`. Cwd `{cwd}`.
````

- [ ] **Step 3: OpenCode mirror**

```markdown
---
description: Print the last N lines from a service's TMUX pane on demand
agent: build
---
Execute this workflow exactly: @jelou/workflows/logs.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix.
```

- [ ] **Step 4: Verify + commit**

```bash
npm test
git add jelou/workflows/logs.md skills/logs/SKILL.md .opencode/commands/jlu-logs.md
git commit -m "feat(logs): workflow + skill + opencode command [skip-bump]"
```

---

## Task 8: Smoke verification

- [ ] **Step 1: Suite + integration**

```bash
npm test
node --test tests/integration/dev-orchestrator/*.test.mjs
```

- [ ] **Step 2: Manual interactive smoke (user-driven)**

In a fresh Claude Code session:
1. Set up a scratch workspace with at least one Dockerized service and one host service.
2. `/jlu:start-dev`. Wait until daemon is running.
3. Trigger a failure: kill a pane manually or break the start command.
4. Run `/jlu:diagnose <service>` — confirm a fix proposal appears, with `runs_in` matching the service's runtime type.
5. Run `/jlu:add-service <other-service>` — confirm a pane appears in the existing window.
6. Run `/jlu:logs <service>` — confirm last 100 lines print.
7. `/jlu:stop-dev --kill-services` and clean up.

---

## Self-Review

| Spec section | Implemented in |
|---|---|
| Diagnoser agent (dual-published) | Task 1 |
| diagnose.mjs core | Task 2 |
| diagnose runtime trio | Task 3 |
| add-service core | Task 4 |
| add-service runtime trio | Task 5 |
| logs core | Task 6 |
| logs runtime trio | Task 7 |
| Hard rules in agent prompt: container fixes use exec_template; missing-dep proposals; evidence-required output | Task 1 prompt body |
| Daemon picks up new pane after add-service automatically (no SIGHUP) | Phase 3 already implements pane-discovery by title every tick |

**Boundary respected:** Phase 5 will polish (smart inference enhancements, README, parity audit suite).

---

## Branch handoff

After Task 8:
- Branch is still `feature/dev-orchestrator`.
- Around 8 new commits in Phase 4.
- Suite green; no PR opened yet.

Next: invoke the Phase 5 plan (`docs/superpowers/plans/2026-05-04-jlu-dev-orchestrator-phase5-polish.md`).
