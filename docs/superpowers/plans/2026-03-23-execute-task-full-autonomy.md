# Execute-Task Full Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `jlu:execute-task` fully autonomous — zero user questions during normal execution, with a single safety valve (pause after 5 failed retries) and a SQL safety gate blocking destructive database commands via Bash.

**Architecture:** All changes are in `jelou/workflows/execute-task.md`. Agent definition files are unchanged. The workflow removes all `AskUserQuestion` calls, replaces interactive decisions with auto-decisions, and injects a SQL safety gate into every agent prompt at spawn time.

**Tech Stack:** Markdown workflow definitions (no code — this is a prompt engineering task)

**Spec:** `docs/superpowers/specs/2026-03-23-execute-task-full-autonomy-design.md`

---

### Task 1: Replace tool requirement header and add SQL Safety Gate

**Files:**
- Modify: `jelou/workflows/execute-task.md:1-7`

- [ ] **Step 1: Replace line 6 (tool requirement) with autonomy declaration and SQL safety gate**

Replace:
```markdown
> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.
```

With:
```markdown
> **Autonomy mode**: This workflow runs fully autonomous. The ONLY case where execution pauses for user input is after 5 failed retry attempts on a phase or build step. All other decisions are auto-resolved.

> **SQL Safety Gate — inject into every agent prompt that has Bash access (test-writer, implementer, qa-agent, build-validator):**
> ```
> ## SQL Safety Gate
> NEVER execute Bash commands containing destructive SQL keywords: DROP TABLE, DROP DATABASE, DROP INDEX, DROP COLUMN, DELETE FROM, or TRUNCATE. This applies to direct SQL commands, database CLI tools (psql, mysql, mongosh, redis-cli), and any command that pipes SQL to a database.
> If a phase requires running destructive SQL, SKIP the execution and report:
> "BLOCKED: Phase requires destructive SQL execution. Manual intervention needed."
> ```
```

- [ ] **Step 2: Verify the header reads correctly**

Read lines 1-15 of the file and confirm the new header is in place.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Replace tool requirement with autonomy declaration and SQL safety gate"
```

---

### Task 2: Make Step 1 auto-select task without asking

**Files:**
- Modify: `jelou/workflows/execute-task.md:10-21` (Step 1)

- [ ] **Step 1: Replace Step 1 content**

Replace:
```markdown
## Step 1 — Resolve Task

1. If a `task-slug` is provided as a command argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If no `task-slug` provided:
   a. Find the most recent task (latest date folder, latest task within it).
   b. Confirm with user: "Found task `<task-slug>`. Execute this one?"

**Error gate**: If no task found, stop: "No task found. Run `/jlu:new-task` first."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`
```

With:
```markdown
## Step 1 — Resolve Task

1. If a `task-slug` is provided as a command argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If no `task-slug` provided:
   a. Find the most recent task (latest date folder, latest task within it).
   b. Auto-select it. Log to terminal: "Auto-selected task `<task-slug>`."

**Error gate**: If no task found, stop: "No task found. Run `/jlu:new-task` first."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`
```

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Step 1: auto-select task instead of asking for confirmation"
```

---

### Task 3: Make Step 3 auto-resume without asking

**Files:**
- Modify: `jelou/workflows/execute-task.md` (Step 3 — Session Recovery Check)

- [ ] **Step 1: Replace Step 3 content**

Replace the entire Step 3 section (from `## Step 3` through the end of option handling before `---`) with:

```markdown
## Step 3 — Session Recovery (Decision #35)

If TASKS.md shows a mid-execution state (status is `implementing` and some phases are marked `done` while others are `pending` or `in_progress`):

1. Log the current state to terminal:
   ```
   Task `<TASK_SLUG>` — resuming interrupted execution.
   Completed: Phase 01, Phase 02
   Resuming from: Phase 03
   ```

2. If any phase has status `in_progress` (interrupted mid-execution):
   - Reset that phase's status to `pending`.
   - Log to terminal: "Phase <NN> was interrupted. Restarting from scratch."

3. Set `RESUME_FROM` = first phase that is not `done`. Skip to Step 7, starting from that phase.
```

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Step 3: auto-resume from first incomplete phase, no user choice"
```

---

### Task 4: Auto-approve proposal in Step 4g

**Files:**
- Modify: `jelou/workflows/execute-task.md` (Step 4g)

- [ ] **Step 1: Replace Step 4g content**

Replace:
```markdown
### 4g. Present for Approval

Present PROPOSAL.md to the user:
```
## Proposal Generated

<executive summary of the proposal>

Phases: <N> phases across <N> services
Dependency order: <service-a> → <service-b> → ...

Full proposal: <TASK_DIR>/PROPOSAL.md

Approve this proposal to begin execution? (yes / request changes)
```

- If approved: continue to Step 5.
- If changes requested: iterate. Ask what to change, update PROPOSAL.md, re-present.
```

With:
```markdown
### 4g. Auto-Approve Proposal

Log the proposal summary to terminal (do not ask for approval):
```
## Proposal Generated — Auto-Approved

Phases: <N> phases across <N> services
Dependency order: <service-a> → <service-b> → ...

Full proposal: <TASK_DIR>/PROPOSAL.md
```

