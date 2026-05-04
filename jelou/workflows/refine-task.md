# Workflow: refine-task

> Orchestrator workflow for `/jlu-refine-task [change description]`
> Apply a targeted change to an already-approved spec via structured agent interview, then propagate the delta into PROPOSAL.md and phase files so `/jlu-execute-task` only re-runs affected phases.

> **Tool requirement**: All prompts, questions, and confirmations to the user MUST use `question`. Never output questions as plain text.

---

## Step 1 — Resolve Task

1. If a `task-slug` is provided as a command argument:
   a. Read `.spec-workspace.json` from the current directory to get the `workspace` path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for a folder matching the slug (slug should be unique).
2. If no `task-slug` provided (or the argument looks like a change description rather than a slug):
   a. Read `.spec-workspace.json` to get the workspace path.
   b. List date folders in `<WORKSPACE_PATH>/specs/` sorted descending. Within the most recent date folder, pick the most recently modified task folder.
   c. Confirm via `question`: "Found task `<task-slug>` from `<date>`. Apply changes to this one?"

**Error gate**: If no task can be resolved, stop: "No task found. Run `/jlu-new-task` first to create one."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`

---

## Step 2 — Get Change Request

1. Read `<TASK_DIR>/SPEC.md`.
   - If missing or empty, stop: "SPEC.md is missing or empty at `<TASK_DIR>/SPEC.md`. Run `/jlu-new-task` to create it."
2. Determine `CHANGE_REQUEST`:
   - If the command argument looks like a change description (not a task slug), use it as `CHANGE_REQUEST`.
   - Otherwise ask via `question`: "What change do you want to apply to this spec?"

**Store**: `SPEC_BEFORE` = current SPEC.md content, `CHANGE_REQUEST`

(The pre-refinement snapshot is just `SPEC_BEFORE` held in memory. Versioning happens in Step 6, where `versions/` is read once.)

---

## Step 3 — Identify Affected Services

1. Read `<TASK_DIR>/TASKS.md`.
2. Extract affected services from the "Services" section.
3. If none listed, fall back to `.spec-workspace.json` `serviceId`.
4. For each affected service, read its entry in `<WORKSPACE_PATH>/registry/services.yaml` for paths and stack metadata.

**Store**: `AFFECTED_SERVICES` = list of `{id, path, stack}`

---

## Step 4 — Load Minimal Context

For each service in `AFFECTED_SERVICES`, read in parallel (single tool-call message):

- `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/INTEGRATIONS.md`

**Skipped by default**: `STACK.md`, `STRUCTURE.md`, `CONCERNS.md`. These are large reference docs that rarely affect a targeted refinement.

**Lazy-load triggers**: if `CHANGE_REQUEST` mentions any of the following, also load the matching file in the same parallel batch:
- "stack", "framework", "version" → `STACK.md`
- "directory", "module structure", "where does X live" → `STRUCTURE.md`
- "known issue", "tech debt", "concern" → `CONCERNS.md`

**Engineering principles** (`<WORKSPACE_PATH>/principles/ENGINEERING_PRINCIPLES.md`): load ONLY if `CHANGE_REQUEST` contains an architectural keyword: "architecture", "security", "performance", "scalability", "auth", "schema", "contract", "event", "migration". Architectural decisions were already settled at `/jlu-new-task` time; loading principles unconditionally adds noise.

**Missing files**: log a single line per missing file (`note: missing <file> for <service-id>`) and continue. Do NOT prompt the user. A refinement proceeds with whatever context is available; if the user wants full coverage they can run `/jlu-map-codebase` separately.

**Store**: `CODEBASE_CONTEXT` = map of service-id -> map of filename -> content. `PRINCIPLES_CONTENT` = string (empty if not loaded).

---

## Step 5 — Interview, Update Spec, Approve

> **Tool requirement reminder**: Every question and confirmation MUST use `question`.

### 5a — Silent Change Analysis

Before asking any questions, silently analyze:
- Which sections of SPEC.md are affected by `CHANGE_REQUEST`
- Conflicts between the change and existing architecture/conventions in `CODEBASE_CONTEXT`
- Implicit assumptions the change introduces that need confirmation
- Edge cases, error scenarios, security implications specific to the change
- Integration points affected (cross-reference INTEGRATIONS.md)

Prioritize by impact: architectural implications > behavioral changes > edge cases > cosmetic details.

### 5b — Structured Interview

Using `question`, interview the user to clarify the change's scope and constraints.

Rules:
- **2-4 questions per round**, grouped by theme — never random
- **Scoped to the change** — do NOT re-interview the full spec
- **Themes** (priority order):
  1. Technical implementation details
  2. Tradeoffs & alternatives
  3. Architecture & design impact
  4. Behavioral changes
  5. Edge cases & error handling
  6. Security & authorization
  7. Performance & scalability
  8. Integration points
  9. UX/UI implications
  10. Constraints & out-of-scope
- **Ask non-obvious questions** informed by codebase context — reference specific files, patterns, or conventions you observed
  - Good: "INTEGRATIONS.md shows this service uses async events for payments. Does this change affect the event schema?"
  - Bad: "Are there any other systems affected?"
- **Go deep** — push back on vague answers ("fast" → "p95 under 200ms?")
- **Ask about tradeoffs** — surface implicit decisions
- **Continue until complete** — keep interviewing until you can confidently update all affected sections
- **Respect the user** — if they say "that's enough" or "move on", stop and update with what you have

### 5c — Update SPEC.md

1. Update only the affected sections of `<TASK_DIR>/SPEC.md`, preserving everything else.
2. Maintain numbered requirements for traceability (FR-N, NFR-N, SC-N). Continue the existing numbering sequence for new requirements.
3. Modified requirement: keep its original number, update text.
4. Removed requirement: mark as "Removed" (do not renumber).

Write to `<TASK_DIR>/SPEC.md`.

### 5d — Present for Approval

Using `question`:
1. Brief summary of what changed and why
2. List of modified sections
3. Judgment calls or areas with incomplete information
4. Ask: "Do you approve these changes to SPEC.md?"

Loop until the user approves or explicitly stops.

---

## Step 6 — Finalize: Version, Changelog, Propagate Delta, Report

After the user approves the spec update:

### 6a — Save Version + Generate Changelog

1. Ensure `<TASK_DIR>/versions/` exists. If absent, create it and snapshot `SPEC_BEFORE` as `SPEC-v1.md` (retroactive first version).
2. `CURRENT_VERSION` = highest existing `SPEC-v<N>.md` number; `NEW_VERSION` = `CURRENT_VERSION + 1`.
3. Copy the updated SPEC.md to `<TASK_DIR>/versions/SPEC-v<NEW_VERSION>.md`.
4. Compute the structured diff between `SPEC_BEFORE` and the new SPEC:
   - **Added**: new requirements, criteria, sections (with their FR/NFR/SC numbers)
   - **Changed**: requirements or sections whose text was modified (preserve their numbers)
   - **Removed**: items marked Removed (rare)
5. Append to `<TASK_DIR>/versions/SPEC-changelog.md`:
   ```markdown

   ## v<PREV> -> v<NEW> (<current-date>)
   Refined via: /jlu-refine-task "<CHANGE_REQUEST first 100 chars>"

   ### Added
   - <each new item with FR/NFR/SC number>

   ### Changed
   - <each modified item with number, showing what changed>

   ### Removed
   - <each removed item, or "(nothing)">
   ```
6. If this is the first changelog entry, create the file with header `# Spec Changelog` then append.

