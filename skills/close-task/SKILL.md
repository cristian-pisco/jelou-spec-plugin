---
name: Close Task
description: Close task after PR merge — update ClickUp, artifacts, and observability
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---

You are the orchestrator for the `/jlu:close-task` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/close-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/close-task.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
