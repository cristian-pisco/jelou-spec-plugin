# Fix close-task timestamp and add Sprint points field

## Problem

Two issues observed when running `jlu:close-task`:

1. **Wrong close timestamp**: The ClickUp activity panel shows `2026-03-25T00:00:00-05:00` instead of the actual time (e.g., `13:17`). The workflow uses ambiguous placeholders (`<ISO-timestamp>`, `<current-datetime-ISO>`) that the Sonnet agent interprets as date-only, defaulting to midnight.

2. **Missing "Sprint points" field**: The `sync-clickup` workflow maps "Story Points" to ClickUp but doesn't map "Sprint points", a separate custom field in ClickUp that should always mirror the Story Points value.

## Changes

### Fix 1: Explicit timestamp generation in close-task.md

**File**: `jelou/workflows/close-task.md`

Add an explicit Bash command at the start of Step 3 to generate the real timestamp:

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

The agent must store this result as `CLOSE_TIMESTAMP` and use it in all three locations:

- Line 81: `"closedAt"` in CLICKUP_TASK.json
- Line 93: `- Closed:` in TASKS.md
- Line 103: `"timestamp"` in observability events

Replace all ambiguous placeholders (`<ISO-timestamp>`, `<current-datetime-ISO>`) with `<CLOSE_TIMESTAMP>` to make it clear they reference the same pre-computed value.

### Fix 2: Add "Sprint points" field mapping in sync-clickup.md

**File**: `jelou/workflows/sync-clickup.md`

Four changes:

1. **Step 3 — Field mappings table**: Add row `| Sprint Points | Sprint points |`
2. **Step 4 — Inference table**: Add row `| Sprint Points | Same value as Story Points — must always be equal |`
3. **Step 7 — Subtask inheritance list**: Add "Sprint Points" to the list of fields subtasks inherit from parent
4. **Step 8 — CLICKUP_TASK.json schema**: Add `"Sprint points": "<field-id>"` to the `field_mappings` block

The rule is simple: Sprint points = Story points, always. No independent inference.

## Files Modified

| File | Change |
|------|--------|
| `jelou/workflows/close-task.md` | Add explicit timestamp generation via Bash, replace 3 placeholders |
| `jelou/workflows/sync-clickup.md` | Add Sprint points to field mapping, inference, inheritance, and schema |

## Out of Scope

- No changes to the close-task launcher skill (`skills/close-task/SKILL.md`)
- No changes to the CLICKUP_TASK.json template (it's a skeleton, fields are added dynamically)
- No new files or scripts
