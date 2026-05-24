# Tracing & Observability — Phase 2 (Instrumentation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase 1 trace foundation into actual workflow execution. Add `Step 0.5 — Trace bootstrap` (runs `trace-reconcile.mjs`) and `Step N — Close workflow span` to all six task-lifecycle workflows. Add per-phase + per-agent-dispatch span pairs inside `execute-task.md` Step 7. Migrate the dev-environment daemon's `events.mjs` to delegate to the new shared emitter so its events flow into the same workspace `spans.jsonl` with `scope: "daemon"`. After Phase 2, real workflow runs leave a complete span trail — but no analyzer or suggester yet (Phase 3).

**Architecture:** Workflow `.md` files are runtime instructions read by the orchestrator. Phase 2 edits them to call the three Phase 1 CLIs (`trace-start-span.mjs`, `trace-end-span.mjs`, `trace-reconcile.mjs`) via Bash at well-defined points. The daemon refactor swaps the implementation of `appendEvent` in `bin/lib/dev-orchestrator/events.mjs` so existing callers keep working unchanged.

**Tech Stack:** Markdown workflow files. Node 20+ ESM for daemon refactor. `node:test` for structural workflow assertions + daemon migration tests. Stdlib only.

**Spec:** `docs/superpowers/specs/2026-05-23-tracing-observability-design.md`
**Phase 1 plan (foundation):** `docs/superpowers/plans/2026-05-23-tracing-observability-phase1-foundation.md`

**Phase 2 deliverable (shippable on its own):** Every lifecycle workflow opens a workflow-level span on entry and closes it on exit. `execute-task` emits per-phase and per-agent-dispatch spans inside Step 7. The dev-env daemon writes through the new shared emitter. After Phase 2 lands, running any `/jlu-*` command leaves a parseable span tree in `<WORKSPACE>/.traces/spans.jsonl` with no analyzer yet to consume it (Phase 3).

**Out of scope for this plan (covered by Phase 3):**
- `bin/trace-analyze.mjs` queries (`--by-agent` / `--by-phase` / `--by-task` / `--trends`).
- `bin/trace-suggest.mjs` 4 rules with cooldown.
- `skills/trace-report/SKILL.md` (`/jlu-trace-report` skill).
- Wiring the suggester into `Step 0.5` of the heavy workflows.

---

## File Structure (Phase 2 only)

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `tests/unit/trace-workflow-instrumentation.test.mjs` | Structural assertions: every instrumented workflow opens a span at Step 0, closes at Step N, calls reconcile at Step 0.5 where applicable. |
| `tests/unit/trace-daemon-migration.test.mjs` | Daemon's `appendEvent` now writes through the new emitter with `scope: "daemon"` while preserving the old API contract. |
| `tests/integration/trace-workflow-end-to-end.test.mjs` | Simulate one `execute-task` invocation against a fake workspace; assert `spans.jsonl` contains the expected tree (workflow → phase → dispatch). |

### Files to MODIFY

| Path | Change |
|------|--------|
| `bin/lib/dev-orchestrator/events.mjs` | Refactor `appendEvent` to delegate to `bin/lib/trace/emitter.mjs::appendSpan` with `scope: "daemon"`. Preserve `EVENT_TYPES`, `SEVERITY`, `severityFor` exports unchanged. |
| `jelou/workflows/execute-task.md` | Add Step 0.5 (reconcile), Step 1 open workflow span, Step 7c.x open phase span, Step 7c.y per-agent-dispatch span pair, Step 7g close phase span, final Step N close workflow span. |
| `jelou/workflows/new-task.md` | Add Step 0 open workflow span + Step N close workflow span. |
| `jelou/workflows/refine-task.md` | Add Step 0.5 reconcile + Step 0 open + Step N close. |
| `jelou/workflows/create-pr.md` | Add Step 0.5 reconcile + Step 0 open + Step N close. |
| `jelou/workflows/report-task.md` | Add Step 0 open + Step N close. |
| `jelou/workflows/close-task.md` | Add Step 0 open + Step N close + snapshot to `<TASK_DIR>/_traces/snapshot.jsonl`. |

### Coding rules (apply to every file touched)

- Workflow edits use `node ${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs …` so the CLI resolves regardless of cwd. Where the workflow already resolves a plugin-root variable, reuse it.
- All CLI calls in workflows are wrapped in tolerant patterns: capture stdout, parse JSON, store in a shell variable, tolerate empty result (when `TRACE_DISABLED=1`). The workflow continues whether or not the trace CLI returned a real span_id.
- Daemon refactor preserves the EXACT existing exports (`EVENT_TYPES`, `SEVERITY`, `severityFor`, `appendEvent`). No daemon caller should need to change.
- Structural workflow tests follow the existing pattern in `tests/unit/close-task-workflow.test.mjs`: read the workflow file once at module scope, assert presence of canonical phrases with `assert.match`.

---

## Task 0: Pre-flight — clean main, tests green, branch

**Files:** none (verification only).

- [ ] **Step 1: Confirm clean working tree on `main`**

Run:
```bash
git status --short
git rev-parse --abbrev-ref HEAD
```

Expected: empty status output. Branch `main`. If not, stop and surface to controller.

- [ ] **Step 2: Sync with remote**

Run:
```bash
git fetch origin
git rebase origin/main
```

Expected: "Current branch main is up to date." If conflicts surface, stop and surface to controller.

- [ ] **Step 3: Baseline test suite is green**

Run:
```bash
npm test
node bin/sync-agents.mjs --check
```

Expected: all tests pass. `sync-agents --check` exit 0. Current baseline is 490 tests. If red, stop — do not start instrumented work on a broken base.

- [ ] **Step 4: Create feature branch**

Run:
```bash
git checkout -b feature/tracing-instrumentation
```

Expected: switched to new branch.

---

