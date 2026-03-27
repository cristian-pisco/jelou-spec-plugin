# Close-Task Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the midnight timestamp bug in close-task and add "Sprint points" field mapping to sync-clickup.

**Architecture:** Two independent edits to workflow markdown files. No code, no tests — these are prompt/instruction files that guide agent behavior.

**Tech Stack:** Markdown workflow definitions (jelou plugin format)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `jelou/workflows/close-task.md` | Modify | Add explicit timestamp generation, replace 3 placeholders |
| `jelou/workflows/sync-clickup.md` | Modify | Add Sprint points to 4 locations |

---

### Task 1: Fix timestamp generation in close-task.md

**Files:**
- Modify: `jelou/workflows/close-task.md:66-119`

- [ ] **Step 1: Add timestamp generation instruction at start of Step 3**

At line 68, after "If all preconditions pass (or user overrides), proceed with closure.", insert:

```markdown
> **Timestamp**: Before executing any closure action, generate the current UTC timestamp by running:
> ```bash
> date -u +"%Y-%m-%dT%H:%M:%SZ"
> ```
> Store the output as `CLOSE_TIMESTAMP`. Use this value everywhere a closure timestamp is needed below.
```

- [ ] **Step 2: Replace placeholder in 3a (CLICKUP_TASK.json)**

At line 81, replace:
```
"closedAt": "<ISO-timestamp>",
```
with:
```
"closedAt": "<CLOSE_TIMESTAMP>",
```

- [ ] **Step 3: Replace placeholder in 3b (TASKS.md)**

At line 93, replace:
```
- Add closure timestamp: `- Closed: <current-datetime-ISO>`
```
with:
```
- Add closure timestamp: `- Closed: <CLOSE_TIMESTAMP>`
```

- [ ] **Step 4: Replace placeholder in 3c (observability event)**

At line 104, replace:
```
"timestamp": "<ISO-timestamp>",
```
with:
```
"timestamp": "<CLOSE_TIMESTAMP>",
```

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/close-task.md
git commit -m "fix(close-task): use explicit UTC timestamp instead of ambiguous placeholders"
```

---

### Task 2: Add "Sprint points" field mapping to sync-clickup.md

**Files:**
- Modify: `jelou/workflows/sync-clickup.md:66-174`

- [ ] **Step 1: Add Sprint points to field mappings table (Step 3)**

At line 71, after the row `| Story Points | Story points |`, insert a new row:
```
| Sprint Points | Sprint points |
```

- [ ] **Step 2: Add Sprint points inference rule (Step 4)**

At line 98, after the row `| **Story Points / Talla** | From number of phases, services, requirements, codebase complexity |`, insert a new row:
```
| **Sprint Points** | Same value as Story Points — must always be equal |
```

- [ ] **Step 3: Add Sprint Points to subtask inheritance list (Step 7)**

At line 152, replace:
```
3. **Subtasks inherit ALL parent custom fields**: Riesgo, Equipo, Tipo proyecto, Solicitante, Front, Talla, Responsable, Sprint, Story Points, Necesita Diseno.
```
with:
```
3. **Subtasks inherit ALL parent custom fields**: Riesgo, Equipo, Tipo proyecto, Solicitante, Front, Talla, Responsable, Sprint, Story Points, Sprint Points, Necesita Diseno.
```

- [ ] **Step 4: Add Sprint points to CLICKUP_TASK.json schema (Step 8)**

At line 174, after `"Sprint": "<field-id>"`, add a trailing comma to that line and insert a new line:
```
"Sprint": "<field-id>",
"Sprint points": "<field-id>"
```

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/sync-clickup.md
git commit -m "feat(sync-clickup): add Sprint points field mapping mirroring Story Points"
```
