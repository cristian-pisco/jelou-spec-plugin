# Summary Agent Design

> Standardize the execution summary displayed after `/jlu:execute-task` and `/jlu:load-context` by delegating it to a dedicated sub-agent.

## Problem

The current Step 9 of `execute-task.md` has a minimal inline summary template (3 bullet points). In practice, the LLM produces richer summaries, but the format varies between runs. There is no standard, and `load-context` has no summary at all.

## Solution

Create `jlu-summary-agent` — a dedicated sub-agent that reads task artifacts and git state, then produces a fixed-format summary. Both `execute-task` and `load-context` dispatch this agent instead of formatting their own output.

## Agent Definition

**File:** `agents/jlu-summary-agent.md`

**Tools:** `Read`, `Bash`, `Glob`, `Grep`

**Model:** `sonnet` (read-only data extraction and formatting — no heavy reasoning needed)

**Inputs:**
- `TASK_DIR` — full path to the task directory (e.g., `<workspace>/specs/2026-03-15/ai-router-backend-v1/`)
- `CONTEXT_HINT` — either `post-execution` or `context-load`

## Output Format

The agent always produces this fixed structure:

```
## Execution Complete                    ← or "## Task Summary" for context-load

Task: <TASK_SLUG>
Status: <lifecycle-state>

### Summary
- Phases completed: <done>/<total> [for <service> if multi-service]
- Tests passing: <unit-count> unit, <integration-count> integration, <e2e-count> e2e
- No regressions: <existing-test-count> existing tests pass unchanged
- Services implemented: <comma-separated list>
- Commits: <count> commits on <branch-name>
- Files changed: <count> (<new-count> new, <modified-count> modified)
- Lines: +<added> / -<removed>
- Worked for <duration>

### What was built

┌──────────────────────┬──────────────────────────────────┬───────┐
│        Phase         │             Files                │ Tests │
├──────────────────────┼──────────────────────────────────┼───────┤
│ 01 — <phase-name>    │ <file1>, <file2>                 │ <N>   │
├──────────────────────┼──────────────────────────────────┼───────┤
│ 02 — <phase-name>    │ <file1>                          │ <N>   │
└──────────────────────┴──────────────────────────────────┴───────┘

### Next Steps
- Run `/jlu:create-pr` to open pull requests
- After PR merge, run `/jlu:close-task`
- <context-specific notes when applicable>
```

### Format Rules

- If a test type has 0 count, omit it from the tests line (e.g., just `274 unit` if no integration/e2e).
- If no pre-existing tests can be determined, omit the "No regressions" line.
- For `post-execution` hint: heading is `## Execution Complete`; Next Steps always starts with `/jlu:create-pr`.
- For `context-load` hint: heading is `## Task Summary`; Next Steps adapts based on lifecycle state using this mapping:

  | State | Next Step |
  |-------|-----------|
  | `draft` | Run `/jlu:refine-spec` to expand the spec. |
  | `refining` | Continue `/jlu:refine-spec` — interview not yet complete. |
  | `planned` | Run `/jlu:execute-task` to begin TDD implementation. |
  | `implementing` | Run `/jlu:execute-task` to resume — next phase is `<recovery-info.next-phase>`. |
  | `validating` | Run `/jlu:execute-task` to complete QA, then `/jlu:create-pr`. |
  | `ready_to_publish` | Run `/jlu:create-pr` to open pull requests. *(If PR exists: merge, then `/jlu:close-task`.)* |
  | `done` | PR is open. Await review and merge, then `/jlu:close-task`. |
  | `closed` | No action needed. |

- Duration format: `Xh Ym` (e.g., `1h 23m`, `45m`, `2h 0m`). Computed from TASKS.md Timeline — difference between "Execution started" and the last timeline entry. If execution spans multiple sessions, note "across N sessions" when multiple "Execution started" / "Execution resumed" events exist.
- Files in the ASCII table show filenames only, not full paths.
- Next Steps includes context-specific notes when relevant (e.g., cross-service dependencies, external team actions, phases that target a different repo).

## Data Sources

