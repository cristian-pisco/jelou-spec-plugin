# Jelou Spec Plugin (OpenCode)

This repository provides a spec-driven orchestration workflow for OpenCode.

## Command Namespace

This file documents the **OpenCode** invocation contract. For Claude Code, see [INVOCATION.md](./INVOCATION.md).

In OpenCode:
- Use only `jlu-*` command names (e.g., `/jlu-new-task`).
- Never invent `jlu:*` names — that prefix belongs to Claude Code only.

## OpenCode Runtime Contract

- Use `question` for all user prompts and confirmations.
- Use `task` for subagent dispatches.
- Workflows live in `jelou/workflows/*.md`.
- OpenCode commands live in `.opencode/commands/*.md`.
- OpenCode subagents live in `.opencode/agents/*.md`.

## Phase 1 Scope

- Core workflows are in scope: map-codebase, new-task, refine-task, execute-task, extend-phase, create-pr, report-task, load-context, close-task, rollback-phase.
- External integrations are deferred to Phase 2:
  - `jlu-task-clickup`
  - `jlu-daily-slack`

If a Phase 1 run touches ClickUp/Slack integration steps, skip those steps and report that they are deferred to Phase 2.
