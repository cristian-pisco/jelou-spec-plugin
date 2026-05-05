---
name: stop-dev
description: Use to stop the dev environment daemon and optionally close the TMUX window. Triggers "stop dev", "tear down services", "close dev environment"
argument-hint: "[--kill-services]"
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

You are the orchestrator for the `/jlu:stop-dev` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory.
2. `~/.claude/jelou/`.

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** Workflow uses `question` → `AskUserQuestion`. Never narrate as plain text.

**Run these in parallel:**
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/stop-dev.md`
3. `ToolSearch`: `select:AskUserQuestion`.

**Update banner / ToolSearch fallback** as in other skills.

## Phase 2 — Execute Workflow

Follow the workflow inline. Argument is `{argument}`. Cwd is `{cwd}`.
