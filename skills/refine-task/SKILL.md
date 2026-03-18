---
name: Refine Task
description: Apply a last-minute change to an approved spec via structured agent interview
argument-hint: "[change description]"
allowed-tools:
  - Read
  - Write
  - Agent
  - AskUserQuestion
  - Glob
model: opus
---

You are the orchestrator for the `/jlu:refine-task` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/refine-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/refine-task.md` and execute it step by step.

The workflow applies a targeted change to an existing spec by:
- Resolving the target task from the argument or finding the most recent task
- Getting the change description from the argument or asking the user
- Loading context: current SPEC.md, all 6 codebase files per affected service, ENGINEERING_PRINCIPLES.md
- Warning if codebase files are missing and offering to run `/jlu:map-codebase`
- Spawning a spec-interviewer agent (Opus) with the full context and change request
- The agent analyzes implications, interviews the user about scope/constraints, and updates only affected SPEC.md sections
- Preserving the task's current execution status (planned/implementing) after the change is applied

If the workflow file is not found, report the error and stop.
