# Workflow: refine-spec

> Orchestrator workflow for `/jlu:refine-spec [task-slug]`
> Structured interview to expand a minimal spec seed into a full, implementation-ready specification.

---

## Step 1 — Resolve Task

1. If a `task-slug` is provided as a command argument:
   a. Read `.spec-workspace.json` from the current directory to get the `workspace` path.
   b. Locate the task by searching `<WORKSPACE_PATH>/specs/` for a folder matching the slug.
   c. Search across all date folders — the slug should be unique.
2. If no `task-slug` provided:
   a. Read `.spec-workspace.json` to get the workspace path.
   b. Find the most recent task:
      - List date folders in `<WORKSPACE_PATH>/specs/` sorted descending.
      - Within the most recent date folder, pick the most recently modified task folder.
   c. Confirm with the user: "Found task `<task-slug>` from `<date>`. Use this one?"

**Error gate**: If no task can be resolved, stop: "No task found. Run `/jlu:new-task` first to create one."

**Store**: `TASK_DIR` = absolute path to the task folder, `TASK_SLUG`

---

## Step 2 — Read SPEC.md Seed

1. Read `<TASK_DIR>/SPEC.md`.
2. If the file does not exist or is empty:
   - Stop: "SPEC.md is missing or empty at `<TASK_DIR>/SPEC.md`. Run `/jlu:new-task` to create it."

**Store**: `SPEC_CONTENT` = full contents of SPEC.md

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
   - If user chooses to map: pause this workflow, instruct user to run `/jlu:map-codebase`, then re-run `/jlu:refine-spec`.
   - If user chooses to continue: proceed with whatever context is available.

---

## Step 7 — Build Composite Context

Assemble the full context string that will be injected into the spec-interviewer agent's prompt. Order matters for clarity:

```
=== SPEC.md (Seed) ===
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
   ```

**What the agent does** (defined in its agent file, summarized here for reference):

1. **Gap analysis** (silent) — Analyzes SPEC.md seed against codebase knowledge. Identifies ambiguities, conflicts, implicit assumptions, edge cases, integration points, NFRs, and known concerns.
2. **Structured interview** — Asks the user 2-4 themed questions per round. Themes: architecture, behavior, edge cases, security, performance, integrations, UX, constraints. Questions are informed by codebase context (non-obvious, specific). Continues until the agent has enough to fill all 5 sections.
3. **Write SPEC.md** — Rewrites `<TASK_DIR>/SPEC.md` with structured sections: Problem Statement, Requirements (FR/NFR), Constraints, Out of Scope, Success Criteria. Requirements are numbered (FR-1, NFR-1, SC-1) for traceability.
4. **Present for approval** — Shows the complete spec to the user. User must explicitly approve.

**Important**: The orchestrator does NOT perform the interview or write the spec. It delegates entirely to the spec-interviewer agent. The orchestrator's job is to load context and spawn the agent.

---

## Step 9 — Post-Agent Confirmation

After the spec-interviewer agent completes:

1. Verify that `<TASK_DIR>/SPEC.md` has been updated (file size should be larger than the seed).
   - If not updated: warn "The spec-interviewer did not appear to update SPEC.md. Review the agent output."

2. Check the agent's output for approval status:
   - If the user **approved** the spec:
     a. Update `<TASK_DIR>/TASKS.md`:
        - Change `Status: draft` to `Status: planned`
        - Add transition timestamp: `- Planned: <current-datetime-ISO>`
     b. Report: "SPEC.md approved. Task transitioned to `planned`. Next step: run `/jlu:execute-task` to begin implementation."
   - If the user **did not approve** or the agent ended without approval:
     a. Leave TASKS.md status as `draft` (or `refining` if it was already in that state).
     b. Report: "SPEC.md was updated but not yet approved. You can:"
        - "Review and edit `<TASK_DIR>/SPEC.md` manually, then re-run `/jlu:refine-spec`"
        - "Continue from where you left off by re-running `/jlu:refine-spec <TASK_SLUG>`"

---

## Error Handling

| Error | Action |
|-------|--------|
| No task found | Stop with message to run `/jlu:new-task` first |
| SPEC.md missing or empty | Stop with message to run `/jlu:new-task` first |
| All codebase files missing | Warn, offer `/jlu:map-codebase`, allow continue without |
| Engineering principles missing | Note and continue |
| Spec-interviewer agent fails | Report failure, suggest re-running the command |
| User cancels interview midway | Agent writes spec with what it has, orchestrator preserves partial work |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| SPEC.md (input seed, output refined) | `.spec-workspace/specs/<date>/<task-slug>/SPEC.md` |
| TASKS.md (status update) | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
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