**Store**: `DELTA` = `{added: [...], changed: [...], removed: [...]}` with FR/NFR/SC numbers and per-item text.

### 6b — Propagate Delta to Proposal & Phase Files

If `<TASK_DIR>/PROPOSAL.md` does NOT exist: skip to 6c. The proposal will be generated fresh from the updated SPEC.md the next time `/jlu-execute-task` runs.

Otherwise, propagate the delta so execute-task only re-runs affected phases:

1. **Read** `<TASK_DIR>/PROPOSAL.md` and every phase file at `<TASK_DIR>/services/<service-id>/phases/<NN>-*.md`.

2. **Map requirements to phases**: for each phase file, parse the `## Requirements (immutable)` section and collect its FR/NFR/SC references. Build `REQ_TO_PHASE` = map of requirement number → phase file path.

3. **Apply Changed** — for each Changed item in `DELTA`:
   - Look up its phase via `REQ_TO_PHASE`.
   - If found, append a `## Modification (added <date>)` block to that phase file via `Edit` (insert before any existing `## Execution` section, or at end if absent):
     ```markdown
     ## Modification (added <date>)
     ### Reason
     Spec refined: <CHANGE_REQUEST first 100 chars>

     ### Modified Requirements
     - FR-<N> (modified): <new text>

     ### Re-Validation Required
     - Tests covering FR-<N> must be re-run/updated.
     ```
   - If the phase status is `done`: reset to `pending` (record in `RESET_PHASES`).
   - If the phase status is `pending` or `in_progress`: leave status as-is — modification will be picked up on the next run.
   - If the requirement maps to no phase (zero matches): log a warning and ask via `question`: "FR-<N> changed but no phase claims it. Which phase should own this change? (phase-NN | new)". Defer creating a new phase to step 4 below if the user chooses "new".

4. **Apply Added** — for each Added item in `DELTA`:
   - Decide placement deterministically:
     - If there is a phase whose status is `pending` AND it is the latest phase in `PROPOSAL.md`'s phase order: append the new requirement under a `## Extension (added <date>)` block in that phase file.
     - Otherwise: create a new phase file at `<TASK_DIR>/services/<service-id>/phases/<NN+1>-<change-slug>.md` from `<plugin-root>/jelou/templates/phase.md`, with the new requirements listed under `## Requirements (immutable)`.
   - Service selection for new phases: if the change request names a service, use that. If not, default to the first service in `AFFECTED_SERVICES`.
   - Record in `EXTENDED_PHASES` or `ADDED_PHASES`.

