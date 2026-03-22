# Summary Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `jlu-summary-agent` that produces a fixed-format execution summary, and integrate it into `execute-task` and `load-context` workflows.

**Architecture:** A new read-only agent (`agents/jlu-summary-agent.md`) reads TASKS.md and git state to produce a standardized summary. The `execute-task` workflow dispatches it in Step 9 (replacing the inline template), and `load-context` dispatches it in a new Step 8 (replacing the inline Current Status section).

**Tech Stack:** Claude Code plugin agents (Markdown prompt files), no runtime code.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `agents/jlu-summary-agent.md` | Agent definition: data extraction logic, output format, error handling |
| Modify | `jelou/workflows/execute-task.md` (Step 9) | Replace inline summary with agent dispatch |
| Modify | `skills/load-context/SKILL.md` (Steps 6, 7 + new Step 8) | Remove Current Status from Step 7, add Step 8 for agent dispatch |

---

### Task 1: Create the summary agent

**Files:**
- Create: `agents/jlu-summary-agent.md`

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-03-22-summary-agent-design.md` (full output format, data sources table, format rules, error handling table)
- Existing agent pattern: `agents/jlu-qa-agent.md` (frontmatter format, mission/rules structure)
- TASKS.md schema: `agents/jlu-tasks-agent.md` lines 33-92 (exact section names and table columns)
- Git commit convention: `agents/jlu-git-agent.md` lines 68-73 (`Phase NN of spec/<slug>` in commit body)
- Lifecycle state mapping: `skills/load-context/SKILL.md` lines 89-98 (state → next step for `context-load` hint)

- [ ] **Step 1: Write the agent frontmatter**

```markdown
---
name: jlu-summary-agent
description: "Generates fixed-format execution summary from TASKS.md and git state"
tools: Read, Bash, Glob, Grep
model: sonnet
---
```

Follow the same frontmatter pattern as `agents/jlu-qa-agent.md`.

- [ ] **Step 2: Write the Mission section**

Describe the agent's purpose: read-only agent that produces a standardized summary. It receives `TASK_DIR` and `CONTEXT_HINT` (either `post-execution` or `context-load`) from the orchestrator's prompt.

- [ ] **Step 3: Write the Data Extraction section**

Document step-by-step how the agent extracts each metric. Use the Data Sources table from the spec (`docs/superpowers/specs/2026-03-22-summary-agent-design.md` lines 85-98) as the source of truth. For each metric, include:
- What to read (exact TASKS.md section name or git command)
- How to parse it (e.g., "sum the `Total` column across all rows in `#### Test Results`")
- Fallback if the source is unavailable

Specific extraction instructions:

1. **Task slug and title**: Read `# Tasks — <Title>` heading from TASKS.md. Extract slug from the task directory name.
2. **Lifecycle status**: Read `## Status` → `**Lifecycle**:` field.
3. **Services**: Read `## Services` → each `### <service-id>` subheading.
4. **Phase names and status**: Read `#### Phases` table per service. Count `done` vs total rows.
5. **Per-phase test counts**: Read `#### Test Results` table per service. The `Total` column (e.g., `15/15`) gives the count for each phase row.
6. **Aggregate test counts**: Sum `Unit`, `Integration`, `E2E` columns across all rows in all `#### Test Results` tables. Parse `X/Y` format — use the numerator (passing count).
7. **No regressions**: Search Timeline table for an entry containing "Baseline:" — extract the number. If not found, omit the line.
8. **Commits and branch**: Run `git rev-parse --abbrev-ref HEAD` and `git log --oneline main..HEAD | wc -l`.
9. **Files changed**: Run `git diff --stat main...HEAD` — count output lines (minus the summary line). Run `git diff --summary main...HEAD` — count lines containing `create mode` for new files.
10. **Lines added/removed**: Run `git diff --shortstat main...HEAD` — parse "X insertions(+), Y deletions(-)".
11. **Duration**: Parse Timeline table — find first "Execution started" row and last row. Compute delta between their timestamps. Format as `Xh Ym`. If multiple "Execution started"/"Execution resumed" events exist, note "across N sessions".
12. **Per-phase file list**: For each phase number NN, run `git log --all --grep="Phase NN of" --name-only --pretty=format:""`. Filter out empty lines. Extract filenames only (strip directory paths). If no results, show `—`.

- [ ] **Step 4: Write the Output Format section**

Include the exact output template from the spec (lines 29-58). Document both variants:

