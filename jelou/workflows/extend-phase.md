# Workflow: extend-phase

> Orchestrator workflow for `/jlu:extend-phase [task-slug] [phase-number]`
> Add or modify scope in an in-progress task via a focused mini-interview.

---

## Step 1 — Resolve Task

1. If `task-slug` is provided as an argument:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If not provided:
   a. Find the most recent task (latest date folder, latest task within it).
   b. Confirm with user: "Found task `<task-slug>`. Extend this one?"

**Error gate**: If no task found, stop: "No task found. Nothing to extend."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`

---

## Step 2 — Read Current State

1. Read `<TASK_DIR>/TASKS.md`:
   - Extract current status, affected services, phase progress.
2. Read `<TASK_DIR>/PROPOSAL.md` (if exists):
   - Extract phase breakdown and dependency order.
3. Read all phase files from `<TASK_DIR>/services/<service-id>/phases/` for each affected service.
4. Identify the phase to extend:
   - If a `phase-number` argument was provided, use it.
   - If not, present the phase list and ask the user which phase to extend:
     ```
     Current phases:
       01 - <phase-name> [done]
       02 - <phase-name> [done]
       03 - <phase-name> [in_progress]
       04 - <phase-name> [pending]

     Which phase do you want to extend? (number, or "new" to add a new phase)
     ```

**Store**: `TARGET_PHASE`, `PHASE_FILE_PATH`, `CURRENT_PHASE_STATUS`

---

## Step 3 — Mini Interview (Decision #24)

Conduct a focused interview about the extension. This is shorter and more targeted than `/jlu:refine-spec`.

Ask the following questions (use `AskUserQuestion`):

### Round 1: What and Why
1. "What is changing? Describe the new or modified requirements."
2. "Why is this change needed? (e.g., new business requirement, bug found during implementation, user feedback)"

### Round 2: Scope and Impact
3. "Which specific requirements are being added or modified? Reference existing FR/NFR numbers from SPEC.md if applicable."
4. "Which services are affected by this extension?"
   - Present the current affected services list.
   - Ask if new services need to be added.

### Round 3: Constraints (if needed)
5. "Are there any constraints or things that should NOT change as part of this extension?"
6. "Does this extension affect any completed phases? If so, how?"

**Store**: `EXTENSION_DESCRIPTION`, `EXTENSION_REASON`, `AFFECTED_REQUIREMENTS`, `EXTENSION_SERVICES`, `CONSTRAINTS`

---

## Step 4 — Impact Analysis

Analyze the impact of the proposed extension:

### 4a. Read Completed Phases

For each phase that is `done`:
1. Read the phase file's execution section.
2. Read the test files and implementation files referenced in the phase's artifacts.
3. Identify which tests and implementations might be affected by the extension.

### 4b. Cross-Reference

1. Map the extension's new/modified requirements to existing phases.
2. Identify:
   - **Affected phases**: Phases whose requirements intersect with the extension.
   - **Unaffected phases**: Phases that are independent of the extension.
   - **New work**: Requirements that don't map to any existing phase.

### 4c. Present Impact Summary

```
## Extension Impact Analysis

### Extension Summary
<EXTENSION_DESCRIPTION>

### Impact on Existing Phases
| Phase | Status | Impact | Details |
|-------|--------|--------|---------|
| 01    | done   | none   | No overlap with extension |
| 02    | done   | affected | Test X covers requirement that is being modified |
| 03    | in_progress | affected | Current implementation needs to accommodate new requirement |
| 04    | pending | none | Not yet started, requirements unchanged |

### New Work Required
- <new requirement that doesn't fit existing phases>

### Tests to Re-Run
- <test-file-1>: covers modified requirement
- <test-file-2>: regression check for affected module

### Risk Assessment
- <risk description>
```

---

## Step 5 — Determine Extension Strategy

Based on the impact analysis, choose one of two strategies:

### Strategy A: Additive (New Requirements Only)

If the extension only ADDS new requirements without modifying existing ones:
1. Keep all existing code and tests as-is.
2. Add new requirements to the target phase file (or create a new phase).
3. New tests and implementation will be layered on top.
4. No phases need to be reopened.

### Strategy B: Modifying (Changes to Existing Requirements)

If the extension MODIFIES requirements that have already been implemented:
1. Mark affected `done` phases as needing re-validation.
2. Reopen the task status:
   - If the modification requires spec-level changes: transition to `refining` and recommend re-running `/jlu:refine-spec`.
   - If the modification is implementation-level only: transition to `planned` and mark affected phases for re-execution.
3. Existing code is preserved as the baseline (Decision #15) — changes build on top, not replace.

Present the strategy to the user for confirmation:
```
Recommended strategy: <A or B>
- <explanation of what will happen>

