# Flatten Interview Nesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 3-level agent nesting by inlining the spec-interviewer logic into the orchestrator workflows so `AskUserQuestion` works natively.

**Architecture:** Replace the "spawn spec-interviewer agent" step in both `refine-task.md` and `new-task.md` with inline interview instructions that the orchestrator executes directly. The `agents/jlu-spec-interviewer.md` file gets a deprecation note but is preserved as reference.

**Tech Stack:** Markdown workflow files (no code)

---

### Task 1: Inline interview logic into `refine-task.md`

**Files:**
- Modify: `jelou/workflows/refine-task.md:99-227` (Step 7 through end)

- [ ] **Step 1: Replace Step 7 — remove agent prompt assembly**

The current Step 7 ("Build Composite Context") assembles a string to inject into the spec-interviewer agent's prompt. Since the orchestrator now does the interview itself, this step simplifies to: "use the context already loaded in Steps 3-5." No composite string assembly is needed — the orchestrator already has all the variables in memory.

In `jelou/workflows/refine-task.md`, replace the entire Step 7 section (lines 99-138) with:

```markdown
## Step 7 — Review Loaded Context

Before starting the interview, confirm you have loaded:
- `CHANGE_REQUEST` from Step 2
- `SPEC_CONTENT` from Step 2
- `CODEBASE_CONTEXT` from Step 4
- `PRINCIPLES_CONTENT` from Step 5

All of these are already in memory from previous steps. No assembly needed — proceed directly to the interview.

---
```

- [ ] **Step 2: Replace Step 8 — inline the interview**

Replace the entire Step 8 section ("Spawn Spec-Interviewer Agent", lines 141-172) with the inline interview logic. This is the core change.

In `jelou/workflows/refine-task.md`, replace the Step 8 section with:

```markdown
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
```

- [ ] **Step 3: Update Step 9 — remove agent references**

Replace the Step 9 section ("Post-Agent Confirmation", lines 175-191) to remove references to "the spec-interviewer agent completes" since the orchestrator did it inline.

In `jelou/workflows/refine-task.md`, replace the Step 9 section with:

```markdown
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
```

- [ ] **Step 4: Update Error Handling table**

In the Error Handling section, replace the row:
```
| Spec-interviewer agent fails | Report failure, suggest re-running the command |
```
with:
```
| Interview interrupted (session timeout, user abort) | Save any spec changes made so far, report partial state |
```

The "User cancels interview midway" row stays the same but update the action text from "Agent updates spec with what it has, orchestrator preserves partial work" to "Update spec with answers gathered so far, preserve partial work".

- [ ] **Step 5: Verify the complete file reads correctly**

Read `jelou/workflows/refine-task.md` from top to bottom and verify:
- No references to "spec-interviewer agent" remain (except in Decision References table if applicable)
- Step numbering is sequential (1-9)
- All `AskUserQuestion` requirements are explicit
- The `COMPOSITE_CONTEXT` variable is no longer referenced (it was only needed for agent prompt injection)

- [ ] **Step 6: Commit**

```bash
git add jelou/workflows/refine-task.md
git commit -m "refactor(refine-task): inline interview logic into orchestrator

Eliminates 3-level agent nesting by having the orchestrator execute
the interview directly with AskUserQuestion instead of spawning the
spec-interviewer agent as a sub-agent."
```

---

### Task 2: Inline interview logic into `new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md:337-502` (Step 13 through end)

- [ ] **Step 1: Replace Step 13 — remove agent prompt assembly**

Same as Task 1 Step 1. The current Step 13 ("Build Composite Context") assembled a string for the agent prompt. Replace it.

In `jelou/workflows/new-task.md`, replace the entire Step 13 section (lines 339-373) with:

```markdown
## Step 13 — Review Loaded Context

Before starting the interview, confirm you have loaded:
- `TASK_DESCRIPTION` from Step 3
- `CODEBASE_CONTEXT` from Step 10
- `PRINCIPLES_CONTENT` from Step 11
- `CONFIRMED_SERVICES` from Step 8

All of these are already in memory from previous steps. No assembly needed — proceed directly to the interview.

---
```

