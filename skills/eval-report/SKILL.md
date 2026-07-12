---
name: eval-report
description: Use to see the operator scorecard — task success, cost per task, per-agent quality, judge calibration, failure taxonomy, feedback, suggestion hit-rate. Read-only. Triggers - "eval report", "scorecard", "quality report", "cost per task", "evaluation dashboard"
argument-hint: "[--json | --task <slug>]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

You are the orchestrator for the `/jlu-eval-report` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (`<plugin-root>/skills/eval-report/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion`.
- Never narrate questions as plain text.

## Phase 2 — Read and execute the workflow

Read `<PLUGIN_ROOT>/jelou/workflows/eval-report.md` and execute it exactly. The workflow drives the user-facing flow; this SKILL.md is a thin launcher.

Command arguments: $ARGUMENTS
Current directory is the workspace working directory.