Proceed? (yes / adjust)
```

---

## Step 6 — Update Phase Files

### For Additive Extensions (Strategy A):

1. Open the target phase file.
2. Add an extension section below the immutable requirements:
   ```markdown
   ## Extension (added <current-date>)
   ### Reason
   <EXTENSION_REASON>

   ### Additional Requirements
   - EXT-1: <new requirement>
   - EXT-2: <new requirement>

   ### Constraints
   - <constraint from interview>
   ```
3. If "new" was chosen (adding a new phase):
   - Create a new phase file: `<TASK_DIR>/services/<service-id>/phases/<NN>-<new-phase-name>.md`
   - Update PROPOSAL.md with the new phase.

### For Modifying Extensions (Strategy B):

1. Update the affected phase files:
   - Mark the requirements section with modification notes (do NOT delete original requirements — they are immutable).
   - Add a modification section:
     ```markdown
     ## Modification (added <current-date>)
     ### Reason
     <EXTENSION_REASON>

     ### Modified Requirements
     - FR-<N> (modified): <new version of requirement>
     - FR-<N> (added): <new requirement>

     ### Re-Validation Required
     - Tests: <list of test files to re-run>
     - Phases: <list of phase numbers to re-validate>
     ```
2. Reset affected phase statuses to `planned` (for re-execution).

---

## Step 7 — Re-Run Affected Tests

1. For each affected phase (Decision #15 — preserve existing code as baseline):
   - Run ONLY the tests that are affected by the extension.
   - Do NOT re-run the entire test suite at this point.
2. Report test results:
   - If all affected tests still pass: "Existing tests remain green. Extension can proceed."
   - If some tests fail: "Extension impacts existing tests. These will need to be updated during re-execution."

---

## Step 8 — Update TASKS.md

Update `<TASK_DIR>/TASKS.md` with:
- Extension details: what was changed and why
- Extension timestamp
- Affected phases and their new statuses
- New/modified requirements summary
- If status changed (e.g., back to `planned` or `refining`), record the transition

```markdown
## Extensions
### Extension 1 — <current-date>
- Reason: <EXTENSION_REASON>
- Strategy: <additive|modifying>
- Affected phases: <list>
- New requirements: <count>
- Modified requirements: <count>
- Status transition: <if any>
```

---

## Step 9 — Report

Present the extension summary:

```
## Phase Extension Complete

### Extension Applied
- Task: <TASK_SLUG>
- Target: Phase <NN> — <phase-name>
- Strategy: <additive|modifying>

### Changes
- New requirements added: <count>
- Requirements modified: <count>
- Phases affected: <list>
- Phases reopened for re-execution: <list>

### Test Impact
- Tests to re-run: <count>
- Current test status: <pass/fail summary>

### Next Steps
<if additive>
- Continue execution with `/jlu:execute-task` — the new requirements will be picked up in the phase.
<if modifying>
- Re-run `/jlu:execute-task` — affected phases will be re-executed with updated requirements.
<if refining needed>
- Run `/jlu:refine-spec` to update the spec with the new requirements, then `/jlu:execute-task`.
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No task found | Stop with message |
| TASKS.md or PROPOSAL.md missing | Stop — nothing to extend |
| Phase number out of range | Show valid range, ask again |
| No phases exist yet | Suggest running `/jlu:execute-task` first to generate proposal and phases |
| User cancels during interview | Stop, no changes applied |
| Test re-run fails on infra issues | Report, note tests need to be re-run manually |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| TASKS.md (updated) | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| Phase files (updated/created) | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/phases/<NN>-<phase>.md` |
| PROPOSAL.md (updated if new phase) | `.spec-workspace/specs/<date>/<task-slug>/PROPOSAL.md` |
| SPEC.md (may need update for Strategy B) | `.spec-workspace/specs/<date>/<task-slug>/SPEC.md` |

---

## Decision References

| Decision | Application |
|----------|-------------|
| #15 | Preserve existing code as baseline — new/modified phases build on top |
| #24 | Mini interview focused on the extension (shorter than /jlu:refine-spec) |
