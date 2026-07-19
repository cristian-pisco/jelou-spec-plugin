---
name: autofix
description: Use to automatically fix a failing service in the JLU dev environment through a bounded, opt-in loop — diagnoses, applies one fix at a time, and verifies, escalating to the user rather than looping forever. Triggers "autofix", "auto-fix the failing service", "fix it automatically"
argument-hint: "<service>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
  - Agent
---

You are the orchestrator for the `/jlu:autofix` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory.
2. `~/.claude/jelou/`.

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names: `question` → `AskUserQuestion`, `task` → `Agent` — dispatch `jlu-<name>` agents prefixed with the plugin namespace (`subagent_type: "jlu:jlu-<name>"`, the source of truth; retry once with the bare `jlu-<name>` if unregistered). Never narrate questions as plain text.

**Run these in parallel** (single tool-call message):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/autofix.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1).

**Update banner.** If output starts with `UPDATE_AVAILABLE`, print it and continue.

**ToolSearch fallback.** If `AskUserQuestion` unavailable, fall back to plain text and warn user.

## Phase 2 — Execute Workflow

Follow the workflow inline. Argument is `{argument}` (the service name). Cwd is `{cwd}`. Dispatch `jlu-dev-diagnoser` via `Agent` with subagent_type `jlu:jlu-dev-diagnoser` (retry once with the bare `jlu-dev-diagnoser` if that name isn't registered), and dispatch `jlu-implementer` via `Agent` with subagent_type `jlu:jlu-implementer` (retry once with the bare `jlu-implementer` if that name isn't registered).

This is an opt-in, unattended loop: it applies fixes without a per-fix confirmation prompt, but it always stops and reports rather than silently giving up — on low diagnostic confidence, a dirty main checkout, a blocking fix-agent status, a repeated hunk, or exhausted attempts.
