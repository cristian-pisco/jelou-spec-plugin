# Workflow: trace-report

> Workflow for `/jlu-trace-report [--by-agent | --by-phase | --by-task <slug> | --trends]`
>
> Read-only analysis of the workspace trace store.

## Step 1 — Resolve mode

If invoked without arguments, ask via `question`:

- "Which trace view do you want?"
  - A) By agent (retry rates, p50/p95 per agent_role)
  - B) By phase (per service:phase_num durations)
  - C) By task (full span tree of one task — requires task slug)
  - D) Trends (week-over-week dispatch counts per agent)

If invoked with one of the explicit flags (`--by-agent`, `--by-phase`, `--by-task <slug>`, `--trends`), skip the question and use it directly.

Map the choice to a flag:
- A → `--by-agent`
- B → `--by-phase`
- C → `--by-task` (then prompt for slug)
- D → `--trends`

## Step 2 — Invoke the analyzer

Run:

```bash
node "{plugin-root}/bin/trace-analyze.mjs" <flag> [flag-arg]
```

where:
- `<flag>` is one of `--by-agent`, `--by-phase`, `--by-task`, `--trends`
- `[flag-arg]` is required only for `--by-task <slug>`

Print the stdout to the user verbatim. The analyzer exits 0 on all modes (even when data is empty) and 1 only on invalid args.

## Step 3 — Done

This is a read-only skill. No state is written. Tracing remains best-effort — if the trace store is missing or unreadable, the user sees a "no data" message and the workflow exits cleanly.
