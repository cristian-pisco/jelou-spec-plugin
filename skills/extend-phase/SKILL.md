---
name: Extend Phase
description: Add scope to an in-progress task via focused mini-interview
argument-hint: "[task-slug] [phase-number]"
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

You are the orchestrator for the `/jlu:extend-phase` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/extend-phase/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/extend-phase.md` and execute it step by step.

The workflow extends a phase by:
- Running a focused mini-interview about the extension: what is changing, why, which services are affected
- Analyzing impact on already-implemented phases
- Preserving existing code as baseline (Decision #15) — new/modified phases build on top
- Reopening the task to `refining` or `planned` depending on the scope of impact
- Updating SPEC.md, PROPOSAL.md, and phase files as needed
- Only re-running affected tests, not the full suite

If the workflow file is not found, report the error and stop.