Continue to Step 6 (Transition to Implementing).
```

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Step 4g: auto-approve proposal with terminal logging"
```

---

### Task 5: Remove Step 5 (execution mode selection) and update Step 6

**Files:**
- Modify: `jelou/workflows/execute-task.md` (Steps 5 and 6)

- [ ] **Step 1: Delete Step 5 entirely**

Remove the entire Step 5 section:
```markdown
## Step 5 — Choose Execution Mode (Decision #29)

Ask the user:
```
Execution mode:
1. Autonomous (default) — Phases run automatically. You'll be interrupted only on failures or blocks.
2. Step-by-step — Pause before each phase for your approval.

Choose (1/2, default: 1):
```

**Store**: `EXECUTION_MODE` = `autonomous` or `step_by_step`
```

- [ ] **Step 2: Update Step 6 to remove execution mode reference**

Replace:
```markdown
## Step 6 — Transition to Implementing

1. Update `<TASK_DIR>/TASKS.md`:
   - Status: `implementing`
   - Add timestamp: `- Implementing: <current-datetime-ISO>`
   - Record execution mode chosen.
```

With:
```markdown
## Step 6 — Transition to Implementing

1. Update `<TASK_DIR>/TASKS.md`:
   - Status: `implementing`
   - Add timestamp: `- Implementing: <current-datetime-ISO>`
```

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Remove Step 5 (execution mode) and clean up Step 6"
```

---

### Task 6: Remove Step 7a (pre-phase gate) and update 7d, 7e, 7h, 7k

**Files:**
- Modify: `jelou/workflows/execute-task.md` (Step 7 subsections)

- [ ] **Step 1: Delete Step 7a entirely**

Remove the entire 7a section:
```markdown
### 7a. Pre-Phase Gate (Step-by-Step Mode Only)

If `EXECUTION_MODE` is `step_by_step`:
```
## Phase <NN>: <Phase Name>
Service: <service-id>
Requirements:
- <requirement-1>
- <requirement-2>

Proceed with this phase? (yes / skip / abort)
```
- If "skip": mark phase as `skipped`, continue to next.
- If "abort": stop execution, report current state.
```

- [ ] **Step 2: Update 7d Red verification — auto-investigate instead of asking**

Replace:
```markdown
**Red verification**:
1. Run the test suite for the affected files.
2. Confirm the new tests FAIL (Red state).
3. If any new tests PASS unexpectedly:
   - Flag to user: "Test `<test-name>` passes without implementation. This may indicate the requirement is already implemented or the test is incorrect."
   - Ask: "Continue anyway, or investigate?"
```

With:
```markdown
**Red verification**:
1. Run the test suite for the affected files.
2. Confirm the new tests FAIL (Red state).
3. If any new tests PASS unexpectedly:
   - Log to terminal: "Test `<test-name>` passes without implementation — auto-investigating."
   - Spawn a fresh `jlu-test-writer` to evaluate whether the test is correct or the requirement is already implemented.
   - If already implemented: mark requirement as covered, skip to next.
   - If test is incorrect: rewrite and re-verify Red state.
