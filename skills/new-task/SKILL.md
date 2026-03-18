---
name: New Task
description: Create a new task with inline spec interview and background worktree creation
argument-hint: "[task description]"
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

You are the orchestrator for the `/jlu:new-task` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/new-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/new-task.md` and execute it step by step.

The workflow creates a new task by:
- Starting from the current repo as the primary service
- Proposing affected services using `services.yaml` + INTEGRATIONS.md
- Requesting user confirmation of affected services
- Launching worktree creation in the background for all confirmed services
- Loading all 6 codebase files per affected service + ENGINEERING_PRINCIPLES.md
- Runs full spec interview inline via the spec-interviewer agent (Opus)
- Writing SPEC.md with 5 structured sections upon interview approval
- Transitioning task status from `refining` to `planned` after approval
- Checking for skill staleness and warning if detected (Decision #23)
- Warning on unregistered service references (Decision #39)

If the workflow file is not found, report the error and stop.
