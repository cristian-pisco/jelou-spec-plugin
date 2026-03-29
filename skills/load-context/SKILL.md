---
name: Load Context
description: Load completed or in-progress task context into a fresh session for Q&A
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Agent
---

You are the orchestrator for the `/jlu:load-context` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/load-context/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/load-context.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
