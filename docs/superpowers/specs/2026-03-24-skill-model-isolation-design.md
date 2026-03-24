# Skill Model Isolation Design

**Date:** 2026-03-24
**Status:** Approved
**Problem:** SKILL.md `model:` frontmatter is ignored — skills run inline via the Skill tool, inheriting the parent session's model instead of the intended model.

## Problem

All 12 JLU skills specify a `model:` field in their SKILL.md frontmatter, but the Skill tool executes skills inline within the current conversation. This means the model override is never respected — every skill runs on whatever model the session uses (typically Opus).

Six skills are designed for cheaper models (Sonnet or Haiku) but consume Opus quota instead. This causes Anthropic API rate limit errors, especially when `create-pr` or other skills run after long Opus sessions like `execute-task`.

### Affected Skills

| Skill | Intended Model | Actually Uses | Impact |
|-------|---------------|---------------|--------|
| create-pr | sonnet | opus | HIGH — multi-service, spawns git-agents |
| close-task | sonnet | opus | HIGH |
| report-task | sonnet | opus | MEDIUM |
| post-slack | sonnet | opus | MEDIUM |
| sync-clickup | sonnet | opus | MEDIUM |
| refresh-skills | haiku | opus | MEDIUM |
| execute-task | opus | opus | LOW (matches) |
| new-task | opus | opus | LOW (matches) |
| map-codebase | opus | opus | LOW (matches) |
| extend-phase | opus | opus | LOW (matches) |
| refine-task | opus | opus | LOW (matches) |
| load-context | opus | opus | LOW (matches) |

### Agent Model Cascade Issue

Agent definitions (e.g., `jlu-git-agent.md`) specify `model:` in frontmatter, but when spawned by an inline skill, the caller may not explicitly pass the model parameter to the Agent tool. The agent's intended model may not be enforced.

## Solution: Launcher Pattern

Convert every SKILL.md into a **two-phase launcher**:

1. **Phase 1 (inline, inherits parent model):** Resolve plugin root path and validate the workflow file exists. Minimal work — ~500 tokens.
2. **Phase 2 (subagent, correct model):** Dispatch the full workflow to an Agent with an explicit `model` parameter. The subagent reads and executes the workflow.

### Architecture

```
User's Opus session
  │
  ├─ /jlu:create-pr        (inline: resolve paths → dispatch Agent model:"sonnet")
  │     └─ Sonnet orchestrator (reads workflow, executes steps)
  │           └─ Agent model:"haiku" (jlu-git-agent, per service)
  │
  ├─ /jlu:close-task        (inline: resolve paths → dispatch Agent model:"sonnet")
  │     └─ Sonnet orchestrator
  │
  ├─ /jlu:report-task       (inline: resolve paths → dispatch Agent model:"sonnet")
  │     └─ Sonnet orchestrator
  │
  ├─ /jlu:post-slack        (inline: resolve paths → dispatch Agent model:"sonnet")
  │     └─ Sonnet orchestrator
  │
  ├─ /jlu:sync-clickup      (inline: resolve paths → dispatch Agent model:"sonnet")
  │     └─ Sonnet orchestrator
  │
  ├─ /jlu:refresh-skills    (inline: resolve paths → dispatch Agent model:"haiku")
  │     └─ Haiku orchestrator
  │
  ├─ /jlu:execute-task      (inline: resolve paths → dispatch Agent model:"opus")
  │     └─ Opus orchestrator
  │           ├─ Agent model:"sonnet" (implementer, test-writer, etc.)
  │           └─ Agent model:"haiku" (git-agent)
  │
  └─ (other opus skills follow same pattern for consistency)
```

### SKILL.md Template

```markdown
---
name: <Skill Name>
description: <description>
argument-hint: "<args>"
allowed-tools:
  - Read
  - Glob
  - Agent
---

## Phase 1 — Resolve Plugin (inline, minimal tokens)

Find the Jelou plugin root directory. Try these paths in order:
1. Go up 2 levels from this skill's directory
2. Check `~/.claude/jelou/`

Read `<plugin-root>/jelou/workflows/<workflow>.md` to confirm it exists.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"<intended-model>"`
- **prompt**: Include:
  - The full content of the workflow file
  - The argument: `{argument}`
  - The plugin root path
- **allowed tools**: <full tool list the workflow needs>

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

### Key Changes Per SKILL.md

- `allowed-tools` shrinks to `Read`, `Glob`, `Agent` (launcher needs only these)
- Heavy tools (`Write`, `Bash`, `Grep`, `AskUserQuestion`, MCP tools) move to the subagent's scope
- Phase 1 costs ~500 tokens on the parent model
- Phase 2 runs entirely on the intended model's quota

### Agent Model Cascade

Workflow files must explicitly specify the model when spawning subagents. Wherever a workflow spawns an agent, add the model parameter:

```
Spawn `jlu-git-agent` with model: "haiku"
Spawn `jlu-implementer` with model: "sonnet"
Spawn `jlu-proposal-agent` with model: "opus"
```

The agent definition's `model:` frontmatter serves as documentation of intent. The **caller** enforces it by passing `model` to the Agent tool.

## Changes Required

### SKILL.md files (all 12)

| Skill | Dispatch Model | Launcher Tools |
|-------|---------------|----------------|
| create-pr | sonnet | Read, Glob, Agent |
| close-task | sonnet | Read, Glob, Agent |
| report-task | sonnet | Read, Glob, Agent |
| post-slack | sonnet | Read, Glob, Agent |
| sync-clickup | sonnet | Read, Glob, Agent |
| refresh-skills | haiku | Read, Glob, Agent |
| execute-task | opus | Read, Glob, Agent |
| new-task | opus | Read, Glob, Agent |
| map-codebase | opus | Read, Glob, Agent |
| extend-phase | opus | Read, Glob, Agent |
| refine-task | opus | Read, Glob, Agent |
| load-context | opus | Read, Glob, Agent |

### Workflow files

Add explicit `model:` parameter to every agent spawn instruction in:
- `jelou/workflows/create-pr.md` — git-agent spawns need `model: "haiku"`
- `jelou/workflows/execute-task.md` — implementer, test-writer, build-validator, qa-agent, proposal-agent spawns
- `jelou/workflows/map-codebase.md` — 6 researcher agents + cross-validator spawns
- `jelou/workflows/new-task.md` — spec-interviewer, researcher spawns
- `jelou/workflows/close-task.md` — any agent spawns
- All other workflows that spawn agents

### Agent definitions (no changes)

Agent `.md` files keep their `model:` frontmatter as documentation. No structural changes needed.

## Edge Cases

### AskUserQuestion from subagents

Skills like `create-pr` and `close-task` use `AskUserQuestion` to interact with the user mid-workflow. Subagents can use this tool — the question surfaces to the user and the response flows back. No change needed.

### Rate limit on the launcher itself

If the Agent dispatch call in Phase 2 hits a rate limit (before the subagent starts), the launcher should detect the error and suggest: "Rate limited. Try again in a fresh session or wait a few minutes."

### Opus skills from non-Opus sessions

If a user runs `/jlu:execute-task` from a Sonnet session, the launcher dispatches to an Opus agent — correct behavior. The pattern works in both directions.

## Testing

1. Run `/jlu:create-pr` from an Opus session after a long `execute-task` — should not hit Opus rate limit
2. Verify PR creation completes using Sonnet quota
3. Verify `jlu-git-agent` runs on Haiku quota
4. Run `/jlu:refresh-skills` — should use Haiku, not Opus
5. Run `/jlu:execute-task` — should still use Opus correctly
