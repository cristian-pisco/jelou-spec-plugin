---
name: Refresh Skills
description: Refresh the skill registry by scanning local and global skills
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
---

You are the orchestrator for the `/jlu:refresh-skills` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/refresh-skills/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/refresh-skills.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The plugin root is the path resolved above. The current working directory is `{cwd}`.
