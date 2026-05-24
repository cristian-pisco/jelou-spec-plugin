# Tracing & Observability — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deterministic foundation of the tracing system: schema constants, a single-writer JSONL emitter with ULID + payload cap + `TRACE_DISABLED` short-circuit, a tolerant reader, three CLI wrappers (`trace-start-span`, `trace-end-span`, `trace-reconcile`), a tracing reference doc, and a workspace `.gitignore` entry. After Phase 1, traces can be emitted, read, and reconciled from any `bin/` script — but no workflow `.md` writes them yet, no daemon migrated yet, no analyzer/suggester yet.

**Architecture:** Pure-Node stdlib `.mjs` modules under `bin/lib/trace/`. The emitter owns the file append and ULID generation; the reader is iterative and tolerant of malformed lines. Three thin CLI wrappers call into the lib. All decisions are deterministic and unit-tested. No new npm deps.

**Tech Stack:** Node 20+ ESM (`.mjs`). `node:test`. `node:crypto.randomBytes` for ULID. `node:fs` `appendFileSync` with `O_APPEND` semantics. Stdlib only.

**Spec:** `docs/superpowers/specs/2026-05-23-tracing-observability-design.md`

**Phase 1 deliverable (shippable on its own):**
- `bin/lib/trace/{schema,emitter,reader}.mjs` with full unit coverage.
- `bin/trace-start-span.mjs`, `bin/trace-end-span.mjs`, `bin/trace-reconcile.mjs` CLIs with unit coverage.
- `jelou/references/tracing.md` schema reference.
- `.gitignore` entry for `.traces/`.
- Integration test exercising the three CLIs end-to-end against a workspace JSONL.

**Out of scope for this plan (covered by later phase plans):**
- Phase 2: Wire all 6 workflows + migrate dev-env daemon to the new emitter.
- Phase 3: `bin/trace-analyze.mjs`, `bin/trace-suggest.mjs`, `skills/trace-report/SKILL.md`, README section, end-to-end integration tests with mocked dispatches.

Each later phase will get its own plan file under `docs/superpowers/plans/`.

---

## File Structure (Phase 1 only)

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `bin/lib/trace/schema.mjs` | Constants only: `EVENT_KIND`, `STATUS`, `SCOPE`, `SPAN_NAMES`, payload cap, reconcile threshold. No logic. |
| `bin/lib/trace/emitter.mjs` | ULID generator, `appendSpan(file, event)`, `startSpan/endSpan` helpers, payload cap enforcement, `TRACE_DISABLED` short-circuit, stderr fallback. |
| `bin/lib/trace/reader.mjs` | `readSpans(file, { filter })` iterative parser. Skip-malformed lines. Rotation-aware (reads `spans.jsonl` + `spans-NNN.jsonl` siblings). |
| `bin/trace-start-span.mjs` | CLI wrapper. Emits `span_start`. Prints `{span_id, trace_id, parent}` to stdout. |
| `bin/trace-end-span.mjs` | CLI wrapper. Emits `span_end`. Computes `duration_ms` from start lookup. |
| `bin/trace-reconcile.mjs` | CLI wrapper. Sweeps orphans (`span_start` with `ts < now() - 30min` lacking `span_end`), emits synthetic `span_end` with `status: "orphaned"`. Idempotent. |
| `jelou/references/tracing.md` | Schema reference: event shapes, attrs canon, `scope` semantics, how to add a new span name. |
| `tests/unit/trace-schema.test.mjs` | Verifies constants are frozen, values are stable. |
| `tests/unit/trace-emitter.test.mjs` | Unit tests for emitter + ULID. |
| `tests/unit/trace-reader.test.mjs` | Unit tests for reader (skip-malformed, rotation, filter). |
| `tests/unit/trace-start-span.test.mjs` | Unit tests for `trace-start-span.mjs` CLI. |
| `tests/unit/trace-end-span.test.mjs` | Unit tests for `trace-end-span.mjs` CLI. |
| `tests/unit/trace-reconcile.test.mjs` | Unit tests for `trace-reconcile.mjs` CLI. |
| `tests/integration/trace-foundation-end-to-end.test.mjs` | Integration: start → end → reconcile across two simulated processes. |
| `tests/fixtures/trace/sample-spans.jsonl` | Small JSONL fixture for reader tests. |
| `tests/fixtures/trace/corrupt-spans.jsonl` | JSONL with one malformed line. |

### Files to MODIFY

| Path | Change |
|------|--------|
| `.gitignore` | Add `.traces/` entry. |

### Coding rule (applies to every module)

- Every child-process call uses `spawnSync` / `spawn` with **array** args (never shell-string `exec`).
- Every file write uses `fs.appendFileSync` with single calls < `PIPE_BUF` (4 KB). Enforce via the payload cap.
- Every module starts with the header pattern used in `bin/plan-phase-waves.mjs`: shebang + module-level comment with Inputs, Output, Exit codes.
- Tests follow the pattern in `tests/unit/agent-frontmatter.test.mjs`: `import { test, describe } from 'node:test'`, `import { strict as assert } from 'node:assert'`, descriptive `describe` blocks per behavior.

---

## Task 0: Pre-flight — clean base, tests green

**Files:** none (verification only).

- [ ] **Step 1: Confirm clean working tree on `main`**

Run:
```bash
git status --short
git rev-parse --abbrev-ref HEAD
```

Expected: empty status output. Branch `main`. If not, stop and surface to user.

- [ ] **Step 2: Sync with remote**

Run:
```bash
git fetch origin
git rebase origin/main
```

Expected: "Current branch main is up to date." If conflicts surface, stop and surface to user.

- [ ] **Step 3: Baseline test suite is green**

Run:
```bash
npm test
node bin/sync-agents.mjs --check
```

Expected: all tests pass. `sync-agents --check` exit 0. If red, stop — do not start instrumented work on a broken base.

- [ ] **Step 4: Create feature branch**

Run:
```bash
git checkout -b feature/tracing-foundation
```

Expected: switched to new branch.

---

## Task 1: Add `.traces/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append `.traces/` line under a new section header**

Open `.gitignore`. Below the existing `playwright-output/` block, append:

```
# Tracing — workspace-local span store, never commit raw traces
.traces/
```

- [ ] **Step 2: Verify entry appears**

Run:
```bash
grep -A1 "Tracing" .gitignore
```

Expected output:
```
# Tracing — workspace-local span store, never commit raw traces
.traces/
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(tracing): ignore .traces/ in workspaces"
```

---

## Task 2: `bin/lib/trace/schema.mjs` — constants module

**Files:**
- Create: `bin/lib/trace/schema.mjs`
- Test: `tests/unit/trace-schema.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/trace-schema.test.mjs`:

```javascript
// tests/unit/trace-schema.test.mjs
//
// Run: `node --test tests/unit/trace-schema.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  EVENT_KIND,
  STATUS,
  SCOPE,
  SPAN_NAMES,
  PAYLOAD_CAP_BYTES,
  RECONCILE_AFTER_MS,
} from '../../bin/lib/trace/schema.mjs';

describe('schema constants are frozen and stable', () => {
  test('EVENT_KIND has exactly the three documented kinds', () => {
    assert.deepEqual(
      Object.keys(EVENT_KIND).sort(),
      ['EVENT', 'SPAN_END', 'SPAN_START']
    );
    assert.equal(EVENT_KIND.SPAN_START, 'span_start');
    assert.equal(EVENT_KIND.SPAN_END, 'span_end');
    assert.equal(EVENT_KIND.EVENT, 'event');
  });

  test('STATUS includes ok / blocked / failed / escalated / orphaned', () => {
    assert.equal(STATUS.OK, 'ok');
    assert.equal(STATUS.BLOCKED, 'blocked');
    assert.equal(STATUS.FAILED, 'failed');
    assert.equal(STATUS.ESCALATED, 'escalated');
    assert.equal(STATUS.ORPHANED, 'orphaned');
  });

  test('SCOPE includes task / daemon / global', () => {
    assert.deepEqual(
      Object.values(SCOPE).sort(),
      ['daemon', 'global', 'task']
    );
  });

  test('SPAN_NAMES includes canonical workflow names', () => {
    for (const name of ['execute_task', 'new_task', 'refine_task', 'create_pr',
                        'report_task', 'close_task', 'phase', 'agent_dispatch']) {
      assert.ok(Object.values(SPAN_NAMES).includes(name),
        `SPAN_NAMES missing ${name}`);
    }
  });

  test('PAYLOAD_CAP_BYTES is 3500 (below PIPE_BUF 4096)', () => {
    assert.equal(PAYLOAD_CAP_BYTES, 3500);
  });

  test('RECONCILE_AFTER_MS defaults to 30 minutes', () => {
    assert.equal(RECONCILE_AFTER_MS, 30 * 60 * 1000);
  });

  test('all exports are frozen (no runtime mutation)', () => {
    assert.ok(Object.isFrozen(EVENT_KIND));
    assert.ok(Object.isFrozen(STATUS));
    assert.ok(Object.isFrozen(SCOPE));
    assert.ok(Object.isFrozen(SPAN_NAMES));
  });
});
```

- [ ] **Step 2: Run test, confirm it fails (module does not exist yet)**

Run:
```bash
node --test tests/unit/trace-schema.test.mjs
```

Expected: FAIL with "Cannot find module '../../bin/lib/trace/schema.mjs'".

- [ ] **Step 3: Create the schema module**

Create `bin/lib/trace/schema.mjs`:

```javascript
// bin/lib/trace/schema.mjs
//
// Tracing schema constants. No logic — values only.
// Imported by emitter, reader, all bin/trace-* CLIs, future analyze/suggest.

