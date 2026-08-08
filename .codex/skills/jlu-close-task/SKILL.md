---
name: jlu-close-task
description: "Use after a PR is merged — updates ClickUp, cleans up artifacts, and marks the task as closed. Triggers: \"close task\", \"PR was merged\", \"task is done\", \"wrap up\""
argument-hint: "[task-slug]"
---
Resolve the workflow file in this order, and use the first one that exists:
1. `$CODEX_HOME/jelou/workflows/close-task.md` (script install; `$CODEX_HOME` defaults to `~/.codex` — resolve it to an absolute path first).
2. `jelou/workflows/close-task.md` (project-local fallback).
3. `<plugin-root>/jelou/workflows/close-task.md`, where `<plugin-root>` is three directories above this SKILL.md (this file lives at `<plugin-root>/.codex/skills/jlu-close-task/SKILL.md`). This is the marketplace-install fallback: `codex plugin add` caches the whole plugin and never runs the script installer, so it is the only path that reaches the bundled workflows.

Resolution rules:
- Select the first existing path only; never read a lower-priority path when a higher one exists.
- If none exists, stop and report all three checked paths.
- Do not read the canonical `skills/close-task/SKILL.md` (a Claude Code entry point); this Codex skill delegates to the shared workflow above.

Read exactly one resolved workflow file and execute it exactly.

Any text the user provides with the invocation is the command arguments.
The current directory is the project working directory.

## Runtime contract (Codex)

The workflow is runtime-neutral and uses the generic verbs `question` and `task`:
- `question` / `AskUserQuestion` → Codex has no structured question tool. Ask the user in plain text, present any prescribed options as a numbered list, and WAIT for their reply before continuing. Never assume an answer, answer for the user, continue inline, or skip a prescribed question because a structured question tool is unavailable.
- **Autonomous mode is the one exception to that ban.** When the argument contains `--autonomous` or `JLU_AUTONOMOUS=true` is set, and the workflow publishes an "Autonomous mode — how every gate resolves" section, no gate asks: each takes its documented default and is disclosed per that section. This is not "assuming an answer because the tool is missing" — it is an explicit hand-off the caller authorised. Without that flag, the ban above stands in full.
- `task` → dispatch a Codex subagent (a `worker`/`explorer` agent, or the named `jlu-*` agent from `.codex/agents/`). If subagent dispatch is unavailable, perform the step inline in this session. Do not let a dispatched agent itself dispatch further agents (Codex defaults to `agents.max_depth = 1`).
- Always reference commands with the `jlu-` prefix (never `jlu:`).
- Phase 1 portability: if a step touches ClickUp or Slack integration, skip it and report it as deferred.
