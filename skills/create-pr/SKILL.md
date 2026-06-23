---
name: create-pr
description: "DEPRECATED alias of /jlu-ship — stages, builds, validates deps, and opens PRs. Use /jlu-ship."
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
  - Agent
---

You are handling the DEPRECATED `/jlu-create-pr` command.

**First, print exactly:**

> ⚠️ `/jlu-create-pr` is deprecated and now runs `/jlu-ship`. Please use `/jlu-ship` going forward.

Then execute the `/jlu-ship` workflow unchanged: resolve the plugin root (up 2 levels from this skill's directory, or `~/.claude/jelou/`), then follow `<plugin-root>/jelou/workflows/ship.md` exactly as written, passing the argument `{argument}`, plugin root, and cwd `{cwd}`. Do all bootstrap (update banner, ToolSearch for AskUserQuestion, trace) per that workflow.
