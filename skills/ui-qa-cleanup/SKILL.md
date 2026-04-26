---
name: ui-qa-cleanup
description: Use to recover from leaked dev servers, stale containers, or held lock files left by a crashed /jlu-ui-qa-run. Triggers "cleanup ui qa", "kill stuck dev servers", "free ports", "clear stale lock"
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu-ui-qa-cleanup` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/ui-qa-cleanup/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 1b — Load Claude Code Runtime Contract

Read `<plugin-root>/jelou/references/claude-code-runtime.md` and follow it. Preload `AskUserQuestion` via `ToolSearch` before Step 1 of the workflow.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/ui-qa-cleanup.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The argument is `{argument}` (optional task slug; sweeps all active tasks when omitted). The plugin root is the path resolved above. The current working directory is `{cwd}`.
