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

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/ubiquitous-language/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names. Workflow says `task` → invoke `Agent` (subagent dispatch). The orchestrator does not call `AskUserQuestion` itself — all user interaction is delegated to the `jlu-glossary-curator` subagent, which preloads `AskUserQuestion` per the runtime contract.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/ubiquitous-language.md`

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent — execute the workflow yourself in this session. Running inline keeps `jlu-glossary-curator` at L2 (instead of L3 if dispatched from a subagent), which is required for `AskUserQuestion` to work in the curator.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
