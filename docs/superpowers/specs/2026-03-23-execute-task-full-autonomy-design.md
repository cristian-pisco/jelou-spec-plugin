# Design: Full Autonomy Mode for `jlu:execute-task`

> Date: 2026-03-23
> Status: Draft

## Problem

The `execute-task` workflow has 8 explicit `AskUserQuestion` interaction points — task confirmation, session recovery, proposal approval, execution mode selection, pre-phase gates, test/build failure handling, and final validation options. Even in "autonomous" mode, the workflow pauses on failures and asks the user.

The goal is **100% autonomy**: the wizard runs from start to finish without asking anything, except when it exhausts retry attempts. Additionally, destructive SQL commands (`DROP`, `DELETE`, `TRUNCATE`) must never be executed via Bash during task execution.

## Approach

**Workflow-level autonomy** — modify `execute-task.md` directly. Remove all `AskUserQuestion` calls and replace them with auto-decisions using sensible defaults. Add a SQL safety gate as a rule injected into all agent prompts at spawn time.

Agents themselves don't change. The orchestrator decides; agents execute.

---

## Section 1: Autonomy Overhaul — Remove User Interaction Points

The `AskUserQuestion` tool requirement (line 6 of the workflow) is replaced with:

> **This workflow runs fully autonomous. The ONLY case where execution pauses for user input is after 5 failed retry attempts on a phase or build step.**

### Per-Step Changes

