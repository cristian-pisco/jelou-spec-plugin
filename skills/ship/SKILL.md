---
name: ship
description: Use after implementation is complete — stages, commits, pushes, and opens PRs for all affected services. Triggers: "ship", "ship it", "create PR", "open pull request", "push the code", "ready for review"
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

You are the orchestrator for the `/jlu-ship` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/ship/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion` (deferred — preload below).
- Workflow says `task` → invoke `Agent` (subagent dispatch).
- Agent namespace: the workflow names agents bare (`jlu-<name>`). Dispatch them prefixed with the plugin namespace — `subagent_type: "jlu:jlu-<name>"` (e.g. `jlu:jlu-deps-validator`). The plugin is the source of truth; a stale `~/.claude/agents/` copy must never shadow it. If the prefixed name isn't registered (e.g. a manual install), retry once with the bare `jlu-<name>`.
- Never narrate questions as plain text. Never skip a prescribed question.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/ship.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1) — mandatory before any `AskUserQuestion` call.

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion`, fall back to printing each question as plain text and warn the user that the skill cannot run correctly without `AskUserQuestion` in this Claude Code version.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT wrap this whole workflow in a sub-agent — execute it yourself in this session. Running inline keeps the orchestrator at L2, which is required for `AskUserQuestion` to work at every gate it brokers.

That is not a ban on the workflow's own delegation: Step 3 dispatches one `jlu-ship-runner` per affected service (sequentially), and Step 4b/5 dispatch validators and the git-agent inside it. Those are required — the per-service body must run in a subagent so its install/build/`gh` output never enters this window. What must stay here is the decision-making: on an interactive run a runner returns `NEEDS_DECISION` and you ask the question. When a caller passes `<AUTONOMOUS> = yes` (the autochain does) nothing is asked at all — every gate takes its documented default from the workflow's gate table and records a caveat in the PR.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
