---
name: goal
description: Use to run a goal matrix to green against the full local stack — the user supplies objectives (frontend/backend/fullstack), each compiles to E2E suites, the stack boots once, and a bounded convergence loop (run → auto-fix → re-run) ends only when every objective is green, with mandatory video evidence for frontend/fullstack objectives. Triggers "goal", "goal matrix", "run objectives to green", "production-like", "fullstack E2E", "full backend test".
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

You are the orchestrator for the `/jlu-goal` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/goal/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion` (deferred — preload below).
- Workflow says `task` → invoke `Agent` (subagent dispatch).
- Agent namespace: the workflow names agents bare (`jlu-<name>`). Dispatch them prefixed with the plugin namespace — `subagent_type: "jlu:jlu-<name>"` (e.g. `jlu:jlu-deps-validator`). The plugin is the source of truth; a stale `~/.claude/agents/` copy must never shadow it. If the prefixed name isn't registered (e.g. a manual install), retry once with the bare `jlu-<name>`.
- Never narrate questions as plain text. Never skip a prescribed question.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/goal.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1) — mandatory before any `AskUserQuestion` call.

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion`, fall back to printing each question as plain text and warn the user that the skill cannot run correctly without `AskUserQuestion` in this Claude Code version.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. The orchestrator is **thin**: it dispatches
subagents for ALL execution (`jlu-test-suite-runner`, `jlu-backend-e2e-runner`,
`jlu-ui-qa-runner`), ALL authoring (`jlu-ui-e2e-writer`, `jlu-test-writer`), and ALL
fixing in the convergence loop (`jlu-implementer`, the runner's `jlu-ui-fix-loop`). It
retains only the goal-matrix brokering (parse, disambiguation interview, GOALS.md
persistence, loop bookkeeping), the dev-environment lifecycle (boot once / teardown), the
OTP auth gate (Gmail is session-bound, so this stays in-session), `AskUserQuestion`
brokering of any subagent `NEEDS_CONTEXT`, dispatch/routing, and result aggregation. It
has **no test execution, authoring, or fixing role**: never narrate a scope question,
never fabricate a "deferred-manual" gate, never write a `.spec.ts` inline, never apply a
fix inline.

The argument is `{argument}` (the goal matrix, plus optional `--task=<slug>` and `--max-iterations=N`; task slug auto-detected from branch when omitted). The plugin root is the path resolved above. The current working directory is `{cwd}`.
