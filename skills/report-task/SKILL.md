---
name: report-task
description: Use to check task status — shows progress, blockers, and detects stale worktrees. Triggers: "where am I", "task status", "what's the progress", "show me the report"
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Agent
---

You are the orchestrator for the `/jlu-report-task` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/report-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/report-task.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
