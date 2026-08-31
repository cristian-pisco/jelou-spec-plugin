---
name: close-task
description: Use after a PR is merged — updates ClickUp, cleans up artifacts, and marks the task as closed. Triggers: "close task", "PR was merged", "task is done", "wrap up"
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
  - Agent
---

You are the orchestrator for the `/jlu-close-task` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/close-task/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Read the workflow.** `Read`: `<plugin-root>/jelou/workflows/close-task.md`

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent — execute the workflow yourself in this session.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
