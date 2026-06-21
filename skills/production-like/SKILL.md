---
name: production-like
description: Use to run the full production-like test suite for a task — auto-detects fullstack vs full-backend, boots the dev infra once, delegates to ui-qa-run (UI) and test-suite + a Testcontainers backend-E2E phase (backend) against the live stack, then tears down. Triggers "production-like", "run the full QA", "test the task end to end", "fullstack E2E", "full backend test".
argument-hint: "[task-slug]"
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

You are the orchestrator for the `/jlu-production-like` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/production-like/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion` (deferred — preload below).
- Workflow says `task` → invoke `Agent` (subagent dispatch).
- Never narrate questions as plain text. Never skip a prescribed question.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/production-like.md`
3. `ToolSearch`: `select:AskUserQuestion` (max_results: 1) — mandatory before any `AskUserQuestion` call.

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion`, fall back to printing each question as plain text and warn the user that the skill cannot run correctly without `AskUserQuestion` in this Claude Code version.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. The orchestrator is **thin**: it dispatches
subagents for ALL execution (`jlu-test-suite-runner`, `jlu-backend-e2e-runner`,
`jlu-ui-qa-runner`) and ALL authoring (`jlu-ui-e2e-writer`, `jlu-test-writer`). It
retains only the dev-environment lifecycle (boot once / teardown), the OTP auth gate
(Gmail is session-bound, so this stays in-session), `AskUserQuestion` brokering of any
subagent `NEEDS_CONTEXT`, dispatch/routing, and result aggregation. It has **no test
execution or authoring role**: never narrate a scope question, never fabricate a
"deferred-manual" gate, never write a `.spec.ts` inline.

The argument is `{argument}` (optional task slug; auto-detect from branch when omitted). The plugin root is the path resolved above. The current working directory is `{cwd}`.