| Metric | Source | Fallback |
|--------|--------|----------|
| Task slug, lifecycle status | TASKS.md — `## Status` section | Abort if missing |
| Task title | TASKS.md — `# Tasks — <Title>` heading | Use slug as title |
| Affected services | TASKS.md — `## Services` section | Abort if missing |
| Phase names, phase status | TASKS.md — `#### Phases` table per service | Abort if missing |
| Per-phase test counts | TASKS.md — `#### Test Results` table per service (`Total` column) | Show `—` in table |
| Aggregate test counts (unit, integration, e2e) | TASKS.md — `#### Test Results` table, sum across all phases per type | Omit types with no data |
| Pre-existing test count (no regressions) | TASKS.md — Timeline entry `Baseline: N existing tests` (recorded by orchestrator at execution start) | Omit line if no baseline recorded |
| Commits count, branch name | `git rev-parse --abbrev-ref HEAD` and `git log --oneline main..HEAD \| wc -l` | Show `—` if git fails |
| Files changed (new vs modified) | `git diff --stat main...HEAD` (count lines with `\|` for modified, lines with `create mode` from `git diff --summary` for new) | Show total only |
| Lines added/removed | `git diff --shortstat main...HEAD` | Omit if git fails |
| Duration | TASKS.md — Timeline table (first "Execution started" to last entry) | Omit if no timeline |
| Per-phase file list | Git log filtered by commit body pattern `Phase NN of spec/<slug>`: `git log --name-only --grep="Phase 0N of"` | Fall back to `git log --name-only <phase-commit-hash>` if phase commits are tagged in Timeline |

### Notes on Data Extraction

- **Per-phase test counts**: The TASKS.md `#### Test Results` table has a row per phase with columns `Unit`, `Integration`, `E2E`, `Total`. Sum across rows for aggregates. Individual phase test count for the ASCII table comes from the `Total` column.
- **Per-phase file list**: The `jlu-git-agent` uses conventional commits with `Phase NN of spec/<task-slug>` in the commit body. Use `git log --all --grep="Phase 01 of" --name-only --pretty=format:""` to extract files per phase. If this yields no results, fall back to listing files from the `git diff --stat` grouped by commit.
- **No regressions**: This is the hardest metric. Preferred approach: check if the TASKS.md Timeline has a "Baseline: N existing tests" entry (the orchestrator should record this at execution start). If not available, omit the line rather than running tests on main (which is slow and may fail).

## Integration Points

### execute-task.md (Step 9)

Replace the current inline summary template with:

> Dispatch `jlu-summary-agent` with the task directory path and context hint `post-execution`. Print the agent's output verbatim — do not add or reformat.

### load-context SKILL.md (new Step 8)

Add a new Step 8 after the existing Step 7 (Present Context Block):

> Dispatch `jlu-summary-agent` with context hint `context-load`. Print the agent's output before the "Context loaded. You can ask me anything…" closing message.

The existing Step 7 "Current Status" section (`**Stage**`, `**Progress**`, `**Next step**`, `**Active blockers**`) is **removed** from Step 7 — the summary agent now owns status presentation. Step 7 retains: Loaded Artifacts, Git Activity, Change Scope, and Artifact Inventory sections.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| TASKS.md not found | Abort with: "Cannot generate summary — TASKS.md not found at `<path>`. Is this task initialized?" |
| TASKS.md has no `## Services` section | Abort with: "TASKS.md is missing service data. Run `/jlu:execute-task` first." |
| Git commands fail (detached HEAD, no branch) | Omit git-dependent metrics (commits, files, lines). Show `—` placeholders. |
| Phase files missing | Use TASKS.md data only. Show `—` for per-phase file list in the table. |
| Timeline section empty | Omit duration line. |
| Task in `draft` or `planned` state (no execution data) | Produce a minimal summary: slug, status, services, and Next Steps only. Skip the ASCII table and test metrics. |

## No Changes to Existing Agents

`jlu-tasks-agent` and `jlu-qa-agent` remain unchanged. The summary agent reads their outputs (TASKS.md, phase files) but does not modify them.

One recommended improvement (not required for this spec): the execute-task orchestrator should record a `Baseline: N existing tests` Timeline entry at execution start, so the summary agent can reliably produce the "No regressions" line. This is an additive change to the orchestrator, not to any agent.