## Task 1: Refactor `bin/lib/dev-orchestrator/events.mjs` to delegate to shared emitter

**Files:**
- Modify: `bin/lib/dev-orchestrator/events.mjs`
- Test: `tests/unit/trace-daemon-migration.test.mjs`

The dev-env daemon writes events via `appendEvent(logPath, evt)`. After this task, `appendEvent` still has the same signature and behavior from the caller's POV — but internally it routes through `bin/lib/trace/emitter.mjs::appendSpan` with `scope: "daemon"`, so daemon events join the workspace `spans.jsonl` automatically.

- [ ] **Step 1: Read current `events.mjs` for context**

Run:
```bash
cat bin/lib/dev-orchestrator/events.mjs
```

The current exports are: `EVENT_TYPES`, `SEVERITY`, `severityFor`, `appendEvent`. Note especially the `appendEvent` signature: `appendEvent(absLogPath, evt)` where `evt` is `{ type, ts?, severity?, ...payload }`.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/trace-daemon-migration.test.mjs`:

```javascript
// tests/unit/trace-daemon-migration.test.mjs
//
// Verifies bin/lib/dev-orchestrator/events.mjs delegates to the shared
// trace emitter while preserving the existing API contract.
//
// Run: `node --test tests/unit/trace-daemon-migration.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EVENT_TYPES,
  SEVERITY,
  severityFor,
  appendEvent,
} from '../../bin/lib/dev-orchestrator/events.mjs';

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'daemon-migration-'));
  file = join(dir, 'dev-events.log');
  delete process.env.TRACE_DISABLED;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TRACE_DISABLED;
});

describe('events.mjs preserves the legacy API', () => {
  test('exports EVENT_TYPES, SEVERITY, severityFor', () => {
    assert.equal(EVENT_TYPES.daemon_started, 'daemon_started');
    assert.equal(EVENT_TYPES.pane_dead, 'pane_dead');
    assert.equal(SEVERITY.info, 'info');
    assert.equal(SEVERITY.hard, 'hard');
    assert.equal(severityFor('pane_dead'), 'hard');
    assert.equal(severityFor('ready'), 'info');
  });
});

describe('appendEvent delegates to the shared emitter', () => {
  test('writes one JSONL line with envelope fields', () => {
    appendEvent(file, { type: 'pane_started', pane: 'svc-a' });
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.ok(parsed.ts, 'ts is populated');
    assert.equal(parsed.severity, 'info', 'severity derived from type');
    assert.equal(parsed.type, 'pane_started');
    assert.equal(parsed.pane, 'svc-a');
  });

  test('records scope: "daemon" so analyzer can filter', () => {
    appendEvent(file, { type: 'ready', pane: 'svc-b' });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.scope, 'daemon');
  });

  test('records event_kind: "event" (effective span with duration_ms 0)', () => {
    appendEvent(file, { type: 'pattern_match', pane: 'svc-a', pattern: 'ECONNREFUSED' });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.event_kind, 'event');
    assert.equal(parsed.name, 'pattern_match');
  });

  test('preserves legacy fields verbatim under attrs or top-level', () => {
    appendEvent(file, { type: 'pane_dead', pane: 'svc-a', exit_code: 137 });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.type, 'pane_dead');
    assert.equal(parsed.pane, 'svc-a');
    assert.equal(parsed.exit_code, 137);
  });

  test('respects explicit ts and severity overrides', () => {
    appendEvent(file, { type: 'daemon_started', ts: '2026-05-01T00:00:00Z', severity: 'info' });
    const parsed = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(parsed.ts, '2026-05-01T00:00:00Z');
    assert.equal(parsed.severity, 'info');
  });

  test('TRACE_DISABLED=1 short-circuits writes', () => {
    process.env.TRACE_DISABLED = '1';
    appendEvent(file, { type: 'ready', pane: 'svc-x' });
    assert.throws(() => readFileSync(file, 'utf8'), /ENOENT/);
  });
});
```

- [ ] **Step 3: Run test, confirm it fails (test imports same module that still works, so most assertions pass — only the new behavior assertions fail)**

Run:
```bash
node --test tests/unit/trace-daemon-migration.test.mjs 2>&1 | tail -25
```

Expected: FAIL. The legacy API tests pass. The `scope: "daemon"`, `event_kind: "event"`, and `TRACE_DISABLED` tests fail because the current implementation does not set those fields and does not honor that env var.

- [ ] **Step 4: Refactor `bin/lib/dev-orchestrator/events.mjs`**

Replace the content of `bin/lib/dev-orchestrator/events.mjs` with:

```javascript
// bin/lib/dev-orchestrator/events.mjs
//
// JSONL writer + event type/severity constants for the dev-env daemon.
//
// Phase 2 migration: appendEvent now delegates to the shared
// bin/lib/trace/emitter.mjs so daemon events join the workspace trace store
// with `scope: "daemon"`. The legacy API (EVENT_TYPES, SEVERITY, severityFor,
// appendEvent signature) is preserved verbatim — daemon callers do not need
// to change.

import { appendSpan } from '../trace/emitter.mjs';
import { EVENT_KIND, SCOPE } from '../trace/schema.mjs';

export const EVENT_TYPES = Object.freeze({
  daemon_started: 'daemon_started',
  pane_started: 'pane_started',
  panes_changed: 'panes_changed',
  ready: 'ready',
  daemon_reload: 'daemon_reload',
  pattern_match: 'pattern_match',
  pane_dead: 'pane_dead',
  readiness_failed: 'readiness_failed',
});

export const SEVERITY = Object.freeze({
  info: 'info',
  soft: 'soft',
  hard: 'hard',
});

const SEVERITY_BY_TYPE = {
  daemon_started: SEVERITY.info,
  pane_started: SEVERITY.info,
  panes_changed: SEVERITY.info,
  ready: SEVERITY.info,
  daemon_reload: SEVERITY.info,
  pattern_match: SEVERITY.soft,
  pane_dead: SEVERITY.hard,
  readiness_failed: SEVERITY.hard,
};

