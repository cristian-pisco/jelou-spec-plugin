---
name: jlu-daily-slack
description: "Use to share sprint progress on Slack — generates and posts a sprint-scoped daily summary to a channel. Triggers: \"post to Slack\", \"daily update\", \"share sprint progress\", \"Slack daily\""
argument-hint: "<sprint> #channel"
---
Resolve the workflow file in this order, and use the first one that exists:
1. `$CODEX_HOME/jelou/workflows/daily-slack.md` (global install; `$CODEX_HOME` defaults to `~/.codex` — resolve it to an absolute path first).
2. `jelou/workflows/daily-slack.md` (project-local fallback).

Resolution rules:
- Select the first existing path only; never read a lower-priority path when a higher one exists.
- If neither exists, stop and report both checked paths.
- Do not read the canonical `skills/daily-slack/SKILL.md` (a Claude Code entry point); this Codex skill delegates to the shared workflow above.

Read exactly one resolved workflow file and execute it exactly.

Any text the user provides with the invocation is the command arguments.
The current directory is the project working directory.

## Runtime contract (Codex)

The workflow is runtime-neutral and uses the generic verbs `question` and `task`:
- `question` / `AskUserQuestion` → Codex has no structured question tool. Ask the user in plain text, present any prescribed options as a numbered list, and WAIT for their reply before continuing. Never assume an answer, answer for the user, continue inline, or skip a prescribed question because a structured question tool is unavailable.
- `task` → dispatch a Codex subagent (a `worker`/`explorer` agent, or the named `jlu-*` agent from `.codex/agents/`). If subagent dispatch is unavailable, perform the step inline in this session. Do not let a dispatched agent itself dispatch further agents (Codex defaults to `agents.max_depth = 1`).
- Always reference commands with the `jlu-` prefix (never `jlu:`).
- Phase 1 portability: if a step touches ClickUp or Slack integration, skip it and report it as deferred.
