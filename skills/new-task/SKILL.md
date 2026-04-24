---
name: new-task
description: Use when starting new work — creates a task, interviews you about the spec, and sets up worktrees. Triggers: "new task", "start a task", "I want to build X", "create a spec"
argument-hint: "[task description]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Agent
---

You are the launcher for the `/jlu-new-task` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/new-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/new-task.md`.

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single task subagent with these parameters:
- **model**: `"opus"`
- **prompt**: Assemble the prompt in this exact order:
  1. The full content of `<plugin-root>/jelou/references/claude-code-runtime.md` (the runtime contract — maps `question` → `AskUserQuestion`, `task` → `Agent`, and requires the subagent to preload `AskUserQuestion` via `ToolSearch` before Step 1).
  2. A blank line.
  3. The full content of the workflow file at `<plugin-root>/jelou/workflows/new-task.md`.
  4. The argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
