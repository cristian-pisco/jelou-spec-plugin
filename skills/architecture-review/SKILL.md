---
name: architecture-review
description: "Use to surface deepening opportunities in a service or across services — refactors that turn shallow modules into deep ones. Triggers: \"architecture review\", \"find refactor candidates\", \"deepen modules\", \"improve architecture\""
argument-hint: "[<service-id>] [--cross-service]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu-architecture-review` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/architecture-review/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 1b — Load Claude Code Runtime Contract

Read `<plugin-root>/jelou/references/claude-code-runtime.md` and follow it. It maps `question` (used in the workflow) to `AskUserQuestion`, maps `task` to `Agent`, and requires you to preload `AskUserQuestion` via `ToolSearch` before Step 1 of the workflow.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/architecture-review.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
