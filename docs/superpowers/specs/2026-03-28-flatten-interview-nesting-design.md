# Flatten Interview Agent Nesting

## Problem Statement

The `jlu:refine-task` and `jlu:new-task` workflows use a 3-level agent nesting pattern: main session → launcher agent → orchestrator agent → spec-interviewer agent. At 3 levels deep, the spec-interviewer agent does not invoke the native `AskUserQuestion` tool. Instead, it outputs questions as plain text (Q1, Q2, etc.). When the user responds in the main prompt, the spec-interviewer session has already terminated, producing the error "The previous agent session can't be continued directly."

This makes the interview flow non-interactive: the user cannot have a real back-and-forth conversation with the spec-interviewer, which is the core purpose of the interview step.

## Requirements

### Functional

- FR-1: The orchestrator agent in `refine-task.md` must execute the interview logic inline (gap analysis, structured questions, spec writing, approval) instead of spawning the `jlu-spec-interviewer` agent.
- FR-2: The orchestrator agent in `new-task.md` must execute the interview logic inline instead of spawning the `jlu-spec-interviewer` agent.
- FR-3: All interview questions must use the `AskUserQuestion` tool. Questions must never be output as plain text.
- FR-4: The interview must follow the existing rules from `agents/jlu-spec-interviewer.md`: 2-4 questions per round grouped by theme, codebase-informed questions, continue until spec is complete, respect user's request to stop.
- FR-5: The interview themes and priority order must be preserved: technical implementation > tradeoffs > architecture > behavioral requirements > edge cases > security > performance > integrations > UX > constraints/out-of-scope.
- FR-6: The SPEC.md output format must remain unchanged: Problem Statement, Requirements (FR/NFR numbered), Constraints, Out of Scope, Success Criteria (SC numbered).
- FR-7: The approval gate must use `AskUserQuestion` — the user must explicitly approve before the workflow proceeds.
- FR-8: In `refine-task.md`, the interview must be scoped to the change request — only ask about implications of the change, not re-interview the full spec.
- FR-9: `agents/jlu-spec-interviewer.md` must be preserved as a reference document with a note that the logic is now inlined in the workflows.

### Non-Functional

- NFR-1: Agent nesting must not exceed 2 levels (main → launcher → orchestrator). No sub-agents spawned for interactive work.
- NFR-2: The launchers (`skills/refine-task/SKILL.md`, `skills/new-task/SKILL.md`) must not be modified.

## Constraints

- The orchestrator is a general-purpose agent spawned by the launcher with access to all tools including `AskUserQuestion`, `Read`, and `Write`. No tool access changes are needed.
- The background worktree agent in `new-task.md` (Step 9) is non-interactive and remains a separate agent — it is not affected by this change.
- The interview rules must be inlined into each workflow, not referenced from the agent file, because the orchestrator cannot read files at runtime without spending tool calls on discovering the plugin path.

## Out of Scope

- Modifying the launcher skill files.
- Changing the SPEC.md format or section structure.
- Changing the interview rules (themes, depth, question batching).
- Modifying any other agent definitions or workflows.
- Refactoring the background worktree agent in `new-task.md`.

## Success Criteria

- SC-1: Running `/jlu:refine-task` produces an interactive interview where each question appears as a native `AskUserQuestion` prompt (not plain text).
- SC-2: Running `/jlu:new-task` produces an interactive interview with native `AskUserQuestion` prompts.
- SC-3: After answering all questions, the spec is written and the approval gate works without "session can't be continued" errors.
- SC-4: The SPEC.md output has the same 5-section structure with numbered requirements.
- SC-5: The `agents/jlu-spec-interviewer.md` file exists with a reference note.
