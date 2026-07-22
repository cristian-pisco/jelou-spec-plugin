---
description: "Use to drive the current branch's PR(s) to green — resolves GitHub review comments (CodeRabbit and other bots included), merge conflicts with the base branch, failing CI/pipeline jobs, and SonarQube quality issues when the repo has Sonar. Triggers \"resolve pr\", \"resolver comentarios del PR\", \"atender comentarios del PR\", \"address PR review comments\", \"el PR tiene conflictos\", \"fix merge conflicts\", \"los jobs del PR están en rojo\", \"el pipeline está en rojo\", \"fix failing checks\", \"checks en rojo\", \"review sonar suggestions\", \"fix sonarqube issues\", \"sonar pr review\""
argument-hint: "[pr-url|pr-number] [--autonomous]"
---
Resolve the workflow file in this order, and use the first one that exists:
1. `$CODEX_HOME/jelou/workflows/resolve-pr.md` (global install; `$CODEX_HOME` defaults to `~/.codex` — resolve it to an absolute path first).
2. `jelou/workflows/resolve-pr.md` (project-local fallback).

Resolution rules:
- Select the first existing path only; never read a lower-priority path when a higher one exists.
- If neither exists, stop and report both checked paths.
- Do not read or execute `skills/resolve-pr/SKILL.md`; `skills/*/SKILL.md` files are Claude Code entry points, not Codex prompts.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
The current directory is the project working directory.

## Runtime contract (Codex)

The workflow is runtime-neutral and uses the generic verbs `question` and `task`:
- `question` / `AskUserQuestion` → Codex has no structured question tool. Ask the user in plain text, present any prescribed options as a numbered list, and WAIT for their reply before continuing. Never assume an answer, answer for the user, continue inline, or skip a prescribed question because a structured question tool is unavailable.
- `task` → dispatch a Codex subagent (a `worker`/`explorer` agent, or the named `jlu-*` agent from `.codex/agents/`). If subagent dispatch is unavailable, perform the step inline in this session. Do not let a dispatched agent itself dispatch further agents (Codex defaults to `agents.max_depth = 1`).
- Always reference commands with the `jlu-` prefix (never `jlu:`).
- Phase 1 portability: if a step touches ClickUp or Slack integration, skip it and report it as deferred.
