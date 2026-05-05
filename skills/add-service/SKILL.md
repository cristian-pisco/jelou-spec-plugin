---
name: add-service
description: Use to add a service's pane to a running jlu-dev TMUX window without restarting the rest. Triggers "add service", "add pane", "extend dev environment"
argument-hint: "[service-name]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu:add-service` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory.
2. `~/.claude/jelou/`.

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names: `question` → `AskUserQuestion`. No subagent dispatch needed.

**Run these in parallel** (single tool-call message):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/add-service.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1).

**Update banner.** If output starts with `UPDATE_AVAILABLE`, print it and continue.

**ToolSearch fallback.** If `AskUserQuestion` unavailable, fall back to plain text and warn user.

## Phase 2 — Execute Workflow

Follow the workflow inline. Argument is `{argument}`. Cwd is `{cwd}`.
