---
name: map-codebase
description: Use before starting work on a new service or workspace root — analyzes architecture, stack, conventions, integrations, and concerns. Triggers: "map codebase", "analyze the service", "understand the code", "explore the repo"
argument-hint: "[service-id | --root [root-path] | --all]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu-map-codebase` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/map-codebase/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion` (deferred — preload below).
- Workflow says `task` → invoke `Agent` (subagent dispatch).
- Agent namespace: the workflow names agents bare (`jlu-<name>`). Dispatch them prefixed with the plugin namespace — `subagent_type: "jlu:jlu-<name>"` (e.g. `jlu:jlu-deps-validator`). The plugin is the source of truth; a stale `~/.claude/agents/` copy must never shadow it. If the prefixed name isn't registered (e.g. a manual install), retry once with the bare `jlu-<name>`.
- Never narrate questions as plain text. Never skip a prescribed question.
- The one exception is autonomous mode (see Phase 2): with `--autonomous` or `JLU_AUTONOMOUS=true`, no gate asks — each takes its documented default from the workflow's gate table and is disclosed there. Without that flag the ban above stands in full.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/map-codebase.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1) — mandatory before any `AskUserQuestion` call.

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion`, fall back to printing each question as plain text and warn the user that the skill cannot run correctly without `AskUserQuestion` in this Claude Code version.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do not delegate the entire workflow to a sub-agent — execute orchestration yourself in this session. When the workflow explicitly says `task`, dispatch the named worker agent. Running orchestration inline keeps single-service `jlu-codebase-analyzer-operational` (which interviews the user via `AskUserQuestion` per Decision #30) at L2 instead of L3, while root batch mode still fans out its non-interactive mapper workers.

**Autonomous mode.** Resolve `<AUTONOMOUS>` before following the workflow: it is
`yes` when the argument contains `--autonomous`, or when `JLU_AUTONOMOUS=true` is
set in the environment; `no` otherwise. Strip `--autonomous` (and an optional
`--answers=<path>`, which becomes `<ANSWERS_FILE>`) from the argument before
treating the rest as the workflow's own input. When it resolves to `yes`, follow
the workflow's "Autonomous mode — how every gate resolves" section: no gate asks,
each takes its documented default, and every decision is disclosed. Never infer
autonomous mode from context — an interactive user always gets the questions.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