```

- [ ] **Step 3: Update 7e Green verification — auto-retry up to 5 times**

Replace:
```markdown
**Green verification**:
1. Run the test suite.
2. Confirm all tests PASS (Green state).
3. If tests still fail after implementation:
   - Report failures.
   - Offer: "Retry implementation, or spawn a fresh implementer with failure context?" (Decision #1)
```

With:
```markdown
**Green verification**:
1. Run the test suite.
2. Confirm all tests PASS (Green state).
3. If tests still fail after implementation:
   - Log failures to terminal.
   - Spawn a fresh `jlu-implementer` with accumulated failure context (Decision #1).
   - Retry up to 5 times total.
   - If still failing after 5 attempts: pause and notify user (see Escalation Format below).
```

- [ ] **Step 4: Update 7h — remove step-by-step branching, add retry logic**

Replace:
```markdown
If QA finds issues:
- Report them clearly.
- In autonomous mode: attempt to fix automatically (spawn implementer with QA findings).
- In step-by-step mode: present to user and ask how to proceed.
```

With:
```markdown
If QA finds issues:
- Log issues to terminal.
- Attempt to fix automatically: spawn `jlu-implementer` with QA findings.
- Retry up to 5 times total.
- If still failing after 5 attempts: pause and notify user (see Escalation Format below).
```

- [ ] **Step 5: Update 7k — remove mode branching, unified escalation**

Replace:
```markdown
**If the agent reports FAIL** (5 rounds exhausted):
- Report the failure to the user with the agent's last error output.
- In autonomous mode: pause execution and ask the user how to proceed.
- In step-by-step mode: present the failure and ask how to proceed.
```

With:
```markdown
**If the agent reports FAIL** (5 rounds exhausted):
- Pause and notify user (see Escalation Format below).
```

- [ ] **Step 6: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Remove step-by-step mode from phase execution, add auto-retry logic"
```

---

### Task 7: Update Step 10 (failure path) — auto-retry then escalate

**Files:**
- Modify: `jelou/workflows/execute-task.md` (Step 10)

- [ ] **Step 1: Replace Step 10 content**

Replace:
```markdown
## Step 10 — Failure Path

If validation fails or phases have unresolved issues:

1. Present failures clearly:
   ```
   ## Execution Incomplete

   ### Failed Phases
   - Phase <NN>: <reason>

   ### Failing Tests
   - <test-name>: <failure reason>

   ### Unresolved Issues
   - <issue>
   ```

2. Offer options:
   - "Retry failed phases"
   - "Pause for manual intervention"
   - "Mark as blocked (will need `/jlu:extend-phase` to continue)"

3. Update TASKS.md with the failure state and details.
```

With:
```markdown
## Step 10 — Failure Path

If validation fails or phases have unresolved issues:

1. Log failures to terminal:
   ```
   ## Execution Incomplete — Auto-Retrying Failed Phases

   ### Failed Phases
   - Phase <NN>: <reason>

   ### Failing Tests
   - <test-name>: <failure reason>
   ```

2. Auto-retry each failed phase (re-run the full TDD cycle from Step 7d). Track attempts per phase.

3. If a phase fails after 5 total attempts: pause and notify user (see Escalation Format below).

4. Update TASKS.md with the failure state and details.
```

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Step 10: auto-retry failed phases up to 5 times, then escalate"
```

---

### Task 8: Update Error Handling table and add Escalation Format

**Files:**
- Modify: `jelou/workflows/execute-task.md` (Error Handling section and new Escalation Format section)

- [ ] **Step 1: Replace Error Handling table**

Replace:
```markdown
## Error Handling

| Error | Action |
|-------|--------|
| Task not in `planned` or `implementing` state | Stop with status message |
| SPEC.md missing | Stop — cannot execute without spec |
| Codebase files missing | Warn, proceed (agents will have less context) |
| Test writer agent fails | Kill, spawn fresh with failure context (Decision #1) |
| Implementer agent fails | Kill, spawn fresh with failure context (Decision #1) |
| Tests never go green after 2 retries | Escalate to user |
| Git commit fails | Report error, do not block phase execution |
| Build validation fails after 5 rounds | Report failure, pause for user intervention |
| Worktree missing | Fall back to main repo, warn user |
```

With:
```markdown
## Error Handling

| Error | Action |
|-------|--------|
| Task not in `planned` or `implementing` state | Stop with status message |
| SPEC.md missing | Stop — cannot execute without spec |
| Codebase files missing | Warn, proceed (agents will have less context) |
| Test writer agent fails | Kill, spawn fresh with failure context — up to 5 attempts (Decision #1) |
| Implementer agent fails | Kill, spawn fresh with failure context — up to 5 attempts (Decision #1) |
| Tests never go green after 5 retries | Pause and notify user (see Escalation Format) |
| QA auto-fix fails after 5 retries | Pause and notify user (see Escalation Format) |
| Git commit fails | Report error, do not block phase execution |
| Build validation fails after 5 rounds | Pause and notify user (see Escalation Format) |
| Worktree missing | Fall back to main repo, warn user |
| Destructive SQL in Bash command | Block execution, report BLOCKED (SQL Safety Gate) |
```

- [ ] **Step 2: Add Escalation Format section after Error Handling**

Insert before the Artifact Paths section:

```markdown
---

## Escalation Format

When any retry limit (5 attempts) is exhausted, this is the **only** point where execution pauses for user input. Use `AskUserQuestion` with this format:

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
```

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Update error handling table and add escalation format"
```

---

### Task 9: Update Decision References

**Files:**
- Modify: `jelou/workflows/execute-task.md` (Decision References table)

- [ ] **Step 1: Update decision references**

Replace:
```markdown
| #29 | Configurable autonomous/step-by-step execution mode |
| #35 | Session recovery: resume, re-validate, or start over |
```

With:
```markdown
| #29 | **Superseded**: always autonomous, execution mode selection removed |
| #35 | **Simplified**: session recovery always auto-resumes from first incomplete phase |
```

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Update decision references for autonomy changes"
```

---

### Task 10: Final verification

- [ ] **Step 1: Read the entire modified file and verify**

Read `jelou/workflows/execute-task.md` end to end. Check:
- No remaining `AskUserQuestion` references except in the Escalation Format section
- No remaining references to `EXECUTION_MODE`, `step_by_step`, or `step-by-step`
- No remaining "ask the user", "offer options", "confirm with user" language (except escalation)
- SQL Safety Gate is present in the header
- Error Handling table has updated retry counts
- All `---` separators are intact

- [ ] **Step 2: Search for leftover interactive language**

```bash
grep -in "ask.*user\|step.by.step\|step_by_step\|EXECUTION_MODE\|AskUserQuestion" jelou/workflows/execute-task.md
```

Only match should be the Escalation Format section's `AskUserQuestion` reference.

- [ ] **Step 3: Final commit if any fixups needed**

If any leftover references found, fix them and commit:
```bash
git add jelou/workflows/execute-task.md
git commit -m "Clean up leftover interactive references"
```