| Step | Current Behavior | New Behavior |
|------|-----------------|--------------|
| **1b** (no slug provided) | Ask: "Found task X. Execute this one?" | Auto-select most recent task, log selection to terminal |
| **3** (session recovery) | Ask: Resume / Re-validate / Start over | Auto-resume from first incomplete phase (see Section 4) |
| **4g** (proposal approval) | Ask: "Approve this proposal?" | Auto-approve, log executive summary to terminal |
| **5** (execution mode) | Ask: Autonomous / Step-by-step | **Remove entirely** — always autonomous |
| **7a** (pre-phase gate) | Ask: Proceed / Skip / Abort | **Remove entirely** — step-by-step mode is gone |
| **7d** (tests pass unexpectedly) | Ask: "Continue or investigate?" | Auto-investigate: spawn fresh test-writer to evaluate |
| **7e** (tests won't go green) | Ask: "Retry or spawn fresh?" | Auto-spawn fresh implementer with failure context, up to 5 retries |
| **7h** (QA issues) | Present to user in step-by-step | Always auto-fix (autonomous was already doing this) |
| **7k** (build fail after 5 rounds) | Pause and ask user | **Pause and notify** — the safety valve |
| **10** (failure path) | Offer retry / pause / blocked | Auto-retry failed phases up to 5 attempts, then **pause and notify** |

### What Gets Removed

- Step 5 (execution mode selection) — deleted entirely
- Step 7a (pre-phase gate) — deleted entirely
- All step-by-step mode branching logic throughout the workflow
- The `EXECUTION_MODE` variable and all references to it

### What Gets Added

- Terminal logging at every auto-decision point (so the user can see what was decided)
- A single `AskUserQuestion` call pattern for the retry-exhausted escalation (see Section 3)

---

## Section 2: SQL Safety Gate

A new constraint injected into **every agent prompt** that has Bash tool access (test-writer, implementer, qa-agent, build-validator). The orchestrator appends this block when spawning agents — agent definition files are not modified.

### Rule Text (injected into agent prompts at spawn time)

```
## SQL Safety Gate
NEVER execute Bash commands containing destructive SQL keywords: DROP, DELETE, TRUNCATE,
or ALTER TABLE ... DROP. This applies to direct SQL commands, database CLI tools (psql, mysql,
mongosh, redis-cli), and any command that pipes SQL to a database.
If a phase requires running destructive SQL, SKIP the execution and report:
"BLOCKED: Phase requires destructive SQL execution. Manual intervention needed."
```

### Detection Keywords

Block Bash commands matching these patterns (case-insensitive):
- `DROP TABLE`, `DROP DATABASE`, `DROP INDEX`, `DROP COLUMN`
- `DELETE FROM`
- `TRUNCATE`

### What Is NOT Blocked

- **Writing migration files** containing these keywords (Write/Edit tools are unaffected)
- `SELECT`, `INSERT`, `UPDATE`, `CREATE` — read/write operations are fine
- `DROP` in non-SQL contexts (e.g., drag-and-drop references in variable names or comments)

### Scope

Only Bash commands. Agents can generate migration files with destructive SQL — they just cannot run them.

---

## Section 3: Retry & Escalation Logic

Unified retry policy across all failure types: **5 attempts, then pause and notify.**

### Per-Failure-Type Behavior

| Failure Type | Current Behavior | New Behavior |
|---|---|---|
| Test writer agent fails | 1 fresh spawn (Decision #1) | Up to 5 fresh spawns with accumulated failure context |
| Implementer — tests won't go green | 2 retries, then escalate | 5 retries (fresh agent each time with failure context) |
| Build validation fails | 5 rounds (already correct) | No change — already 5 rounds |
| Per-phase QA auto-fix fails | 1 attempt, then ask user | 5 attempts, then pause and notify |
| Final validation fails | Ask user immediately | Auto-retry failed phases (up to 5), then pause and notify |
| Test dispute (Decision #5) | 1 fresh test-writer evaluation | No change — disputes are judgment calls, not retry-able |

### Pause-and-Notify Format

When 5 retries are exhausted, this is the **only** `AskUserQuestion` call in the entire workflow:

```
## Execution Paused — Manual Intervention Needed

Phase <NN>: <Phase Name> (<service-id>)
Failure type: <test-writer | implementer | build | qa>
Attempts: 5/5

Last error:
<last error output>

Completed phases: <list>
Remaining phases: <list>

Awaiting your input to proceed.
```

---

## Section 4: Session Recovery Auto-Decision

When the workflow detects a mid-execution state (Step 3), it always **resumes** from the first incomplete phase. No user input, no options.

### Rationale

- Re-validate adds time without clear benefit (per-phase QA already passed for completed phases).
- Start over discards completed work unnecessarily.
- Resume is the conservative, predictable choice for a fully autonomous system.

### Edge Case: Phase Stuck in `in_progress`

If a phase was interrupted mid-execution (status is `in_progress`, not `done` or `pending`):

1. Reset that phase's status to `pending`.
2. Resume from that phase (re-run the full TDD cycle for it).
3. Log to terminal: `"Phase <NN> was interrupted. Restarting from scratch."`

---

## Summary of Changes

### Files Modified

- `jelou/workflows/execute-task.md` — all changes are here, including:
  - The Error Handling table (after Step 10): update "2 retries" entries to "5 retries" to match the unified retry policy
  - Step 6: remove "Record execution mode chosen" line (execution mode no longer exists)

### Files NOT Modified

- Agent definitions (`agents/jlu-*.md`) — unchanged; SQL safety gate is injected at spawn time by the orchestrator
- Templates — unchanged
- Skills — unchanged

### Behavioral Changes

1. **Zero user questions** during normal execution (all auto-decided)
2. **One exception**: pause-and-notify after 5 failed retries
3. **SQL safety gate** on all Bash commands across all agents
4. **Step-by-step mode removed** entirely
5. **Session recovery always resumes** from first incomplete phase
6. **Proposals auto-approved** with terminal logging

### Decision References

| Decision | Impact |
|----------|--------|
| #1 | Extended: fresh agent spawns now up to 5 attempts (was 1-2) |
| #5 | Unchanged: dispute resolution stays as-is |
| #13 | QA auto-fix extended to 5 attempts |
| #29 | **Superseded**: execution mode selection removed, always autonomous |
| #35 | **Simplified**: session recovery always resumes, no user choice |
