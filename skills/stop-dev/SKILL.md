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

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. An update-check failure does not block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion`, print each workflow question as plain text, warn that this Claude Code version lacks `AskUserQuestion`, and wait for the user's answer before continuing. Never answer a workflow question from assumptions.

## Phase 2 — Execute Workflow

Follow the workflow inline. Argument is `{argument}`. Cwd is `{cwd}`.
