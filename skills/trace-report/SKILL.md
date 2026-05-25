---
name: trace-report
description: Use to inspect the workspace trace store — per-agent / per-phase / per-task / trends. Read-only. Triggers - "trace report", "show traces", "trace analytics", "tracing dashboard"
argument-hint: "[--by-agent | --by-phase | --by-task <slug> | --trends]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

You are the orchestrator for the `/jlu-trace-report` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (`<plugin-root>/skills/trace-report/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion`.
- Never narrate questions as plain text.

## Phase 2 — Read and execute the workflow

Read `<PLUGIN_ROOT>/jelou/workflows/trace-report.md` and execute it exactly. The workflow drives the user-facing flow; this SKILL.md is a thin launcher.

Command arguments: $ARGUMENTS
Current directory is the workspace working directory.