export function severityFor(type) {
  return SEVERITY_BY_TYPE[type] || SEVERITY.info;
}

export function appendEvent(absLogPath, evt) {
  const { type, ts, severity, ...rest } = evt;
  appendSpan(absLogPath, {
    event_kind: EVENT_KIND.EVENT,
    scope: SCOPE.DAEMON,
    name: type,
    ts: ts || undefined,
    severity: severity || severityFor(type),
    type,
    ...rest,
  });
}
```

- [ ] **Step 5: Run test, confirm it passes**

Run:
```bash
node --test tests/unit/trace-daemon-migration.test.mjs 2>&1 | tail -20
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Run the broader daemon test suite to confirm no regression**

Run:
```bash
node --test tests/unit/*.test.mjs 2>&1 | tail -10
```

Expected: full suite green (490 + 7 new = 497, or however many).

- [ ] **Step 7: Commit**

```bash
git add bin/lib/dev-orchestrator/events.mjs tests/unit/trace-daemon-migration.test.mjs
git commit -m "feat(tracing): migrate dev-env daemon to shared trace emitter (scope: daemon)"
```

---

## Task 2: Instrument `execute-task.md` — workflow + phase + agent dispatch spans

**Files:**
- Modify: `jelou/workflows/execute-task.md`
- Test: `tests/unit/trace-workflow-instrumentation.test.mjs` (created here, extended in subsequent tasks)

`execute-task.md` is the heaviest workflow — six edits:

1. **Step 0.5 — Trace bootstrap** (new): runs reconciler, captures workflow-level span via `trace-start-span.mjs`, stores span_id + trace_id in workflow variables.
2. **Step 7c.0 — Open phase span** (new, at top of each phase iteration): runs `trace-start-span.mjs` with parent = workflow span, name = `phase`, attributes phase_num / service_id. Stores `PHASE_SPAN_ID` and `PHASE_START_TS`.
3. **Per-agent-dispatch wrappers** in Step 7 (new): before each subagent dispatch, call `trace-start-span.mjs` with name = `agent_dispatch`, agent = role, model = resolved model tier, parent = `PHASE_SPAN_ID`. Capture `AGENT_SPAN_ID`. After the dispatch returns its JSON report, call `trace-end-span.mjs` with status / retries / outcome / diff_size_loc / error_signature derived from the report.
4. **Step 7g — Close phase span** (new): at end of phase iteration, run `trace-end-span.mjs` with status reflecting the phase outcome.
5. **Step N — Close workflow span** (new, last step): run `trace-end-span.mjs` for the workflow span.

The exact placement: read the existing `execute-task.md` to find Step 1 (Resolve Task), Step 7 (Phase Execution), and the final Step. Insert the new steps in the correct order without disturbing the existing logic.

- [ ] **Step 1: Write the failing structural test**

Create `tests/unit/trace-workflow-instrumentation.test.mjs`:

```javascript
// tests/unit/trace-workflow-instrumentation.test.mjs
//
// Structural assertions for the trace instrumentation added in Phase 2.
// Each workflow that opens a workflow-level span must close it. Workflows
// that run the reconciler must call it at Step 0.5.
//
// Run: `node --test tests/unit/trace-workflow-instrumentation.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('execute-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/execute-task.md');

  test('Step 0.5 runs trace-reconcile.mjs', () => {
    assert.match(wf, /Step 0\.5[\s\S]*?trace-reconcile\.mjs/i,
      'Step 0.5 must invoke bin/trace-reconcile.mjs');
  });

  test('Step 0.5 opens the workflow-level span via trace-start-span.mjs', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name execute_task/,
      'workflow span must be opened with --name execute_task');
  });

  test('Per-phase span is opened before each phase body', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name phase/,
      'per-phase span emission required');
    assert.match(wf, /PHASE_SPAN_ID/,
      'phase span_id must be captured into a variable');
  });

  test('Per-agent-dispatch span is opened with --name agent_dispatch', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name agent_dispatch/,
      'per-dispatch span emission required');
    assert.match(wf, /--agent /,
      'agent role must be passed to the start-span call');
  });

  test('Per-agent-dispatch span is closed with --status and report-derived attrs', () => {
    assert.match(wf, /trace-end-span\.mjs[\s\S]*?--status/,
      'dispatch span must be closed');
    assert.ok(
      /trace-end-span\.mjs[\s\S]*?--retries/.test(wf) ||
      /trace-end-span\.mjs[\s\S]*?retries/.test(wf),
      'dispatch end must pass retry_count from the agent report'
    );
  });

  test('Phase span is closed with --status', () => {
    // Two distinct close calls: one for the agent dispatch, one for the phase.
    const closeCount = (wf.match(/trace-end-span\.mjs/g) || []).length;
    assert.ok(closeCount >= 3,
      `expected >=3 trace-end-span.mjs calls (dispatch + phase + workflow), got ${closeCount}`);
  });

  test('Workflow span is closed at the end of the workflow', () => {
    // The very last close call should pair with the workflow open.
    assert.match(wf, /WORKFLOW_SPAN_ID/,
      'workflow span_id must be captured into a variable named WORKFLOW_SPAN_ID');
  });

  test('TRACE_DISABLED tolerance: workflow tolerates empty span ids', () => {
    assert.match(wf, /TRACE_DISABLED|tolerate empty|empty span_id|skip.*trace/i,
      'workflow must document that empty span ids are acceptable');
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -20
```

Expected: FAIL. The current `execute-task.md` has no `trace-*` references.

- [ ] **Step 3: Read the current `execute-task.md` to locate insertion points**

Run:
```bash
grep -n "^## Step\|^### Step\|^# " jelou/workflows/execute-task.md | head -40
```

Note the line numbers of:
- The line immediately after the preamble heading (where Step 0.5 will be inserted).
- The Step 7 phase iteration block (where per-phase and per-dispatch spans go).
- The final Step (where the workflow span is closed).

- [ ] **Step 4: Insert Step 0.5 — Trace bootstrap**

Insert a new section between the preamble and the first existing step. The exact placement: right before the existing Step 1 (or Step 2 if Step 1 is preamble). The new block:

```markdown
## Step 0.5 — Trace bootstrap

Before any other step, open the workflow-level span and sweep orphans from any
prior interrupted run. The trace store lives at `<WORKSPACE>/.traces/spans.jsonl`
by default; set `TRACE_FILE` or `TRACE_DISABLED=1` to override.

1. **Sweep orphans** (idempotent — safe to run when the store is empty):
   ```bash
   node "${PLUGIN_ROOT:-.}/bin/trace-reconcile.mjs"
   ```
   The output line `reconciled: <N>` is informational. Do not fail the workflow
   if this script exits non-zero — tracing is best-effort.

2. **Open the workflow-level span**:
   ```bash
   WF_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
     --name execute_task --scope task --task "$TASK_SLUG")
   WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
   WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
   ```
   The stdout JSON is `{"span_id":"…","trace_id":"…","parent":null}`. When
   `TRACE_DISABLED=1` both ids are empty strings — every downstream
   `trace-end-span.mjs` call tolerates that (no-op when span_id is empty).

3. **Note:** if `$TASK_SLUG` is not yet resolved at this step (Step 1 resolves
   it), defer the open-span call until immediately after Step 1 and prepend
   `--task "$TASK_SLUG"` there. Either placement is acceptable as long as the
   span opens before Step 7's phase iteration begins.
```

(If `Step 0.5` would conflict with task-slug resolution, the implementer should adjust the structure so the workflow span opens immediately after Step 1's resolution step, but the reconciler runs at the very top.)

- [ ] **Step 5: Insert per-phase span open/close in Step 7**

Find the existing Step 7 phase iteration. At the top of each iteration body, add:

```markdown
### Step 7c.0 — Open phase span

Run:
```bash
PH_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name phase --scope task \
  --task "$TASK_SLUG" --service "$SERVICE_ID" --phase "$PHASE_NUM" \
  --parent "$WORKFLOW_SPAN_ID" --trace "$WORKFLOW_TRACE_ID")
PHASE_SPAN_ID=$(echo "$PH_OUT" | jq -r '.span_id // ""')
```
```

And at the end of each phase iteration (paired with success/failure resolution):

```markdown
### Step 7g — Close phase span

Determine the phase outcome status:
- `ok` — phase reached green tests + commit
- `blocked` — three-strike rule fired (orchestrator escalation)
- `failed` — phase aborted (non-recoverable error)

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$PHASE_SPAN_ID" --status "$PHASE_OUTCOME"
```
Empty `$PHASE_SPAN_ID` is tolerated (no-op).
```

- [ ] **Step 6: Insert per-agent-dispatch span pair**

Find the existing subagent dispatch points in Step 7 (test-writer, implementer, refactor-agent, qa-agent, build-validator, etc.). Wrap each dispatch with:

```markdown
### Open dispatch span (before invoking <agent>)

Run:
```bash
DS_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name agent_dispatch --scope task \
  --agent <agent-role> --model "$MODEL_FOR_AGENT" \
  --task "$TASK_SLUG" --service "$SERVICE_ID" --phase "$PHASE_NUM" \
  --parent "$PHASE_SPAN_ID" --trace "$WORKFLOW_TRACE_ID")
DISPATCH_SPAN_ID=$(echo "$DS_OUT" | jq -r '.span_id // ""')
```

… dispatch the subagent as today …

### Close dispatch span (after parsing the agent's JSON report)

From the agent's structured report, extract `status`, `outcome`, `retry_count` (if
present), and the list of `artifacts`. Compute `diff_size_loc` from
`git diff --shortstat` over the artifacts. Compute `error_signature` as
`sha256(normalized_error_message)[:8]` when `status == "blocked"` or `"failed"`.

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$DISPATCH_SPAN_ID" --status "$AGENT_STATUS" \
  ${AGENT_RETRIES:+--retries "$AGENT_RETRIES"} \
  ${AGENT_OUTCOME:+--outcome "$AGENT_OUTCOME"} \
  ${DIFF_SIZE_LOC:+--diff-size "$DIFF_SIZE_LOC"} \
  ${ERROR_SIG:+--error-sig "$ERROR_SIG"}
```
```

Apply this pattern to every dispatch in Step 7. The implementer should choose either to (a) duplicate the block inline before each dispatch, or (b) factor a single "Dispatch wrapper" section at the top of Step 7 that the per-agent steps reference. Option (b) is preferred for readability.

- [ ] **Step 7: Insert Step N — Close workflow span**

At the very end of `execute-task.md` (after the last existing step), add:

```markdown
## Step N — Close workflow span

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```

`$WORKFLOW_OUTCOME`:
- `ok` — all phases done, QA green, ready for `/jlu-create-pr`.
- `blocked` — workflow halted on a phase escalation; user intervention required.
- `failed` — workflow aborted (irrecoverable error).

Empty `$WORKFLOW_SPAN_ID` (when `TRACE_DISABLED=1`) is tolerated.
```

- [ ] **Step 8: Add a `TRACE_DISABLED` tolerance note near the top of the file**

Add this note in the existing preamble or early-orientation section:

```markdown
> **Tracing tolerance**: Every `trace-start-span.mjs` invocation captures
> stdout JSON. When `TRACE_DISABLED=1` (env var or
> `.spec-workspace.json: tracing.enabled: false`), every span_id is an empty
> string. Downstream `trace-end-span.mjs` calls and `jq` lookups must tolerate
> empty values without failing the workflow.
```

- [ ] **Step 9: Run the structural test**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -20
```

Expected: PASS for the `execute-task` block of tests. (Other workflows still red — those land in Tasks 3-7.)

- [ ] **Step 10: Run the full suite to confirm no regression**

Run:
```bash
npm test 2>&1 | tail -10
```

Expected: full suite green.

- [ ] **Step 11: Commit**

```bash
git add jelou/workflows/execute-task.md tests/unit/trace-workflow-instrumentation.test.mjs
git commit -m "feat(tracing): instrument execute-task with workflow + phase + per-agent-dispatch spans"
```

---

## Task 3: Instrument `new-task.md` — workflow open/close

**Files:**
- Modify: `jelou/workflows/new-task.md`
- Test: extend `tests/unit/trace-workflow-instrumentation.test.mjs`

`new-task` is the interview workflow. No phases, no agent dispatches inside Step 7 — just a top-level span.

- [ ] **Step 1: Extend the structural test**

Append to `tests/unit/trace-workflow-instrumentation.test.mjs`:

```javascript
describe('new-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/new-task.md');

  test('opens a workflow-level span with --name new_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name new_task/,
      'workflow span open required');
  });

  test('closes the workflow span with trace-end-span.mjs', () => {
    assert.match(wf, /trace-end-span\.mjs/,
      'workflow span close required');
  });

  test('captures WORKFLOW_SPAN_ID', () => {
    assert.match(wf, /WORKFLOW_SPAN_ID/,
      'span_id capture required for end-span pairing');
  });
});
```

- [ ] **Step 2: Run test, confirm new block fails**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -15
```

