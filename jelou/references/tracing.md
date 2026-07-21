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
| `ship` | task | `/jlu-ship` (Phase 2) |
| `report_task` | task | `/jlu-report-task` (Phase 2) |
| `close_task` | task | `/jlu-close-task` (Phase 2) |
| `phase` | task | execute-task per-phase (Phase 2) |
| `agent_dispatch` | task | execute-task per-dispatch (Phase 2) |
| `pane_started`, `pane_dead`, `pattern_match`, `ready` | daemon | dev-env daemon (Phase 2 migration) |

## Discrete events (`event_kind: event`)

Not every trace record is a start/end pair. A discrete event stands alone and
attaches to a span via `parent_span_id`.

| Name | Scope | Emitted by | Notes |
|---|---|---|---|
| `eval` | task | `bin/trace-eval.mjs` (Stage 3) | One per judged span; carries the LLM-judge quality attrs below. Advisory — no rule consumes it until Stage 5. See `eval.md`. |

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
| `gen_ai.usage.input_tokens` | agent_dispatch | input tokens for the dispatch; best-effort, present only when the runtime exposes usage |
| `gen_ai.usage.output_tokens` | agent_dispatch | output tokens for the dispatch; best-effort |
| `gen_ai.usage.reasoning_tokens` | agent_dispatch | reasoning tokens when the runtime reports them |
| `gen_ai.usage.cache_read_tokens` | agent_dispatch | cache-read tokens when the runtime reports them |
| `cost_usd` | agent_dispatch | USD cost; `--cost` if given, else derived from tokens × the tier price table (`bin/lib/trace/cost.mjs`). Advisory, not a billing source of truth |
| `success` | phase, execute_task | correctness from the RED oracle: `pass@1` \| `pass@k` \| `fail` (distinct from `status`) |
| `attempts_to_green` | phase, agent_dispatch | attempt count to reach green (k in pass@k) |
| `pr_outcome` | ship, close_task | `merged_clean` \| `merged_churned` \| `reverted` \| `open` (Stage 2) |
| `quality_score` / `quality_dims` | eval | LLM-judge composite in `[0,1]` and its per-dimension breakdown (`correctness`, `faithfulness_to_spec`, `task_completion`); Stage 3, see `eval.md` |
| `evaluator` | eval | comma-joined judge model ids that produced the score |
| `panel_agreement` | eval | `1` minus the population std-dev of per-judge composite scores, clamped to `[0,1]` (`1.0` for a single judge) |
| `escalate` | eval | `true` when `panel_agreement < 0.7` or the judges straddle the `0.5` composite line; flags a verdict for human review, never blocks |
| `rationale` | eval | first judge's brief rationale, truncated to keep the line under the payload cap |
| `failure_mode` | any failed/blocked span | controlled MAST-seeded enum: `spec` \| `coordination` \| `verification` \| `execution` \| `unknown` (Stage 5) |

Cost is **best-effort and advisory**: token usage is populated only when a runtime exposes it, and the price table drifts. Treat `cost_usd` as a trend signal, never a billing figure.

Traces can be exported to the OpenInference / OTel-GenAI attribute shape (for Phoenix / Langfuse / Datadog) with `node bin/trace-export-otlp.mjs` — an offline alias over the same store, no re-instrumentation.

## Feedback store

