# Tracing & Observability — Harness Engineering Design

> Status: Draft for plan
> Date: 2026-05-23
> Companion features: `/jlu-trace-report`, instrumented `/jlu-execute-task`, `/jlu-new-task`, `/jlu-refine-task`, `/jlu-create-pr`, `/jlu-report-task`, `/jlu-close-task`, instrumented dev-env daemon

## Goal

Add a plugin-native tracing and observability layer so every workflow invocation, phase, and agent dispatch leaves a structured span trail. The plugin can then (a) surface bottlenecks and retry hot spots on demand, (b) emit blocking suggestions before each heavy workflow when trace evidence points to a fixable cost — model tier bumps, new failure patterns to register, or phases worth parallelizing. Coverage spans the entire task lifecycle (`new-task → refine-task → execute-task → create-pr → report-task → close-task`) and folds the existing dev-environment daemon’s event log into the same store.

The system follows the **harness engineering** pattern (2026 canon): three observable surfaces — Component (what ran), Experience (how it went), Decision (what changed and the prediction). V1 ships the Component and Experience surfaces and the analyze/suggest CLIs that exploit them. Decision surface (falsifiable predictions, auto-evolution) is explicitly out of scope V1 — see §8.

## Constraints (decided during brainstorm)

| Decision | Choice |
|----------|--------|
| Scope | Everything: full task lifecycle workflows + dev-env daemon — single trace store |
| Self-correction depth | Blocking suggestions before each workflow — orchestrator reads trace, prints suggestions, user approves `y/n`. No silent auto-apply |
| Format | Custom JSONL, plugin-native (consistent with existing `dev-events.log`). Schema is OTLP-shaped so a future exporter can ship without re-instrumenting |
| Layout | Single workspace JSONL at `<WORKSPACE>/.traces/spans.jsonl`, with `task_slug` as a span attribute. Rotation at 50MB → `spans-001.jsonl`, `.002.jsonl` |
| Granularity | 3 levels: workflow → phase → agent_dispatch. No intra-agent spans (bash/LLM tool calls inside an agent are not traced) |
| Architecture | A — Orchestrator-owned writer. Subagents (23 prompts) do not change. Orchestrator wraps dispatches and emits `agent_dispatch_start/end` |
| Signals | duration, status, agent_role, phase_num, service_id, model_used, retry_count, escalation_reason, diff_size_loc, error_signature |
| Suggestion rules | (a) retry_rate >20% → bump model tier; (b) error_signature ≥3 occurrences → extend `patterns.mjs`; (c) phase p95 >3× median → suggest parallelize; (d) any `status: blocked` → immediate flag |
| Suggestion cooldown | 7 days per (rule, signature). Persisted in `.spec-workspace/.cache/suggestion-history.jsonl` |
| Identifiers | ULID for `span_id` / `trace_id` (sortable by time, stdlib implementable, ~30 LOC, no deps) |
| Privacy | `.traces/` is gitignored by default. Error content is hashed into `error_signature`, not stored in clear |
| Disable knob | `TRACE_DISABLED=1` env var OR `.spec-workspace.json` `tracing.enabled: false` → emitter is no-op |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  EMISSION                                                       │
│  bin/lib/trace/emitter.mjs    (single writer, append-only)      │
│  · startSpan() / endSpan() / appendEvent() (programmatic API)   │
│  · CLI wrappers: bin/trace-start-span.mjs, trace-end-span.mjs   │
│  · Called from workflow .md instructions, bin/ scripts, daemon  │
│  · Workflow wraps each agent dispatch → emits agent_dispatch    │
│    start/end, parses subagent's existing JSON report for attrs  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  STORAGE                                                        │
│  <WORKSPACE>/.traces/spans.jsonl    (single source of truth)    │
│  · Rotation: 50MB → spans-001.jsonl, .002.jsonl, …              │
│  · gitignored by default; opt-in commit                         │
│  · OTLP-shaped schema (see §3) — line-delimited JSON            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
┌────────────────────────┐   ┌────────────────────────────────────┐
│  ANALYSIS              │   │  SUGGESTION                        │
│  bin/trace-analyze.mjs │   │  bin/trace-suggest.mjs             │
│  · /jlu-trace-report   │   │  · Runs at Step 0.5 of:            │
│  · --by-agent          │   │      execute-task, refine-task,    │
│  · --by-phase          │   │      create-pr                     │
│  · --by-task <slug>    │   │  · 4 rules (a/b/c/d) with cooldown │
│  · --trends --window   │   │  · Prints evidence inline,         │
│  · Read-only CLI       │   │    awaits user y/n approval        │
└────────────────────────┘   └────────────────────────────────────┘
```

**Single writer per process.** Each workflow invocation is an isolated process — no file locks needed. Daemon runs in its own long-lived process — same `O_APPEND` atomicity (writes < `PIPE_BUF` 4 KB).

**Subagents do not change.** The orchestrator wraps each Task tool dispatch: emits `agent_dispatch_start` before, parses the agent's standard JSON report (`status`, `outcome`, `risks`, `next_actions`, `artifacts`) on return, emits `agent_dispatch_end` with status / retries / diff_size / error_signature extracted. The 23 agent prompts under `agents/` and the mirror `.opencode/agents/` are untouched.

**Dev-env daemon.** `bin/lib/dev-orchestrator/events.mjs` is refactored to delegate to `bin/lib/trace/emitter.mjs`. Every existing `EVENT_TYPE` continues to produce an equivalent entry in `spans.jsonl` (effective spans with `scope: "daemon"`, no `task_slug`, no `phase_num`). `dev-events.log` remains as a symlink to `spans.jsonl` for one release for any external tool reading it.

**Task close.** `/jlu-close-task` snapshots that task's spans (filter by `task_slug`) to `<TASK_DIR>/_traces/snapshot.jsonl` and may opt-in purge them from the workspace store via `--purge-trace`.

## Span Schema

Each line in the JSONL is one event. Three `event_kind` values: `span_start`, `span_end`, `event` (discrete with no duration, e.g., `pattern_match`).

**Base shape (all events):**

```json
{
  "ts": "2026-05-23T14:22:01.456Z",
  "event_kind": "span_start | span_end | event",
  "span_id": "01HXY7K2…",
  "parent_span_id": "01HXY7K1…",
  "trace_id": "01HXY7K0…",
  "scope": "task | daemon | global",
  "name": "execute_task | phase | agent_dispatch | classify_phase | …",
  "task_slug": "fix-mcp-tier-b",
  "service_id": "workflow-engine",
  "phase_num": 3,
  "agent_role": "implementer",
  "attrs": { "...": "name-specific attrs" }
}
```

Required at all levels: `ts`, `event_kind`, `span_id`, `trace_id`, `scope`, `name`. `parent_span_id` is omitted on the root span of a trace.

Optional, only set when applicable to the span level:
- `task_slug` — present on all `scope: "task"` spans.
- `service_id` — present on phase and agent spans when scoped to a service.
- `phase_num` — present on phase and agent spans inside a phase.
- `agent_role` — present only on `agent_dispatch` spans.

**`span_end` attrs (canonical):**

```json
{
  "event_kind": "span_end",
  "span_id": "01HXY7K2…",
  "duration_ms": 12450,
  "status": "ok | blocked | failed | escalated | orphaned",
  "attrs": {
    "model_used": "sonnet",
    "retry_count": 2,
    "escalation_reason": "five_strike_blocked",
    "diff_size_loc": 87,
    "error_signature": "a1b2c3d4",
    "outcome": "tests pass, 3 files modified",
    "artifacts": ["src/foo.ts", "tests/foo.test.ts"]
  }
}
```

`attrs` is open — adding fields does not break existing parsers. Canon keys are the ones above; everything else is additive.

**Example trace tree** (`/jlu-execute-task`, 1 phase, 2 dispatches):

```
trace_id=T1
└─ span: execute_task            scope=task task=fix-mcp ⏱245s status=ok
   └─ span: phase phase_num=3    service=workflow-engine ⏱198s status=ok
      ├─ span: agent_dispatch    agent=test-writer model=sonnet ⏱42s status=ok retries=0
      │  attrs: { diff_size_loc: 28, artifacts: [...] }
      └─ span: agent_dispatch    agent=implementer model=sonnet ⏱121s status=ok retries=1
         attrs: { diff_size_loc: 87, retry_count: 1, error_signature: "a1b2c3d4" }
