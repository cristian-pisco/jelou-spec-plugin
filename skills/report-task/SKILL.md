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

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/report-task/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names. Workflow says `task` → invoke `Agent` (subagent dispatch). This skill does not call `AskUserQuestion`.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/report-task.md`

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent — execute the workflow yourself in this session.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