Expected: `new-task` block fails; `execute-task` block still passes.

- [ ] **Step 3: Edit `jelou/workflows/new-task.md`**

Read the file. Insert at the very top (after the preamble heading, before Step 1):

```markdown
## Step 0 — Open workflow span

Run:
```bash
WF_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name new_task --scope task)
WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
```

Note: `--task` is omitted here because the slug is created later in this
workflow. The span is updated retroactively via `trace-end-span` when the slug
is known.

Tracing is best-effort. When `TRACE_DISABLED=1`, the captured ids are empty
strings — the workflow continues regardless.
```

And at the end of the file (after the last step):

```markdown
## Step N — Close workflow span

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME" \
  ${TASK_SLUG:+--outcome "task=$TASK_SLUG"}
```

`$WORKFLOW_OUTCOME` is `ok` when the spec reached `planned` state, `blocked`
when the interview aborted, or `failed` on irrecoverable error.
```

- [ ] **Step 4: Run test, confirm pass**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/new-task.md tests/unit/trace-workflow-instrumentation.test.mjs
git commit -m "feat(tracing): instrument new-task with workflow-level span"
```

---

## Task 4: Instrument `refine-task.md` — workflow open/close + reconcile

**Files:**
- Modify: `jelou/workflows/refine-task.md`
- Test: extend `tests/unit/trace-workflow-instrumentation.test.mjs`

`refine-task` is one of the three "heavy" workflows that get Step 0.5 reconciler. (Phase 3 will additionally wire in the suggester.) For Phase 2 we add the reconcile call and the workflow-level span pair.

- [ ] **Step 1: Extend the structural test**

Append:

```javascript
describe('refine-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/refine-task.md');

  test('Step 0.5 runs trace-reconcile.mjs', () => {
    assert.match(wf, /trace-reconcile\.mjs/);
  });

  test('opens a workflow-level span with --name refine_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name refine_task/);
  });

  test('closes the workflow span', () => {
    assert.match(wf, /trace-end-span\.mjs/);
  });

  test('captures WORKFLOW_SPAN_ID', () => {
    assert.match(wf, /WORKFLOW_SPAN_ID/);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -15
```

Expected: `refine-task` block fails.

- [ ] **Step 3: Edit `jelou/workflows/refine-task.md`**

Read the file. Insert at the very top:

```markdown
## Step 0 — Trace bootstrap

1. **Sweep orphans from interrupted runs**:
   ```bash
   node "${PLUGIN_ROOT:-.}/bin/trace-reconcile.mjs"
   ```

2. **Open the workflow-level span**:
   ```bash
   WF_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
     --name refine_task --scope task --task "$TASK_SLUG")
   WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
   WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
   ```

Empty span ids (when `TRACE_DISABLED=1`) are tolerated downstream.
```

And at the end:

```markdown
## Step N — Close workflow span

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```
```

- [ ] **Step 4: Run test, confirm pass**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/refine-task.md tests/unit/trace-workflow-instrumentation.test.mjs
git commit -m "feat(tracing): instrument refine-task with reconcile + workflow span"
```

---

## Task 5: Instrument `create-pr.md` — workflow open/close + reconcile

**Files:**
- Modify: `jelou/workflows/create-pr.md`
- Test: extend `tests/unit/trace-workflow-instrumentation.test.mjs`

Same pattern as Task 4 but for `create-pr.md`. This is the third "heavy" workflow.

- [ ] **Step 1: Extend the structural test**

Append:

```javascript
describe('create-pr workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/create-pr.md');

  test('Step 0.5 runs trace-reconcile.mjs', () => {
    assert.match(wf, /trace-reconcile\.mjs/);
  });

  test('opens a workflow-level span with --name create_pr', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name create_pr/);
  });

  test('closes the workflow span', () => {
    assert.match(wf, /trace-end-span\.mjs/);
  });
});
```

- [ ] **Step 2: Confirm test fails, then edit file**

Same pattern as Task 4 — insert the `Step 0 — Trace bootstrap` block at top and `Step N — Close workflow span` at bottom. Use `--name create_pr` instead of `--name refine_task`.