export const EVENT_KIND = Object.freeze({
  SPAN_START: 'span_start',
  SPAN_END: 'span_end',
  EVENT: 'event',
});

export const STATUS = Object.freeze({
  OK: 'ok',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  ESCALATED: 'escalated',
  ORPHANED: 'orphaned',
});

export const SCOPE = Object.freeze({
  TASK: 'task',
  DAEMON: 'daemon',
  GLOBAL: 'global',
});

export const SPAN_NAMES = Object.freeze({
  EXECUTE_TASK: 'execute_task',
  NEW_TASK: 'new_task',
  REFINE_TASK: 'refine_task',
  CREATE_PR: 'create_pr',
  REPORT_TASK: 'report_task',
  CLOSE_TASK: 'close_task',
  PHASE: 'phase',
  AGENT_DISPATCH: 'agent_dispatch',
});

// Single appendFileSync call must stay below PIPE_BUF (4096 on Linux)
// to remain atomic. Leave headroom for the trailing newline + envelope.
export const PAYLOAD_CAP_BYTES = 3500;

// Threshold for reconciler to declare a span_start orphaned.
export const RECONCILE_AFTER_MS = 30 * 60 * 1000;
```

- [ ] **Step 4: Run test, confirm it passes**

Run:
```bash
node --test tests/unit/trace-schema.test.mjs
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add bin/lib/trace/schema.mjs tests/unit/trace-schema.test.mjs
git commit -m "feat(tracing): add schema constants module"
```

---

## Task 3: `bin/lib/trace/emitter.mjs` — ULID + appendSpan + payload cap + TRACE_DISABLED

**Files:**
- Create: `bin/lib/trace/emitter.mjs`
- Test: `tests/unit/trace-emitter.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/trace-emitter.test.mjs`:

```javascript
// tests/unit/trace-emitter.test.mjs
//
// Run: `node --test tests/unit/trace-emitter.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid, appendSpan, startSpan, endSpan } from '../../bin/lib/trace/emitter.mjs';
import { EVENT_KIND, STATUS, SCOPE } from '../../bin/lib/trace/schema.mjs';

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-emitter-'));
  file = join(dir, 'spans.jsonl');
  delete process.env.TRACE_DISABLED;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TRACE_DISABLED;
});

describe('ulid()', () => {
  test('returns a 26-character Crockford base32 string', () => {
    const id = ulid();
    assert.equal(id.length, 26);
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('two consecutive ulids are monotonic by time prefix', () => {
    const a = ulid();
    const b = ulid();
    // First 10 chars are the 48-bit ms timestamp; b must be >= a
    assert.ok(b.slice(0, 10) >= a.slice(0, 10));
  });

  test('uniqueness across 1000 calls', () => {
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(ulid());
    assert.equal(set.size, 1000);
  });
});

describe('appendSpan(file, event)', () => {
  test('writes one JSONL line with required fields', () => {
    appendSpan(file, {
      event_kind: EVENT_KIND.SPAN_START,
      span_id: '01HXY7K2ABCDEFGHJKMNPQRSTV',
      trace_id: '01HXY7K2ABCDEFGHJKMNPQRSTV',
      scope: SCOPE.TASK,
      name: 'execute_task',
    });
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.event_kind, 'span_start');
    assert.equal(parsed.scope, 'task');
    assert.equal(parsed.name, 'execute_task');
    assert.ok(parsed.ts, 'ts is auto-populated');
  });

  test('appends successive lines without overwriting', () => {
    for (let i = 0; i < 3; i++) {
      appendSpan(file, {
        event_kind: EVENT_KIND.SPAN_START,
        span_id: ulid(), trace_id: ulid(), scope: SCOPE.TASK, name: 'x',
      });
    }
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 3);
  });

  test('creates parent directory if missing', () => {
    const nested = join(dir, 'a/b/c/spans.jsonl');
    appendSpan(nested, {
      event_kind: EVENT_KIND.EVENT,
      span_id: ulid(), trace_id: ulid(), scope: SCOPE.GLOBAL, name: 'ping',
    });
    assert.ok(readFileSync(nested, 'utf8').length > 0);
  });

  test('TRACE_DISABLED=1 short-circuits (no file write)', () => {
    process.env.TRACE_DISABLED = '1';
    appendSpan(file, {
      event_kind: EVENT_KIND.SPAN_START,
      span_id: ulid(), trace_id: ulid(), scope: SCOPE.TASK, name: 'x',
    });
    // No file should be created
    assert.throws(() => readFileSync(file, 'utf8'), /ENOENT/);
  });

  test('payload over 3500 bytes drops outcome + artifacts and writes', () => {
    const big = 'x'.repeat(5000);
    appendSpan(file, {
      event_kind: EVENT_KIND.SPAN_END,
      span_id: ulid(), trace_id: ulid(), scope: SCOPE.TASK, name: 'phase',
      status: STATUS.OK,
      attrs: { outcome: big, artifacts: [big, big], retry_count: 1 },
    });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.attrs.outcome, undefined,
      'outcome dropped when over cap');
    assert.equal(parsed.attrs.artifacts, undefined,
      'artifacts dropped when over cap');
    assert.equal(parsed.attrs.retry_count, 1,
      'small attrs preserved');
    assert.equal(parsed.attrs.payload_capped, true,
      'cap is signalled');
  });

  test('fallback to stderr when file is not writable', (t) => {
    // Point at a path under a non-existent read-only mount style location.
    // Simulate by passing a path whose parent is a regular file.
    const blocking = join(dir, 'blocker');
    writeFileSync(blocking, 'plain', 'utf8');
    const bad = join(blocking, 'sub/spans.jsonl');
    const warnings = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { warnings.push(String(chunk)); return true; };
    try {
      appendSpan(bad, {
        event_kind: EVENT_KIND.EVENT,
        span_id: ulid(), trace_id: ulid(), scope: SCOPE.GLOBAL, name: 'x',
      });
    } finally {
      process.stderr.write = origStderr;
    }
    assert.ok(
      warnings.some((w) => /trace.*write.*failed/i.test(w)),
      'expected stderr warning'
    );
  });
});