For `post-execution`:
- Heading: `## Execution Complete`
- Next Steps: always starts with `/jlu:create-pr`, then `/jlu:close-task`, then context-specific notes

For `context-load`:
- Heading: `## Task Summary`
- Next Steps: adapted per lifecycle state. Include the full mapping table from the spec (lines 68-77).

Include the ASCII table format for "What was built" — the agent must dynamically size column widths to fit content.

- [ ] **Step 5: Write the Format Rules section**

Copy all rules from the spec (lines 61-81):
- Omit test types with 0 count
- Omit "No regressions" if no baseline
- Duration format `Xh Ym`
- Filenames only in table (no paths)
- Context-specific notes in Next Steps

- [ ] **Step 6: Write the Error Handling section**

Include the full error handling table from the spec (lines 124-131):
- TASKS.md not found → abort with message
- No Services section → abort with message
- Git fails → omit git metrics, show `—`
- Phase files missing → use TASKS.md only, show `—` for file list
- Timeline empty → omit duration
- Task in `draft`/`planned` → minimal summary (slug, status, services, Next Steps only; skip ASCII table and test metrics)

- [ ] **Step 7: Write the Rules section**

- Read-only agent — never modify any files
- Always run git commands before parsing output (never assume)
- Always read TASKS.md before producing output (never assume)
- Output must be valid Markdown
- Test counts must match TASKS.md exactly — never estimate
- If data is unavailable, degrade gracefully (omit the line or show `—`) — never fabricate

- [ ] **Step 8: Review the complete agent file**

Read back `agents/jlu-summary-agent.md` and verify:
- Frontmatter has name, description, tools, model
- All 12 data extraction steps are present
- Both output variants (post-execution, context-load) are documented
- Error handling covers all 6 conditions from the spec
- No references to sections/tables that don't exist in the TASKS.md schema

- [ ] **Step 9: Commit**

```bash
git add agents/jlu-summary-agent.md
git commit -m "Add jlu-summary-agent for standardized execution summaries"
```

---

### Task 2: Integrate into execute-task workflow (Step 9)

**Files:**
- Modify: `jelou/workflows/execute-task.md` lines 395-419

**Reference docs:**
- Current Step 9: `jelou/workflows/execute-task.md` lines 395-419 (the inline template to replace)
- Spec integration: `docs/superpowers/specs/2026-03-22-summary-agent-design.md` lines 108-112

- [ ] **Step 1: Read the current Step 9**

Read `jelou/workflows/execute-task.md` lines 393-420 to confirm the exact content being replaced.

- [ ] **Step 2: Replace the inline summary in Step 9**

Replace the content of Step 9 (lines 395-419). Keep item 1 (TASKS.md update) unchanged. Replace item 2 (the inline summary template) with:

```markdown
## Step 9 — Success Path

If all validation passes:

1. Update TASKS.md:
   - Status: `validating` → `ready_to_publish`
   - Add completion timestamp
   - Record final test counts
2. Dispatch `jlu-summary-agent`:
   - Pass `TASK_DIR` (the resolved task directory path)
   - Pass `CONTEXT_HINT` = `post-execution`
   - Print the agent's output verbatim — do not add to or reformat it.
```

**Note:** The old Step 9 referenced `/jlu:sync-clickup` as a next step. This is intentionally removed — the summary agent's output uses `/jlu:create-pr` per the spec. ClickUp sync can happen at any time and is not part of the critical path.

- [ ] **Step 3: Verify surrounding steps are untouched**

Read back lines 380-450 of execute-task.md to confirm Step 8 and Step 10 are intact.

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Replace inline summary in execute-task Step 9 with summary agent dispatch"
```

---

### Task 3: Integrate into load-context skill (Steps 6, 7, and new Step 8)

**Files:**
- Modify: `skills/load-context/SKILL.md` lines 76-161

**Reference docs:**
- Current Step 6: `skills/load-context/SKILL.md` lines 76-100 (status derivation — keep Step 6 intact, the summary agent reuses this logic internally)
- Current Step 7: `skills/load-context/SKILL.md` lines 102-160 (context block with Current Status section to remove)
- Spec integration: `docs/superpowers/specs/2026-03-22-summary-agent-design.md` lines 114-120
- Allowed tools: `skills/load-context/SKILL.md` lines 5-9 (currently Read, Bash, Glob, Grep — no change needed since the agent is dispatched as a sub-agent by the orchestrator)

- [ ] **Step 1: Read the current Steps 6 and 7**

Read `skills/load-context/SKILL.md` lines 76-161 in full.

- [ ] **Step 2: Remove Current Status from Step 7**

In the Step 7 context block template (lines 106-157), remove the "Current Status" section (lines 112-119, including the trailing `---` separator):

```
### Current Status