- [ ] **Step 3: Run test, confirm pass**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/create-pr.md tests/unit/trace-workflow-instrumentation.test.mjs
git commit -m "feat(tracing): instrument create-pr with reconcile + workflow span"
```

---

## Task 6: Instrument `report-task.md` — workflow open/close

**Files:**
- Modify: `jelou/workflows/report-task.md`
- Test: extend `tests/unit/trace-workflow-instrumentation.test.mjs`

Light workflow. Open + close only, no reconcile.

- [ ] **Step 1: Extend structural test**

Append:

```javascript
describe('report-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/report-task.md');

  test('opens a workflow-level span with --name report_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name report_task/);
  });

  test('closes the workflow span', () => {
    assert.match(wf, /trace-end-span\.mjs/);
  });
});
```

- [ ] **Step 2: Confirm fail, then edit file**

Insert at top of `jelou/workflows/report-task.md`:

```markdown
## Step 0 — Open workflow span

```bash
WF_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name report_task --scope task --task "$TASK_SLUG")
WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
```
```

And at the end:

```markdown
## Step N — Close workflow span

```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```
```

- [ ] **Step 3: Run test, confirm pass**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/report-task.md tests/unit/trace-workflow-instrumentation.test.mjs
git commit -m "feat(tracing): instrument report-task with workflow-level span"
```

---

## Task 7: Instrument `close-task.md` — workflow open/close + snapshot

**Files:**
- Modify: `jelou/workflows/close-task.md`
- Test: extend `tests/unit/trace-workflow-instrumentation.test.mjs`

`close-task` is the only workflow that also persists a per-task snapshot of the trace before closure. The snapshot lives at `<TASK_DIR>/_traces/snapshot.jsonl` and contains every span with `task_slug == <this-task-slug>`. The workspace `spans.jsonl` is not purged by default (opt-in `--purge-trace`, deferred to a future phase).

- [ ] **Step 1: Extend structural test**

Append:

```javascript
describe('close-task workflow — trace instrumentation', () => {
  const wf = read('jelou/workflows/close-task.md');

  test('opens a workflow-level span with --name close_task', () => {
    assert.match(wf, /trace-start-span\.mjs[\s\S]*?--name close_task/);
  });

  test('closes the workflow span', () => {
    assert.match(wf, /trace-end-span\.mjs/);
  });

  test('snapshots the task trace to TASK_DIR before final closure', () => {
    assert.match(wf, /_traces\/snapshot\.jsonl/);
    assert.match(wf, /task_slug/);
  });
});
```

- [ ] **Step 2: Confirm fail, then edit file**

Insert at the top of `jelou/workflows/close-task.md`:

```markdown
## Step 0 — Open workflow span

```bash
WF_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name close_task --scope task --task "$TASK_SLUG")
WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
```
```

Add a snapshot step before the existing closure steps:

```markdown
## Step N-1 — Snapshot task trace to TASK_DIR

Persist the entire trace of this task to `<TASK_DIR>/_traces/snapshot.jsonl`
so the workspace-level store can rotate without losing the history of closed
tasks:

```bash
mkdir -p "$TASK_DIR/_traces"
node -e "
  const { readSpans, listRotatedFiles } = require(\"${PLUGIN_ROOT:-.}/bin/lib/trace/reader.mjs\");
  const fs = require('node:fs');
  const path = require('node:path');
  const slug = process.env.TASK_SLUG;
  const base = process.env.TRACE_FILE
    || path.resolve(process.cwd(), '.traces/spans.jsonl');
  const out = path.join(process.env.TASK_DIR, '_traces/snapshot.jsonl');
  const w = fs.createWriteStream(out);
  for (const f of listRotatedFiles(base)) {
    for (const evt of readSpans(f, { filter: e => e.task_slug === slug })) {
      w.write(JSON.stringify(evt) + '\n');
    }
  }
  w.end();
"
```

Tolerate failure (best-effort) — closure proceeds regardless.
```

(The implementer may rewrite the snapshot logic as a small dedicated helper at
`bin/trace-snapshot-task.mjs` if the inline `node -e` is too clunky for
maintenance. A helper is preferred but inline is acceptable for Phase 2.)

And at the end:

```markdown
## Step N — Close workflow span

```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```
```

- [ ] **Step 3: Run all workflow tests + run the existing `close-task-workflow.test.mjs` to confirm no regression**

Run:
```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -15
node --test tests/unit/close-task-workflow.test.mjs 2>&1 | tail -10
```

Expected: both PASS. The pre-existing `close-task-workflow.test.mjs` must continue to pass — the new content is additive.

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/close-task.md tests/unit/trace-workflow-instrumentation.test.mjs
git commit -m "feat(tracing): instrument close-task with workflow span + task snapshot"
```

---

## Task 8: Integration test — execute-task end-to-end emits expected span tree

**Files:**
- Create: `tests/integration/trace-workflow-end-to-end.test.mjs`

Verifies the documented span tree is actually emitted by the bash commands in the workflow. The test simulates `execute-task`'s Step 7 (one phase, two dispatches) by running the relevant CLI calls directly with the same shape as the workflow.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/trace-workflow-end-to-end.test.mjs`:

```javascript
// tests/integration/trace-workflow-end-to-end.test.mjs
//
// Runs the same CLI sequence that execute-task.md's Step 7 emits, then
// asserts the resulting span tree shape. This is a structural check
// against the workflow's documented Bash blocks, NOT a real
// /jlu-execute-task run (which would require a real agent runtime).
//
// Run: `node --test tests/integration/trace-workflow-end-to-end.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const START = join(ROOT, 'bin/trace-start-span.mjs');
const END = join(ROOT, 'bin/trace-end-span.mjs');

let dir;
let file;

function start(args) {
  const r = spawnSync('node', [START, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function end(args) {
  const r = spawnSync('node', [END, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file },
  });
  assert.equal(r.status, 0, r.stderr);
}

function spans() {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wf-e2e-'));
  file = join(dir, '.traces', 'spans.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('execute-task span tree shape', () => {
  test('workflow → phase → 2 dispatches → close all produces 4 starts + 4 ends', () => {
    // Step 0.5 — workflow open
    const wf = start(['--name', 'execute_task', '--scope', 'task',
                      '--task', 'alpha']);

    // Step 7c.0 — phase open
    const ph = start(['--name', 'phase', '--scope', 'task',
                      '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
                      '--parent', wf.span_id, '--trace', wf.trace_id]);

    // Step 7 — test-writer dispatch
    const tw = start(['--name', 'agent_dispatch', '--scope', 'task',
                      '--agent', 'test-writer', '--model', 'sonnet',
                      '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
                      '--parent', ph.span_id, '--trace', wf.trace_id]);
    end(['--span', tw.span_id, '--status', 'ok',
         '--retries', '0', '--diff-size', '28',
         '--outcome', 'tests written: 3 files']);

    // Step 7 — implementer dispatch
    const im = start(['--name', 'agent_dispatch', '--scope', 'task',
                      '--agent', 'implementer', '--model', 'sonnet',
                      '--task', 'alpha', '--service', 'svc-x', '--phase', '1',
                      '--parent', ph.span_id, '--trace', wf.trace_id]);
    end(['--span', im.span_id, '--status', 'ok',
         '--retries', '1', '--diff-size', '87']);

    // Step 7g — phase close
    end(['--span', ph.span_id, '--status', 'ok']);

    // Step N — workflow close
    end(['--span', wf.span_id, '--status', 'ok']);

    const all = spans();
    assert.equal(all.length, 8);
    assert.equal(all.filter(e => e.event_kind === 'span_start').length, 4);
    assert.equal(all.filter(e => e.event_kind === 'span_end').length, 4);

    // All ends carry trace_id == workflow root.
    assert.ok(all.every(e => e.trace_id === wf.trace_id));

    // Phase parent is workflow; dispatches' parent is phase.
    const phStart = all.find(e => e.event_kind === 'span_start' && e.name === 'phase');
    assert.equal(phStart.parent_span_id, wf.span_id);

    const dispatchStarts = all.filter(e =>
      e.event_kind === 'span_start' && e.name === 'agent_dispatch');
    assert.equal(dispatchStarts.length, 2);
    assert.ok(dispatchStarts.every(s => s.parent_span_id === ph.span_id));

    // Dispatch ends carry diff_size_loc.
    const dispatchEnds = all.filter(e =>
      e.event_kind === 'span_end' && e.name === 'agent_dispatch');
    assert.deepEqual(
      dispatchEnds.map(e => e.attrs.diff_size_loc).sort(),
      [28, 87]
    );
  });

  test('TRACE_DISABLED=1 produces zero spans even when CLIs are called', () => {
    process.env.TRACE_DISABLED = '1';
    try {
      const wf = start(['--name', 'execute_task', '--scope', 'task']);
      assert.equal(wf.span_id, '');
      // CLI exits 0 so the workflow continues, but no file is written.
      assert.throws(() => readFileSync(file, 'utf8'), /ENOENT/);
    } finally {
      delete process.env.TRACE_DISABLED;
    }
  });

  test('daemon-emitted events join the same store with scope: "daemon"', async () => {
    const { appendEvent, EVENT_TYPES } = await import(
      '../../bin/lib/dev-orchestrator/events.mjs');
    appendEvent(file, { type: EVENT_TYPES.pane_started, pane: 'svc-a' });
    appendEvent(file, { type: EVENT_TYPES.ready, pane: 'svc-a' });
    const all = spans();
    assert.equal(all.length, 2);
    assert.ok(all.every(e => e.scope === 'daemon'));
    assert.equal(all[0].name, 'pane_started');
    assert.equal(all[1].name, 'ready');
  });
});
```

- [ ] **Step 2: Run the integration test**

Run:
```bash
node --test tests/integration/trace-workflow-end-to-end.test.mjs 2>&1 | tail -20
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/trace-workflow-end-to-end.test.mjs
git commit -m "test(tracing): integration test for workflow span tree shape + daemon co-residency"
```

---

## Task 9: Full suite + sync-agents + CHANGELOG

**Files:** modify `CHANGELOG.md` only.

- [ ] **Step 1: Run the full unit suite**

Run:
```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass. Phase 2 adds approximately 7 (daemon) + 7-9 (workflow structural across 6 workflows) ≈ 14-16 new unit tests. Total expected: 490 + ~15 = ~505.

- [ ] **Step 2: Run integration tests**

Run:
```bash
node --test tests/integration/*.test.mjs 2>&1 | tail -10
```

Expected: previous 3 Phase 1 integration tests + 3 new Phase 2 = 6 integration tests pass.

- [ ] **Step 3: Verify agent sync is unchanged**

Run:
```bash
node bin/sync-agents.mjs --check
git diff main..HEAD -- agents/ .opencode/agents/ | wc -l
```

Expected: exit 0 and `0`. Phase 2 instruments workflows, not agents.

- [ ] **Step 4: Confirm TRACE_DISABLED still works end-to-end**

Run:
```bash
TMPDIR_TEST=$(mktemp -d)
cd "$TMPDIR_TEST"
TRACE_DISABLED=1 node /home/cristianp/personal-projects/jelou-spec-plugin/bin/trace-start-span.mjs --name execute_task --scope task
TRACE_DISABLED=1 node /home/cristianp/personal-projects/jelou-spec-plugin/bin/trace-reconcile.mjs
ls .traces/ 2>&1 || echo "no .traces dir created"
cd /home/cristianp/personal-projects/jelou-spec-plugin
rm -rf "$TMPDIR_TEST"
```

Expected: CLIs no-op cleanly, no `.traces/` directory created.

- [ ] **Step 5: Add CHANGELOG entry**

Open `CHANGELOG.md`. Insert at the top (right after the `# Changelog` header, before the existing `## [0.3.165]` entry):

```markdown
## [unreleased]

### Added

- **Tracing instrumentation across the task lifecycle (Phase 2 of the harness-engineering observability layer).** Every lifecycle workflow now emits structured spans: `new-task`, `refine-task`, `execute-task`, `create-pr`, `report-task`, `close-task` each open a workflow-level span on entry and close it on exit. The three "heavy" workflows (`refine-task`, `create-pr`, plus the always-on `execute-task`) additionally call `bin/trace-reconcile.mjs` at Step 0.5 to sweep orphan spans from any prior interrupted run. Inside `execute-task` Step 7, each phase opens a child span and each subagent dispatch opens a grandchild span with `agent_role`, `model_used`, and on close the parsed report's `status`, `retry_count`, `outcome`, `diff_size_loc`, and `error_signature`. `close-task` snapshots the task's spans to `<TASK_DIR>/_traces/snapshot.jsonl` before closure so workspace-level rotation never loses the history of closed tasks.
- **Dev-environment daemon migrated to the shared emitter.** `bin/lib/dev-orchestrator/events.mjs::appendEvent` now delegates to `bin/lib/trace/emitter.mjs::appendSpan` with `scope: "daemon"`. The legacy API (`EVENT_TYPES`, `SEVERITY`, `severityFor`, `appendEvent` signature) is preserved unchanged — daemon callers do not need to change. Daemon events join the same workspace `spans.jsonl` as workflow spans, so the future analyzer (Phase 3) can correlate dev-env failures with the task that hit them.
- **Tests**: ~15 new unit tests (workflow structural assertions + daemon migration) and 3 new integration tests (span tree shape + TRACE_DISABLED end-to-end + daemon co-residency). Full suite ~505/505.

### Internal

- Workflow `.md` files now reference `${PLUGIN_ROOT:-.}/bin/trace-*.mjs` for plugin-root resolution, matching the existing pattern in other workflow steps.
- The 23 agent prompts under `agents/` are byte-identical to prior main. Phase 2 instruments workflows, not agents — subagents continue to emit their existing JSON reports unchanged; the orchestrator extracts span attrs from those reports.
```

- [ ] **Step 6: Commit the changelog**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): record tracing instrumentation (Phase 2) [skip-bump]"
```

The `[skip-bump]` marker prevents the commit-msg hook from cascading another version bump on this commit — final version for the branch will be set in the final `[allow-jump]` consolidation commit before opening the PR.

- [ ] **Step 7: Consolidate version cascade before PR**

The branch will have accumulated multiple `chore(release): bump` commits from the commit-msg hook. Before opening the PR, collapse the cascade to a single `+1 patch` bump (e.g., `0.3.165 → 0.3.166`):

```bash
# Inspect current state
grep '"version"' package.json
git log --oneline main..HEAD | grep "chore(release)"

# If the version is now > 0.3.166, manually reset all three manifest files
# to the next sequential value:
#   package.json
#   .claude-plugin/plugin.json
#   .claude-plugin/marketplace.json
# Set each to "0.3.166" (or whatever main+1 is).

# Then commit with the [allow-jump] marker to bypass the anti-jump guard:
git add package.json .claude-plugin/marketplace.json .claude-plugin/plugin.json
git commit -m "chore(release): consolidate Phase 2 version cascade [allow-jump]"
```

This step matches the lesson learned at the end of Phase 1: the commit-msg hook auto-bumps on every commit; without `[skip-bump]` markers (or `[allow-jump]` consolidation) the branch ends 10+ versions ahead of the actual delta. One sequential `+1 patch` is the correct release shape for Phase 2.

---

## Phase 2 — Self-Review Checklist

Before opening the PR:

1. **Spec coverage** — Every Phase-2 item from the spec is implemented:
   - ✅ `new-task`, `refine-task`, `execute-task`, `create-pr`, `report-task`, `close-task` each open + close workflow spans
   - ✅ `refine-task`, `create-pr`, `execute-task` run `trace-reconcile.mjs` at Step 0.5
   - ✅ `execute-task` Step 7 emits per-phase + per-agent-dispatch spans
   - ✅ `close-task` snapshots the task trace to `<TASK_DIR>/_traces/snapshot.jsonl`
   - ✅ Dev-env daemon migrated to shared emitter
   - ✅ Tests: structural (workflow assertions) + integration (span tree + daemon)
   - 🔜 Phase 3: analyzer, suggester, skill

2. **Test count** — Approximately:
   - Workflow structural: 8 (execute-task) + 3 (new) + 4 (refine) + 3 (create-pr) + 2 (report) + 3 (close) = ~23
   - Daemon migration: 7
   - Integration: 3
   - **Total**: ~33 new tests

3. **Zero regression** — `npm test` green, `sync-agents --check` green, all integration tests green, agents unchanged.

4. **Version is sequential** — final branch version is exactly `main + 1 patch`.

If any item is missing or red, fix before opening the PR.

---

## What Phase 3 will do (preview)

- `bin/trace-analyze.mjs` with `--by-agent`, `--by-phase`, `--by-task`, `--trends` queries
- `bin/trace-suggest.mjs` with 4 rules + 7-day cooldown via `.spec-workspace/.cache/suggestion-history.jsonl`
- New skill `skills/trace-report/SKILL.md` + OpenCode mirror `.opencode/commands/jlu-trace-report.md`
- Suggester wired into `Step 0.5` of execute-task / refine-task / create-pr (right after the reconcile call)
- Integration test for the suggester (seed 15 runs with 30% retry rate, validate `bump_model_tier` emission with evidence)
- README "Tracing & Observability" section updates the "What's coming next" subsection

Phase 3 plan file: `docs/superpowers/plans/2026-05-24-tracing-observability-phase3-analyze-suggest.md` (written once Phase 2 lands).