```

In the JSONL this is 6 lines (3 `span_start` + 3 `span_end`), one per line, not nested.

## Suggestion Rules

All rules evaluate on a window of the **last N=10 traces** (filtered by trace root completion). Window is configurable via env `TRACE_SUGGEST_WINDOW`. The window threshold itself gates output: if fewer than 10 completed traces exist, suggester runs silent (no false positives on fresh workspaces).

| Rule | Formula | Suggestion |
|------|---------|------------|
| (a) bump_model_tier | for each `agent_role`: `sum(retry_count) / count(dispatches) > 0.20` | "set MODEL_CONFIG.<group> = <next tier> for this task" |
| (b) extend_patterns | `count(spans where error_signature == X) ≥ 3` across last 30d | "register error_signature X as a known failure pattern via `/jlu-add-failure-pattern`" |
| (c) suggest_parallelize | for each `(phase_num, service_id)`: `p95(duration_ms) / median(duration_ms) > 3.0` | "consider per-service-parallel waves for phase N (see `parallel-dispatch.md`)" |
| (d) immediate_flag | any span with `status == "blocked"` in last 24h | "phase X / agent Y blocked — review reports under `<TASK_DIR>/services/<svc>/phases/<NN>-reports/`" |

Each suggestion includes evidence inline:

```
SUGGEST [bump_model_tier] implementer has 30% retry rate (3/10 last runs)
  evidence: trace_ids S4, S12, S18 — error_signatures a1b2c3d4, a1b2c3d4, e5f6a7b8
  apply: set MODEL_CONFIG.code = opus for this task? (y/n)
