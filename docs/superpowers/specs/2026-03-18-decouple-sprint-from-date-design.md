# Decouple Sprint Number from Creation Date

## Problem

When agents create tasks via `/jlu:new-task`, the workflow prompts the user for a "Sprint date" in `dd-mm-yyyy` format. This date is then stored in the Sprint field of TASKS.md, CLICKUP_TASK.json, and propagated to ClickUp. However, Sprint is a numeric identifier (e.g., 14, 27), not a date. The creation date and the Sprint are two separate concepts that the current implementation conflates.

## Solution

Separate Sprint (a positive integer) from the creation date (auto-generated). The date-based directory structure is preserved for file organization.

## Changes

### 1. Prompt Changes — `jelou/workflows/new-task.md`

**Step 3 — Prompt for Task Details:**

- Remove the "Sprint date" prompt entirely.
- Add a new prompt:
  > "Sprint number for this task? (positive integer, e.g. 14)"
- Validation: must be a positive integer (> 0). No default. If invalid, ask again.
- Auto-generate the creation date as today's date in `dd-mm-yyyy` format (no user prompt).
- Store: `TASK_DESCRIPTION`, `SPRINT_NUMBER`, `CREATION_DATE`

**Step 4 — Generate Task Slug:**

- Change directory path from `specs/<SPRINT_DATE>/` to `specs/<CREATION_DATE>/`.
- The date is now auto-generated, not user-provided.

**Step 6 — Write Initial TASKS.md:**

- Change `Sprint: <SPRINT_DATE>` to `Sprint: <SPRINT_NUMBER>`.

**Step 16 — Final Report:**

- Change `Sprint: <SPRINT_DATE>` to `Sprint: <SPRINT_NUMBER>`.

### 2. Template Changes

**`jelou/templates/tasks.md` (line 10):**

- Change `| **Sprint** | {{sprint-identifier}} |` to `| **Sprint** | {{sprint-number}} |`

**`jelou/templates/clickup-task.json` (line 14):**

- No structural change. The `"sprint"` field will store a number string (e.g., `"14"`) instead of a date string.

### 3. Downstream Documentation

**`skills/sync-clickup/SKILL.md` (line 84):**

- Change `| **Sprint** | From TASKS.md sprint date |` to `| **Sprint** | From TASKS.md sprint number |`

**`agents/jlu-pm-agent.md`:**

- No changes needed. Sprint inheritance and mandatory enforcement remain correct.

**`JELOU_SPEC_PROPOSAL.md`:**

- Out of scope. Historical design document, not executable.

## Files Modified

| File | Change |
|------|--------|
| `jelou/workflows/new-task.md` | Replace Sprint date prompt with Sprint number prompt; auto-generate creation date; update variable names and references |
| `jelou/templates/tasks.md` | Rename placeholder from `{{sprint-identifier}}` to `{{sprint-number}}` |
| `skills/sync-clickup/SKILL.md` | Update inference table text from "sprint date" to "sprint number" |

## Validation

- Run `/jlu:new-task` and verify the agent asks for a Sprint number (not a date).
- Verify the creation date is auto-generated as today's date.
- Verify the task directory uses the auto-generated date.
- Verify TASKS.md Sprint field contains the entered number.
- Verify ClickUp sync picks up the sprint number correctly.
