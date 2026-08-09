# Workflow: eval-report

> Workflow for `/jlu-eval-report [--json | --task <slug>]`
>
> Read-only north-star scorecard over the workspace evaluation signals
> (spans + evaluations + feedback + suggestion history).

## Step 1 — Resolve mode

If invoked without arguments, run the full scorecard (no flags).

If invoked with `--json`, pass it through to emit the raw scorecard object as JSON.

If invoked with `--task <slug>`, pass it through to scope the scorecard to a single task.

## Step 2 — Invoke the scorecard

Run:

```bash
node "{plugin-root}/bin/trace-eval-report.mjs" [flags]
```

where `[flags]` is empty, `--json`, or `--task <slug>` exactly as the user invoked.

Print the stdout to the user verbatim. The CLI exits 0 in all modes (even when the
store is empty, where it prints a "no evaluation data yet" line) and 1 only on
invalid args.

## Step 3 — Done

This is a read-only skill. No state is written. Evaluation is best-effort — if the
trace store, feedback store, or suggestion history is missing or unreadable, the
user sees a clean "no evaluation data yet" message and the workflow exits cleanly.

**An empty store is the NORMAL state, not a fault.** Tracing is OFF unless `JLU_TRACE=1`
is set (see `jelou/references/tracing.md` → "Tracing is OFF by default"), so normal runs
emit no spans and therefore no eval events. This report only carries data from
`JLU_TRACE=1` runs and from the `jlu-bench` evaluation harness, which sets it. When the
output says "no evaluation data yet", say so plainly and do NOT send the user debugging a
healthy install.
