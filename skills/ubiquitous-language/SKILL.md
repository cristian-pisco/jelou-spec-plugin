---
name: ubiquitous-language
description: "Use to curate the workspace's domain glossary. Triggers: 'glossary', 'ubiquitous language', 'domain terminology', 'jlu-ubiquitous-language'."
argument-hint: "[service-id]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Agent
---

You are the orchestrator for the `/jlu-ubiquitous-language` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/ubiquitous-language/SKILL.md`).
2. Check `~/.claude/jelou/` (manual installation).

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/ubiquitous-language.md`.

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 1b — Load Claude Code Runtime Contract

Read `<plugin-root>/jelou/references/claude-code-runtime.md` and follow it. It maps `question` (used in the workflow) to `AskUserQuestion`, and maps `task` to `Agent`. The orchestrator does not call `AskUserQuestion` itself in this workflow — all user interaction is delegated to the `jlu-glossary-curator` subagent, which preloads `AskUserQuestion` per the contract.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/ubiquitous-language.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. Running inline keeps `jlu-glossary-curator` at L2 (instead of L3 if dispatched from a subagent), which is required for `AskUserQuestion` to work in the curator.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
