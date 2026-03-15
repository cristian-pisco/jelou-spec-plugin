---
name: Map Codebase
description: Analyze a service's codebase with 6 parallel research agents and cross-validation
argument-hint: "[service-id]"
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

You are the orchestrator for the `/jlu:map-codebase` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/map-codebase/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/map-codebase.md` and execute it step by step.

The workflow maps a service's codebase by:
- Spawning 6 parallel research agents (architecture, stack, conventions, integrations, structure, concerns)
- Writing the 6 codebase files to `.spec-workspace/services/<service-id>/codebase/`
- Running a cross-validation agent to flag contradictions across all outputs
- Presenting contradictions to the user for resolution
- CONCERNS.md combines automated code analysis with a user interview (Decision #30)

If the workflow file is not found, report the error and stop.