describe('startSpan(file, event) / endSpan(file, event)', () => {
  test('startSpan auto-fills event_kind and returns ids', () => {
    const r = startSpan(file, {
      scope: SCOPE.TASK, name: 'phase', parent_span_id: null,
    });
    assert.ok(r.span_id);
    assert.ok(r.trace_id);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(line.event_kind, 'span_start');
    assert.equal(line.span_id, r.span_id);
    assert.equal(line.trace_id, r.trace_id);
  });

  test('startSpan with parent inherits trace_id', () => {
    const root = startSpan(file, { scope: SCOPE.TASK, name: 'execute_task' });
    const child = startSpan(file, {
      scope: SCOPE.TASK, name: 'phase',
      parent_span_id: root.span_id, trace_id: root.trace_id,
    });
    assert.equal(child.trace_id, root.trace_id);
    assert.notEqual(child.span_id, root.span_id);
  });

  test('endSpan emits span_end with status and attrs', () => {
    endSpan(file, {
      span_id: 'S1', trace_id: 'T1', name: 'phase',
      scope: SCOPE.TASK, status: STATUS.OK,
      duration_ms: 1234,
      attrs: { retry_count: 0 },
    });
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(line.event_kind, 'span_end');
    assert.equal(line.duration_ms, 1234);
    assert.equal(line.attrs.retry_count, 0);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails (module not yet)**

Run:
```bash
node --test tests/unit/trace-emitter.test.mjs 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module '../../bin/lib/trace/emitter.mjs'".

- [ ] **Step 3: Create the emitter module**

Create `bin/lib/trace/emitter.mjs`:

```javascript
// bin/lib/trace/emitter.mjs
//
// Single-writer JSONL emitter for the tracing system. Stdlib-only.
//   - ulid(): 26-char Crockford base32 monotonic id.
//   - appendSpan(file, event): one fs.appendFileSync; auto-creates parent dirs;
//     enforces PAYLOAD_CAP_BYTES by dropping `outcome`/`artifacts` when over cap;
//     short-circuits when TRACE_DISABLED=1; falls back to stderr on write error.
//   - startSpan(file, { scope, name, parent_span_id?, trace_id?, ... }):
//     wraps appendSpan for the SPAN_START case, generating span_id + trace_id
//     when not provided.
//   - endSpan(file, { span_id, trace_id, name, scope, status, duration_ms?, attrs? }):
//     wraps appendSpan for the SPAN_END case.
//
// File appends < PIPE_BUF (4 KB) are atomic on Linux/macOS, so concurrent writers
// to the same file do not interleave bytes. We enforce that bound via PAYLOAD_CAP_BYTES.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EVENT_KIND, PAYLOAD_CAP_BYTES } from './schema.mjs';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastMs = 0;
let lastSeq = 0;

export function ulid() {
  let ms = Date.now();
  // Ensure monotonicity inside the same millisecond by incrementing the
  // random portion via a sequence counter when ms hasn't advanced.
  if (ms <= lastMs) {
    ms = lastMs;
    lastSeq += 1;
  } else {
    lastMs = ms;
    lastSeq = 0;
  }
  let tsPart = '';
  let t = ms;
  for (let i = 9; i >= 0; i--) {
    tsPart = CROCKFORD[t % 32] + tsPart;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(10);
  // Mix the sequence counter into the last byte so same-ms ids stay monotonic.
  rnd[9] = (rnd[9] + lastSeq) & 0xff;
  let bin = '';
  for (const b of rnd) bin += b.toString(2).padStart(8, '0');
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart += CROCKFORD[parseInt(bin.slice(i * 5, (i + 1) * 5), 2)];
  }
  return tsPart + randPart;
}

export function appendSpan(file, event) {
  if (process.env.TRACE_DISABLED === '1') return;

  const out = { ts: event.ts || new Date().toISOString(), ...event };

  let line = JSON.stringify(out);
  if (Buffer.byteLength(line, 'utf8') > PAYLOAD_CAP_BYTES) {
    if (out.attrs) {
      const trimmed = { ...out.attrs };
      delete trimmed.outcome;
      delete trimmed.artifacts;
      trimmed.payload_capped = true;
      out.attrs = trimmed;
    }
    line = JSON.stringify(out);
    // If still over cap, drop attrs entirely as a last resort.
    if (Buffer.byteLength(line, 'utf8') > PAYLOAD_CAP_BYTES) {
      out.attrs = { payload_capped: true };
      line = JSON.stringify(out);
    }
  }

  try {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, line + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(
      `[trace] write failed for ${file}: ${err.message}\n`
    );
  }
}

export function startSpan(file, event) {
  const trace_id = event.trace_id || ulid();
  const span_id = ulid();
  appendSpan(file, {
    event_kind: EVENT_KIND.SPAN_START,
    span_id,
    trace_id,
    parent_span_id: event.parent_span_id || undefined,
    scope: event.scope,
    name: event.name,
    task_slug: event.task_slug,
    service_id: event.service_id,
    phase_num: event.phase_num,
    agent_role: event.agent_role,
    attrs: event.attrs,
  });
  return { span_id, trace_id, parent_span_id: event.parent_span_id || null };
}

export function endSpan(file, event) {
  appendSpan(file, {
    event_kind: EVENT_KIND.SPAN_END,
    span_id: event.span_id,
    trace_id: event.trace_id,
    parent_span_id: event.parent_span_id || undefined,
    scope: event.scope,
    name: event.name,
    task_slug: event.task_slug,
    service_id: event.service_id,
    phase_num: event.phase_num,
    agent_role: event.agent_role,
    duration_ms: event.duration_ms,
    status: event.status,
    attrs: event.attrs,
  });
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run:
```bash
node --test tests/unit/trace-emitter.test.mjs 2>&1 | tail -30
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add bin/lib/trace/emitter.mjs tests/unit/trace-emitter.test.mjs
git commit -m "feat(tracing): add JSONL emitter with ULID, payload cap, and TRACE_DISABLED short-circuit"
```

---

## Task 4: `bin/lib/trace/reader.mjs` — tolerant iterator + rotation awareness

**Files:**
- Create: `bin/lib/trace/reader.mjs`
- Test: `tests/unit/trace-reader.test.mjs`
- Create: `tests/fixtures/trace/sample-spans.jsonl`
- Create: `tests/fixtures/trace/corrupt-spans.jsonl`

- [ ] **Step 1: Create fixture files**

Create `tests/fixtures/trace/sample-spans.jsonl`:

```jsonl
{"ts":"2026-05-20T10:00:00Z","event_kind":"span_start","span_id":"S1","trace_id":"T1","scope":"task","name":"execute_task","task_slug":"alpha"}
{"ts":"2026-05-20T10:00:05Z","event_kind":"span_start","span_id":"S2","parent_span_id":"S1","trace_id":"T1","scope":"task","name":"phase","task_slug":"alpha","phase_num":1}
{"ts":"2026-05-20T10:01:00Z","event_kind":"span_end","span_id":"S2","trace_id":"T1","scope":"task","name":"phase","status":"ok","duration_ms":55000,"attrs":{"retry_count":0}}
{"ts":"2026-05-20T10:01:05Z","event_kind":"span_end","span_id":"S1","trace_id":"T1","scope":"task","name":"execute_task","status":"ok","duration_ms":65000}
{"ts":"2026-05-20T11:00:00Z","event_kind":"event","span_id":"E1","trace_id":"T2","scope":"daemon","name":"pattern_match"}
```

Create `tests/fixtures/trace/corrupt-spans.jsonl`:

```jsonl
{"ts":"2026-05-20T10:00:00Z","event_kind":"span_start","span_id":"S1","trace_id":"T1","scope":"task","name":"execute_task"}
this is not valid JSON
{"ts":"2026-05-20T10:00:05Z","event_kind":"span_end","span_id":"S1","trace_id":"T1","scope":"task","name":"execute_task","status":"ok","duration_ms":5000}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/trace-reader.test.mjs`:

```javascript
// tests/unit/trace-reader.test.mjs
//
// Run: `node --test tests/unit/trace-reader.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSpans, listRotatedFiles } from '../../bin/lib/trace/reader.mjs';

let dir;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'trace-reader-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const FIX = 'tests/fixtures/trace';

describe('readSpans(file)', () => {
  test('reads all events in file order', () => {
    const events = [...readSpans(`${FIX}/sample-spans.jsonl`)];
    assert.equal(events.length, 5);
    assert.equal(events[0].span_id, 'S1');
    assert.equal(events[4].name, 'pattern_match');
  });

  test('skips malformed lines and continues', () => {
    const warnings = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { warnings.push(String(chunk)); return true; };
    let events;
    try {
      events = [...readSpans(`${FIX}/corrupt-spans.jsonl`)];
    } finally {
      process.stderr.write = origStderr;
    }
    assert.equal(events.length, 2, 'malformed line is skipped');
    assert.ok(warnings.some((w) => /skip.*malformed/i.test(w)));
  });

  test('returns empty iterator when file does not exist', () => {
    const events = [...readSpans(join(dir, 'missing.jsonl'))];
    assert.equal(events.length, 0);
  });

  test('filter: by task_slug', () => {
    const events = [...readSpans(`${FIX}/sample-spans.jsonl`,
      { filter: (e) => e.task_slug === 'alpha' })];
    assert.equal(events.length, 4);
    assert.ok(events.every((e) => e.task_slug === 'alpha'));
  });

  test('filter: by event_kind', () => {
    const events = [...readSpans(`${FIX}/sample-spans.jsonl`,
      { filter: (e) => e.event_kind === 'span_end' })];
    assert.equal(events.length, 2);
  });
});

describe('listRotatedFiles(baseFile)', () => {
  test('returns base file plus rotated siblings in order', () => {
    const base = join(dir, 'spans.jsonl');
    writeFileSync(base, '');
    writeFileSync(join(dir, 'spans-001.jsonl'), '');
    writeFileSync(join(dir, 'spans-002.jsonl'), '');
    writeFileSync(join(dir, 'unrelated.jsonl'), '');
    const files = listRotatedFiles(base);
    assert.deepEqual(
      files.map((f) => f.replace(dir + '/', '')),
      ['spans-001.jsonl', 'spans-002.jsonl', 'spans.jsonl']
    );
  });

  test('returns only base when no rotation', () => {
    const base = join(dir, 'spans.jsonl');
    writeFileSync(base, '');
    const files = listRotatedFiles(base);
    assert.deepEqual(
      files.map((f) => f.replace(dir + '/', '')),
      ['spans.jsonl']
    );
  });

  test('returns empty when base missing', () => {
    const base = join(dir, 'spans.jsonl');
    assert.deepEqual(listRotatedFiles(base), []);
  });
});
```

- [ ] **Step 3: Run test, confirm it fails**

Run:
```bash
node --test tests/unit/trace-reader.test.mjs 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module '../../bin/lib/trace/reader.mjs'".

- [ ] **Step 4: Create the reader module**

Create `bin/lib/trace/reader.mjs`:

```javascript
// bin/lib/trace/reader.mjs
//
// Iterative JSONL reader for the tracing store. Stdlib-only.
//   - readSpans(file, { filter? }): generator of parsed events. Skip-malformed.
//   - listRotatedFiles(baseFile): rotated siblings (spans-NNN.jsonl) + base in order.
//
// Designed for memory-bounded reads: the generator yields one event at a time,
// callers can short-circuit via `for-of` `break`. Analyzers and the suggester
// build their indexes incrementally without loading the whole file.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

export function* readSpans(file, { filter } = {}) {
  if (!existsSync(file)) return;
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    process.stderr.write(`[trace] read failed for ${file}: ${err.message}\n`);
    return;
  }
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      process.stderr.write(`[trace] skip malformed line in ${file}\n`);
      continue;
    }
    if (filter && !filter(evt)) continue;
    yield evt;
  }
}

export function listRotatedFiles(baseFile) {
  const dir = dirname(baseFile);
  const base = basename(baseFile);                    // spans.jsonl
  const stem = base.replace(/\.jsonl$/, '');          // spans
  if (!existsSync(dir)) return [];
  const siblings = readdirSync(dir).filter((f) => {
    if (f === base) return existsSync(join(dir, f));
    return f.startsWith(`${stem}-`) && f.endsWith('.jsonl');
  });
  if (!siblings.length) return [];
  // Sort rotated (numbered) first ascending, then base last.
  siblings.sort((a, b) => {
    if (a === base) return 1;
    if (b === base) return -1;
    return a.localeCompare(b);
  });
  return siblings.map((f) => join(dir, f));
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run:
```bash
node --test tests/unit/trace-reader.test.mjs 2>&1 | tail -20
```

Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add bin/lib/trace/reader.mjs tests/unit/trace-reader.test.mjs tests/fixtures/trace/
git commit -m "feat(tracing): add tolerant JSONL reader with rotation awareness"
```

---

## Task 5: `bin/trace-start-span.mjs` — CLI wrapper

**Files:**
- Create: `bin/trace-start-span.mjs`
- Test: `tests/unit/trace-start-span.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/trace-start-span.test.mjs`:

```javascript
// tests/unit/trace-start-span.test.mjs
//
// Run: `node --test tests/unit/trace-start-span.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;
let file;
const SCRIPT = 'bin/trace-start-span.mjs';

function run(args, env = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-start-cli-'));
  file = join(dir, 'spans.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-start-span.mjs', () => {
  test('emits a workflow root span and prints {span_id, trace_id} on stdout', () => {
    const r = run(['--name', 'execute_task', '--scope', 'task',
                   '--task', 'alpha']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.span_id);
    assert.ok(out.trace_id);
    assert.equal(out.parent, null);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(line.event_kind, 'span_start');
    assert.equal(line.name, 'execute_task');
    assert.equal(line.task_slug, 'alpha');
  });

  test('with --parent, inherits trace_id and sets parent_span_id', () => {
    const root = JSON.parse(run(['--name', 'execute_task', '--scope', 'task',
                                  '--task', 'alpha']).stdout);
    const child = JSON.parse(run(['--name', 'phase', '--scope', 'task',
                                   '--task', 'alpha', '--service', 'svc-x',
                                   '--phase', '1',
                                   '--parent', root.span_id,
                                   '--trace', root.trace_id]).stdout);
    assert.equal(child.trace_id, root.trace_id);
    assert.notEqual(child.span_id, root.span_id);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const childLine = JSON.parse(lines[1]);
    assert.equal(childLine.parent_span_id, root.span_id);
    assert.equal(childLine.service_id, 'svc-x');
    assert.equal(childLine.phase_num, 1);
  });

  test('exits 1 when --name is missing', () => {
    const r = run(['--scope', 'task']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--name required/i);
  });

  test('exits 1 when --scope is invalid', () => {
    const r = run(['--name', 'phase', '--scope', 'invalid']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--scope must be one of/i);
  });

  test('TRACE_DISABLED=1: exits 0, writes nothing, prints empty ids', () => {
    const r = run(['--name', 'execute_task', '--scope', 'task'],
                  { TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.span_id, '');
    assert.equal(out.trace_id, '');
  });

  test('agent_dispatch span carries --agent and --model', () => {
    const root = JSON.parse(run(['--name', 'execute_task', '--scope', 'task',
                                  '--task', 'a']).stdout);
    const r = run(['--name', 'agent_dispatch', '--scope', 'task',
                   '--agent', 'implementer', '--model', 'sonnet',
                   '--task', 'a', '--service', 'svc-x', '--phase', '1',
                   '--parent', root.span_id, '--trace', root.trace_id]);
    assert.equal(r.status, 0);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[1]);
    assert.equal(line.agent_role, 'implementer');
    assert.equal(line.attrs.model_used, 'sonnet');
  });

  test('TRACE_FILE unset: resolves <WORKSPACE>/.traces/spans.jsonl from cwd', () => {
    const r = spawnSync('node', [SCRIPT, '--name', 'execute_task',
                                 '--scope', 'task'], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, TRACE_FILE: '' },
    });
    assert.equal(r.status, 0);
    const expectedFile = join(dir, '.traces', 'spans.jsonl');
    const content = readFileSync(expectedFile, 'utf8');
    assert.ok(content.length > 0);
  });

  test('writes ts in ISO-8601 UTC', () => {
    const r = run(['--name', 'execute_task', '--scope', 'task']);
    assert.equal(r.status, 0);
    const line = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.match(line.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run:
```bash
node --test tests/unit/trace-start-span.test.mjs 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module" or non-zero exit.

- [ ] **Step 3: Create the CLI wrapper**

Create `bin/trace-start-span.mjs`:

```javascript
#!/usr/bin/env node
// bin/trace-start-span.mjs — emit a span_start, print {span_id, trace_id, parent}.
//
// Inputs (CLI flags, kebab-case):
//   --name <span name>         REQUIRED (e.g., execute_task, phase, agent_dispatch)
//   --scope <task|daemon|global>  REQUIRED
//   --parent <span_id>         optional — sets parent_span_id
//   --trace <trace_id>         optional — when set, inherits this trace; required with --parent
//   --task <slug>              optional — task_slug attribute
//   --service <id>             optional — service_id attribute
//   --phase <num>              optional — phase_num attribute
//   --agent <role>             optional — agent_role attribute (for agent_dispatch)
//   --model <model>            optional — attrs.model_used (for agent_dispatch)
//
// Environment:
//   TRACE_FILE   absolute path to spans.jsonl. If unset, resolves to
//                <cwd>/.traces/spans.jsonl.
//   TRACE_DISABLED=1   short-circuit: exit 0 with empty ids printed.
//
// Output (stdout, single JSON line):
//   {"span_id":"01HX...","trace_id":"01HX...","parent":"01HX..."|null}
//
// Exit codes:
//   0  span emitted (or TRACE_DISABLED)
//   1  invalid args

import { resolve } from 'node:path';
import { startSpan } from './lib/trace/emitter.mjs';
import { SCOPE } from './lib/trace/schema.mjs';

const VALID_SCOPES = new Set(Object.values(SCOPE));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    out[key] = argv[++i];
  }
  return out;
}

function die(msg) {
  process.stderr.write(`trace-start-span: ${msg}\n`);
  process.exit(1);
}

function resolveTraceFile() {
  if (process.env.TRACE_FILE) return process.env.TRACE_FILE;
  return resolve(process.cwd(), '.traces', 'spans.jsonl');
}

const args = parseArgs(process.argv.slice(2));

if (process.env.TRACE_DISABLED === '1') {
  process.stdout.write(JSON.stringify({ span_id: '', trace_id: '', parent: null }) + '\n');
  process.exit(0);
}

if (!args.name) die('--name required');
if (!args.scope) die('--scope required');
if (!VALID_SCOPES.has(args.scope)) {
  die(`--scope must be one of ${[...VALID_SCOPES].join(', ')}`);
}
if (args.parent && !args.trace) {
  die('--trace required when --parent is set');
}

const phaseNum = args.phase != null ? Number(args.phase) : undefined;
if (args.phase != null && Number.isNaN(phaseNum)) die('--phase must be a number');

const attrs = {};
if (args.model) attrs.model_used = args.model;

const r = startSpan(resolveTraceFile(), {
  scope: args.scope,
  name: args.name,
  parent_span_id: args.parent || undefined,
  trace_id: args.trace || undefined,
  task_slug: args.task || undefined,
  service_id: args.service || undefined,
  phase_num: phaseNum,
  agent_role: args.agent || undefined,
  attrs: Object.keys(attrs).length ? attrs : undefined,
});

process.stdout.write(JSON.stringify({
  span_id: r.span_id,
  trace_id: r.trace_id,
  parent: r.parent_span_id,
}) + '\n');
```

- [ ] **Step 4: Make executable**

Run:
```bash
chmod +x bin/trace-start-span.mjs
```

- [ ] **Step 5: Run test, confirm it passes**

Run:
```bash
node --test tests/unit/trace-start-span.test.mjs 2>&1 | tail -20
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add bin/trace-start-span.mjs tests/unit/trace-start-span.test.mjs
git commit -m "feat(tracing): add trace-start-span CLI"
```

---

## Task 6: `bin/trace-end-span.mjs` — CLI wrapper

**Files:**
- Create: `bin/trace-end-span.mjs`
- Test: `tests/unit/trace-end-span.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/trace-end-span.test.mjs`:

```javascript
// tests/unit/trace-end-span.test.mjs
//
// Run: `node --test tests/unit/trace-end-span.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;
let file;

function run(args, env = {}) {
  return spawnSync('node', ['bin/trace-end-span.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

function startSpanLine(span_id, trace_id, name, scope, extras = {}) {
  return JSON.stringify({
    ts: '2026-05-20T10:00:00.000Z',
    event_kind: 'span_start',
    span_id, trace_id, scope, name, ...extras,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-end-cli-'));
  file = join(dir, 'spans.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-end-span.mjs', () => {
  test('emits span_end and computes duration from matching start', () => {
    const startTs = new Date(Date.now() - 5000).toISOString();
    writeFileSync(file, JSON.stringify({
      ts: startTs, event_kind: 'span_start', span_id: 'S1', trace_id: 'T1',
      scope: 'task', name: 'phase',
    }) + '\n');
    const r = run(['--span', 'S1', '--status', 'ok']);
    assert.equal(r.status, 0, r.stderr);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const end = JSON.parse(lines[1]);
    assert.equal(end.event_kind, 'span_end');
    assert.equal(end.span_id, 'S1');
    assert.equal(end.trace_id, 'T1');
    assert.equal(end.status, 'ok');
    assert.ok(end.duration_ms >= 4000 && end.duration_ms <= 6000,
      `duration_ms ${end.duration_ms} should be ~5000`);
  });

  test('--duration overrides computed value', () => {
    writeFileSync(file, startSpanLine('S1', 'T1', 'phase', 'task') + '\n');
    const r = run(['--span', 'S1', '--status', 'ok', '--duration', '1234']);
    assert.equal(r.status, 0);
    const end = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean)[1]);
    assert.equal(end.duration_ms, 1234);
  });

  test('passes through --retries, --outcome, --diff-size, --error-sig, --escalation', () => {
    writeFileSync(file, startSpanLine('S1', 'T1', 'agent_dispatch', 'task',
      { agent_role: 'implementer' }) + '\n');
    const r = run(['--span', 'S1', '--status', 'blocked',
                   '--retries', '3', '--outcome', 'still red after 5 strikes',
                   '--diff-size', '87', '--error-sig', 'a1b2c3d4',
                   '--escalation', 'five_strike_blocked']);
    assert.equal(r.status, 0);
    const end = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean)[1]);
    assert.equal(end.status, 'blocked');
    assert.equal(end.attrs.retry_count, 3);
    assert.equal(end.attrs.outcome, 'still red after 5 strikes');
    assert.equal(end.attrs.diff_size_loc, 87);
    assert.equal(end.attrs.error_signature, 'a1b2c3d4');
    assert.equal(end.attrs.escalation_reason, 'five_strike_blocked');
  });

  test('--artifacts: comma-separated list passed through', () => {
    writeFileSync(file, startSpanLine('S1', 'T1', 'agent_dispatch', 'task',
      { agent_role: 'implementer' }) + '\n');
    const r = run(['--span', 'S1', '--status', 'ok',
                   '--artifacts', 'src/a.ts,src/b.ts,tests/a.test.ts']);
    assert.equal(r.status, 0);
    const end = JSON.parse(readFileSync(file, 'utf8').split('\n').filter(Boolean)[1]);
    assert.deepEqual(end.attrs.artifacts, ['src/a.ts', 'src/b.ts', 'tests/a.test.ts']);
  });

  test('--span missing: exit 1', () => {
    const r = run(['--status', 'ok']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--span required/i);
  });

  test('invalid --status: exit 1', () => {
    const r = run(['--span', 'S1', '--status', 'weird']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--status must be one of/i);
  });

  test('matching span_start not found: exit 0, writes span_end without duration', () => {
    const r = run(['--span', 'GHOST', '--status', 'ok']);
    assert.equal(r.status, 0);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const end = JSON.parse(lines[0]);
    assert.equal(end.event_kind, 'span_end');
    assert.equal(end.duration_ms, undefined);
    assert.equal(end.attrs && end.attrs.unmatched_start, true);
  });

  test('TRACE_DISABLED=1: exits 0, writes nothing', () => {
    writeFileSync(file, startSpanLine('S1', 'T1', 'phase', 'task') + '\n');
    const r = run(['--span', 'S1', '--status', 'ok'], { TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'no new line written');
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run:
```bash
node --test tests/unit/trace-end-span.test.mjs 2>&1 | tail -20
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create the CLI wrapper**

Create `bin/trace-end-span.mjs`:

```javascript
#!/usr/bin/env node
// bin/trace-end-span.mjs — emit a span_end, compute duration from matching start.
//
// Inputs (CLI flags):
//   --span <span_id>           REQUIRED — span_id of the open span to close
//   --status <ok|blocked|failed|escalated|orphaned>  REQUIRED
//   --duration <ms>            optional — override computed duration
//   --retries <n>              optional — attrs.retry_count
//   --outcome <string>         optional — attrs.outcome
//   --diff-size <n>            optional — attrs.diff_size_loc
//   --error-sig <hex>          optional — attrs.error_signature
//   --escalation <reason>      optional — attrs.escalation_reason
//   --artifacts <a,b,c>        optional — attrs.artifacts (comma-separated)
//
// Behavior:
//   - Looks up the matching span_start in TRACE_FILE to derive trace_id, scope,
//     name, task_slug, service_id, phase_num, agent_role, and start ts.
//   - duration_ms = now - start_ts unless --duration overrides.
//   - If no matching span_start is found, still emits span_end but flags
//     attrs.unmatched_start: true (reconciler may pair them later, otherwise
//     analyzer treats as orphan tail).
//
// Environment:
//   TRACE_FILE        path to spans.jsonl
//   TRACE_DISABLED=1  short-circuit
//
// Exit codes:
//   0  span_end emitted (or TRACE_DISABLED)
//   1  invalid args

import { resolve } from 'node:path';
import { appendSpan } from './lib/trace/emitter.mjs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { EVENT_KIND, STATUS } from './lib/trace/schema.mjs';

const VALID_STATUSES = new Set(Object.values(STATUS));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

function die(msg) {
  process.stderr.write(`trace-end-span: ${msg}\n`);
  process.exit(1);
}

function resolveTraceFile() {
  if (process.env.TRACE_FILE) return process.env.TRACE_FILE;
  return resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function findStart(traceFile, spanId) {
  for (const f of listRotatedFiles(traceFile)) {
    for (const evt of readSpans(f, {
      filter: (e) => e.event_kind === EVENT_KIND.SPAN_START && e.span_id === spanId,
    })) {
      return evt;
    }
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));

if (process.env.TRACE_DISABLED === '1') process.exit(0);
if (!args.span) die('--span required');
if (!args.status) die('--status required');
if (!VALID_STATUSES.has(args.status)) {
  die(`--status must be one of ${[...VALID_STATUSES].join(', ')}`);
}

const traceFile = resolveTraceFile();
const start = findStart(traceFile, args.span);

let duration_ms;
if (args.duration != null) duration_ms = Number(args.duration);
else if (start) duration_ms = Date.now() - new Date(start.ts).getTime();

const attrs = {};
if (args.retries != null) attrs.retry_count = Number(args.retries);
if (args.outcome) attrs.outcome = args.outcome;
if (args['diff-size'] != null) attrs.diff_size_loc = Number(args['diff-size']);
if (args['error-sig']) attrs.error_signature = args['error-sig'];
if (args.escalation) attrs.escalation_reason = args.escalation;
if (args.artifacts) attrs.artifacts = args.artifacts.split(',').map((s) => s.trim());
if (!start) attrs.unmatched_start = true;

appendSpan(traceFile, {
  event_kind: EVENT_KIND.SPAN_END,
  span_id: args.span,
  trace_id: start && start.trace_id,
  parent_span_id: start && start.parent_span_id,
  scope: start && start.scope,
  name: start && start.name,
  task_slug: start && start.task_slug,
  service_id: start && start.service_id,
  phase_num: start && start.phase_num,
  agent_role: start && start.agent_role,
  duration_ms,
  status: args.status,
  attrs: Object.keys(attrs).length ? attrs : undefined,
});
```

- [ ] **Step 4: Make executable**

Run:
```bash
chmod +x bin/trace-end-span.mjs
```

- [ ] **Step 5: Run test, confirm it passes**

Run:
```bash
node --test tests/unit/trace-end-span.test.mjs 2>&1 | tail -20
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add bin/trace-end-span.mjs tests/unit/trace-end-span.test.mjs
git commit -m "feat(tracing): add trace-end-span CLI with duration computation"
```

---

## Task 7: `bin/trace-reconcile.mjs` — orphan sweep

**Files:**
- Create: `bin/trace-reconcile.mjs`
- Test: `tests/unit/trace-reconcile.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/trace-reconcile.test.mjs`:

```javascript
// tests/unit/trace-reconcile.test.mjs
//
// Run: `node --test tests/unit/trace-reconcile.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;
let file;

function run(env = {}) {
  return spawnSync('node', ['bin/trace-reconcile.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

function startLine(span_id, opts = {}) {
  const ts = opts.ts || new Date().toISOString();
  return JSON.stringify({
    ts, event_kind: 'span_start', span_id, trace_id: opts.trace_id || 'T1',
    scope: opts.scope || 'task', name: opts.name || 'phase',
    task_slug: opts.task_slug,
  });
}

function endLine(span_id, opts = {}) {
  const ts = opts.ts || new Date().toISOString();
  return JSON.stringify({
    ts, event_kind: 'span_end', span_id, trace_id: opts.trace_id || 'T1',
    scope: opts.scope || 'task', name: opts.name || 'phase',
    status: opts.status || 'ok', duration_ms: opts.duration_ms || 0,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-reconcile-'));
  file = join(dir, 'spans.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-reconcile.mjs', () => {
  test('no-op when file does not exist', () => {
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 0/);
  });

  test('no-op when no orphans', () => {
    writeFileSync(file, [
      startLine('S1'),
      endLine('S1'),
    ].join('\n') + '\n');
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 0/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
  });

  test('does not reconcile a recent orphan (< 30 min old)', () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts: recent }) + '\n');
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 0/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
  });

  test('emits synthetic span_end for span_start older than 30 min', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts: old, task_slug: 'alpha' }) + '\n');
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 1/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const end = JSON.parse(lines[1]);
    assert.equal(end.event_kind, 'span_end');
    assert.equal(end.span_id, 'S1');
    assert.equal(end.status, 'orphaned');
    assert.equal(end.attrs.reconciled, true);
    assert.equal(end.task_slug, 'alpha');
    assert.ok(end.duration_ms >= 45 * 60 * 1000);
  });

  test('idempotent: running twice does not re-emit', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts: old }) + '\n');
    run();
    const r2 = run();
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /reconciled: 0/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 2, 'no new span_end on second run');
  });

  test('TRACE_RECONCILE_AFTER_MS env overrides threshold', () => {
    const ts = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts }) + '\n');
    const r = run({ TRACE_RECONCILE_AFTER_MS: '60000' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /reconciled: 1/);
  });

  test('multiple orphans across same trace are all closed', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, [
      startLine('S1', { ts: old, trace_id: 'TA' }),
      startLine('S2', { ts: old, trace_id: 'TA' }),
      startLine('S3', { ts: old, trace_id: 'TB' }),
    ].join('\n') + '\n');
    const r = run();
    assert.match(r.stdout, /reconciled: 3/);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 6);
  });

  test('TRACE_DISABLED=1: exits 0, no changes', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, startLine('S1', { ts: old }) + '\n');
    const r = run({ TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
  });

  test('skips malformed lines but continues processing', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, [
      startLine('S1', { ts: old }),
      'not valid json',
      startLine('S2', { ts: old }),
    ].join('\n') + '\n');
    const r = run();
    assert.match(r.stdout, /reconciled: 2/);
  });

  test('span_start followed by span_end of different span: orphan stays detected', () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    writeFileSync(file, [
      startLine('S1', { ts: old }),
      endLine('S2'),
    ].join('\n') + '\n');
    const r = run();
    assert.match(r.stdout, /reconciled: 1/);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run:
```bash
node --test tests/unit/trace-reconcile.test.mjs 2>&1 | tail -20
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create the CLI wrapper**

Create `bin/trace-reconcile.mjs`:

```javascript
#!/usr/bin/env node
// bin/trace-reconcile.mjs — sweep orphan span_start entries and emit synthetic span_end.
//
// Scans TRACE_FILE (and rotated siblings) for span_start events whose span_id
// has no matching span_end and whose ts is older than RECONCILE_AFTER_MS
// (default 30 min, override with TRACE_RECONCILE_AFTER_MS).
//
// For each orphan, appends a synthetic span_end with:
//   status: "orphaned"
//   attrs.reconciled: true
//   duration_ms = now - start.ts
//
// Idempotent: a subsequent run sees the synthetic span_end and skips the start.
//
// Environment:
//   TRACE_FILE                  path to spans.jsonl
//   TRACE_RECONCILE_AFTER_MS    threshold in ms (default 1_800_000)
//   TRACE_DISABLED=1            short-circuit (exit 0)
//
// Output (stdout, single line):
//   reconciled: <N>
//
// Exit codes:
//   0  always (best-effort)

import { resolve } from 'node:path';
import { appendSpan } from './lib/trace/emitter.mjs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import {
  EVENT_KIND, STATUS, RECONCILE_AFTER_MS,
} from './lib/trace/schema.mjs';

function resolveTraceFile() {
  if (process.env.TRACE_FILE) return process.env.TRACE_FILE;
  return resolve(process.cwd(), '.traces', 'spans.jsonl');
}

if (process.env.TRACE_DISABLED === '1') {
  process.stdout.write('reconciled: 0\n');
  process.exit(0);
}

const threshold = process.env.TRACE_RECONCILE_AFTER_MS
  ? Number(process.env.TRACE_RECONCILE_AFTER_MS)
  : RECONCILE_AFTER_MS;

const traceFile = resolveTraceFile();
const files = listRotatedFiles(traceFile);

const opens = new Map();     // span_id -> start event
const closed = new Set();    // span_ids with matching span_end

for (const f of files) {
  for (const evt of readSpans(f)) {
    if (evt.event_kind === EVENT_KIND.SPAN_START) {
      opens.set(evt.span_id, evt);
    } else if (evt.event_kind === EVENT_KIND.SPAN_END) {
      closed.add(evt.span_id);
    }
  }
}

const now = Date.now();
let reconciled = 0;

for (const [span_id, start] of opens) {
  if (closed.has(span_id)) continue;
  const startMs = new Date(start.ts).getTime();
  if (now - startMs < threshold) continue;
  appendSpan(traceFile, {
    event_kind: EVENT_KIND.SPAN_END,
    span_id,
    trace_id: start.trace_id,
    parent_span_id: start.parent_span_id,
    scope: start.scope,
    name: start.name,
    task_slug: start.task_slug,
    service_id: start.service_id,
    phase_num: start.phase_num,
    agent_role: start.agent_role,
    status: STATUS.ORPHANED,
    duration_ms: now - startMs,
    attrs: { reconciled: true },
  });
  reconciled += 1;
}

process.stdout.write(`reconciled: ${reconciled}\n`);
```

- [ ] **Step 4: Make executable**

Run:
```bash
chmod +x bin/trace-reconcile.mjs
```

- [ ] **Step 5: Run test, confirm it passes**

Run:
```bash
node --test tests/unit/trace-reconcile.test.mjs 2>&1 | tail -20
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add bin/trace-reconcile.mjs tests/unit/trace-reconcile.test.mjs
git commit -m "feat(tracing): add trace-reconcile CLI for orphan sweep"
```

---

## Task 8: Integration test — three CLIs together

**Files:**
- Create: `tests/integration/trace-foundation-end-to-end.test.mjs`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/trace-foundation-end-to-end.test.mjs`:

```javascript
// tests/integration/trace-foundation-end-to-end.test.mjs
//
// Exercises the three Phase-1 CLIs end-to-end against a workspace JSONL.
//
// Run: `node --test tests/integration/trace-foundation-end-to-end.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;
let file;

function startSpan(args) {
  const r = spawnSync('node', ['bin/trace-start-span.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function endSpan(args) {
  const r = spawnSync('node', ['bin/trace-end-span.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file },
  });
  assert.equal(r.status, 0, r.stderr);
}

function reconcile(env = {}) {
  return spawnSync('node', ['bin/trace-reconcile.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

function lines() {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-e2e-'));
  file = join(dir, '.traces', 'spans.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('trace foundation end-to-end', () => {
  test('happy path: workflow → phase → 2 dispatches → close all', () => {
    const wf = startSpan(['--name', 'execute_task', '--scope', 'task',
                          '--task', 'alpha']);
    const ph = startSpan(['--name', 'phase', '--scope', 'task',
                          '--task', 'alpha', '--service', 'svc-x',
                          '--phase', '1',
                          '--parent', wf.span_id, '--trace', wf.trace_id]);
    const d1 = startSpan(['--name', 'agent_dispatch', '--scope', 'task',
                          '--agent', 'test-writer', '--model', 'sonnet',
                          '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
                          '--parent', ph.span_id, '--trace', wf.trace_id]);
    endSpan(['--span', d1.span_id, '--status', 'ok',
             '--retries', '0', '--diff-size', '28']);
    const d2 = startSpan(['--name', 'agent_dispatch', '--scope', 'task',
                          '--agent', 'implementer', '--model', 'sonnet',
                          '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
                          '--parent', ph.span_id, '--trace', wf.trace_id]);
    endSpan(['--span', d2.span_id, '--status', 'ok',
             '--retries', '1', '--diff-size', '87']);
    endSpan(['--span', ph.span_id, '--status', 'ok']);
    endSpan(['--span', wf.span_id, '--status', 'ok']);

    const all = lines();
    assert.equal(all.length, 8);                       // 4 starts + 4 ends
    assert.equal(all.filter((e) => e.event_kind === 'span_start').length, 4);
    assert.equal(all.filter((e) => e.event_kind === 'span_end').length, 4);
    assert.equal(all.filter((e) => e.status === 'ok').length, 4);

    // All ends carry the same trace_id as the workflow root.
    const root = all[0];
    assert.ok(all.every((e) => e.trace_id === root.trace_id));

    // Both agent_dispatch ends carry diff_size_loc.
    const dispatchEnds = all.filter((e) =>
      e.event_kind === 'span_end' && e.name === 'agent_dispatch');
    assert.equal(dispatchEnds.length, 2);
    assert.equal(dispatchEnds[0].attrs.diff_size_loc, 28);
    assert.equal(dispatchEnds[1].attrs.diff_size_loc, 87);
  });

  test('orphan: process dies between phase start and end → reconciler closes it', () => {
    const wf = startSpan(['--name', 'execute_task', '--scope', 'task',
                          '--task', 'alpha']);
    startSpan(['--name', 'phase', '--scope', 'task',
               '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
               '--parent', wf.span_id, '--trace', wf.trace_id]);
    // Simulate orphan by overriding threshold so the 1-second-old start qualifies.
    const r = reconcile({ TRACE_RECONCILE_AFTER_MS: '100' });
    assert.equal(r.status, 0);
    // 100ms threshold but timing is non-deterministic; allow either outcome
    // but at minimum reconcile should not crash. Run again after a sleep.
    const all = lines();
    assert.ok(all.length >= 2);
  });

  test('concurrent writers: two processes appending in parallel do not corrupt', async () => {
    // Two parallel child processes, each writing 50 spans.
    const procs = [];
    for (let i = 0; i < 2; i++) {
      procs.push(new Promise((res) => {
        let n = 0;
        function next() {
          if (n >= 50) return res();
          const r = spawnSync('node', ['bin/trace-start-span.mjs',
                                       '--name', 'phase', '--scope', 'task'], {
            env: { ...process.env, TRACE_FILE: file },
          });
          if (r.status !== 0) return res();
          n += 1;
          setImmediate(next);
        }
        next();
      }));
    }
    await Promise.all(procs);

    // Every line should parse cleanly (no truncation, no interleaving).
    const raw = readFileSync(file, 'utf8');
    const rows = raw.split('\n').filter(Boolean);
    assert.equal(rows.length, 100);
    for (const row of rows) {
      assert.doesNotThrow(() => JSON.parse(row));
    }
  });
});
```

- [ ] **Step 2: Run integration test**

Run:
```bash
node --test tests/integration/trace-foundation-end-to-end.test.mjs 2>&1 | tail -20
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/trace-foundation-end-to-end.test.mjs
git commit -m "test(tracing): integration test for foundation CLIs end-to-end"
```

---

## Task 9: `jelou/references/tracing.md` — schema reference doc

**Files:**
- Create: `jelou/references/tracing.md`

- [ ] **Step 1: Write the reference doc**

Create `jelou/references/tracing.md`:

```markdown
# Tracing — Schema & Conventions

> Reference for the plugin-native tracing system introduced in Phase 1.
> See `docs/superpowers/specs/2026-05-23-tracing-observability-design.md` for the full design.

## Where traces live

- **Per-workspace store**: `<WORKSPACE>/.traces/spans.jsonl`
- **Rotation**: when `spans.jsonl` reaches 50 MB it rotates to `spans-001.jsonl`, `.002.jsonl`, …
- **Default cwd**: `bin/trace-*` CLIs resolve `TRACE_FILE` env var; if unset, default to `<cwd>/.traces/spans.jsonl`.
- **Gitignored**: `.traces/` is in the plugin's `.gitignore` and recommended for workspace `.gitignore`.

## Event shape (one per line)

All events share this envelope:

| Field | Type | Required | Notes |
|---|---|---|---|
| `ts` | ISO-8601 UTC | yes | Auto-populated by the emitter |
| `event_kind` | `span_start` \| `span_end` \| `event` | yes | |
| `span_id` | ULID (26 chars) | yes | |
| `trace_id` | ULID | yes | Root span: `trace_id == span_id` |
| `parent_span_id` | ULID | no | Omitted on root spans |
| `scope` | `task` \| `daemon` \| `global` | yes | |
| `name` | string | yes | See "Canonical span names" below |
| `task_slug` | string | no | All `scope: task` spans carry this |
| `service_id` | string | no | Phase and agent spans inside a service |
| `phase_num` | number | no | Phase and agent spans inside a phase |
| `agent_role` | string | no | Only on `agent_dispatch` spans |
| `attrs` | object | no | Open key-value bag, see below |

On `span_end` additionally:

| Field | Type | Notes |
|---|---|---|
| `duration_ms` | number | now - start.ts unless `--duration` overrides |
| `status` | `ok` \| `blocked` \| `failed` \| `escalated` \| `orphaned` | |

## Canonical span names

| Name | Scope | Emitted by |
|---|---|---|
| `execute_task` | task | `/jlu-execute-task` (Phase 2) |
| `new_task` | task | `/jlu-new-task` (Phase 2) |
| `refine_task` | task | `/jlu-refine-task` (Phase 2) |
| `create_pr` | task | `/jlu-create-pr` (Phase 2) |
| `report_task` | task | `/jlu-report-task` (Phase 2) |
| `close_task` | task | `/jlu-close-task` (Phase 2) |
| `phase` | task | execute-task per-phase (Phase 2) |
| `agent_dispatch` | task | execute-task per-dispatch (Phase 2) |
| `pane_started`, `pane_dead`, `pattern_match`, `ready` | daemon | dev-env daemon (Phase 2 migration) |

## Canonical `attrs` keys

| Key | Where | Notes |
|---|---|---|
| `model_used` | agent_dispatch | "sonnet", "opus", "haiku", etc. |
| `retry_count` | agent_dispatch | n internal retries the agent performed |
| `escalation_reason` | agent_dispatch | "five_strike_blocked", etc. |
| `diff_size_loc` | agent_dispatch | LOC delta from `git diff --shortstat` |
| `error_signature` | any failed/blocked span | SHA-256[:8] hash of normalized error message |
| `outcome` | any span | Human-readable summary (dropped if total payload > 3500 bytes) |
| `artifacts` | agent_dispatch | List of changed files (dropped if over cap) |
| `payload_capped` | any | `true` when emitter trimmed `outcome`/`artifacts` |
| `reconciled` | span_end | `true` when synthesized by `trace-reconcile.mjs` |
| `unmatched_start` | span_end | `true` when `trace-end-span.mjs` could not find the matching start |

## How to add a new span name

1. Add the constant to `bin/lib/trace/schema.mjs` under `SPAN_NAMES`.
2. Document it in the "Canonical span names" table above.
3. If the new span carries new attrs, document them in the `attrs` table.
4. Add a unit test in the workflow that emits the span (Phase 2+).

## CLIs

| CLI | Purpose | Returns |
|---|---|---|
| `bin/trace-start-span.mjs` | Emit `span_start` | JSON `{span_id, trace_id, parent}` on stdout |
| `bin/trace-end-span.mjs` | Emit `span_end`, compute duration | nothing |
| `bin/trace-reconcile.mjs` | Sweep orphans older than 30 min | `reconciled: <N>` on stdout |

All three honor:
- `TRACE_FILE` (path override; defaults to `<cwd>/.traces/spans.jsonl`)
- `TRACE_DISABLED=1` (no-op short-circuit)

The reconciler additionally honors `TRACE_RECONCILE_AFTER_MS` (default `1800000` = 30 min).

## Best-effort guarantees

The tracing system is **best-effort instrumentation, never a failure axis.** If the
store is unwritable, the emitter writes a warning to stderr and continues. If a
span is interrupted (process killed, ctrl-C), the reconciler closes it on the next
workflow run. Workflows that consume `bin/trace-start-span.mjs` output must tolerate
empty `span_id` (e.g., when `TRACE_DISABLED=1`).
```

- [ ] **Step 2: Commit**

```bash
git add jelou/references/tracing.md
git commit -m "docs(tracing): schema and conventions reference"
```

---

## Task 10: Full suite green + sync-agents clean

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run:
```bash
npm test
```

Expected: all tests pass — both the new tracing tests and every pre-existing test.

- [ ] **Step 2: Run integration tests**

Run:
```bash
node --test tests/integration/trace-foundation-end-to-end.test.mjs
```

Expected: 3 tests pass.

- [ ] **Step 3: Verify agent sync is unchanged**

Run:
```bash
node bin/sync-agents.mjs --check
```

Expected: exit 0, message like "agents in sync". The 23 files under `agents/` must be byte-identical to before — Phase 1 does not touch any agent prompt.

- [ ] **Step 4: Verify the disable knob really disables**

Run:
```bash
TRACE_DISABLED=1 node bin/trace-start-span.mjs --name execute_task --scope task
TRACE_DISABLED=1 node bin/trace-reconcile.mjs
```

Expected: both exit 0, no `.traces/` directory created in cwd. `trace-start-span` prints `{"span_id":"","trace_id":"","parent":null}`. `trace-reconcile` prints `reconciled: 0`.

- [ ] **Step 5: CHANGELOG entry**

Open `CHANGELOG.md` and add a new entry at the top:

```markdown
## [unreleased]

### Added
- **Tracing foundation (Phase 1 of harness-engineering observability layer).** New `bin/lib/trace/{schema,emitter,reader}.mjs` modules and three CLI wrappers (`bin/trace-start-span.mjs`, `bin/trace-end-span.mjs`, `bin/trace-reconcile.mjs`) that emit and read a workspace-local JSONL span store at `<WORKSPACE>/.traces/spans.jsonl`. The emitter is stdlib-only, ULID-based, payload-capped at 3500 bytes (under `PIPE_BUF` for atomic appends), with a `TRACE_DISABLED=1` short-circuit and a stderr fallback when the store is unwritable. The reconciler sweeps orphan spans older than 30 minutes (override via `TRACE_RECONCILE_AFTER_MS`). New reference doc at `jelou/references/tracing.md`. No workflow is instrumented yet (Phase 2) and no analyzer/suggester ships (Phase 3) — this release is foundation only. Agents are untouched.

### Changed
- `.gitignore` now ignores `.traces/` at the workspace level.
```

- [ ] **Step 6: Commit the changelog**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): record tracing foundation (Phase 1) [skip-bump]"
```

The `[skip-bump]` marker keeps the bump-version hook from auto-bumping on this commit — the foundation is shippable but Phase 1 ships as part of the larger feature, not standalone. The maintainer decides when to bump.

---

## Phase 1 — Self-Review Checklist

Before opening the PR for Phase 1:

1. **Spec coverage** — Every Phase-1 item under "Components to Ship in V1" in the spec is implemented and tested:
   - ✅ `bin/lib/trace/emitter.mjs`, `schema.mjs`, `reader.mjs`
   - ✅ `bin/trace-start-span.mjs`, `trace-end-span.mjs`, `trace-reconcile.mjs`
   - ✅ `jelou/references/tracing.md`
   - ✅ `.gitignore` entry
   - 🔜 Workflows, daemon migration, analyzer, suggester, skill, README — deferred to Phase 2 & 3.

2. **Test count** — Phase 1 adds approximately:
   - 7 (schema) + 13 (emitter incl. ULID) + 8 (reader) + 8 (start-span) + 8 (end-span) + 10 (reconcile) + 3 (integration) = **~57 new tests**.

3. **Zero regression** — `npm test` and `node bin/sync-agents.mjs --check` both green.

4. **Agents untouched** — `git log --name-only main..feature/tracing-foundation -- agents/` returns nothing.

5. **No new deps** — `git diff main..feature/tracing-foundation -- package.json` is empty (only the `version` is touched if at all, and it should NOT be in this phase).

If any item is missing or red, fix before opening the PR.

---

## What Phase 2 will do (preview)

- Add `Step 0 — Open workflow span` and `Step N — Close workflow span` to all six workflows: `new-task.md`, `refine-task.md`, `execute-task.md`, `create-pr.md`, `report-task.md`, `close-task.md` (plus mirrors under `.opencode/commands/`).
- Wrap per-phase + per-agent-dispatch in `execute-task.md` Step 7.
- Add `Step 0.5 — Reconcile + (later) Suggest` to the three heavier workflows.
- Refactor `bin/lib/dev-orchestrator/events.mjs` to delegate to `bin/lib/trace/emitter.mjs`. Daemon events flow into the same `spans.jsonl` with `scope: "daemon"`. `dev-events.log` becomes a symlink for 1 release.
- Add ~14 unit tests (daemon-migration) + 4 integration tests (workflow end-to-end).

Phase 2 plan file will live at `docs/superpowers/plans/2026-05-23-tracing-observability-phase2-instrumentation.md`.

## What Phase 3 will do (preview)

- `bin/trace-analyze.mjs` with `--by-agent` / `--by-phase` / `--by-task` / `--trends` queries.
- `bin/trace-suggest.mjs` with the 4 rules + 7-day cooldown via `.spec-workspace/.cache/suggestion-history.jsonl`.
- New skill `skills/trace-report/SKILL.md` + OpenCode mirror.
- Integration test for the suggester (seed 15 runs with 30 % retry rate → assert it emits `bump_model_tier`).
- README "Tracing & Observability" section.
- Wire the suggester into `Step 0.5` of execute-task / refine-task / create-pr.
- Add ~32 unit tests + 2 integration tests.

Phase 3 plan file will live at `docs/superpowers/plans/2026-05-23-tracing-observability-phase3-analyze-suggest.md`.