- [ ] **Step 2: Replace Step 14 — inline the interview**

Replace the entire Step 14 section ("Spawn Spec-Interviewer Agent", lines 378-406) with inline interview logic. This is the new-task variant (full spec creation, not refinement).

In `jelou/workflows/new-task.md`, replace the Step 14 section with:

```markdown
## Step 14 — Interview and Write Spec

> **Tool requirement reminder**: Every question and confirmation in this step MUST use `AskUserQuestion`. Never output questions as plain text.

### 14a — Gap Analysis (silent)

Before asking any questions, silently analyze the task description (`TASK_DESCRIPTION`) against the codebase knowledge (`CODEBASE_CONTEXT`). Identify:
- Ambiguities or missing details in the task description
- Conflicts between the task and existing architecture, conventions, or integration patterns
- Implicit assumptions that need explicit confirmation
- Edge cases, error scenarios, and security implications not addressed
- Integration points with other services or systems referenced in INTEGRATIONS.md
- Non-functional requirements (performance, scalability, observability) not mentioned
- Known concerns from CONCERNS.md that intersect with this task

Prioritize gaps by impact: architectural decisions > behavioral requirements > edge cases > cosmetic details.

### 14b — Structured Interview

Using `AskUserQuestion`, interview the user to resolve all identified gaps.

Rules:
- **2-4 questions per round**, grouped by theme — never random
- **Themes to cover** (in rough priority order):
  1. Technical implementation details (how will this be built? what patterns apply?)
  2. Tradeoffs & alternatives (why this approach over others? what are we giving up?)
  3. Architecture & design decisions (how does this fit into the existing system?)
  4. Behavioral requirements (what exactly should happen in each scenario?)
  5. Edge cases & error handling (what happens when things go wrong?)
  6. Security & authorization (who can do what? what's sensitive?)
  7. Performance & scalability (volume expectations, latency constraints?)
  8. Integration points (what other services/systems are affected?)
  9. UX/UI implications (if applicable — user-facing behavior)
  10. Constraints & out-of-scope (what should we explicitly NOT do?)
- **Ask non-obvious questions** — informed by what you found in the codebase context, not generic. Reference specific files, patterns, or conventions you observed.
  - Good: "INTEGRATIONS.md shows this service communicates with service-payments via async events. Should the new feature use the same event bus, or does it need a synchronous call?"
  - Bad: "What technology should we use?"
- **Go deep** — don't accept vague answers. If the user says "it should be fast", ask "what's the latency budget? p95 under 200ms?"
- **Ask about tradeoffs** — if the user chose approach A, ask why not B. Surface implicit decisions.
- **Continue until complete** — keep interviewing until you can confidently fill all 5 output sections.
- **Respect the user** — if the user says "that's enough" or "move on", stop the interview and write the spec with what you have.

### 14c — Write SPEC.md

After the interview is complete, write `<TASK_DIR>/SPEC.md` with these structured sections:

```markdown
# <Task Title>

## Problem Statement
What problem this solves and why it matters. Include business context.

## Requirements

### Functional
- FR-1: <requirement>
- FR-2: <requirement>
...

### Non-Functional
- NFR-1: <requirement> (e.g., performance, security, scalability, observability)
...

## Constraints
Technical, business, or timeline constraints that bound the solution.

## Out of Scope
Explicitly excluded from this task — things that might seem related but are NOT part of this work.

## Success Criteria
How to verify the task is complete. Concrete, testable conditions.
- SC-1: <criterion>
- SC-2: <criterion>
...
```

Rules for writing:
- Preserve the user's original intent from the task description
- Add precision and detail from interview answers
- Number requirements and criteria for traceability (FR-1, NFR-1, SC-1)
- Make every requirement concrete enough that a developer could implement it and a QA agent could verify it

### 14d — Present for Approval

Using `AskUserQuestion`, present the complete SPEC.md to the user:
1. A brief executive summary of what the spec covers
2. A count of requirements (FR: X, NFR: Y) and success criteria (SC: Z)
3. Any areas where you had to make judgment calls or where information was incomplete
4. Ask clearly: "Do you approve this spec to move to `planned` status?"

If the user wants changes, make them and re-present. Loop until the user approves or explicitly stops.

---
```

