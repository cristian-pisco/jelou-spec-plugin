---
name: production-like
description: "DEPRECATED alias of /jlu-goal — runs a goal matrix to green against the full local stack with a bounded convergence loop and video evidence. Use /jlu-goal."
argument-hint: "[goal matrix] [--task=<slug>] [--max-iterations=N]"
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

You are handling the DEPRECATED `/jlu-production-like` command.

**First, print exactly:**

> ⚠️ `/jlu-production-like` is deprecated and now runs `/jlu-goal`. Please use `/jlu-goal` going forward.

Then execute the `/jlu-goal` workflow unchanged: resolve the plugin root (up 2 levels from this skill's directory, or `~/.claude/jelou/`), then follow `<plugin-root>/jelou/workflows/goal.md` exactly as written, passing the argument `{argument}`, plugin root, and cwd `{cwd}`. Do all bootstrap (update banner, ToolSearch for AskUserQuestion, runtime contract) per `<plugin-root>/skills/goal/SKILL.md`.
