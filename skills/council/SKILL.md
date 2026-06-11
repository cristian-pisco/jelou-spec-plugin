---
name: council
description: "Use to convene a multi-model jury on a software architecture idea — a deliberation session where heterogeneous judges refute it round after round until the user and jury reach consensus (GO/GO_WITH_CONDITIONS/NO_GO), then hands a cleared idea off exclusively to /jlu-new-task. Triggers: \"council\", \"jurado\", \"judge this idea\", \"vale la pena implementar\", \"second opinion on this design\""
argument-hint: "<idea text | path-to-idea-file> [--context <path>] [--services a,b]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - WebSearch
  - ToolSearch
  - Skill
---

You are the orchestrator for the `/jlu-council` command.

## Phase 1 — Bootstrap

**Resolve plugin root.** Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/council/SKILL.md`).
2. `~/.claude/jelou/` (manual installation).

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

**Runtime contract (Claude Code).** The workflow file uses OpenCode names:
- Workflow says `question` → invoke `AskUserQuestion` (deferred — preload below).
- Workflow §4.3 says "research each uncertainty with your runtime's web research tool" →
  use the Perplexity MCP tool if connected (`mcp__perplexity__*`), otherwise `WebSearch`
  (preload below). The judges never search — only you, the arbiter, do. Never assume a fact
  you cannot verify.
- Workflow §6 says "invoke `/jlu-new-task`" → invoke the `new-task` skill via the `Skill`
  tool, passing the seed text as its argument. This is the council's ONLY onward routing —
  never suggest or invoke superpowers, GSD, gstack, or any other plugin's planning/spec
  workflow. Prefer the fresh-session handoff in §6 when the deliberation grew long.
- Never narrate questions as plain text. Never skip a prescribed question.

**Run these in parallel** (single tool-call message — do NOT serialize):
1. `Bash`: `<plugin-root>/bin/check-update.sh 2>/dev/null || echo SKIPPED`
2. `Read`: `<plugin-root>/jelou/workflows/council.md`
3. `ToolSearch`: `select:AskUserQuestion,WebSearch` (max_results: 2) — `AskUserQuestion` is
   mandatory before any question; `WebSearch` is the arbiter's fallback research tool.
4. `ToolSearch`: `perplexity search` (max_results: 3) — best-effort probe for the Perplexity
   MCP tool; if it returns matches, prefer it over `WebSearch` for §4.3 research.

**Update banner.** If the bash output starts with `UPDATE_AVAILABLE <local> <remote>`, print one line and continue:

> `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

If the output is `UP_TO_DATE` or `SKIPPED`, continue silently. Update-check failures must never block the workflow.

**ToolSearch fallback.** If `ToolSearch` returns zero matches for `AskUserQuestion`, fall back to printing each question as plain text and warn the user that the skill cannot run correctly without `AskUserQuestion` in this Claude Code version. If neither Perplexity nor `WebSearch` is available, the arbiter must declare each judge uncertainty as unresolved rather than assuming it away (per the workflow's §4.3).

## Phase 2 — Execute Workflow

Follow the workflow file you just read. Do NOT spawn a sub-agent — execute the workflow yourself in this session (you are the arbiter; the design forbids delegating the synthesis). The deliberation runs over several rounds until the user and the jury reach consensus; you stay in this session for the whole loop, the inter-round research, and the final `/jlu-new-task` handoff.

The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
