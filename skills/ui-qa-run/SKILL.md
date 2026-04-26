---
name: ui-qa-run
description: Use to run the Playwright E2E suite against affected services post-deploy, with bounded auto-fix loop. Triggers "run E2E tests", "ui qa", "run playwright", "verify ui after deploy"
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
  - Agent
---

You are the orchestrator for the `/jlu-ui-qa-run` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/ui-qa-run/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 1b — Load Claude Code Runtime Contract

Read `<plugin-root>/jelou/references/claude-code-runtime.md` and follow it. It maps `question` (used in the workflow) to `AskUserQuestion`, maps `task` to `Agent`, and requires you to preload `AskUserQuestion` via `ToolSearch` before Step 1 of the workflow.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/ui-qa-run.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The argument is `{argument}` (optional task slug; auto-detect from branch when omitted). The plugin root is the path resolved above. The current working directory is `{cwd}`.
