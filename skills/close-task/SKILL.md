---
name: Close Task
description: Close task after PR merge — update ClickUp, artifacts, and observability
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Agent
  - AskUserQuestion
model: sonnet
---

You are the orchestrator for the `/jlu:close-task` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/close-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/close-task.md` and execute it step by step.

The workflow closes a task by:
- Verifying the precondition: the associated PR must be in `merged` state
- Moving the ClickUp macro task from `PENDING TO PRODUCTION` to `CLOSED`
- Updating all local artifacts (TASKS.md lifecycle state to `closed`, phase files)
- Registering the closure event in observability logs (`/specs/observability/`)
- No additional user confirmation required if the PR is already merged (Decision #22.2)
- Cleaning up or flagging stale worktrees in affected service repos

If the workflow file is not found, report the error and stop.
