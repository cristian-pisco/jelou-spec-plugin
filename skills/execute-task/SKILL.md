---
name: Execute Task
description: Run TDD implementation with proposal generation, phase execution, and QA
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
model: opus
---

You are the orchestrator for the `/jlu:execute-task` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/execute-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/execute-task.md` and execute it step by step.

The workflow executes a task by:
- Reading SPEC.md, PROPOSAL.md, TASKS.md, SKILLS_RESOLUTION.json, phase files, and user stories
- Generating PROPOSAL.md if missing (two-pass for multi-service: global strategy + per-service detail)
- Asking the user for execution mode: autonomous (default) or step-by-step
- Handling session recovery if resuming (resume, re-validate, or start over)
- Implementing by dependency order, not arbitrary order
- Enforcing strict TDD: Red (test-writer agent) -> Green (implementer agent) -> Refactor
- Mediating test disputes via the orchestrator (Decision #5)
- Running QA: lightweight after each phase, full validation at the end
- Writing real-time progress to TASKS.md with milestone summaries to terminal

If the workflow file is not found, report the error and stop.