- [ ] **Step 3: Update Step 15 — remove agent references**

Replace the Step 15 section ("Post-Agent Confirmation", lines 410-429) to remove references to "the spec-interviewer agent completes" and "the agent's output."

In `jelou/workflows/new-task.md`, replace the Step 15 section with:

```markdown
## Step 15 — Post-Interview Confirmation

After the user approves (or declines) the spec:

1. Verify that `<TASK_DIR>/SPEC.md` exists and has all 5 structured sections.
   - If not created or incomplete: warn "SPEC.md could not be completed. Review the interview output."

2. If the user **approved** the spec:
   a. Update `<TASK_DIR>/TASKS.md`:
      - Change `Status: refining` to `Status: planned`
      - Add transition timestamp: `- Planned: <current-datetime-ISO>`
   b. Check `WORKTREE_AGENT_TASK` result:
      - If the background worktree agent completed successfully: log the created worktrees.
      - If it failed or is still running: report the worktree errors and note the user can create worktrees manually.
3. If the user **did not approve** or the interview ended without approval:
   a. Leave TASKS.md status as `refining`.
   b. Report: "SPEC.md was created but not yet approved. You can:"
      - "Review and edit `<TASK_DIR>/SPEC.md` manually, then re-run `/jlu:new-task <TASK_SLUG>`"
      - "Or re-run `/jlu:refine-task <TASK_SLUG>` to apply targeted changes"

---
```

- [ ] **Step 4: Update Error Handling table**

In the Error Handling section of `new-task.md`, find the table (around line 480). If there is a row referencing "Spec-interviewer agent fails", replace it with:
```
| Interview interrupted (session timeout, user abort) | Save any spec content written so far, report partial state |
```

If there is a row for "User cancels at any confirmation step", keep it — it already covers the general case.

- [ ] **Step 5: Verify the complete file reads correctly**

Read `jelou/workflows/new-task.md` from top to bottom and verify:
- No references to "spec-interviewer agent" remain in steps or error handling
- Step numbering is sequential (1-16)
- All `AskUserQuestion` requirements are explicit
- The `COMPOSITE_CONTEXT` variable is no longer referenced
- Step 9 (background worktree agent) is unchanged

- [ ] **Step 6: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "refactor(new-task): inline interview logic into orchestrator

Same change as refine-task: eliminates 3-level agent nesting by
having the orchestrator execute the interview directly with
AskUserQuestion instead of spawning the spec-interviewer agent."
```

---

### Task 3: Add deprecation note to `agents/jlu-spec-interviewer.md`

**Files:**
- Modify: `agents/jlu-spec-interviewer.md:1-6` (frontmatter area)

- [ ] **Step 1: Add deprecation note after the frontmatter**

In `agents/jlu-spec-interviewer.md`, insert a deprecation notice immediately after the frontmatter closing `---` (line 6) and before the first paragraph (line 8). Insert:

```markdown

> **Deprecation notice**: This agent is no longer spawned as a sub-agent. The interview logic has been inlined into the orchestrator workflows (`jelou/workflows/new-task.md` Step 14, `jelou/workflows/refine-task.md` Step 8) to avoid 3-level agent nesting issues with `AskUserQuestion`. This file is preserved as the canonical reference for interview rules, themes, and SPEC.md format.

```

Do NOT modify any other content in the file.

- [ ] **Step 2: Commit**

```bash
git add agents/jlu-spec-interviewer.md
git commit -m "docs(spec-interviewer): add deprecation note

Agent logic is now inlined in orchestrator workflows. File preserved
as reference for interview rules and SPEC.md format."
```

---
