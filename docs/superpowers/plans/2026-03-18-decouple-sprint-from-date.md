# Decouple Sprint Number from Creation Date — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Sprint date prompt with a Sprint number prompt and auto-generate the creation date, so agents stop putting dates in the Sprint field.

**Architecture:** Three markdown files need text edits. The workflow file (`new-task.md`) gets the bulk of changes (prompt, validation, variable names, directory paths). The template and downstream docs get minor text updates for consistency.

**Tech Stack:** Markdown files only — no code, no tests.

**Spec:** `docs/superpowers/specs/2026-03-18-decouple-sprint-from-date-design.md`

---

### Task 1: Update Step 3 prompt in `jelou/workflows/new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md:82-94`

- [ ] **Step 1: Replace the Sprint date prompt with Sprint number prompt**

Replace lines 88-94 of `jelou/workflows/new-task.md`:

**Current (lines 88-94):**
```markdown
2. **Sprint date**:
   - Ask the user:
     > "Sprint date for this task? (dd-mm-yyyy format, press Enter for current week's Monday)"
   - Default: Calculate the Monday of the current week in `dd-mm-yyyy` format.
   - Validate the format. If invalid, ask again.

**Store**: `TASK_DESCRIPTION`, `SPRINT_DATE`
```

**Replace with:**
```markdown
2. **Sprint number**:
   - Ask the user:
     > "Sprint number for this task? (positive integer, e.g. 14)"
   - No default. The user must provide a value.
   - Validate: must be a positive integer (> 0). If invalid, ask again.
3. **Creation date**:
   - Auto-generate today's date in `dd-mm-yyyy` format using the system's local timezone.
   - Do NOT prompt the user.

**Store**: `TASK_DESCRIPTION`, `SPRINT_NUMBER`, `CREATION_DATE`
```

- [ ] **Step 2: Verify the edit**

Read `jelou/workflows/new-task.md` lines 82-100 and confirm the new text is in place with no formatting issues.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "Replace Sprint date prompt with Sprint number prompt in new-task workflow"
```

---

### Task 2: Update directory path references in `jelou/workflows/new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md:106,117,121`

- [ ] **Step 1: Update Step 4 directory path (line 106)**

Replace in `jelou/workflows/new-task.md`:

**Current:**
```
2. Verify the slug does not already exist at `<WORKSPACE_PATH>/specs/<SPRINT_DATE>/<task-slug>/`.
```

**Replace with:**
```
2. Verify the slug does not already exist at `<WORKSPACE_PATH>/specs/<CREATION_DATE>/<task-slug>/`.
```

- [ ] **Step 2: Update Step 5 directory creation (line 117)**

Replace in `jelou/workflows/new-task.md`:

**Current:**
```
   <WORKSPACE_PATH>/specs/<SPRINT_DATE>/<TASK_SLUG>/
```

**Replace with:**
```
   <WORKSPACE_PATH>/specs/<CREATION_DATE>/<TASK_SLUG>/
```

- [ ] **Step 3: Update Step 5 TASK_DIR store (line 121)**

Replace in `jelou/workflows/new-task.md`:

**Current:**
```
**Store**: `TASK_DIR` = `<WORKSPACE_PATH>/specs/<SPRINT_DATE>/<TASK_SLUG>`
```

**Replace with:**
```
**Store**: `TASK_DIR` = `<WORKSPACE_PATH>/specs/<CREATION_DATE>/<TASK_SLUG>`
```

- [ ] **Step 4: Verify the edits**

Read `jelou/workflows/new-task.md` lines 98-122 and confirm all three references now use `<CREATION_DATE>`.

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "Update directory path references from SPRINT_DATE to CREATION_DATE"
```

---

### Task 3: Update Sprint references in TASKS.md and Final Report in `jelou/workflows/new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md:136,389`

- [ ] **Step 1: Update Step 6 inline TASKS.md template (line 136)**

