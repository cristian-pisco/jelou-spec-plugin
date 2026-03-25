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

1. **Phase 1 (inline, inherits parent model):** Resolve plugin root path and validate the workflow/skill content source exists. Minimal work — a few file reads only.
2. **Phase 2 (subagent, correct model):** Dispatch the full workflow to an Agent with an explicit `model` parameter. The subagent executes the workflow.

### Skill Categories

Skills fall into two categories based on where their logic lives:

**Category A — Skills with separate workflow files (7 skills):**
`create-pr`, `close-task`, `execute-task`, `new-task`, `map-codebase`, `extend-phase`, `refine-task`

These have a corresponding file under `jelou/workflows/<name>.md`. The launcher reads the workflow file and passes its content to the subagent.

**Category B — Skills with embedded logic (5 skills):**
`report-task`, `post-slack`, `sync-clickup`, `refresh-skills`, `load-context`

These embed their entire workflow directly in the SKILL.md. For these skills:
1. **Extract** the workflow logic (everything below the frontmatter) into a new file: `jelou/workflows/<name>.md`
2. **Replace** the SKILL.md body with the launcher template
3. The extracted workflow file becomes the source passed to the subagent

This extraction is a prerequisite step before applying the launcher pattern to Category B skills.

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

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Read `<plugin-root>/jelou/workflows/<workflow>.md` to confirm it exists.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"<intended-model>"`
- **prompt**: Include:
  - The full content of the workflow file
  - The argument: `{argument}`
  - The plugin root path
  - The current working directory

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

### Key Changes Per SKILL.md

- `allowed-tools` shrinks to `Read`, `Glob`, `Agent` (launcher needs only these)
- Heavy tools (`Write`, `Bash`, `Grep`, `AskUserQuestion`, MCP tools) move to the subagent's scope
- Phase 1 does only file resolution — no workflow content is read into the parent context
- Phase 2 runs entirely on the intended model's quota

### MCP Tool Delegation

Three skills depend on MCP tools: `close-task` (ClickUp), `sync-clickup` (ClickUp), `post-slack` (Slack).

The Agent tool in Claude Code provides subagents access to all MCP servers configured in the session. MCP tools listed in the skill's `allowed-tools` do NOT need to be on the launcher — they are available to the subagent through the session's MCP configuration.

The subagent prompt must reference the specific MCP tools it needs. For example, the `sync-clickup` workflow already names the ClickUp tools it uses (e.g., `clickup_create_task`, `clickup_update_task`). The subagent will have access to these through the session's MCP server connections.

**If MCP access fails in the subagent:** The existing error handling in each workflow applies (e.g., `sync-clickup` Step 0 probes ClickUp connectivity and stops with a setup message if unavailable).

### Agent Model Cascade

Workflow files must explicitly specify the model when spawning subagents. Wherever a workflow spawns an agent, add the model parameter:

```
Spawn `jlu-git-agent` with model: "haiku"
Spawn `jlu-implementer` with model: "sonnet"
Spawn `jlu-proposal-agent` with model: "opus"
```

The agent definition's `model:` frontmatter serves as documentation of intent. The **caller** enforces it by passing `model` to the Agent tool.

## Changes Required

### Phase 1: Non-Opus skills (priority — these cause rate limit errors)

#### 1a. Extract embedded workflows (Category B prerequisite)

Create new workflow files for the 5 skills that embed logic in SKILL.md:

| Skill | New File | Source |
|-------|----------|--------|
| report-task | `jelou/workflows/report-task.md` | Extract from `skills/report-task/SKILL.md` body |
| post-slack | `jelou/workflows/post-slack.md` | Extract from `skills/post-slack/SKILL.md` body |
| sync-clickup | `jelou/workflows/sync-clickup.md` | Extract from `skills/sync-clickup/SKILL.md` body |
| refresh-skills | `jelou/workflows/refresh-skills.md` | Extract from `skills/refresh-skills/SKILL.md` body |
| load-context | `jelou/workflows/load-context.md` | Extract from `skills/load-context/SKILL.md` body |

The extracted content is the full SKILL.md body below the frontmatter, unchanged.

#### 1b. Convert non-Opus SKILL.md files to launchers

| Skill | Dispatch Model | Subagent Needs |
|-------|---------------|----------------|
| create-pr | sonnet | Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion |
| close-task | sonnet | Read, Write, Bash, Glob, Agent, AskUserQuestion, MCP (ClickUp) |
| report-task | sonnet | Read, Bash, Glob, Grep, AskUserQuestion |
| post-slack | sonnet | Read, Write, Bash, Glob, AskUserQuestion, MCP (Slack, ClickUp) |
| sync-clickup | sonnet | Read, Write, Glob, AskUserQuestion, MCP (ClickUp) |
| refresh-skills | haiku | Read, Write, Glob, Bash |

### Phase 2: Opus skills (consistency — apply same pattern)

| Skill | Dispatch Model | Subagent Needs |
|-------|---------------|----------------|
| execute-task | opus | Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion |
| new-task | opus | Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion |
| map-codebase | opus | Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion |
| extend-phase | opus | Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion |
| refine-task | opus | Read, Write, Agent, AskUserQuestion, Glob |
| load-context | opus | Read, Bash, Glob, Grep, Agent |

### Phase 3: Workflow agent spawn annotations

Add explicit `model:` parameter to every agent spawn instruction in:
- `jelou/workflows/create-pr.md` — git-agent spawns: `model: "haiku"`
- `jelou/workflows/execute-task.md` — implementer (`sonnet`), test-writer (`sonnet`), build-validator (`sonnet`), qa-agent (`sonnet`), proposal-agent (`opus`)
- `jelou/workflows/map-codebase.md` — 6 researchers (`opus`), cross-validator (`opus`)
- `jelou/workflows/new-task.md` — spec-interviewer (`opus`), researchers (`opus`)
- `jelou/workflows/close-task.md` — any agent spawns per their definition
- `jelou/workflows/load-context.md` — summary-agent (`sonnet`)

### Agent definitions (no changes)

Agent `.md` files keep their `model:` frontmatter as documentation. No structural changes needed.

## Rollout Order

Deliver in priority order to maximize impact:

1. **Phase 1a + 1b** — Non-Opus skills: extract workflows + convert to launchers. This directly fixes the rate limit problem.
2. **Phase 3** — Workflow agent spawn annotations. Ensures the model cascade is enforced at every level.
3. **Phase 2** — Opus skills: convert for consistency. Lower priority since these already match the typical session model.

## Edge Cases

### AskUserQuestion from subagents

Skills like `create-pr` and `close-task` use `AskUserQuestion` to interact with the user mid-workflow. Subagents can use this tool — the question surfaces to the user and the response flows back. No change needed.

### Rate limit on the launcher itself

If the Agent dispatch call in Phase 2 hits a rate limit (before the subagent starts), the launcher should detect the error and suggest: "Rate limited. Try again in a fresh session or wait a few minutes."

### Plugin root not found

If neither path resolution strategy finds the plugin root in Phase 1, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

### Opus skills from non-Opus sessions

If a user runs `/jlu:execute-task` from a Sonnet session, the launcher dispatches to an Opus agent — correct behavior. The pattern works in both directions.

### Token cost of Phase 1

Phase 1 only resolves paths and confirms the workflow file exists — it does NOT read the workflow content into the parent session. The workflow content is read by the subagent in Phase 2, so those tokens are charged against the subagent's model quota, not the parent session's.

## Testing

### Non-Opus skills (Phase 1)

1. Run `/jlu:create-pr` from an Opus session after a long `execute-task` — should not hit Opus rate limit
2. Verify PR creation completes using Sonnet quota
3. Verify `jlu-git-agent` runs on Haiku quota (check model in agent output)
4. Run `/jlu:refresh-skills` — should use Haiku, not Opus
5. Run `/jlu:close-task` — verify ClickUp MCP tools work from subagent
6. Run `/jlu:sync-clickup` — verify ClickUp MCP tools work from subagent
7. Run `/jlu:post-slack` — verify Slack MCP tools work from subagent

### Opus skills (Phase 2)

8. Run `/jlu:execute-task` — should still use Opus correctly
9. Run `/jlu:load-context` — verify read-only workflow works as subagent

### Error handling

10. Test with plugin root missing — should show clear error message
11. Test subagent dispatch when rate limited — should show retry suggestion
