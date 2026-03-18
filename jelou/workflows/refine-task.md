# Workflow: refine-task

> Orchestrator workflow for `/jlu:refine-task [change description]`
> Apply a last-minute targeted change to an already-approved spec via structured agent interview.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.

---

## Step 1 — Resolve Task

1. If a `task-slug` is provided as a command argument:
   a. Read `.spec-workspace.json` from the current directory to get the `workspace` path.
   b. Locate the task by searching `<WORKSPACE_PATH>/specs/` for a folder matching the slug.
   c. Search across all date folders — the slug should be unique.
2. If no `task-slug` provided (and no change description, or the argument looks like a change description rather than a slug):
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Find the most recent task:
      - List date folders in `<WORKSPACE_PATH>/specs/` sorted descending.
      - Within the most recent date folder, pick the most recently modified task folder.
   c. Confirm with the user: "Found task `<task-slug>` from `<date>`. Apply changes to this one?"

**Error gate**: If no task can be resolved, stop: "No task found. Run `/jlu:new-task` first to create one."

**Store**: `TASK_DIR` = absolute path to the task folder, `TASK_SLUG`

---

## Step 2 — Get Change Request

1. Read `<TASK_DIR>/SPEC.md`.
   - If the file does not exist or is empty:
     - Stop: "SPEC.md is missing or empty at `<TASK_DIR>/SPEC.md`. Run `/jlu:new-task` to create it."

2. Determine `CHANGE_REQUEST`:
   - If the command argument looks like a change description (not a task slug), use it as `CHANGE_REQUEST`.
   - If no change description was provided, ask the user:
     > "What change do you want to apply to this spec?"

**Store**: `SPEC_CONTENT` = full contents of SPEC.md, `CHANGE_REQUEST` = the change to apply

---

## Step 3 — Identify Affected Services

1. Read `<TASK_DIR>/TASKS.md`.
2. Extract the list of affected services from the "Services" section.
3. If no affected services are listed:
   a. Read `.spec-workspace.json` to get the current `serviceId`.
   b. Use that as the sole affected service.
4. For each affected service, read the corresponding entry from `<WORKSPACE_PATH>/registry/services.yaml` to get paths and stacks.

**Store**: `AFFECTED_SERVICES` = list of `{id, path, stack}`

---

## Step 4 — Load Context Files

For each service in `AFFECTED_SERVICES`, attempt to read:

- `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/STACK.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/INTEGRATIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONCERNS.md`

Track which files exist and which are missing.

**Store**: `CODEBASE_CONTEXT` = map of service-id -> map of filename -> content

---

## Step 5 — Read Engineering Principles

1. Read `<WORKSPACE_PATH>/principles/ENGINEERING_PRINCIPLES.md`.
2. If the file does not exist, note it but do not block. The interview can proceed without it.

**Store**: `PRINCIPLES_CONTENT` = contents (or empty string if missing)

---

## Step 6 — Warn on Missing Context

1. If any codebase files are missing for any affected service:
   - Present a warning for each:
     ```
     Missing codebase files for <service-id>:
       - ARCHITECTURE.md
       - STACK.md
       - (etc.)
     ```
   - Offer: "Run `/jlu:map-codebase <service-id>` to generate them? Or continue without codebase context?"
   - If user chooses to map: pause this workflow, instruct user to run `/jlu:map-codebase`, then re-run `/jlu:refine-task`.
   - If user chooses to continue: proceed with whatever context is available.

---

## Step 7 — Build Composite Context

Assemble the full context string that will be injected into the spec-interviewer agent's prompt. The change request is prepended so the agent knows its primary objective:

```
=== CHANGE REQUEST ===
<CHANGE_REQUEST>

=== SPEC.md (Current Approved Specification) ===
<SPEC_CONTENT>

=== Engineering Principles ===
<PRINCIPLES_CONTENT>

=== Service: <service-id-1> ===

--- ARCHITECTURE.md ---
<content>

--- STACK.md ---
<content>

--- CONVENTIONS.md ---
<content>

--- INTEGRATIONS.md ---
<content>

--- STRUCTURE.md ---
<content>

--- CONCERNS.md ---
<content>

=== Service: <service-id-2> ===
(repeat for each affected service)
```