```

User declines (`n`) → recorded to `.spec-workspace/.cache/suggestion-history.jsonl` with timestamp and optional reason → suggester respects a 7-day cooldown on that (rule, signature) pair.

## Data Flow — Orchestrator Wraps Agent Dispatches

Inside `execute-task.md` Step 7 (Phase Execution):

```
1. Orchestrator opens phase span
   ├─ Bash: node bin/trace-start-span.mjs \
   │    --name phase --task $TASK_SLUG \
   │    --service $SERVICE_ID --phase $PHASE_NUM \
   │    --parent $WORKFLOW_SPAN_ID
   │  → stdout: {"span_id":"S2","trace_id":"T1","parent":"S1"}
   ├─ Capture PHASE_SPAN_ID=S2
   │
2. Orchestrator dispatches test-writer agent
   ├─ Bash: node bin/trace-start-span.mjs \
   │    --name agent_dispatch --agent test-writer \
   │    --model sonnet --parent $PHASE_SPAN_ID
   │  → stdout: {"span_id":"S3", …}
   ├─ Task tool dispatch → agent runs → returns JSON report
   ├─ Orchestrator parses report.status, report.outcome, …
   ├─ Bash: node bin/trace-end-span.mjs \
   │    --span $AGENT_SPAN_ID --status ok --retries 0 \
   │    --outcome "tests written: 3 files" \
   │    --diff-size $(git diff --shortstat | parse-loc)
   │  → appends span_end with computed duration_ms
   │
3. Repeat for implementer (same pattern)
   │
