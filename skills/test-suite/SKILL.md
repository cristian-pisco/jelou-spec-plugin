---
name: test-suite
description: Run the current service's unit + integration tests with the minimum worker count (1) and report failures grouped by component (Controller, Service, Repository, etc). Use when you want a fuller signal than execute-task's affected-tests step — typically before opening a PR. Triggers: "run tests", "test suite", "regression check", "validar tests"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

You are the orchestrator for the `/jlu-test-suite` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/test-suite/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/test-suite.md`

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Execute it **inline in this session** — do NOT spawn a sub-agent. The workflow takes no arguments and never asks the user anything; running inline keeps the LLM that classifies failures (Steps 5–6) at the same tier as the developer's current session.

The current working directory is `{cwd}`. The workflow has no arguments.

## Model recommendation

Best results when invoked from a Sonnet-or-better session. The failure-classification step (mapping each failed test to its Controller/Service/Repository/etc.) reads test files and infers the component under test from imports — Haiku is sometimes underspecific on projects with non-standard naming. If you are already in Sonnet or Opus, no action needed.