**Store**: `COMPOSITE_CONTEXT` = the full assembled context string

---

## Step 8 — Spawn Spec-Interviewer Agent

Notify the user before spawning:
```
Spawning spec-interviewer agent (Opus) to analyze the change and interview you about implications...
```

Spawn a single `jlu-spec-interviewer` agent with model: **opus**.

**Agent prompt construction**:

1. Read the agent definition from `<plugin-root>/agents/jlu-spec-interviewer.md`.
2. Prepend `COMPOSITE_CONTEXT` before the agent instructions.
3. Append task metadata:
   ```
   Task slug: <TASK_SLUG>
   Task directory: <TASK_DIR>
   SPEC.md path: <TASK_DIR>/SPEC.md
   Affected services: <comma-separated list>
   Mode: refine (apply targeted change to existing spec)
   Change request: <CHANGE_REQUEST>
   ```

**What the agent does** (the orchestrator does NOT analyze the change itself — full delegation):

1. **Change analysis** (silent) — Analyzes the change request against the existing spec and codebase. Identifies implications, conflicts, gaps the change introduces, and sections of the spec that are affected.
2. **Structured interview** — Asks the user focused questions to clarify the change's scope and constraints. Questions are specific to the change (not a full re-interview of the original spec).
3. **Update SPEC.md** — Updates only the affected sections of the spec, preserving everything else. Maintains numbered requirements for traceability.
4. **Present for approval** — Shows the updated spec (or diff of changes) to the user. User must explicitly approve.

**Important**: The orchestrator does NOT perform the change analysis or update the spec. It delegates entirely to the spec-interviewer agent.

---

## Step 9 — Post-Agent Confirmation

After the spec-interviewer agent completes:

1. Verify that `<TASK_DIR>/SPEC.md` has been updated.
   - If not updated: warn "The spec-interviewer did not appear to update SPEC.md. Review the agent output."

2. Update `<TASK_DIR>/TASKS.md` based on the task's current status:
   - If task status is `planned` or `implementing`: **keep current status** (a spec refinement does not reset execution state).
   - Add a note to the Lifecycle section:
     ```
     - Spec refined: <current-datetime-ISO> — <CHANGE_REQUEST summary (first 100 chars)>
     ```

3. Report the outcome:
   - If approved: "Spec updated. Task status remains `<STATUS>`. Change recorded in TASKS.md lifecycle."
   - If not approved: "SPEC.md was updated but not yet approved. Re-run `/jlu:refine-task <TASK_SLUG>` to continue."

---

## Error Handling

| Error | Action |
|-------|--------|
| No task found | Stop with message to run `/jlu:new-task` first |
| SPEC.md missing or empty | Stop with message to run `/jlu:new-task` first |
| All codebase files missing | Warn, offer `/jlu:map-codebase`, allow continue without |
| Engineering principles missing | Note and continue |
| Spec-interviewer agent fails | Report failure, suggest re-running the command |
| User cancels interview midway | Agent updates spec with what it has, orchestrator preserves partial work |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| SPEC.md (updated in place) | `.spec-workspace/specs/<date>/<task-slug>/SPEC.md` |
| TASKS.md (lifecycle note added) | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| Codebase files (read-only) | `.spec-workspace/services/<service-id>/codebase/*.md` |
| Engineering principles (read-only) | `.spec-workspace/principles/ENGINEERING_PRINCIPLES.md` |

---

## Decision References

| Decision | Application |
|----------|-------------|
| #6 | Structured questionnaire after reading codebase |
| #37 | Minimal seed + interview expands to structured spec |
| #33 | Context loaded by orchestrator, not self-read by agent (tiered prompts) |
| #43 | Global principles + per-service conventions both injected |
