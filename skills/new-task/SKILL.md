---
name: New Task
description: Create a new task with spec seed, worktrees, and affected service detection
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
- Creating or using an existing SPEC.md seed (even one sentence is enough)
- Offering to run `/jlu:map-codebase` if the codebase map is missing
- Creating the task folder in `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/`
- Creating a local worktree at `/.worktrees/<task-slug>`
- Proposing affected services using `services.yaml` + INTEGRATIONS.md
- Requesting user confirmation of affected services
- Creating worktrees in confirmed repos
- Checking for skill staleness and warning if detected (Decision #23)
- Warning on unregistered service references (Decision #39)

If the workflow file is not found, report the error and stop.
