---
name: new-task
description: Use when starting new work — creates a task, interviews you about the spec, and sets up worktrees. Triggers: "new task", "start a task", "I want to build X", "create a spec"
argument-hint: "[task description]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu-new-task` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/new-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/new-task.md`.

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 1b — Load Claude Code Runtime Contract

Read `<plugin-root>/jelou/references/claude-code-runtime.md` and follow it. It maps `question` (used in the workflow) to `AskUserQuestion`, maps `task` to `Agent`, and requires you to preload `AskUserQuestion` via `ToolSearch` before Step 1 of the workflow.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/new-task.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. Running inline keeps the orchestrator at L2 (instead of L3 if dispatched from a subagent), which is required for `AskUserQuestion` to work throughout the interview, confirmations, and mode-selection steps.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
