# Tracing & Observability — Phase 3 (Analyze + Suggest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the harness-engineering loop. Add the read-side of the trace store: a `trace-analyze.mjs` CLI that surfaces bottlenecks (per-agent / per-phase / per-task / trends), a `trace-suggest.mjs` CLI that emits four blocking suggestions before each heavy workflow with 7-day cooldown, and a user-facing `/jlu-trace-report` skill that wraps the analyzer. Wire the suggester into `Step 0.5` of `execute-task`, `refine-task`, and `create-pr` so suggestions land before each heavy workflow runs.

**Architecture:** Two new stdlib-only Node CLIs (`bin/trace-analyze.mjs`, `bin/trace-suggest.mjs`) read the workspace `spans.jsonl` via the existing `bin/lib/trace/reader.mjs`. A small `bin/lib/trace/aggregate.mjs` module hosts the shared aggregation logic (group spans by trace_id, compute durations, retry_rate, p50/p95). A new `bin/lib/trace/rules.mjs` module hosts the four suggestion rules with their thresholds and cooldown logic. The skill wires `bin/trace-analyze.mjs` into a user-facing `/jlu-trace-report`. The suggester wires into existing Step 0.5 blocks in the three heavy workflows.

**Tech Stack:** Node 20+ ESM (`.mjs`). `node:test`. Stdlib only.

**Spec:** `docs/superpowers/specs/2026-05-23-tracing-observability-design.md`
**Phase 1 plan:** `docs/superpowers/plans/2026-05-23-tracing-observability-phase1-foundation.md` (already merged)
**Phase 2 plan:** `docs/superpowers/plans/2026-05-24-tracing-observability-phase2-instrumentation.md` (already merged)

**Phase 3 deliverable (shippable on its own):** A user can run `/jlu-trace-report` and see bottlenecks across their workspace traces. Before each `/jlu-execute-task`, `/jlu-refine-task`, and `/jlu-create-pr`, the suggester scans recent traces and presents (`y/n` per suggestion) blocking suggestions when one of the four rules fires. All four rules are unit-tested with happy + edge cases. Cooldown survives across workspace sessions via `.spec-workspace/.cache/suggestion-history.jsonl`. README's "What's coming next" section updates to mark Phase 3 done.

---

## File Structure (Phase 3)

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `bin/lib/trace/aggregate.mjs` | Pure functions: `groupByTrace(spans)`, `groupByAgent(spans)`, `groupByPhase(spans)`, `computeDuration(start, end)`, `percentile(arr, p)`, `retryRate(agentSpans)`. No I/O. |
| `bin/lib/trace/rules.mjs` | Four suggestion rules as data + a `evaluate(spans, history)` evaluator. Constants: thresholds, windows, cooldown ms. |
| `bin/trace-analyze.mjs` | CLI: `--by-agent` / `--by-phase` / `--by-task <slug>` / `--trends [--window 30d]`. Reads spans.jsonl + rotated siblings, formats a table to stdout. |
| `bin/trace-suggest.mjs` | CLI: scan last N=10 completed traces (configurable via `TRACE_SUGGEST_WINDOW`), apply rules, print suggestions with inline evidence, exit 0. Reads cooldown history from `.spec-workspace/.cache/suggestion-history.jsonl`. |
| `skills/trace-report/SKILL.md` | Claude Code launcher for `/jlu-trace-report`. References shared workflow `jelou/workflows/trace-report.md`. |
| `.opencode/commands/jlu-trace-report.md` | OpenCode launcher for `/jlu-trace-report` (mirrors the Claude Code SKILL.md via the established dual-runtime pattern). |
| `jelou/workflows/trace-report.md` | Shared workflow: invokes `bin/trace-analyze.mjs` with the user-selected query. |
| `tests/unit/trace-aggregate.test.mjs` | Unit tests for aggregation helpers. |
| `tests/unit/trace-rules.test.mjs` | Unit tests for all four rules + cooldown logic. |
| `tests/unit/trace-analyze.test.mjs` | Unit tests for the analyzer CLI. |
| `tests/unit/trace-suggest.test.mjs` | Unit tests for the suggester CLI (rule trigger + cooldown + evidence formatting). |
| `tests/integration/trace-suggester-end-to-end.test.mjs` | Seed 15 traces with 30% retry rate on `implementer`, run suggester, assert `bump_model_tier` emission with evidence. |
| `tests/fixtures/trace/aggregate-sample.jsonl` | Small fixture with traces for analyzer/aggregator unit tests. |
| `tests/fixtures/trace/rules-sample.jsonl` | Crafted fixture that triggers each of the four rules. |

### Files to MODIFY

| Path | Change |
|------|--------|
| `jelou/workflows/execute-task.md` | Add suggester invocation immediately after the existing `trace-reconcile.mjs` call at Step 0.5. |
| `jelou/workflows/refine-task.md` | Add suggester invocation after the reconcile call. |
| `jelou/workflows/create-pr.md` | Add suggester invocation after the reconcile call. |
| `README.md` | Update the "Tracing & Observability" → "What's coming next" subsection to mark Phase 3 done and add a `/jlu-trace-report` row to the CLIs table. |
| `CHANGELOG.md` | New `## [0.3.167] — 2026-05-24` entry summarizing Phase 3. |

### Coding rules (apply to every file touched)

- Stdlib only. No new npm deps. Same constraint as Phase 1 and Phase 2.
- CLI scripts have `#!/usr/bin/env node` shebang and the standard header (Inputs / Output / Exit codes) like `bin/plan-phase-waves.mjs`.
- `bin/trace-suggest.mjs` honors `TRACE_DISABLED=1` (no-op exit 0, prints nothing) and `TRACE_SUGGEST_WINDOW=<N>` (default 10 traces).
- Suggestions always require explicit `y/n` per item — never auto-apply.
- Cooldown is keyed by `(rule_id, signature)` where `signature` is rule-specific (e.g., for rule `b` it's the `error_signature` itself; for rule `a` it's the `agent_role`).
- Workflow edits use the same `${PLUGIN_ROOT:-.}/bin/trace-suggest.mjs` pattern as Phase 2's reconcile call.
- Every commit on this branch uses `[skip-bump]` to keep the version locked at the target. Lock the branch at `0.3.167` (next sequential patch above main `0.3.166`).

---

## Task 0: Pre-flight — clean main, tests green, branch

**Files:** none (verification only).

