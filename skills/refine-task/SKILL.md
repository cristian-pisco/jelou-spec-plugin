---
name: refine-task
description: "Use when a spec needs changes after approval — applies targeted refinements via structured interview. Triggers: \"change the spec\", \"update requirements\", \"the spec needs X\", \"refine task\""
argument-hint: "[change description] [clickup-url|id] [--no-autochain]"
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

You are the orchestrator for the `/jlu-refine-task` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/refine-task/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion` (deferred — preload below).
- Workflow says `task` → invoke `Agent` (subagent dispatch).
- Agent namespace: the workflow names agents bare (`jlu-<name>`). Dispatch them prefixed with the plugin namespace — `subagent_type: "jlu:jlu-<name>"` (e.g. `jlu:jlu-resolve-pr-runner`). The plugin is the source of truth; a stale `~/.claude/agents/` copy must never shadow it. If the prefixed name isn't registered (e.g. a manual install), retry once with the bare `jlu-<name>`.
- Never narrate questions as plain text. Never skip a prescribed question.
- The one exception is autonomous mode (see Phase 2): with `--autonomous` or `JLU_AUTONOMOUS=true`, no gate asks — each takes its documented default from the workflow's gate table and is disclosed there. Without that flag the ban above stands in full.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/refine-task.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1) — mandatory before any `AskUserQuestion` call.

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion`, fall back to printing each question as plain text, then stop and wait for the user's answer. Warn the user that this Claude Code version lacks the structured question tool, but never answer a workflow question yourself, continue inline, or narrow the scope from assumptions.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent — execute the workflow yourself in this session.

**Autonomous mode.** Resolve `<AUTONOMOUS>` before following the workflow: it is
`yes` when the argument contains `--autonomous`, or when `JLU_AUTONOMOUS=true` is
set in the environment; `no` otherwise. Strip `--autonomous` (and an optional
`--answers=<path>`, which becomes `<ANSWERS_FILE>`) from the argument before
treating the rest as the workflow's own input. When it resolves to `yes`, follow
the workflow's "Autonomous mode — how every gate resolves" section: no gate asks,
each takes its documented default, and every decision is disclosed. Never infer
autonomous mode from context — an interactive user always gets the questions.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