5. **Apply Removed** — for each Removed item in `DELTA`:
   - Look up its phase. Append a `## Removed (added <date>)` note documenting the removal. Do NOT delete the original immutable line — Decision #15 (preserve baseline).
   - Phase status is unchanged.

6. **Update PROPOSAL.md**:
   - If new phases were added in step 4: append them to PROPOSAL.md's phase table in dependency order.
   - Append a `## Refinement Log` entry:
     ```markdown
     ## Refinement Log
     - <date> · v<PREV> -> v<NEW>
       - Modified phases: <comma-separated phase NNs, or "(none)">
       - Reset phases: <comma-separated phase NNs that went done -> pending, or "(none)">
       - Extended phases: <list, or "(none)">
       - Added phases: <list, or "(none)">
       - Spec change: <CHANGE_REQUEST first 100 chars>
     ```

**Store**: `MODIFIED_PHASES`, `RESET_PHASES`, `EXTENDED_PHASES`, `ADDED_PHASES` (lists of phase identifiers).

### 6c — Update TASKS.md

1. Append a Lifecycle entry:
   ```
   - Spec refined: <ISO> — v<PREV> -> v<NEW> · <CHANGE_REQUEST first 100 chars>
   ```
2. **Status transition**:
   - If `RESET_PHASES` is non-empty OR `ADDED_PHASES` is non-empty: transition status to `implementing` (or keep `implementing` if already there). Add: `- Status: <prev> -> implementing (phases reopened by refinement)`.
   - Otherwise: keep current status.
3. If a Phase Progress table exists in TASKS.md, update each affected phase's status to match the phase file.

### 6d — Report

Print directly to terminal — no agent dispatch:

```
## Refinement Complete — <TASK_SLUG>

Version: v<PREV> -> v<NEW>
Spec change: <CHANGE_REQUEST first 100 chars>

### Delta
- Added requirements: <count>
- Changed requirements: <count>
- Removed requirements: <count>

### Phase Impact
- Modified in place: <list, or "(none)">
- Reset for re-execution: <list, or "(none)">
- Extended (new requirements appended): <list, or "(none)">
- New phases added: <list, or "(none)">

### Next Steps
<if RESET_PHASES or ADDED_PHASES non-empty>
- Run /jlu-execute-task to apply the refinement. Only affected phases will run.
<elif PROPOSAL.md absent>
- Run /jlu-execute-task when ready. Proposal will be generated from the refined spec.
<else>
- Refinement applied. Proposal and phase files are aligned with the new spec; no execution needed.
</if>
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No task found | Stop: "Run `/jlu-new-task` first" |
| SPEC.md missing or empty | Stop: "Run `/jlu-new-task` to create it" |
| Codebase files missing | Log per-file note, continue |
| Engineering principles missing | Skip silently (only loaded conditionally) |
| Interview interrupted (timeout, abort) | Save spec changes made so far, skip 6b, report partial state |
| User cancels mid-interview | Update spec with answers gathered so far, skip 6b, preserve partial work |
| Changed requirement maps to no phase | Ask via `question` which phase should own it (or "new") |
| Phase file references a requirement number not in SPEC.md | Log warning, leave phase file unmodified |
| PROPOSAL.md exists but is malformed | Log warning, skip 6b propagation, instruct user to delete PROPOSAL.md and let execute-task regenerate |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| SPEC.md (updated in place) | `.spec-workspace/specs/<date>/<task-slug>/SPEC.md` |
| Version snapshot | `.spec-workspace/specs/<date>/<task-slug>/versions/SPEC-v<N>.md` |
| Spec changelog | `.spec-workspace/specs/<date>/<task-slug>/versions/SPEC-changelog.md` |
| TASKS.md (lifecycle + status updated) | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| PROPOSAL.md (refinement log + phase table updated) | `.spec-workspace/specs/<date>/<task-slug>/PROPOSAL.md` |
| Phase files (modification/extension blocks added) | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/phases/<NN>-*.md` |
| Codebase files (read-only) | `.spec-workspace/services/<service-id>/codebase/{ARCHITECTURE,CONVENTIONS,INTEGRATIONS}.md` |
| Engineering principles (read-only, conditional) | `.spec-workspace/principles/ENGINEERING_PRINCIPLES.md` |

---

## Decision References

| Decision | Application |
|----------|-------------|
| #6 | Structured questionnaire after reading minimal codebase context |
| #15 | Preserve existing code/requirements as baseline — modification/extension blocks layered on top, never overwriting immutable sections |
| #19 | Phase files: immutable requirements + mutable execution + appended modification/extension/removed blocks |
| #21 | PROPOSAL.md is the contract `/jlu-execute-task` obeys — refinement keeps it in sync |
| #24 | Mini-interview scoped to the change, not full re-interview |
| #33 | Context loaded in earlier steps, not during interview (separation of concerns) |
| #37 | Minimal seed + interview expands to structured spec |
| #43 | Per-service conventions injected; global principles loaded only on demand |