- [ ] **Step 1: Confirm clean working tree, sync with remote**

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git fetch origin
git rebase origin/main
```

Expected: clean status, on `feature/tracing-analyze-suggest` (the branch has already been created by the controller before this task starts). If conflicts during rebase, STOP and surface to controller.

- [ ] **Step 2: Baseline test suite green**

```bash
npm test
node --test tests/integration/*.test.mjs
node bin/sync-agents.mjs --check
```

Expected: 520+ unit tests passing, 7 integration tests passing, sync-agents exit 0. If red, STOP.

- [ ] **Step 3: Confirm version is locked at 0.3.166 (sequential next is 0.3.167)**

```bash
grep '"version"' package.json
```

Expected: `"version": "0.3.166"`. If not, surface to controller.

---

## Task 1: `bin/lib/trace/aggregate.mjs` — pure aggregation helpers

**Files:**
- Create: `bin/lib/trace/aggregate.mjs`
- Test: `tests/unit/trace-aggregate.test.mjs`
- Create: `tests/fixtures/trace/aggregate-sample.jsonl`

Aggregation is shared between analyzer and suggester. Pure functions, no I/O.

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/trace/aggregate-sample.jsonl` with two completed traces — one with implementer retry, one clean:

```jsonl
{"ts":"2026-05-20T10:00:00.000Z","event_kind":"span_start","span_id":"T1WF","trace_id":"T1","scope":"task","name":"execute_task","task_slug":"alpha"}
{"ts":"2026-05-20T10:00:01.000Z","event_kind":"span_start","span_id":"T1PH","parent_span_id":"T1WF","trace_id":"T1","scope":"task","name":"phase","task_slug":"alpha","service_id":"svc-x","phase_num":1}
{"ts":"2026-05-20T10:00:02.000Z","event_kind":"span_start","span_id":"T1A1","parent_span_id":"T1PH","trace_id":"T1","scope":"task","name":"agent_dispatch","task_slug":"alpha","service_id":"svc-x","phase_num":1,"agent_role":"test-writer"}
{"ts":"2026-05-20T10:00:30.000Z","event_kind":"span_end","span_id":"T1A1","trace_id":"T1","scope":"task","name":"agent_dispatch","status":"ok","duration_ms":28000,"agent_role":"test-writer","attrs":{"retry_count":0,"diff_size_loc":28}}
{"ts":"2026-05-20T10:00:31.000Z","event_kind":"span_start","span_id":"T1A2","parent_span_id":"T1PH","trace_id":"T1","scope":"task","name":"agent_dispatch","task_slug":"alpha","service_id":"svc-x","phase_num":1,"agent_role":"implementer"}
{"ts":"2026-05-20T10:02:30.000Z","event_kind":"span_end","span_id":"T1A2","trace_id":"T1","scope":"task","name":"agent_dispatch","status":"ok","duration_ms":119000,"agent_role":"implementer","attrs":{"retry_count":1,"diff_size_loc":87}}
{"ts":"2026-05-20T10:02:31.000Z","event_kind":"span_end","span_id":"T1PH","trace_id":"T1","scope":"task","name":"phase","status":"ok","duration_ms":150000}
{"ts":"2026-05-20T10:02:32.000Z","event_kind":"span_end","span_id":"T1WF","trace_id":"T1","scope":"task","name":"execute_task","status":"ok","duration_ms":152000}
{"ts":"2026-05-20T11:00:00.000Z","event_kind":"span_start","span_id":"T2WF","trace_id":"T2","scope":"task","name":"execute_task","task_slug":"beta"}
{"ts":"2026-05-20T11:00:01.000Z","event_kind":"span_start","span_id":"T2PH","parent_span_id":"T2WF","trace_id":"T2","scope":"task","name":"phase","task_slug":"beta","service_id":"svc-x","phase_num":1}
{"ts":"2026-05-20T11:00:02.000Z","event_kind":"span_start","span_id":"T2A1","parent_span_id":"T2PH","trace_id":"T2","scope":"task","name":"agent_dispatch","task_slug":"beta","service_id":"svc-x","phase_num":1,"agent_role":"implementer"}
{"ts":"2026-05-20T11:02:00.000Z","event_kind":"span_end","span_id":"T2A1","trace_id":"T2","scope":"task","name":"agent_dispatch","status":"ok","duration_ms":118000,"agent_role":"implementer","attrs":{"retry_count":0,"diff_size_loc":45}}
{"ts":"2026-05-20T11:02:01.000Z","event_kind":"span_end","span_id":"T2PH","trace_id":"T2","scope":"task","name":"phase","status":"ok","duration_ms":121000}
{"ts":"2026-05-20T11:02:02.000Z","event_kind":"span_end","span_id":"T2WF","trace_id":"T2","scope":"task","name":"execute_task","status":"ok","duration_ms":122000}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/trace-aggregate.test.mjs`:

```javascript
// tests/unit/trace-aggregate.test.mjs
//
// Run: `node --test tests/unit/trace-aggregate.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  groupByTrace,
  groupByAgent,
  groupByPhase,
  percentile,
  retryRate,
  pairSpans,
} from '../../bin/lib/trace/aggregate.mjs';
import { readSpans } from '../../bin/lib/trace/reader.mjs';

const FIX = 'tests/fixtures/trace/aggregate-sample.jsonl';

function loadAll() {
  return [...readSpans(FIX)];
}

describe('pairSpans(events)', () => {
  test('pairs span_start with matching span_end by span_id', () => {
    const evts = loadAll();
    const pairs = pairSpans(evts);
    // 4 spans per trace × 2 traces = 8 pairs total
    assert.equal(pairs.length, 8);
    for (const p of pairs) {
      assert.equal(p.start.event_kind, 'span_start');
      assert.equal(p.end.event_kind, 'span_end');
      assert.equal(p.start.span_id, p.end.span_id);
      assert.ok(p.duration_ms >= 0);
    }
  });

  test('orphan span_start (no matching end) is omitted from pairs', () => {
    const orphan = [{
      event_kind: 'span_start', span_id: 'X', trace_id: 'T', scope: 'task',
      name: 'phase', ts: '2026-05-20T10:00:00Z',
    }];
    assert.equal(pairSpans(orphan).length, 0);
  });
});

describe('groupByTrace(pairs)', () => {
  test('groups pairs by trace_id', () => {
    const pairs = pairSpans(loadAll());
    const grouped = groupByTrace(pairs);
    assert.deepEqual(Object.keys(grouped).sort(), ['T1', 'T2']);
    assert.equal(grouped.T1.length, 4); // workflow + phase + 2 dispatches
  });
});

describe('groupByAgent(pairs)', () => {
  test('groups agent_dispatch pairs by agent_role', () => {
    const pairs = pairSpans(loadAll()).filter(p => p.start.name === 'agent_dispatch');
    const grouped = groupByAgent(pairs);
    assert.deepEqual(Object.keys(grouped).sort(), ['implementer', 'test-writer']);
    assert.equal(grouped.implementer.length, 2);
    assert.equal(grouped['test-writer'].length, 1);
  });

  test('ignores non-agent_dispatch spans', () => {
    const pairs = pairSpans(loadAll());
    const grouped = groupByAgent(pairs);
    // Only agent_dispatch pairs are present
    assert.ok(Object.values(grouped).every(arr =>
      arr.every(p => p.start.name === 'agent_dispatch')
    ));
  });
});

describe('groupByPhase(pairs)', () => {
  test('groups phase pairs by (service_id, phase_num)', () => {
    const pairs = pairSpans(loadAll()).filter(p => p.start.name === 'phase');
    const grouped = groupByPhase(pairs);
    assert.deepEqual(Object.keys(grouped), ['svc-x:1']);
    assert.equal(grouped['svc-x:1'].length, 2);
  });
});

describe('percentile(arr, p)', () => {
  test('p50 of [1,2,3,4,5] is 3', () => {
    assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  });

  test('p95 of [1..100] is 95 or 96 (linear interpolation)', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    const p95 = percentile(arr, 95);
    assert.ok(p95 >= 95 && p95 <= 96);
  });

  test('empty array returns 0', () => {
    assert.equal(percentile([], 50), 0);
  });

  test('single element returns that element', () => {
    assert.equal(percentile([42], 95), 42);
  });
});

describe('retryRate(agentPairs)', () => {
  test('returns sum(retry_count) / count for implementer in fixture', () => {
    const pairs = pairSpans(loadAll()).filter(p =>
      p.start.name === 'agent_dispatch' && p.start.agent_role === 'implementer');
    // implementer: 2 dispatches, retry_count [1, 0]. rate = 1/2 = 0.5
    assert.equal(retryRate(pairs), 0.5);
  });

  test('returns 0 for empty input', () => {
    assert.equal(retryRate([]), 0);
  });

  test('treats missing retry_count as 0', () => {
    const pairs = [
      { end: { attrs: {} } },
      { end: { attrs: { retry_count: 2 } } },
    ];
    assert.equal(retryRate(pairs), 1);
  });
});
```

- [ ] **Step 3: Run test, confirm it fails**

```bash
node --test tests/unit/trace-aggregate.test.mjs 2>&1 | tail -15
```

Expected: FAIL with "Cannot find module '../../bin/lib/trace/aggregate.mjs'".

- [ ] **Step 4: Create the aggregate module**

Create `bin/lib/trace/aggregate.mjs`:

```javascript
// bin/lib/trace/aggregate.mjs
//
// Pure aggregation helpers for the tracing system. Stdlib only — no I/O.
//
//   - pairSpans(events): zip span_start with matching span_end by span_id.
//     Returns [{ start, end, duration_ms }, ...]. Orphans are omitted.
//   - groupByTrace(pairs): { trace_id -> pairs[] }
//   - groupByAgent(pairs): { agent_role -> pairs[] }, agent_dispatch only.
//   - groupByPhase(pairs): { "<service_id>:<phase_num>" -> pairs[] }, phase only.
//   - percentile(arr, p): linear-interpolated p-th percentile (0-100).
//   - retryRate(agentPairs): sum(retry_count) / count. 0 for empty input.

export function pairSpans(events) {
  const starts = new Map();
  const pairs = [];
  for (const e of events) {
    if (e.event_kind === 'span_start') {
      starts.set(e.span_id, e);
    } else if (e.event_kind === 'span_end') {
      const start = starts.get(e.span_id);
      if (!start) continue;
      const duration_ms = e.duration_ms != null
        ? e.duration_ms
        : (new Date(e.ts).getTime() - new Date(start.ts).getTime());
      pairs.push({ start, end: e, duration_ms });
      starts.delete(e.span_id);
    }
  }
  return pairs;
}

export function groupByTrace(pairs) {
  const out = {};
  for (const p of pairs) {
    const key = p.start.trace_id;
    if (!out[key]) out[key] = [];
    out[key].push(p);
  }
  return out;
}

export function groupByAgent(pairs) {
  const out = {};
  for (const p of pairs) {
    if (p.start.name !== 'agent_dispatch') continue;
    const role = p.start.agent_role;
    if (!role) continue;
    if (!out[role]) out[role] = [];
    out[role].push(p);
  }
  return out;
}

export function groupByPhase(pairs) {
  const out = {};
  for (const p of pairs) {
    if (p.start.name !== 'phase') continue;
    const key = `${p.start.service_id || 'unknown'}:${p.start.phase_num ?? 'unknown'}`;
    if (!out[key]) out[key] = [];
    out[key].push(p);
  }
  return out;
}

export function percentile(arr, p) {
  if (arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function retryRate(agentPairs) {
  if (agentPairs.length === 0) return 0;
  let total = 0;
  for (const p of agentPairs) {
    total += (p.end?.attrs?.retry_count ?? 0);
  }
  return total / agentPairs.length;
}
```

- [ ] **Step 5: Run test, confirm pass**

```bash
node --test tests/unit/trace-aggregate.test.mjs 2>&1 | tail -15
```

Expected: PASS, all tests.

- [ ] **Step 6: Commit with [skip-bump]**

```bash
git add bin/lib/trace/aggregate.mjs tests/unit/trace-aggregate.test.mjs tests/fixtures/trace/aggregate-sample.jsonl
git commit -m "feat(tracing): add aggregation helpers (groupByTrace/Agent/Phase, percentile, retryRate) [skip-bump]"
```

---

## Task 2: `bin/lib/trace/rules.mjs` + `bin/trace-suggest.mjs` — the four rules

**Files:**
- Create: `bin/lib/trace/rules.mjs`
- Create: `bin/trace-suggest.mjs`
- Test: `tests/unit/trace-rules.test.mjs`
- Test: `tests/unit/trace-suggest.test.mjs`
- Create: `tests/fixtures/trace/rules-sample.jsonl`

The four rules per the design spec:

| ID | Rule | Trigger | Suggestion |
|----|------|---------|------------|
| `bump_model_tier` | per agent_role, retry_rate > 0.20 over last N=10 dispatches | bump model tier for that agent |
| `extend_patterns` | error_signature appears ≥ 3 times in last 30 days | extend `patterns.mjs` with that signature |
| `suggest_parallelize` | per (service, phase), p95_duration / median_duration > 3.0 over last N=10 phase runs | enable `per-service-parallel` |
| `immediate_flag` | any span with `status: "blocked"` in last 24 hours | flag the blocked dispatch for review |

Cooldown: 7 days per `(rule_id, signature)` pair, stored as JSONL records in `.spec-workspace/.cache/suggestion-history.jsonl`.

- [ ] **Step 1: Create the rules fixture**

Create `tests/fixtures/trace/rules-sample.jsonl` with crafted spans that trigger each rule. Construct 12 traces:

- 10 traces with implementer dispatches: 3 have `retry_count: 1`, 7 have `retry_count: 0` → retry_rate = 0.3 (triggers rule a)
- Within those, 3 different traces have `error_signature: "DEAD_BEEF"` → triggers rule b
- 1 phase with duration 60000 ms; 9 phases with 10000-15000 ms → triggers rule c
- 1 span with `status: "blocked"` from within the last 24 hours → triggers rule d

Use timestamps within the last 24 hours so all rules see the events as recent. The fixture file should be ~30-50 spans. Generate it with a small Node script if hand-writing is too tedious — the implementer may write a helper at `tests/fixtures/trace/generate-rules-sample.mjs` that emits the fixture deterministically and run it once.

(The fixture content is generated mechanically. Implementer should produce it and commit the resulting `.jsonl` file. If a generator helper is added, commit it alongside.)

- [ ] **Step 2: Write the failing tests for rules.mjs**

Create `tests/unit/trace-rules.test.mjs`:

```javascript
// tests/unit/trace-rules.test.mjs
//
// Run: `node --test tests/unit/trace-rules.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  RULES,
  RULE_IDS,
  COOLDOWN_MS,
  evaluate,
  applyCooldown,
  formatSuggestion,
} from '../../bin/lib/trace/rules.mjs';
import { readSpans } from '../../bin/lib/trace/reader.mjs';
import { pairSpans } from '../../bin/lib/trace/aggregate.mjs';

const FIX = 'tests/fixtures/trace/rules-sample.jsonl';

function loadPairs() {
  return pairSpans([...readSpans(FIX)]);
}

describe('RULES constants', () => {
  test('exposes four rules with stable ids', () => {
    assert.deepEqual(
      RULE_IDS.sort(),
      ['bump_model_tier', 'extend_patterns', 'immediate_flag', 'suggest_parallelize']
    );
  });

  test('each rule has id, description, evaluate, formatSuggestion', () => {
    for (const r of RULES) {
      assert.ok(r.id);
      assert.ok(r.description);
      assert.ok(typeof r.evaluate === 'function');
    }
  });

  test('COOLDOWN_MS is 7 days', () => {
    assert.equal(COOLDOWN_MS, 7 * 24 * 60 * 60 * 1000);
  });
});

describe('rule: bump_model_tier', () => {
  test('triggers when retry_rate > 0.20 over last 10 dispatches', () => {
    const pairs = loadPairs();
    const findings = evaluate(pairs).filter(f => f.rule_id === 'bump_model_tier');
    assert.ok(findings.length >= 1, 'expected bump_model_tier finding');
    const f = findings.find(x => x.signature === 'implementer');
    assert.ok(f, 'expected finding for implementer agent');
    assert.ok(f.evidence.retry_rate > 0.20);
    assert.equal(f.evidence.dispatches_checked, 10);
  });

  test('does not trigger when retry_rate <= 0.20', () => {
    // Construct a small in-memory fixture: 10 dispatches all retry_count 0
    const pairs = [];
    for (let i = 0; i < 10; i++) {
      pairs.push({
        start: { event_kind: 'span_start', span_id: `S${i}`, trace_id: `T${i}`,
                 name: 'agent_dispatch', agent_role: 'cleaner', scope: 'task' },
        end: { event_kind: 'span_end', span_id: `S${i}`, status: 'ok',
                attrs: { retry_count: 0 } },
        duration_ms: 1000,
      });
    }
    const findings = evaluate(pairs).filter(f => f.rule_id === 'bump_model_tier');
    assert.equal(findings.length, 0);
  });
});

describe('rule: extend_patterns', () => {
  test('triggers when error_signature appears >= 3 times', () => {
    const pairs = loadPairs();
    const findings = evaluate(pairs).filter(f => f.rule_id === 'extend_patterns');
    assert.ok(findings.length >= 1);
    const f = findings.find(x => x.signature === 'DEAD_BEEF');
    assert.ok(f, 'expected finding for error_signature DEAD_BEEF');
    assert.ok(f.evidence.occurrences >= 3);
  });
});

describe('rule: suggest_parallelize', () => {
  test('triggers when p95 / median > 3.0 for a (service, phase) pair', () => {
    const pairs = loadPairs();
    const findings = evaluate(pairs).filter(f => f.rule_id === 'suggest_parallelize');
    assert.ok(findings.length >= 1);
  });
});

describe('rule: immediate_flag', () => {
  test('triggers for any blocked span in last 24h', () => {
    const pairs = loadPairs();
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.ok(findings.length >= 1);
  });

  test('does not trigger for blocked spans older than 24h', () => {
    const oldTs = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const pairs = [{
      start: { event_kind: 'span_start', span_id: 'S1', trace_id: 'T1',
               name: 'agent_dispatch', agent_role: 'implementer', scope: 'task',
               ts: oldTs },
      end: { event_kind: 'span_end', span_id: 'S1', status: 'blocked',
              ts: oldTs, attrs: { error_signature: 'OLD_ERR' } },
      duration_ms: 1000,
    }];
    const findings = evaluate(pairs).filter(f => f.rule_id === 'immediate_flag');
    assert.equal(findings.length, 0);
  });
});

describe('applyCooldown(findings, history)', () => {
  test('removes findings whose (rule_id, signature) is within cooldown window', () => {
    const findings = [
      { rule_id: 'bump_model_tier', signature: 'implementer', evidence: {} },
      { rule_id: 'extend_patterns', signature: 'DEAD_BEEF', evidence: {} },
    ];
    const now = Date.now();
    const history = [
      { rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'declined', ts: new Date(now - 60 * 60 * 1000).toISOString() }, // 1h ago — still cooling down
    ];
    const filtered = applyCooldown(findings, history);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].rule_id, 'extend_patterns');
  });

  test('keeps findings whose cooldown has elapsed', () => {
    const findings = [
      { rule_id: 'bump_model_tier', signature: 'implementer', evidence: {} },
    ];
    const ancient = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const history = [
      { rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'declined', ts: ancient },
    ];
    const filtered = applyCooldown(findings, history);
    assert.equal(filtered.length, 1);
  });

  test('approved actions also start a cooldown (avoid re-suggesting same thing right after fix)', () => {
    const findings = [
      { rule_id: 'bump_model_tier', signature: 'implementer', evidence: {} },
    ];
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const history = [
      { rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'approved', ts: recent },
    ];
    const filtered = applyCooldown(findings, history);
    assert.equal(filtered.length, 0);
  });
});

describe('formatSuggestion(finding)', () => {
  test('renders human-readable suggestion with inline evidence', () => {
    const out = formatSuggestion({
      rule_id: 'bump_model_tier',
      signature: 'implementer',
      evidence: { retry_rate: 0.3, dispatches_checked: 10, error_signatures: ['a1b2c3d4'] },
      message: 'implementer has 30% retry rate (3/10 last runs)',
    });
    assert.match(out, /SUGGEST \[bump_model_tier\]/);
    assert.match(out, /implementer/);
    assert.match(out, /30%/);
    assert.match(out, /apply:|action:|y\/n/i);
  });
});
```

- [ ] **Step 3: Run test, confirm it fails**

```bash
node --test tests/unit/trace-rules.test.mjs 2>&1 | tail -15
```

Expected: FAIL (module missing).

- [ ] **Step 4: Create `bin/lib/trace/rules.mjs`**

Create `bin/lib/trace/rules.mjs`:

```javascript
// bin/lib/trace/rules.mjs
//
// The four suggestion rules and the cooldown logic. Pure functions over
// the [{start, end, duration_ms}] pair shape from aggregate.mjs.
//
// Rules:
//   bump_model_tier  — per agent_role, retry_rate > 0.20 over last N=10 dispatches
//   extend_patterns  — error_signature appears >= 3 times in last 30 days
//   suggest_parallelize — per (service, phase), p95 / median > 3.0 over last N=10 phase runs
//   immediate_flag   — any span with status: "blocked" in last 24 hours
//
// Cooldown: 7 days per (rule_id, signature) pair. applyCooldown() removes
// findings already in the history within the cooldown window. Both 'approved'
// and 'declined' history entries start a cooldown (so the user is not
// re-prompted for the same finding immediately after responding).

import { groupByAgent, groupByPhase, percentile, retryRate } from './aggregate.mjs';

const N_WINDOW = 10;
const PATTERN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const BLOCKED_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const RETRY_RATE_THRESHOLD = 0.20;
const PARALLEL_RATIO_THRESHOLD = 3.0;
const PATTERN_OCCURRENCE_THRESHOLD = 3;

export const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export const RULES = [
  {
    id: 'bump_model_tier',
    description: 'Per-agent retry rate exceeds threshold',
    evaluate: (pairs) => {
      const findings = [];
      const byAgent = groupByAgent(pairs);
      for (const [agent_role, agentPairs] of Object.entries(byAgent)) {
        const recent = agentPairs.slice(-N_WINDOW);
        if (recent.length < N_WINDOW) continue;
        const rate = retryRate(recent);
        if (rate <= RETRY_RATE_THRESHOLD) continue;
        const signatures = recent
          .map(p => p.end?.attrs?.error_signature)
          .filter(Boolean);
        findings.push({
          rule_id: 'bump_model_tier',
          signature: agent_role,
          evidence: {
            retry_rate: rate,
            dispatches_checked: recent.length,
            error_signatures: signatures,
          },
          message: `${agent_role} has ${Math.round(rate * 100)}% retry rate ` +
            `(${Math.round(rate * recent.length)}/${recent.length} last runs)`,
        });
      }
      return findings;
    },
  },
  {
    id: 'extend_patterns',
    description: 'Repeated error_signature across last 30 days',
    evaluate: (pairs) => {
      const cutoff = Date.now() - PATTERN_LOOKBACK_MS;
      const counts = new Map();
      for (const p of pairs) {
        if (!p.end) continue;
        const ts = new Date(p.end.ts).getTime();
        if (ts < cutoff) continue;
        const sig = p.end?.attrs?.error_signature;
        if (!sig) continue;
        counts.set(sig, (counts.get(sig) || 0) + 1);
      }
      const findings = [];
      for (const [sig, occurrences] of counts) {
        if (occurrences < PATTERN_OCCURRENCE_THRESHOLD) continue;
        findings.push({
          rule_id: 'extend_patterns',
          signature: sig,
          evidence: { occurrences },
          message: `error_signature ${sig} repeated ${occurrences}x in last 30 days`,
        });
      }
      return findings;
    },
  },
  {
    id: 'suggest_parallelize',
    description: 'Phase p95 / median > 3.0',
    evaluate: (pairs) => {
      const findings = [];
      const byPhase = groupByPhase(pairs);
      for (const [key, phasePairs] of Object.entries(byPhase)) {
        const recent = phasePairs.slice(-N_WINDOW);
        if (recent.length < N_WINDOW) continue;
        const durations = recent.map(p => p.duration_ms);
        const p95 = percentile(durations, 95);
        const median = percentile(durations, 50);
        if (median === 0) continue;
        const ratio = p95 / median;
        if (ratio <= PARALLEL_RATIO_THRESHOLD) continue;
        findings.push({
          rule_id: 'suggest_parallelize',
          signature: key,
          evidence: {
            p95_ms: Math.round(p95),
            median_ms: Math.round(median),
            ratio: Number(ratio.toFixed(2)),
            samples: recent.length,
          },
          message: `phase ${key} p95 ${Math.round(p95)}ms / median ${Math.round(median)}ms ` +
            `= ${ratio.toFixed(1)}x (over ${PARALLEL_RATIO_THRESHOLD}x threshold)`,
        });
      }
      return findings;
    },
  },
  {
    id: 'immediate_flag',
    description: 'Recently blocked span',
    evaluate: (pairs) => {
      const cutoff = Date.now() - BLOCKED_LOOKBACK_MS;
      const findings = [];
      for (const p of pairs) {
        if (!p.end) continue;
        if (p.end.status !== 'blocked' && p.end.status !== 'failed') continue;
        const ts = new Date(p.end.ts).getTime();
        if (ts < cutoff) continue;
        const sig = p.end?.attrs?.error_signature ||
          `${p.start.name}:${p.start.agent_role || p.start.service_id || 'unknown'}`;
        findings.push({
          rule_id: 'immediate_flag',
          signature: sig,
          evidence: {
            span_id: p.start.span_id,
            agent_role: p.start.agent_role,
            phase_num: p.start.phase_num,
            service_id: p.start.service_id,
            task_slug: p.start.task_slug,
            status: p.end.status,
            ts: p.end.ts,
          },
          message: `${p.start.name} ${sig} ${p.end.status} on task=${p.start.task_slug || '?'}`,
        });
      }
      return findings;
    },
  },
];

export const RULE_IDS = RULES.map(r => r.id);

export function evaluate(pairs) {
  const findings = [];
  for (const rule of RULES) {
    findings.push(...rule.evaluate(pairs));
  }
  return findings;
}

export function applyCooldown(findings, history) {
  const now = Date.now();
  const cooled = new Set();
  for (const h of history) {
    const ts = new Date(h.ts).getTime();
    if (now - ts < COOLDOWN_MS) cooled.add(`${h.rule_id}:${h.signature}`);
  }
  return findings.filter(f => !cooled.has(`${f.rule_id}:${f.signature}`));
}

export function formatSuggestion(finding) {
  const ev = Object.entries(finding.evidence || {})
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
  return [
    `SUGGEST [${finding.rule_id}] ${finding.message}`,
    `  evidence: ${ev}`,
    `  apply: y/n?`,
  ].join('\n');
}
```

- [ ] **Step 5: Run rules test, confirm pass**

```bash
node --test tests/unit/trace-rules.test.mjs 2>&1 | tail -20
```

Expected: PASS, all rule tests. If the fixture didn't trigger a specific rule, regenerate it.

- [ ] **Step 6: Write the failing test for the suggester CLI**

Create `tests/unit/trace-suggest.test.mjs`:

```javascript
// tests/unit/trace-suggest.test.mjs
//
// Run: `node --test tests/unit/trace-suggest.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'bin/trace-suggest.mjs');
const FIX_RULES = join(ROOT, 'tests/fixtures/trace/rules-sample.jsonl');

let dir;
let traceFile;
let historyFile;

function run(env = {}) {
  return spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TRACE_FILE: traceFile,
      TRACE_SUGGEST_HISTORY: historyFile,
      ...env,
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suggest-'));
  traceFile = join(dir, '.traces/spans.jsonl');
  historyFile = join(dir, '.spec-workspace/.cache/suggestion-history.jsonl');
  mkdirSync(dirname(traceFile), { recursive: true });
  copyFileSync(FIX_RULES, traceFile);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-suggest.mjs', () => {
  test('emits SUGGEST lines for each triggered rule', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SUGGEST \[bump_model_tier\]/);
    assert.match(r.stdout, /SUGGEST \[extend_patterns\]/);
  });

  test('TRACE_DISABLED=1 short-circuits to exit 0 with no output', () => {
    const r = run({ TRACE_DISABLED: '1' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });

  test('respects 7-day cooldown via suggestion-history.jsonl', () => {
    // Pre-populate history with a 1-hour-old "declined" entry for bump_model_tier:implementer.
    mkdirSync(dirname(historyFile), { recursive: true });
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeFileSync(historyFile,
      JSON.stringify({
        rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'declined', ts: recent,
      }) + '\n');
    const r = run();
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /SUGGEST \[bump_model_tier\][^\n]*implementer/,
      'bump_model_tier for implementer should be suppressed by cooldown');
  });

  test('emits empty output when no rules fire', () => {
    writeFileSync(traceFile, '');
    const r = run();
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });

  test('handles missing trace file gracefully (no error)', () => {
    rmSync(traceFile);
    const r = run();
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  });
});
```

- [ ] **Step 7: Run test, confirm fail**

```bash
node --test tests/unit/trace-suggest.test.mjs 2>&1 | tail -15
```

Expected: FAIL (CLI missing).

- [ ] **Step 8: Create `bin/trace-suggest.mjs`**

Create `bin/trace-suggest.mjs`:

```javascript
#!/usr/bin/env node
// bin/trace-suggest.mjs — scan recent traces, emit blocking suggestions.
//
// Inputs (env):
//   TRACE_FILE                workspace spans.jsonl (default <cwd>/.traces/spans.jsonl)
//   TRACE_SUGGEST_HISTORY     cooldown store (default <cwd>/.spec-workspace/.cache/suggestion-history.jsonl)
//   TRACE_SUGGEST_WINDOW      max completed traces to scan (default 10)
//   TRACE_DISABLED=1          short-circuit (exit 0 silently)
//
// Output (stdout): one SUGGEST block per finding (multi-line), separated by blank lines.
// Exit codes:
//   0  always (best-effort; never fails the workflow)

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { pairSpans } from './lib/trace/aggregate.mjs';
import { evaluate, applyCooldown, formatSuggestion } from './lib/trace/rules.mjs';

function resolveTraceFile() {
  return process.env.TRACE_FILE
    || resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function resolveHistoryFile() {
  return process.env.TRACE_SUGGEST_HISTORY
    || resolve(process.cwd(), '.spec-workspace', '.cache', 'suggestion-history.jsonl');
}

function loadHistory(file) {
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

if (process.env.TRACE_DISABLED === '1') process.exit(0);

const traceFile = resolveTraceFile();
const historyFile = resolveHistoryFile();

const events = [];
for (const f of listRotatedFiles(traceFile)) {
  for (const e of readSpans(f)) events.push(e);
}

const pairs = pairSpans(events);
const findings = evaluate(pairs);
const history = loadHistory(historyFile);
const filtered = applyCooldown(findings, history);

if (filtered.length === 0) process.exit(0);

const out = filtered.map(formatSuggestion).join('\n\n');
process.stdout.write(out + '\n');
```

- [ ] **Step 9: chmod + run test, confirm pass**

```bash
chmod +x bin/trace-suggest.mjs
node --test tests/unit/trace-suggest.test.mjs 2>&1 | tail -15
node --test tests/unit/trace-rules.test.mjs 2>&1 | tail -10
```

Expected: PASS on both.

- [ ] **Step 10: Commit with [skip-bump]**

```bash
git add bin/lib/trace/rules.mjs bin/trace-suggest.mjs tests/unit/trace-rules.test.mjs tests/unit/trace-suggest.test.mjs tests/fixtures/trace/rules-sample.jsonl
git commit -m "feat(tracing): add four-rule suggester with 7-day cooldown [skip-bump]"
```

---

## Task 3: `bin/trace-analyze.mjs` — analyzer CLI with 4 query modes

**Files:**
- Create: `bin/trace-analyze.mjs`
- Test: `tests/unit/trace-analyze.test.mjs`

Four query modes:
- `--by-agent` — table per agent_role: n, p50_ms, p95_ms, retry_rate, escalation_rate
- `--by-phase` — table per (service:phase_num): n, p50_ms, p95_ms
- `--by-task <slug>` — full span tree of that task (workflow → phase → dispatch indented)
- `--trends --window 30d` — week-over-week deltas of dispatches by agent_role

- [ ] **Step 1: Write the failing test**

Create `tests/unit/trace-analyze.test.mjs`:

```javascript
// tests/unit/trace-analyze.test.mjs
//
// Run: `node --test tests/unit/trace-analyze.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'bin/trace-analyze.mjs');
const FIX_AGG = join(ROOT, 'tests/fixtures/trace/aggregate-sample.jsonl');

let dir;
let file;

function run(args, env = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TRACE_FILE: file, ...env },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'analyze-'));
  file = join(dir, '.traces/spans.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(FIX_AGG, file);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bin/trace-analyze.mjs', () => {
  test('--by-agent shows table with implementer + test-writer rows', () => {
    const r = run(['--by-agent']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /agent_role/i);
    assert.match(r.stdout, /implementer/);
    assert.match(r.stdout, /test-writer/);
    assert.match(r.stdout, /retry_rate|p95/i);
  });

  test('--by-phase shows phase rows keyed by service:phase_num', () => {
    const r = run(['--by-phase']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /svc-x.*1|svc-x:1/);
  });

  test('--by-task shows tree of one task', () => {
    const r = run(['--by-task', 'alpha']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /execute_task/);
    assert.match(r.stdout, /phase/);
    assert.match(r.stdout, /agent_dispatch/);
    assert.match(r.stdout, /implementer/);
  });

  test('--by-task with unknown slug returns empty + non-error', () => {
    const r = run(['--by-task', 'nonexistent']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no spans found|empty/i);
  });

  test('--trends shows week-over-week dispatch counts', () => {
    const r = run(['--trends']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /week|trend|dispatches/i);
  });

  test('no flag prints usage and exits 1', () => {
    const r = run([]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /usage|--by-agent|--by-phase/i);
  });

  test('missing trace file: exits 0, reports empty', () => {
    rmSync(file);
    const r = run(['--by-agent']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no.*data|empty/i);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

```bash
node --test tests/unit/trace-analyze.test.mjs 2>&1 | tail -15
```

- [ ] **Step 3: Create `bin/trace-analyze.mjs`**

Create `bin/trace-analyze.mjs`:

```javascript
#!/usr/bin/env node
// bin/trace-analyze.mjs — query the workspace trace store.
//
// Modes:
//   --by-agent              table per agent_role
//   --by-phase              table per service:phase_num
//   --by-task <slug>        span tree of one task
//   --trends [--window 30d] week-over-week dispatch counts per agent
//
// Inputs (env):
//   TRACE_FILE  workspace spans.jsonl (default <cwd>/.traces/spans.jsonl)
//
// Output: human-readable tables/trees on stdout.
// Exit codes:
//   0  query produced output (or empty result)
//   1  invalid args

import { resolve } from 'node:path';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import {
  pairSpans, groupByAgent, groupByPhase, percentile, retryRate,
} from './lib/trace/aggregate.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function resolveTraceFile() {
  return process.env.TRACE_FILE
    || resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function loadPairs() {
  const events = [];
  for (const f of listRotatedFiles(resolveTraceFile())) {
    for (const e of readSpans(f)) events.push(e);
  }
  return pairSpans(events);
}

function fmt(n, suffix = '') {
  if (n === 0) return '0' + suffix;
  if (n < 1000) return n.toFixed(0) + suffix;
  if (n < 60000) return (n / 1000).toFixed(1) + 's';
  return (n / 60000).toFixed(1) + 'm';
}

function byAgent(pairs) {
  const grouped = groupByAgent(pairs);
  if (Object.keys(grouped).length === 0) {
    process.stdout.write('No agent_dispatch data found.\n');
    return;
  }
  process.stdout.write('agent_role       n   p50      p95      retry_rate  escalation_rate\n');
  process.stdout.write('---------------- --- -------- -------- ----------- ----------------\n');
  for (const [role, ps] of Object.entries(grouped)) {
    const durations = ps.map(p => p.duration_ms);
    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    const rate = retryRate(ps);
    const escalated = ps.filter(p => p.end?.status === 'escalated' || p.end?.status === 'blocked').length;
    const escRate = escalated / ps.length;
    process.stdout.write(
      `${role.padEnd(16)} ${String(ps.length).padStart(3)} ${fmt(p50).padStart(8)} ${fmt(p95).padStart(8)} ` +
      `${(rate * 100).toFixed(0).padStart(10)}% ${(escRate * 100).toFixed(0).padStart(15)}%\n`
    );
  }
}

function byPhase(pairs) {
  const grouped = groupByPhase(pairs);
  if (Object.keys(grouped).length === 0) {
    process.stdout.write('No phase data found.\n');
    return;
  }
  process.stdout.write('service:phase    n   p50      p95\n');
  process.stdout.write('---------------- --- -------- --------\n');
  for (const [key, ps] of Object.entries(grouped)) {
    const durations = ps.map(p => p.duration_ms);
    process.stdout.write(
      `${key.padEnd(16)} ${String(ps.length).padStart(3)} ` +
      `${fmt(percentile(durations, 50)).padStart(8)} ${fmt(percentile(durations, 95)).padStart(8)}\n`
    );
  }
}

function byTask(pairs, slug) {
  const taskPairs = pairs.filter(p => p.start.task_slug === slug);
  if (taskPairs.length === 0) {
    process.stdout.write(`No spans found for task '${slug}'.\n`);
    return;
  }
  // Print a tree: workflow at root, phases as children, dispatches as grandchildren.
  const byParent = new Map();
  for (const p of taskPairs) {
    const parent = p.start.parent_span_id || 'ROOT';
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(p);
  }
  function emit(parent, depth) {
    const children = byParent.get(parent) || [];
    for (const p of children) {
      const indent = '  '.repeat(depth);
      const attrs = p.end?.attrs ? ` (${Object.entries(p.end.attrs).map(([k, v]) => `${k}=${v}`).join(', ')})` : '';
      process.stdout.write(
        `${indent}${p.start.name}` +
        (p.start.agent_role ? `:${p.start.agent_role}` : '') +
        ` ${fmt(p.duration_ms)} ${p.end?.status || '?'}${attrs}\n`
      );
      emit(p.start.span_id, depth + 1);
    }
  }
  emit('ROOT', 0);
}

function trends(pairs) {
  const grouped = groupByAgent(pairs);
  if (Object.keys(grouped).length === 0) {
    process.stdout.write('No data for trends.\n');
    return;
  }
  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  process.stdout.write('agent_role       this_week  last_week  delta\n');
  process.stdout.write('---------------- --------- --------- ------\n');
  for (const [role, ps] of Object.entries(grouped)) {
    let thisWeek = 0;
    let lastWeek = 0;
    for (const p of ps) {
      const ts = new Date(p.end?.ts || p.start.ts).getTime();
      if (now - ts < WEEK_MS) thisWeek += 1;
      else if (now - ts < 2 * WEEK_MS) lastWeek += 1;
    }
    const delta = thisWeek - lastWeek;
    const sign = delta > 0 ? '+' : '';
    process.stdout.write(
      `${role.padEnd(16)} ${String(thisWeek).padStart(9)} ${String(lastWeek).padStart(9)} ` +
      `${sign}${String(delta).padStart(5)}\n`
    );
  }
}

const args = parseArgs(process.argv.slice(2));
const pairs = loadPairs();

if (args['by-agent']) {
  byAgent(pairs);
} else if (args['by-phase']) {
  byPhase(pairs);
} else if (args['by-task']) {
  byTask(pairs, args['by-task']);
} else if (args['trends']) {
  trends(pairs);
} else {
  process.stderr.write(
    'usage: trace-analyze.mjs [--by-agent | --by-phase | --by-task <slug> | --trends]\n');
  process.exit(1);
}
```

- [ ] **Step 4: chmod + run, confirm pass**

```bash
chmod +x bin/trace-analyze.mjs
node --test tests/unit/trace-analyze.test.mjs 2>&1 | tail -15
```

Expected: PASS, all tests.

- [ ] **Step 5: Commit with [skip-bump]**

```bash
git add bin/trace-analyze.mjs tests/unit/trace-analyze.test.mjs
git commit -m "feat(tracing): add trace-analyze CLI with --by-agent/phase/task/trends [skip-bump]"
```

---

## Task 4: Wire suggester into Step 0.5 of heavy workflows

**Files:**
- Modify: `jelou/workflows/execute-task.md`
- Modify: `jelou/workflows/refine-task.md`
- Modify: `jelou/workflows/create-pr.md`
- Extend: `tests/unit/trace-workflow-instrumentation.test.mjs`

After the existing reconcile call (added in Phase 2), insert a suggester invocation that prints any active suggestions to terminal. The orchestrator must surface them to the user via `AskUserQuestion` (Claude) / `question` (OpenCode) for `y/n` approval. Approved/declined actions append to `.spec-workspace/.cache/suggestion-history.jsonl`.

- [ ] **Step 1: Extend the structural test**

Append to `tests/unit/trace-workflow-instrumentation.test.mjs`:

```javascript

describe('suggester wired into Step 0.5 of heavy workflows', () => {
  const heavy = ['execute-task', 'refine-task', 'create-pr'];
  for (const name of heavy) {
    test(`${name} invokes bin/trace-suggest.mjs after reconcile`, () => {
      const wf = read(`jelou/workflows/${name}.md`);
      assert.match(wf, /trace-suggest\.mjs/,
        `${name} must invoke bin/trace-suggest.mjs at Step 0.5`);
    });

    test(`${name} documents y/n approval + suggestion-history.jsonl`, () => {
      const wf = read(`jelou/workflows/${name}.md`);
      assert.match(wf, /suggestion-history\.jsonl|y\/n approval/);
    });
  }
});
```

- [ ] **Step 2: Confirm test fails for the three workflows**

```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -20
```

Expected: 6 new failures (3 workflows × 2 assertions each).

- [ ] **Step 3: Edit each of the three workflow files**

For `execute-task.md`, `refine-task.md`, `create-pr.md` — locate the existing Phase 2 reconcile block (look for `trace-reconcile.mjs`). IMMEDIATELY AFTER the reconcile call, insert this suggester block (adjust the leading sub-step numbering to fit each workflow's structure):

```markdown
### Step 0.5b — Surface suggestions from prior runs

Run the suggester. It scans recent trace history and emits one SUGGEST block per active rule that fires (4 possible rules: bump model tier, extend failure patterns, suggest parallelization, immediate flag on blocked spans). The 7-day cooldown is honored automatically.

```bash
SUGGESTIONS=$(node "${PLUGIN_ROOT:-.}/bin/trace-suggest.mjs" 2>/dev/null || true)
```

If `SUGGESTIONS` is non-empty:

1. Display each SUGGEST block to the user (one at a time) via `question` (OpenCode) / `AskUserQuestion` (Claude Code).
2. For each, accept `y` (approve) or `n` (decline). Approval triggers the action (e.g., setting MODEL_CONFIG override, or queuing a `/jlu-add-failure-pattern` call). Decline silently dismisses the suggestion.
3. Append a JSONL record to `<WORKSPACE>/.spec-workspace/.cache/suggestion-history.jsonl` for EACH decision (approved or declined). The record shape:

   ```json
   {"rule_id":"<id>","signature":"<sig>","action":"approved"|"declined","ts":"<iso8601>"}
   ```

   Both approved and declined actions start the 7-day cooldown, so the user is not re-prompted for the same finding immediately after responding.

If `SUGGESTIONS` is empty, continue silently — no findings means no friction.

Tracing is best-effort: if `bin/trace-suggest.mjs` errors out, the empty `SUGGESTIONS` variable means the workflow simply continues without prompts.
```

- [ ] **Step 4: Run structural test, confirm pass**

```bash
node --test tests/unit/trace-workflow-instrumentation.test.mjs 2>&1 | tail -15
```

Expected: PASS (all blocks including the 3 new describe entries).

- [ ] **Step 5: Run full suite to confirm no regression**

```bash
npm test 2>&1 | tail -8
```

Expected: full suite green.

- [ ] **Step 6: Commit with [skip-bump]**

```bash
git add jelou/workflows/execute-task.md jelou/workflows/refine-task.md jelou/workflows/create-pr.md tests/unit/trace-workflow-instrumentation.test.mjs
git commit -m "feat(tracing): wire suggester into Step 0.5 of execute-task/refine-task/create-pr [skip-bump]"
```

---

## Task 5: `/jlu-trace-report` skill + workflow + OpenCode mirror

**Files:**
- Create: `skills/trace-report/SKILL.md`
- Create: `.opencode/commands/jlu-trace-report.md`
- Create: `jelou/workflows/trace-report.md`

User-facing entry point for the analyzer. Follows the existing dual-runtime contract (see `jelou/references/claude-code-runtime.md` and existing skills like `skills/test-suite/SKILL.md` for the pattern).

- [ ] **Step 1: Inspect an existing skill for format reference**

```bash
ls skills/test-suite/ skills/logs/ 2>/dev/null
head -30 skills/test-suite/SKILL.md
head -30 .opencode/commands/jlu-test-suite.md
head -30 jelou/workflows/test-suite.md
```

These exemplify the skill / OpenCode-command / shared-workflow trio used by simple read-only skills.

- [ ] **Step 2: Create `jelou/workflows/trace-report.md`**

```markdown
# Workflow: trace-report

> Workflow for `/jlu-trace-report [--by-agent | --by-phase | --by-task <slug> | --trends]`
> Read-only analysis of the workspace trace store.

## Step 1 — Resolve mode

If invoked without arguments, ask via `question` / `AskUserQuestion`:

- "Which trace view do you want?"
  - A) By agent (retry rates, p50/p95 per agent_role)
  - B) By phase (per service:phase_num durations)
  - C) By task (full span tree of one task — requires task slug)
  - D) Trends (week-over-week dispatch counts per agent)

If invoked with one of the explicit flags (`--by-agent`, `--by-phase`, `--by-task <slug>`, `--trends`), skip the question and use it directly.

## Step 2 — Invoke the analyzer

Translate the chosen mode to a flag and run:

```bash
node "${PLUGIN_ROOT:-.}/bin/trace-analyze.mjs" <flag>
```

Print the stdout to the user verbatim. The analyzer exits 0 on empty stores (with a "no data found" line) and 1 on invalid args.

## Step 3 — Done

This is a read-only skill. No state is written. Tracing remains best-effort — if the trace store is missing or unreadable, the user sees a "no data" message and the workflow exits cleanly.
```

- [ ] **Step 3: Create `skills/trace-report/SKILL.md`**

```markdown
---
name: trace-report
description: Use to inspect the workspace trace store — per-agent / per-phase / per-task / trends. Read-only. Triggers - "trace report", "show traces", "trace analytics", "tracing dashboard"
argument-hint: "[--by-agent | --by-phase | --by-task <slug> | --trends]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

You are the orchestrator for the `/jlu-trace-report` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (`<plugin-root>/skills/trace-report/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion`.
- Never narrate questions as plain text.

## Phase 2 — Read and execute the workflow

Read `<PLUGIN_ROOT>/jelou/workflows/trace-report.md` and execute it exactly. The workflow drives the user-facing flow; this SKILL.md is a thin launcher.

Command arguments: $ARGUMENTS
Current directory is the workspace working directory.
```

- [ ] **Step 4: Create `.opencode/commands/jlu-trace-report.md`**

```markdown
---
description: Inspect the workspace trace store (per-agent / per-phase / per-task / trends)
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/trace-report.md` (global install preferred)
2. `jelou/workflows/trace-report.md` (project-local fallback)

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the workspace working directory.

Use `question` for user prompts (OpenCode equivalent of question).
```

- [ ] **Step 5: Run sync-agents check (skills get mirrored too)**

```bash
node bin/sync-agents.mjs --check 2>&1 | tail -3
```

If the check fails because new skill files were added but mirrors are missing, run:

```bash
node bin/sync-agents.mjs
node bin/sync-agents.mjs --check
```

Expected: clean exit 0 after sync.

- [ ] **Step 6: Quick manual sanity check that the analyzer is invokable from a typical workspace path**

```bash
node bin/trace-analyze.mjs --by-agent 2>&1 | head -5
```

Expected: "No agent_dispatch data found." (or actual data if running in a workspace with traces).

- [ ] **Step 7: Commit with [skip-bump]**

```bash
git add skills/trace-report/ .opencode/commands/jlu-trace-report.md jelou/workflows/trace-report.md
git commit -m "feat(tracing): add /jlu-trace-report skill for workspace trace analysis [skip-bump]"
```

---

## Task 6: Integration test — seed 15 runs, verify bump_model_tier emission

**Files:**
- Create: `tests/integration/trace-suggester-end-to-end.test.mjs`

End-to-end verification that the suggester actually emits the right finding given a realistic trace.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/trace-suggester-end-to-end.test.mjs`:

```javascript
// tests/integration/trace-suggester-end-to-end.test.mjs
//
// Seed a synthetic 15-run trace store with 30% retry rate on implementer,
// run the suggester, verify it emits bump_model_tier with correct evidence.
//
// Run: `node --test tests/integration/trace-suggester-end-to-end.test.mjs`

import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SUGGEST = join(ROOT, 'bin/trace-suggest.mjs');

let dir;
let traceFile;
let historyFile;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suggester-e2e-'));
  traceFile = join(dir, '.traces/spans.jsonl');
  historyFile = join(dir, '.spec-workspace/.cache/suggestion-history.jsonl');
  mkdirSync(dirname(traceFile), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seedRuns(file, count, retryRateTarget) {
  const lines = [];
  const retriesNeeded = Math.round(count * retryRateTarget);
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.now() - (count - i) * 1000).toISOString();
    const retry_count = i < retriesNeeded ? 1 : 0;
    lines.push(JSON.stringify({
      ts, event_kind: 'span_start',
      span_id: `S${i}`, trace_id: `T${i}`,
      scope: 'task', name: 'agent_dispatch',
      task_slug: `task-${i}`, service_id: 'svc-x', phase_num: 1,
      agent_role: 'implementer',
    }));
    lines.push(JSON.stringify({
      ts: new Date(Date.now() - (count - i) * 1000 + 60000).toISOString(),
      event_kind: 'span_end',
      span_id: `S${i}`, trace_id: `T${i}`,
      scope: 'task', name: 'agent_dispatch',
      agent_role: 'implementer',
      status: 'ok', duration_ms: 60000,
      attrs: { retry_count, diff_size_loc: 50 },
    }));
  }
  writeFileSync(file, lines.join('\n') + '\n');
}

describe('suggester end-to-end against synthetic trace store', () => {
  test('15 runs with 30% retry rate emits bump_model_tier for implementer', () => {
    seedRuns(traceFile, 15, 0.30);
    const r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SUGGEST \[bump_model_tier\]/);
    assert.match(r.stdout, /implementer/);
    assert.match(r.stdout, /30%/);
  });

  test('15 runs with 10% retry rate does NOT emit bump_model_tier', () => {
    seedRuns(traceFile, 15, 0.10);
    const r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /bump_model_tier/);
  });

  test('cooldown: declining a suggestion suppresses it on the next run', () => {
    seedRuns(traceFile, 15, 0.30);
    // First run — should emit
    let r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.match(r.stdout, /bump_model_tier/);
    // Simulate user declining: write history entry
    mkdirSync(dirname(historyFile), { recursive: true });
    writeFileSync(historyFile,
      JSON.stringify({
        rule_id: 'bump_model_tier', signature: 'implementer',
        action: 'declined', ts: new Date().toISOString(),
      }) + '\n');
    // Second run — should be silent
    r = spawnSync('node', [SUGGEST], {
      encoding: 'utf8',
      env: {
        ...process.env,
        TRACE_FILE: traceFile,
        TRACE_SUGGEST_HISTORY: historyFile,
      },
    });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /SUGGEST \[bump_model_tier\][^\n]*implementer/);
  });
});
```

- [ ] **Step 2: Run the integration test**

```bash
node --test tests/integration/trace-suggester-end-to-end.test.mjs 2>&1 | tail -15
```

Expected: 3 tests pass.

- [ ] **Step 3: Run all integration tests together**

```bash
node --test tests/integration/*.test.mjs 2>&1 | tail -10
```

Expected: 7 (Phase 1+2) + 3 (Phase 3) = 10 integration tests pass.

- [ ] **Step 4: Commit with [skip-bump]**

```bash
git add tests/integration/trace-suggester-end-to-end.test.mjs
git commit -m "test(tracing): integration test — suggester emits bump_model_tier on 30% retry rate [skip-bump]"
```

---

## Task 7: README update + CHANGELOG + final verify

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README "Tracing & Observability" section**

In `README.md`, find the "Tracing & Observability" section. Two updates:

**a)** Update the CLIs table to add the new ones:

Add rows after the existing three:

```markdown
| `bin/trace-analyze.mjs` | Read-side query: `--by-agent` / `--by-phase` / `--by-task <slug>` / `--trends` | tabular output on stdout |
| `bin/trace-suggest.mjs` | Scan recent traces, emit blocking suggestions per the four rules | one SUGGEST block per finding |
```

**b)** Replace the "What's coming next" subsection with a "Status: complete" subsection and add a `/jlu-trace-report` usage example:

Find:
```markdown
### What's coming next

- **Phase 2** will instrument the six lifecycle workflows ...
- **Phase 3** will ship `bin/trace-analyze.mjs` ...
```

Replace with:

```markdown
### Reading the trace store

Use the `/jlu-trace-report` skill to inspect the workspace traces:

```bash
/jlu-trace-report --by-agent
# agent_role       n   p50      p95      retry_rate  escalation_rate
# implementer      14  62.0s    140.0s   21%         0%
# test-writer      8   28.0s    35.0s    0%          0%
# qa-agent         5   18.0s    24.0s    0%          0%
```

Other modes: `--by-phase`, `--by-task <slug>`, `--trends`.

### Suggestions before heavy workflows

The three heavy workflows (`/jlu-execute-task`, `/jlu-refine-task`, `/jlu-create-pr`) run the suggester at Step 0.5 right after the reconciler. The suggester applies four rules over recent traces:

- **`bump_model_tier`** — agent retry rate > 20% over last 10 dispatches → suggests upgrading that agent's model tier
- **`extend_patterns`** — same `error_signature` ≥ 3x in 30 days → suggests adding it to the daemon's failure-pattern matcher via `/jlu-add-failure-pattern`
- **`suggest_parallelize`** — phase p95 / median > 3.0× → suggests enabling per-service-parallel waves
- **`immediate_flag`** — any blocked/failed span in last 24h → surfaces it for review

Each suggestion is presented as a single `y/n` question with inline evidence (trace_ids, retry counts, error signatures). User responses persist to `.spec-workspace/.cache/suggestion-history.jsonl` with a 7-day cooldown per `(rule, signature)` pair — same finding never re-prompts within a week.
```

- [ ] **Step 2: Add CHANGELOG entry at the top**

Insert after `# Changelog` header, before any existing version block:

```markdown
## [0.3.167] — 2026-05-24

### Added

- **Tracing analyzer + suggester + skill (Phase 3 of the harness-engineering observability layer — closes the loop).** New `bin/trace-analyze.mjs` CLI with four query modes (`--by-agent`, `--by-phase`, `--by-task <slug>`, `--trends`) reads the workspace `spans.jsonl` and prints tabular summaries: agents with their p50/p95 durations, retry rate, and escalation rate; phases keyed by `service:phase_num`; the full span tree of one task; and week-over-week trend deltas. New `bin/trace-suggest.mjs` CLI applies four rules over recent traces with a 7-day cooldown: `bump_model_tier` (agent retry rate > 20% over last 10 dispatches), `extend_patterns` (error_signature ≥ 3 occurrences across 30 days), `suggest_parallelize` (phase p95/median > 3.0× over last 10), `immediate_flag` (any blocked/failed span in last 24h). The suggester is wired into the existing `Step 0.5` block of the three heavy workflows (`execute-task`, `refine-task`, `create-pr`) — right after the Phase 2 reconcile call — so suggestions surface before each workflow runs. Approved and declined responses persist to `.spec-workspace/.cache/suggestion-history.jsonl` with `(rule_id, signature)` keying.
- **`/jlu-trace-report` skill** (`skills/trace-report/SKILL.md` + `.opencode/commands/jlu-trace-report.md` + `jelou/workflows/trace-report.md`) — interactive launcher that asks which view (by-agent / by-phase / by-task / trends) and invokes `bin/trace-analyze.mjs`. Read-only; no state written.
- **`bin/lib/trace/aggregate.mjs`** — pure aggregation helpers shared between analyzer and suggester (`pairSpans`, `groupByTrace`, `groupByAgent`, `groupByPhase`, `percentile`, `retryRate`). Stdlib only, no I/O.
- **`bin/lib/trace/rules.mjs`** — the four rules as data + a generic `evaluate(pairs)` entry point + `applyCooldown(findings, history)` + `formatSuggestion(finding)`. Thresholds (retry-rate 0.20, parallelize ratio 3.0, pattern occurrences 3, blocked lookback 24h, pattern lookback 30d) are module-scope constants — tunable without touching call sites.
- **Tests**: 4 new unit test files (aggregate, rules, analyze, suggest) totaling ~40 new unit tests; 1 new integration test file (suggester end-to-end with synthetic 15-run trace store + cooldown verification). Full unit suite expected ~560+, integration suite expected ~10.

### Internal

- The 23 agent prompts under `agents/` are byte-identical to prior main. Phase 3 adds analyzer + suggester + skill on top of Phase 2's instrumentation; subagents are not touched.
- The dual-runtime contract for the new skill follows the existing pattern: shared workflow at `jelou/workflows/trace-report.md`, Claude Code launcher at `skills/trace-report/SKILL.md`, OpenCode launcher at `.opencode/commands/jlu-trace-report.md`.
```

- [ ] **Step 3: Final verification**

```bash
npm test 2>&1 | tail -8
node --test tests/integration/*.test.mjs 2>&1 | tail -8
node bin/sync-agents.mjs --check 2>&1 | tail -3
git diff main..HEAD -- agents/ .opencode/agents/ | wc -l
grep '"version"' package.json
```

Expected:
- Unit suite: ~560+ passing (520 from main + ~40 new)
- Integration suite: ~10 passing (7 from main + 3 new)
- sync-agents check: exit 0
- agents/ diff: 0 lines
- package.json version: 0.3.167 (consolidated via [skip-bump] discipline) OR 0.3.166 if no version bump fired (since every commit had [skip-bump])

If version is still 0.3.166, bump it once now to 0.3.167:

```bash
# Edit package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json
# Change "0.3.166" to "0.3.167" in all three files
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(release): bump to 0.3.167 for Phase 3 [allow-jump]"
```

The `[allow-jump]` marker is used because the hook would otherwise see "no staged version change yet" and try to bump itself; `[allow-jump]` bypasses any validation.

Actually simpler — if every commit on the branch had `[skip-bump]`, the version files are still at 0.3.166 (untouched). The PR landing on main is the appropriate trigger for the final bump, which is handled by the merge-time machinery. If the maintainer wants the branch to end at 0.3.167, do the manual bump above before opening the PR.

- [ ] **Step 4: Commit README + CHANGELOG**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(tracing): document analyzer, suggester, and /jlu-trace-report (Phase 3) [skip-bump]"
```

- [ ] **Step 5: Verify branch is ready for PR**

```bash
git status --short
git log --oneline main..HEAD | head -20
```

Expected: clean working tree; 7-9 commits ahead of main (Tasks 1-6 + this final docs commit + optional final bump).

---

## Phase 3 — Self-Review Checklist

Before opening the PR:

1. **Spec coverage** — Every Phase-3 item from the spec is implemented:
   - ✅ `bin/trace-analyze.mjs` with `--by-agent`, `--by-phase`, `--by-task <slug>`, `--trends`
   - ✅ `bin/trace-suggest.mjs` with the four rules + 7-day cooldown
   - ✅ `skills/trace-report/SKILL.md` + OpenCode mirror + shared workflow
   - ✅ Suggester wired into `Step 0.5` of execute-task / refine-task / create-pr
   - ✅ Integration test (seed 15 runs → assert `bump_model_tier`)
   - ✅ README "Tracing & Observability" section updated

2. **Test count** — Approximately:
   - Aggregate: ~12 tests
   - Rules: ~12 tests
   - Analyze CLI: ~7 tests
   - Suggest CLI: ~5 tests
   - Workflow structural extension: ~6 tests
   - Integration: 3 tests
   - **Total**: ~45 new tests

3. **Zero regression** — `npm test` green, `sync-agents --check` green, all integration tests green, agents unchanged.

4. **Version is sequential** — final branch version is exactly `main + 1 patch` (0.3.167) OR remains at `main` (0.3.166) depending on whether the final bump is left to merge-time machinery.

If any item is missing or red, fix before opening the PR.

---

## Out of scope (deferred to future phases)

These were mentioned in the original 5-gap list (post-Phase-3 wishlist) but are NOT in Phase 3:

- **Phase 4 — Eval harness**: a benchmark suite that runs the orchestrator against known cases and scores success rates. Without this, suggester decisions and harness tweaks can't be measured.
- **Phase 5 — Falsifiable predictions**: each commit that touches `agents/`, `jelou/workflows/`, or `jelou/references/` carries a prediction set; the next run verifies and reverts disconfirmed edits. Depends on Phase 4.
- **Phase 6 — Cost telemetry**: schema reserves `attrs.tokens_in` and `attrs.cost_usd`; nothing captures them today.
- **Phase 6 — Cross-task long-term memory**: per-workflow patterns extracted from closed-task snapshots and injected into future workflow prompts. Phase 3's cooldown is the rudimentary version.
- **Phase 7 — Replay**: deterministic re-execution of a phase from its trace.

Each of these would get its own spec + plan + PR cycle if/when adopted.
