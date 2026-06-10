---
description: "Use to run the full production-like test suite for a task — auto-detects fullstack vs full-backend, boots the dev infra once, delegates to ui-qa-run (UI) and test-suite (backend) against the live stack, then tears down. Triggers \"production-like\", \"run the full QA\", \"test the task end to end\", \"fullstack E2E\", \"full backend test\"."
argument-hint: "[task-slug]"
---
Resolve the workflow file in this order, and use the first one that exists:
1. `$CODEX_HOME/jelou/workflows/production-like.md` (global install; `$CODEX_HOME` defaults to `~/.codex` — resolve it to an absolute path first).
2. `jelou/workflows/production-like.md` (project-local fallback).

Resolution rules:
- Select the first existing path only; never read a lower-priority path when a higher one exists.
- If neither exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
The current directory is the project working directory.

## Runtime contract (Codex)

The workflow is runtime-neutral and uses the generic verbs `question` and `task`:
- `question` → Codex has no structured question tool. Ask the user in plain text, present any prescribed options as a numbered list, and WAIT for their reply before continuing. Never assume an answer; never skip a prescribed question.
- `task` → dispatch a Codex subagent (a `worker`/`explorer` agent, or the named `jlu-*` agent from `.codex/agents/`). If subagent dispatch is unavailable, perform the step inline in this session. Do not let a dispatched agent itself dispatch further agents (Codex defaults to `agents.max_depth = 1`).
- Always reference commands with the `jlu-` prefix (never `jlu:`).
- Phase 1 portability: if a step touches ClickUp or Slack integration, skip it and report it as deferred.
