---
description: "Use to surface deepening opportunities in a service or across services — refactors that turn shallow modules into deep ones."
argument-hint: "[<service-id>] [--cross-service]"
---
Resolve the workflow file in this order, and use the first one that exists:
1. `$CODEX_HOME/jelou/workflows/architecture-review.md` (global install; `$CODEX_HOME` defaults to `~/.codex` — resolve it to an absolute path first).
2. `jelou/workflows/architecture-review.md` (project-local fallback).

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
