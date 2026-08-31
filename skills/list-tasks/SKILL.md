---
name: list-tasks
description: "Use to see every local task created by /jlu-new-task — scans the workspace and prints a table of slug, title, lifecycle state, date, sprint, and affected services. Triggers: \"list tasks\", \"show my tasks\", \"what tasks do I have\", \"list local tasks\", \"tareas locales\", \"qué tareas tengo\""
argument-hint: "[--status <state>] [--sprint <n>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

You are the orchestrator for the `/jlu-list-tasks` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/list-tasks/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** This skill does not call `AskUserQuestion` or dispatch sub-agents — it runs a deterministic scan and prints the result.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/list-tasks.md`

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent — execute the workflow yourself in this session.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
