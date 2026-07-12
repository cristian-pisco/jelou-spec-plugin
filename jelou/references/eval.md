# Evaluation — LLM-as-Judge Quality Layer (Stage 3)

> Reference for the plugin-native quality layer that scores agent output.
> See `tracing.md` for the underlying span/event store and the `eval` event.

The quality layer is **advisory, offline, and dormant.** It records an LLM-judge
score as an `eval` event attached to the span it judges, but **no rule consumes
that score.** Consumption is gated on calibration and lands in Stage 5 — until
then the scores exist only to build the calibration corpus.

## The rubric — three dimensions

Every judge scores three dimensions, each a number in the closed range `[0,1]`,
plus a brief free-text rationale (`bin/lib/trace/rubric.mjs`, `QUALITY_SCHEMA`):

| Dimension | Question |
|---|---|
| `correctness` | Is the work technically correct and free of defects? |
| `faithfulness_to_spec` | Does it do exactly what the reference asked — no more, no less? |
| `task_completion` | Is the task actually finished, with nothing left half-done? |

`compositeScore(dims)` is the mean of the three, clamped to `[0,1]`.
`buildJudgePrompt({ agent_role, output, reference })` presents the agent output
and the reference material (SPEC.md / TASKS.md / RED test text) and instructs the
judge to score reference-grounded, **order-neutral and length-neutral** — a
longer, more verbose, or earlier-listed answer is never better for that reason
alone. The prompt is robust to a missing reference: it judges on the output alone
rather than penalizing the gap.

## Panel of LLMs (PoLL) and de-biasing

Rather than trust a single judge, the layer fans out to a **cross-family panel**
and aggregates (`aggregatePanel(verdicts)`):

- `quality_dims` — per-dimension means across the panel.
- `quality_score` — `compositeScore` of those means.
- `panel_agreement` — `1` minus the population standard deviation of each judge's
  composite score, clamped to `[0,1]` (`1.0` for a single verdict).
- `escalate` — `true` when `panel_agreement < 0.7` **or** the judges straddle the
  `0.5` composite line (some above, some below). Escalation flags a verdict a
  human should look at; it never blocks a task.

De-biasing rules baked into the panel:

- **No same-family self-judge.** Agents run on Claude, so the default panel
  (`EVAL_DEFAULT_MODELS` in `bin/trace-eval.mjs`) is deliberately non-Anthropic:
  `openai/gpt-5.5`, `google/gemini-3.1-pro-preview`, `deepseek/deepseek-v4-pro`.
  Three distinct frontier lineages, none the same family as the author.
- **Order- and length-neutral** judging, instructed in the prompt.

**Model ids drift.** The default list is a snapshot; provider ids change and
models are retired. Verify against the OpenRouter catalog
(https://openrouter.ai/models) before a run, and override with `--models
<csv>` when an id has moved or you want a different panel.

## Calibration — Cohen's kappa vs Stage-2 feedback

Scores stay advisory until they are shown to agree with ground truth. The
ground truth is the **Stage-2 feedback store** (`feedback.jsonl`): the
`accept` / `reject` signals harvested for free at close-task.

Calibration binarizes each judge composite with `binarizeScore(score,
threshold)` (`>= threshold → positive`, else `negative`) and compares the
binarized labels against the feedback labels for the same spans with
`cohensKappa(pairs)` (`bin/lib/trace/aggregate.mjs`) — observed agreement
corrected for chance. Kappa is `1` for perfect agreement, `≈0` for chance, and
negative for systematic disagreement. Only once kappa clears an agreed bar does
Stage 5 wire the score into a rule.

## Kappa-gated quality rules (Stage 5) — dormant until calibrated

Stage 5 wires the `eval` score into two suggestion rules in
`bin/lib/trace/rules.mjs`. Both are **dormant** — they emit nothing — until the
judge is proven calibrated. This is the safety property: an uncalibrated judge
must never drive a change.

- `faithfulness_below_baseline` — per `agent_role`, over `>= MIN_SAMPLE` eval'd
  dispatches, mean `quality_dims.faithfulness_to_spec` below `FAITHFULNESS_FLOOR`
  (0.6) → suggest tightening the prompt / escalating. Carries an
  `expected_improvement` (`faithfulness_to_spec`, direction `increase`).
- `quality_regression` — a phase whose most recent `quality_score` is below its
  own historical median by `QUALITY_REGRESSION_MARGIN` → flag likely prompt
  regression.

**The gate** (`judgeCalibration({ events, feedback })`): compute `cohensKappa`
over paired `(binarizeScore(quality_score), feedbackSignal)` across spans that
have BOTH an `eval` event and a `feedback` entry (feedback `accept` → `positive`,
`reject` → `negative`). The rules fire **only** when paired count `>= MIN_SAMPLE`
(10) AND `kappa >= KAPPA_FLOOR` (0.4). Below the floor or too few pairs, both
rules return `[]`. `bin/trace-suggest.mjs` prints one line when eval events exist
but the gate is closed:
`quality rules dormant: judge uncalibrated (kappa=<x>, pairs=<n>, need kappa>=0.4 & pairs>=10)`.

## Offline and sampled

The judge **never runs on a task's critical path.** `bin/trace-eval.mjs` is an
offline CLI run against the trace store after the fact, and it is sampled:
`--sample-rate <0..1>` (default `1.0`) judges a fraction of eligible spans so a
large corpus stays affordable.

`runEval` resolves the agent output from the provided `--output` or, best-effort,
from the persisted report path `services/<svc>/phases/<NN>-reports/` when a span
maps to one; a span with no resolvable output is skipped, never judged blind.

## Knobs

| Knob | Effect |
|---|---|
| `EVAL_DISABLED=1` | No-op: `runEval` returns an empty summary, emits nothing. |
| `TRACE_DISABLED=1` | No-op (also short-circuits every trace write). |
| missing `OPENROUTER_API_KEY` | Cannot judge — stderr note, returns without emitting. |

## CLI

```
node bin/trace-eval.mjs (--span <id> | --task <slug>) \
  [--models <csv>] [--output <path>] [--reference <path>] [--sample-rate <0..1>]
```

- Trace file: `TRACE_FILE`, else `<cwd>/.traces/spans.jsonl`.
- Feedback file: `FEEDBACK_FILE`, else `feedback.jsonl` alongside the trace file.
- Reads `OPENROUTER_API_KEY`.
- Best-effort: exits `0` even when nothing was judged; exits `1` only on invalid
  args (neither `--span` nor `--task`).

Each judged span produces exactly one `eval` event attached to it via
`parent_span_id`. See the `eval` row in `tracing.md` for the attrs shape.