**Stage**: <human-readable label (from Step 6 mapping)>
**Progress**: <phases done>/<total> phases complete  ← only if state is `implementing` or later
**Next step**: `<command>` — <one-sentence reason from Step 6 mapping>
**Active blockers**: <"None" or bulleted list of blocker descriptions>

---
```

Keep everything else in Step 7: the header (`## Task: ...`), `### Loaded Artifacts`, `### Git Activity`, `### Change Scope`, and `### Artifact Inventory` sections.

- [ ] **Step 3: Add new Step 8 — Summary**

After the Step 7 context block (after the artifact inventory), add a new Step 8 before the closing message:

```markdown
---

## Step 8 — Task Summary

Dispatch `jlu-summary-agent`:
- Pass `TASK_DIR` (the resolved task directory path from Step 2)
- Pass `CONTEXT_HINT` = `context-load`
- Print the agent's output before the closing message.

After the summary, tell the user:
> Context loaded. You can ask me anything about this task. I can read any artifact from the inventory above for more detail.
```

Move the existing closing message ("Context loaded. You can ask me anything...") from the end of Step 7 into Step 8 so it appears after the summary.

- [ ] **Step 4: Keep Step 6 intact**

Step 6 (Derive Status Summary, lines 76-100) stays unchanged. The summary agent performs its own status derivation internally, but Step 6's logic is still needed for the load-context orchestrator's internal use (e.g., deciding whether to show phase counts). No edits to Step 6.

- [ ] **Step 5: Read back the full modified file**

Read `skills/load-context/SKILL.md` in full to verify:
- Step 6 is intact
- Step 7 no longer has Current Status section
- New Step 8 dispatches the summary agent
- Closing message is in Step 8

- [ ] **Step 6: Commit**

```bash
git add skills/load-context/SKILL.md
git commit -m "Integrate summary agent into load-context as Step 8"
```

---

### Task 4: Register agent in plugin system

**Files:**
- Check: `.claude-plugin/plugin.json` — verify if agents need explicit registration (current agents don't appear to be listed here, so this may be auto-discovered)
- Check: any agent registry or index file

- [ ] **Step 1: Verify agent discovery mechanism**

Check how existing agents are discovered. Read `.claude-plugin/plugin.json` and search for any agent registry pattern:

```bash
grep -r "jlu-qa-agent\|jlu-tasks-agent" .claude-plugin/ jelou/ skills/ --include="*.json" --include="*.md" -l
```

If agents are auto-discovered from the `agents/` directory (likely, since `plugin.json` doesn't list them), then no registration is needed — the file created in Task 1 is sufficient.

- [ ] **Step 2: Verify the agent is referenceable**

Confirm the agent name `jlu-summary-agent` follows the naming convention of existing agents (all use `jlu-<role>-agent` pattern). Verify the file is in `agents/` directory alongside the others.

- [ ] **Step 3: Commit (if any registration was needed)**

Only commit if changes were made. If auto-discovered, skip this step.

---

### Task 5: Final verification

- [ ] **Step 1: Verify all files are consistent**

Read these files and cross-check references:
- `agents/jlu-summary-agent.md` — references correct TASKS.md section names
- `jelou/workflows/execute-task.md` Step 9 — references `jlu-summary-agent` by correct name
- `skills/load-context/SKILL.md` Step 8 — references `jlu-summary-agent` by correct name

- [ ] **Step 2: Verify no broken cross-references**

Check that:
- The TASKS.md section names referenced in the agent (`## Status`, `## Services`, `#### Phases`, `#### Test Results`, `## Timeline`) match the schema in `agents/jlu-tasks-agent.md`
- The lifecycle state mapping in the agent matches the mapping in `skills/load-context/SKILL.md` Step 6
- The git commit pattern (`Phase NN of spec/<slug>`) matches the convention in `agents/jlu-git-agent.md`

- [ ] **Step 3: Commit plan document**

```bash
git add docs/superpowers/plans/2026-03-22-summary-agent.md
git commit -m "Add summary agent implementation plan"
```
