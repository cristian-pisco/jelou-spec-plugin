---
name: map-codebase
description: Use before starting work on a new service — analyzes architecture, stack, conventions, integrations, and concerns. Triggers: "map codebase", "analyze the service", "understand the code", "explore the repo"
argument-hint: "[service-id]"
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

You are the orchestrator for the `/jlu-map-codebase` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/map-codebase/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/map-codebase.md`.

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 1b — Load Claude Code Runtime Contract

Read `<plugin-root>/jelou/references/claude-code-runtime.md` and follow it. It maps `question` (used in the workflow) to `AskUserQuestion`, maps `task` to `Agent`, and requires you to preload `AskUserQuestion` via `ToolSearch` before Step 1 of the workflow.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/map-codebase.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. Running inline keeps `jlu-codebase-analyzer-operational` (which interviews the user via `AskUserQuestion` per Decision #30) at L2 instead of L3, which is required for `AskUserQuestion` to work.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
