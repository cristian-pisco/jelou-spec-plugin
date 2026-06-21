---
name: investigate
description: "Use for research and decision investigation — researching a question, comparing options, or gathering what is known about a topic, persisted as a resumable note. Triggers: \"research\", \"investigate X\", \"look into\", \"compare options\", \"what's known about\". NOT for debugging failures, 500s, errors, or stack traces — those route to /jlu-diagnose."
argument-hint: "<question> [--engine perplexity|fusion]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
  - WebSearch
---

You are the orchestrator for the `/jlu-investigate` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Up 2 levels from this skill's directory (`<plugin-root>/skills/investigate/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow stays tool-agnostic; map "research" here:
- `perplexity` engine → prefer the Perplexity MCP tool if connected
  (`mcp__perplexity__search`, or `mcp__perplexity__deep_research` for complex topics);
  otherwise fall back to `WebSearch`. Preload via `ToolSearch`.
- `fusion` engine → `bin/investigate.mjs fusion` (OpenRouter, needs `OPENROUTER_API_KEY`).
- If no research tool is available for the `perplexity` engine and no `OPENROUTER_API_KEY`
  for `fusion`, tell the user and persist the round as unresolved. Never invent a fact.

**Run in parallel** (single tool-call message):
1. `ToolSearch`: `select:WebSearch` (max_results: 1) — fallback research tool.
2. `ToolSearch`: `perplexity search` (max_results: 3) — prefer it for the perplexity engine.

## Phase 2 — Execute workflow

Read `<plugin-root>/jelou/workflows/investigate.md` and execute it exactly. The argument is
`{argument}`. The plugin root is the path resolved above. The current working directory is
`{cwd}`.
