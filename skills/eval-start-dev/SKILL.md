---
name: eval-start-dev
description: Use to audit whether /jlu-start-dev would actually boot correctly — either the main branches or one task slug, chosen up front — checking the boot plan, worktree resolution (backend and frontend), DNS-safe container names, readiness log sources, deps provenance, peer wiring and published host ports, and optionally proving it with a real boot. Triggers "evaluate start-dev", "is start-dev correct for this task", "auditar start-dev", "validar el boot de la tarea", "validar el stack en main"
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

You are the orchestrator for the `/jlu:eval-start-dev` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory.
2. `~/.claude/jelou/`.

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names: `question` → `AskUserQuestion`, `task` → `Agent` (not used). Never narrate questions as plain text.

**Run these in parallel** (single tool-call message):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/eval-start-dev.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1).

**Update banner.** If output starts with `UPDATE_AVAILABLE`, print it and continue.

**ToolSearch fallback.** If `AskUserQuestion` unavailable, fall back to plain text and warn user.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent. The current working directory is `{cwd}`.

Arguments: an optional task slug and an optional `--live` flag. When no slug is given, the workflow's Step 0 asks the user whether to evaluate the main branches or a task slug — ask it with `AskUserQuestion`, never as narrated text, and never skip it by guessing a slug from `{cwd}`.
