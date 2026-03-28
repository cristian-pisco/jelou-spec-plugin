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

## Step 7 — Review Loaded Context

Before starting the interview, confirm you have loaded:
- `CHANGE_REQUEST` from Step 2
- `SPEC_CONTENT` from Step 2
- `CODEBASE_CONTEXT` from Step 4
- `PRINCIPLES_CONTENT` from Step 5

All of these are already in memory from previous steps. No assembly needed — proceed directly to the interview.

---

## Step 8 — Interview and Update Spec

> **Tool requirement reminder**: Every question and confirmation in this step MUST use `AskUserQuestion`. Never output questions as plain text.

### 8a — Change Analysis (silent)

Before asking any questions, silently analyze:
- Which sections of the existing SPEC.md are affected by `CHANGE_REQUEST`
- Conflicts between the change and the existing architecture/conventions in `CODEBASE_CONTEXT`
- Implicit assumptions the change introduces that need confirmation
- Edge cases, error scenarios, and security implications specific to the change
- Integration points affected (cross-reference with INTEGRATIONS.md in `CODEBASE_CONTEXT`)

Prioritize by impact: architectural implications > behavioral changes > edge cases > cosmetic details.

### 8b — Structured Interview

Using `AskUserQuestion`, interview the user to clarify the change's scope and constraints.

Rules:
- **2-4 questions per round**, grouped by theme — never random
- **Scoped to the change** — do NOT re-interview the full spec. Only ask about implications, conflicts, or gaps introduced by `CHANGE_REQUEST`.
- **Themes** (in rough priority order):
  1. Technical implementation details (how does this change get built? what patterns apply?)
  2. Tradeoffs & alternatives (why this change over others? what are we giving up?)
  3. Architecture & design impact (how does this change affect the existing system design?)
  4. Behavioral changes (what exactly changes in each affected scenario?)
  5. Edge cases & error handling (what new failure modes does this change introduce?)
  6. Security & authorization (does this change affect access control or sensitive data?)
  7. Performance & scalability (does this change affect latency, throughput, or resource usage?)
  8. Integration points (does this change affect other services or external systems?)
  9. UX/UI implications (if applicable — user-facing behavior changes)
  10. Constraints & out-of-scope (what should we explicitly NOT change?)
- **Ask non-obvious questions** — informed by what you found in the codebase context, not generic. Reference specific files, patterns, or conventions you observed.
  - Good: "INTEGRATIONS.md shows this service uses async events for payments. Does this change affect the event schema?"
  - Bad: "Are there any other systems affected?"
- **Go deep** — don't accept vague answers. If the user says "it should be fast", ask "what's the latency budget?"
- **Continue until complete** — keep interviewing until you can confidently update all affected sections of the spec.
- **Respect the user** — if the user says "that's enough" or "move on", stop the interview and update the spec with what you have.

### 8c — Update SPEC.md

After the interview is complete:
1. Update only the affected sections of `<TASK_DIR>/SPEC.md`, preserving everything else.
2. Maintain numbered requirements for traceability (FR-N, NFR-N, SC-N). When adding new requirements, continue the existing numbering sequence.
3. If a requirement is modified, keep its original number and update the text.
4. If a requirement is removed, note it as "Removed" rather than renumbering.

Write the result to `<TASK_DIR>/SPEC.md`.

### 8d — Present for Approval

Using `AskUserQuestion`, present the updated spec to the user:
1. A brief summary of what changed and why
2. List of sections that were modified
3. Any areas where you had to make judgment calls or where information was incomplete
4. Ask clearly: "Do you approve these changes to SPEC.md?"

If the user wants changes, make them and re-present. Loop until the user approves or explicitly stops.

---

## Step 9 — Post-Interview Confirmation

After the user approves (or declines) the spec update:

1. Verify that `<TASK_DIR>/SPEC.md` has been updated.

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
| Interview interrupted (session timeout, user abort) | Save any spec changes made so far, report partial state |
| User cancels interview midway | Update spec with answers gathered so far, preserve partial work |

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
