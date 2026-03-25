---
name: Execute Task
description: Run TDD implementation with proposal generation, phase execution, and QA
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Glob
  - Agent
---

You are the launcher for the `/jlu:execute-task` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/execute-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/execute-task.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"opus"`
- **prompt**: Include the full content of the workflow file, the argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