Stage 2 adds a sidecar store `<WORKSPACE>/.traces/feedback.jsonl` — the first quality ground truth, keyed by `span_id` and harvested for free. Spans are append-only (a span's end is written once), so feedback never mutates a closed span; it lives in this separate store.

Each line:

| Field | Type | Notes |
|---|---|---|
| `ts` | ISO-8601 UTC | defaults to write time |
| `span_id` | ULID | the span the signal is about (e.g. the `ship` span) |
| `signal` | `accept` \| `reject` \| `implicit_negative` \| `edit` | see `SIGNAL` in `schema.mjs` |
| `source` | string | provenance, e.g. `pr_merge`, `pr_close`, `re_dispatch` |
| `note` | string | free-form, e.g. `merged_clean`, `reverted` |

Undefined fields are omitted. Writes are best-effort — short-circuit on `TRACE_DISABLED=1`, stderr warning on error, never throw — via `bin/lib/trace/feedback.mjs` (`appendFeedback` / `readFeedback`) and the `bin/trace-feedback.mjs` CLI. The CLI resolves the store from `FEEDBACK_FILE`, else `feedback.jsonl` alongside `TRACE_FILE`, else `<cwd>/.traces/feedback.jsonl`.

Harvest points:
- **`accept`** — recorded at `/jlu-close-task` Step 2b when the trunk PR is confirmed `MERGED` (`--source pr_merge --note merged_clean`), keyed to the ship span_id resolved from the trace store.
- **`reject`** — recorded at `/jlu-close-task` Step 2b when the trunk PR is found `CLOSED` but not merged (`--source pr_close --note reverted`).
- **`implicit_negative`** — **derived on demand, never written** by any workflow: `harvestImplicitNegatives(pairs)` returns one per `agent_dispatch` pair whose `end.attrs.retry_count > 0` (`source: re_dispatch`).

## Decision surface — suggestion rules (Stage 5)

`bin/trace-suggest.mjs` scans the store and emits blocking suggestions from the
rules in `bin/lib/trace/rules.mjs`. Each finding is
`{ rule_id, signature, evidence, message }`; a finding that **proposes a change**
also carries `expected_improvement`.

### Falsifiable predictions + the verification loop

- `expected_improvement` is `{ metric, signature, baseline, target, window_n, direction }`.
  `bump_model_tier` predicts `retried_fraction` will `decrease` from its current
  fraction to `RETRY_RATE_THRESHOLD` (0.20) within `N_WINDOW` (10) dispatches; the
  two quality rules predict `faithfulness_to_spec` / `quality_score` will `increase`.
  `formatSuggestion` renders it as a `predict:` line
  (`predict: retried_fraction implementer 0.60 → ≤0.20 within 10 dispatches`).
- **When the user approves a suggestion, the approval record persisted to
  `suggestion-history.jsonl` must include the finding's `expected_improvement`** —
  that is what makes the prediction verifiable on a later run.
- `verifyPredictions(pairs, history, { now })` (`bin/lib/trace/verify.mjs`) is pure:
  for every `action: 'approved'` history record that carries an
  `expected_improvement` and whose `window_n` dispatches have accrued after its
  `ts`, it recomputes the metric over that post-approval window and returns
  `{ rule_id, signature, metric, predicted_target, actual, met, ts }`. Nothing
  verifiable yet → `[]`.
- `trace-suggest` prints a `prediction check:` section
  (`prior [bump_model_tier] implementer: predicted ≤0.20 → actual 0.15 MET`) and
  appends best-effort `{ kind: 'verification', rule_id, signature, met, actual, ts }`
  lines to the history file. These records are the suggestion-hit-rate signal.
- History readers are tolerant of both extensions: `applyCooldown` skips
  `kind: 'verification'` records (they never start a cooldown) and ignores the
  extra `expected_improvement` on approval records.

### `failure_mode` classification + earliest-decisive attribution

- `classifyFailureMode({ name, agent_role, escalation_reason })`
  (`bin/lib/trace/failure.mjs`) is role/context based — never the hashed
  `error_signature`: `qa-agent`/`test-writer`/`spec-reviewer` → `verification`;
  `spec-interviewer`/`proposal-agent` → `spec`; an `escalation_reason` indicating
  coordination (or a phase span with multiple failed children) → `coordination`;
  `implementer`/`build-validator`/`refactor-agent` → `execution`; otherwise
  `unknown`. It returns a `FAILURE_MODE` value.
- `immediate_flag` groups recent failed/blocked spans by `trace_id` and
  emits **one** finding per trace, attributed to `earliestDecisiveFailure` (the
  decisive span with the earliest `start.ts`) with a `failure_mode` in its
  evidence. A single trace with three cascading failures yields one flag, not
  three; independent failures in different traces still each flag. `orphaned`
  spans are **excluded** — they are a self-healing artifact of interrupted runs
  (the reconciler writes their synthetic `span_end` and they age out), so
  flagging them is pure friction with no user action. When `context.currentTask`
  (env `TRACE_CURRENT_TASK`) is set, findings are limited to that task, so an
  unrelated prior run never surfaces during the current workflow.

Surfacing is caller-controlled and MUST NOT interrupt in-flight work:
`execute-task` and `ship` print suggestions non-blocking and continue;
interactive approval lives only in `refine-task` and the on-demand
`/jlu-trace-report`. Tracing never blocks a running task.

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
