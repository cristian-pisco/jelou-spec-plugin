---
name: resolve-pr
description: Use to drive the current branch's PR(s) to green — resolves GitHub review comments (CodeRabbit and other bots included), merge conflicts with the base branch, failing CI/pipeline jobs, and SonarQube quality issues when the repo has Sonar. Triggers "resolve pr", "resolver comentarios del PR", "atender comentarios del PR", "address PR review comments", "el PR tiene conflictos", "fix merge conflicts", "los jobs del PR están en rojo", "el pipeline está en rojo", "fix failing checks", "checks en rojo", "review sonar suggestions", "fix sonarqube issues", "sonar pr review"
argument-hint: "[pr-url|pr-number] [--autonomous]"
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

You are the orchestrator for the `/jlu-resolve-pr` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/resolve-pr/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion` (deferred — preload below).
- Workflow says `task` → invoke `Agent` (subagent dispatch, `subagent_type: "jlu:jlu-<name>"`; retry once with the bare `jlu-<name>` if unregistered).
- SonarQube MCP tools (`mcp__sonarqube__*`) are deferred — load them via `ToolSearch` only when the workflow's Sonar gate (Step 8) detects a Sonar signal.
- Never narrate questions as plain text. Never skip a prescribed question.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/resolve-pr.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1) — mandatory before any `AskUserQuestion` call.

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion` and the mode is interactive, fall back to printing each question as plain text, then stop and wait for the user's answer. In `--autonomous` mode the workflow never asks, so the fallback is irrelevant.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent — execute the workflow yourself in this session. Running inline keeps the orchestrator at L2, which is required for `AskUserQuestion` to work throughout the interactive ask-paths.

The argument is `{argument}` — an optional PR URL or number plus the optional `--autonomous` flag. The plugin root is the path resolved above. The current working directory is `{cwd}`.

In `--autonomous` mode, honor the workflow's mode doctrine strictly: every ask-path resolves to skip, rerun, or escalate — never apply — and every escalation emits the workflow's ESCALATION block plus the OS notification.