4. Orchestrator closes phase span
   └─ Bash: node bin/trace-end-span.mjs --span $PHASE_SPAN_ID \
        --status $PHASE_OUTCOME
```

Workflow .md changes are confined to:
- A `Step 0.5 — Trace bootstrap` near the top of each workflow (open workflow-level span, run reconcile, run suggester).
- Per-phase / per-dispatch start/end blocks in `execute-task.md`.
- A `Step N — Close workflow span` at the end of each workflow.

**Subagent contract unchanged.** Their JSON report is the input the orchestrator parses for `span_end` attrs.

**Suggestion trigger placement** — `Step 0.5` of the heavier workflows runs:
```
node bin/trace-reconcile.mjs  # sweep orphans first
node bin/trace-suggest.mjs --task $TASK_SLUG --window 10
```
If suggestions exist, they print to terminal and the orchestrator asks `y/n` per suggestion. Approved suggestions persist to `.spec-workspace/.cache/model-overrides.json` (rule a) or queue a `/jlu-add-failure-pattern` invocation (rule b) or surface as a planning note in Step 2 (rule c) or halt with explicit user acknowledgement (rule d).

## Error Handling and Robustness

**Principle: tracing is best-effort instrumentation, never a failure axis.**

| Failure | Symptom | Mitigation |
|---|---|---|
| `spans.jsonl` not writable | `start-span.mjs` exit ≠ 0 | Emitter logs warning to stderr, exits 0. Workflow continues without span_id (no-trace mode). Reconciler detects gaps on next run |
| `start-span.mjs` exit OK but parse fails | `PHASE_SPAN_ID` empty | Workflow checks `[ -z "$PHASE_SPAN_ID" ]` and skips matching `end-span`. Reconciler cleans up |
| `end-span.mjs` not called (kill, ctrl-C, exception) | orphan `span_start` | `bin/trace-reconcile.mjs` runs in Step 0.5. Detects spans with `ts < now() - 30min` lacking matching `span_end`, emits synthetic `span_end` with `status: "orphaned"` and `attrs.reconciled: true` |
| `span_id` collision in concurrent runs | two spans share id | ULID + 80 bits randomness → P(collision) < 10⁻¹⁵. Documented, no mitigation needed |
| Race on append between concurrent workflows | truncated line | Each append < `PIPE_BUF` (4 KB on Linux) is atomic via `O_APPEND`. Typical span payload ~600 bytes. Cap in emitter: if payload > 3.5 KB, drop `outcome`/`artifacts` before write |
| Daemon and workflow append simultaneously | same guarantees | Same `O_APPEND` semantics |
| Corrupt line in JSONL | analyzer/suggester crash | All readers wrap parse in `try { JSON.parse } catch { skip, log }`. One bad line never contaminates a report |
| Suggester false positive | user approves unneeded change | (1) `y/n` per suggestion, no auto-apply. (2) Evidence inline includes trace_ids. (3) Declines persist to `suggestion-history.jsonl` and trigger 7-day cooldown |
| Reconciler false orphan (slow live process) | premature `status: "orphaned"` | Threshold 30min is conservative; typical workflow < 15min. Env var `TRACE_RECONCILE_AFTER_MS` to extend |
| Workspace switches mid-trace | spans stay in old workspace | By design — each workspace is its own store. No cross-workspace correlation V1 |
| Parallel dispatch (H7) | tree completeness | Each wave opens a parent span; each phase in the wave inherits `parent = wave_span_id`. Documented in `jelou/references/parallel-dispatch.md` |

**Rollback knobs:**

- `TRACE_DISABLED=1` env var → all CLI wrappers exit 0 without writing; workflows tolerate empty span ids. Zero impact.
- `.spec-workspace.json` field `tracing: { enabled: false }` → same effect at workspace scope.
- Suggester only runs when `tracing.enabled !== false` AND `<WORKSPACE>/.traces/spans.jsonl` exists AND has ≥10 completed traces.
- A release may revert the suggester alone (remove `Step 0.5 — Suggest` from workflows) without de-instrumenting — emission and analysis are cleanly separated.

**Schema evolution:**
- `attrs` is free-form. Adding keys is non-breaking.
- For canon-breaking changes: introduce `schema_version: "v2"` per line. Readers handle both. No retroactive rewrite.

**Privacy:**
- `.traces/` is gitignored by default (added to repo `.gitignore` and recommended for workspace `.gitignore`).
- `error_signature` is a SHA-256[:8] of the normalized error message, not the raw error.
- Threat model: same sensitivity as `git log`. Local-only.

**Performance:**
- Emission: 1–2 ms per span (file append). Negligible vs any agent dispatch (>1s).
- Analyzer: O(N) full read. 1000 runs × 6 spans ≈ 6 KB lines × 600 bytes ≈ 3.5 MB. Parse < 50 ms.
- Suggester: reads last N=10 `trace_id`s in reverse, < 30 ms.
- 50 MB rotation ≈ 80K runs — over a year of intensive use.

## Testing Strategy

Coherent with the plugin's current pattern: Node `--test` runner, `tests/unit/*.test.mjs`, integration tests under `tests/integration/`.

**Unit tests (~76):**

| File | Coverage | ~Tests |
|---|---|---|
| `tests/unit/trace-emitter.test.mjs` | `appendSpan` atomicity, ULID generation, payload cap > 3.5 KB, `TRACE_DISABLED=1` short-circuit, stderr fallback | 12 |
| `tests/unit/trace-start-span.test.mjs` | CLI parsing, stdout JSON shape, parent propagation, scope detection, missing-args validation | 8 |
| `tests/unit/trace-end-span.test.mjs` | Duration from start_ts, status enum, attrs merge, missing span_id no-op | 8 |
| `tests/unit/trace-reconcile.test.mjs` | Orphan detection > 30min, recent spans untouched, synthetic span_end shape, idempotent on second run | 10 |
| `tests/unit/trace-analyze.test.mjs` | p50/p95 per agent_role, retry_rate, escalation freq, malformed line skip, empty store empty report | 14 |
| `tests/unit/trace-suggest.test.mjs` | 4 rules (a/b/c/d) happy + edge cases, 7-day cooldown via `suggestion-history.jsonl`, evidence inline, window < 10 silent | 18 |
| `tests/unit/trace-daemon-migration.test.mjs` | `dev-events.log` → `spans.jsonl` rewrite preserves semantics, compat symlink for 1 release | 6 |

**Integration tests (~9):**

| File | Coverage | ~Tests |
|---|---|---|
| `tests/integration/trace-execute-task-end-to-end.test.mjs` | Simulates 1-phase 1-agent execute-task (Task tool mocked), validates full tree in `spans.jsonl` | 4 |
| `tests/integration/trace-concurrent-workflows.test.mjs` | 2 workflows writing same JSONL in parallel, no-corruption / no-collision | 2 |
| `tests/integration/trace-suggester-end-to-end.test.mjs` | Seed 15 runs with 30% retry rate, run suggester, validate emitted `bump_model_tier` with correct evidence | 3 |

**Out of test scope:** behavior of the real Task tool, real LLM calls, real model retries. The emitter is deterministic; integration tests mock dispatches.

## Success Criteria

V1 is shippable when:

1. **Instrumentation coverage** — `new-task`, `refine-task`, `execute-task`, `create-pr`, `report-task`, `close-task` each emit complete spans in at least one real end-to-end run.
2. **Zero regression** — `npm test` and `node bin/sync-agents.mjs --check` both pass. The 23 agent prompts under `agents/` are byte-identical.
3. **Daemon migrated** — `dev-events.log` is a symlink to `spans.jsonl`; every existing `EVENT_TYPE` produces an equivalent entry.
4. **Analyzer answers 4 queries**:
   - `trace-analyze --by-agent` → table: n, p50, p95, retry_rate, escalation_rate per `agent_role`
   - `trace-analyze --by-phase` → same, by `(phase_num, service_id)`
   - `trace-analyze --by-task <slug>` → full span tree of one task
   - `trace-analyze --trends --window 30d` → week-over-week deltas
5. **Suggester emits the 4 rules** with inline evidence and respects the 7-day cooldown.
6. **Reconciler clean on fresh workspace** (no spurious output) and correctly cleans orphans after a simulated kill.

## Out of Scope V1

- **Falsifiable predictions** per AHE (each suggestion declares `expected_improvement`; next run verifies). Requires A/B rollback infra — own spec.
- **OTLP exporter** (`bin/trace-export-otlp.mjs` to Jaeger / Tempo / Langfuse). Schema is already OTLP-shaped; the exporter is one future script with no re-instrumentation.
- **Live streaming** (websocket/SSE). The append-only JSONL is `tail -f`-able today; a UI viewer is a later add.
- **Tokens / USD cost** — depends on uniform reporting from runtimes (Claude Code vs OpenCode). Schema reserves `attrs.tokens_in`, `attrs.cost_usd`; fields populate when feasible.
- **Cross-workspace correlation** — each workspace is self-contained. A future optional `home_trace_id` could be added.
- **Web UI / dashboard** — V1 is CLI-only. A `/jlu-trace-dashboard` is a v0.4.x candidate.
- **Self-evolution autonomy** — user chose blocking suggestions. No silent edits to workflows or agents in V1.

## Components to Ship in V1

```
bin/lib/trace/
  emitter.mjs              writer + ULID + stderr fallback + payload cap
  schema.mjs               constants: EVENT_KIND, STATUS, SCOPE, RULES
  reader.mjs               iterative JSONL parser, skip-malformed
bin/
  trace-start-span.mjs     CLI wrapper, called from workflow .md
  trace-end-span.mjs       CLI wrapper
  trace-reconcile.mjs      orphan sweep
  trace-analyze.mjs        queries: --by-agent / --by-phase / --by-task / --trends
  trace-suggest.mjs        4 rules + cooldown + evidence
jelou/workflows/
  execute-task.md          + Step 0.5 (reconcile + suggest), per-phase span, per-dispatch span, close span
  new-task.md              + workflow-level span (open + close)
  refine-task.md           + workflow-level span
  create-pr.md             + Step 0.5, workflow-level span
  report-task.md           + workflow-level span
  close-task.md            + workflow-level span, snapshot to TASK_DIR, optional --purge-trace
jelou/references/
  tracing.md               schema, attrs, how to add a new span
bin/lib/dev-orchestrator/
  events.mjs               refactor: delegate to trace/emitter.mjs
skills/
  trace-report/            new skill /jlu-trace-report → invokes bin/trace-analyze.mjs
README.md                  + section "Tracing & observability"
.gitignore                 + .traces/ entry
tests/unit/                ~76 new tests
tests/integration/         ~9 new tests
```

**No-touch files:** every `.md` under `agents/` and its mirror under `.opencode/agents/`. The 23 subagent prompts are untouched. This is enforced by `node bin/sync-agents.mjs --check` continuing to pass.

## Notes for Implementation Planner

- The 6 workflow `.md` files each get the same 3-block edit pattern (open span / per-step inner spans / close span). The planner should treat these as 6 similar but independent units, not as one big change.
- The dev-env daemon migration is the riskiest single unit — it's the one place the new emitter must be *backward compatible* (symlink, event types preserved). Treat it as its own phase with explicit before/after fixtures.
- The suggester is the most user-visible component. Its UX (evidence inline, y/n loop, cooldown messaging) deserves a dedicated phase with manual end-to-end checks beyond unit tests.