Replace in `jelou/workflows/new-task.md`:

**Current:**
```
- Sprint: <SPRINT_DATE>
```

**Replace with:**
```
- Sprint: <SPRINT_NUMBER>
```

- [ ] **Step 2: Update Step 16 Final Report (line 389)**

Replace in `jelou/workflows/new-task.md`:

**Current:**
```
- Sprint: <SPRINT_DATE>
```

**Replace with:**
```
- Sprint: <SPRINT_NUMBER>
```

Note: There are two occurrences of `- Sprint: <SPRINT_DATE>` in this file. Both must be changed.

- [ ] **Step 3: Verify the edits**

Grep for `SPRINT_DATE` in `jelou/workflows/new-task.md` — expect zero results. Grep for `SPRINT_NUMBER` — expect exactly 3 results (the Store line from Task 1, plus lines 136 and 389).

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "Update Sprint field from SPRINT_DATE to SPRINT_NUMBER in TASKS.md template and final report"
```

---

### Task 4: Update `jelou/templates/tasks.md`

**Files:**
- Modify: `jelou/templates/tasks.md:10`

- [ ] **Step 1: Rename the Sprint placeholder**

Replace in `jelou/templates/tasks.md`:

**Current:**
```
| **Sprint** | {{sprint-identifier}} |
```

**Replace with:**
```
| **Sprint** | {{sprint-number}} |
```

- [ ] **Step 2: Verify the edit**

Read `jelou/templates/tasks.md` lines 8-12 and confirm the placeholder now reads `{{sprint-number}}`.

- [ ] **Step 3: Commit**

```bash
git add jelou/templates/tasks.md
git commit -m "Rename Sprint placeholder from sprint-identifier to sprint-number"
```

---

### Task 5: Update `skills/sync-clickup/SKILL.md`

**Files:**
- Modify: `skills/sync-clickup/SKILL.md:29,84`

- [ ] **Step 1: Update artifact description (line 29)**

Replace in `skills/sync-clickup/SKILL.md`:

**Current:**
```
   - `TASKS.md` — current status, sprint date, affected services, phase progress
```

**Replace with:**
```
   - `TASKS.md` — current status, sprint number, affected services, phase progress
```

- [ ] **Step 2: Update inference table (line 84)**

Replace in `skills/sync-clickup/SKILL.md`:

**Current:**
```
| **Sprint** | From TASKS.md sprint date |
```

**Replace with:**
```
| **Sprint** | From TASKS.md sprint number |
```

- [ ] **Step 3: Verify the edits**

Grep for `sprint date` in `skills/sync-clickup/SKILL.md` — expect zero results. Grep for `sprint number` — expect exactly 2 results.

- [ ] **Step 4: Commit**

```bash
git add skills/sync-clickup/SKILL.md
git commit -m "Update Sprint references from 'sprint date' to 'sprint number' in sync-clickup skill"
```

---

### Task 6: Final verification

- [ ] **Step 1: Global grep for stale references**

Run: `grep -rn "sprint date\|sprint-date\|SPRINT_DATE\|sprint-identifier" jelou/ skills/ agents/ --include="*.md" --include="*.json"`

Expected: Zero results across all plugin files (ignore `JELOU_SPEC_PROPOSAL.md` and `docs/` which are out of scope).

- [ ] **Step 2: Verify new references are consistent**

Run: `grep -rn "sprint number\|sprint-number\|SPRINT_NUMBER\|sprint_number" jelou/ skills/ agents/ --include="*.md" --include="*.json"`

Expected: References in `jelou/workflows/new-task.md`, `jelou/templates/tasks.md`, and `skills/sync-clickup/SKILL.md` only.

- [ ] **Step 3: Commit verification note (if any fixups needed)**

If any stale references were found in Steps 1-2, fix them and commit:
```bash
git add -A
git commit -m "Fix remaining stale Sprint date references"
```
