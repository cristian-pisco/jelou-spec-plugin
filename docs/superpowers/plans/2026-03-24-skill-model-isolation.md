# Skill Model Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SKILL.md `model:` frontmatter actually work by converting all 12 JLU skills to a launcher pattern that dispatches workflows to subagents with explicit model overrides.

**Architecture:** Each SKILL.md becomes a thin launcher (Phase 1: resolve plugin path, Phase 2: dispatch Agent with correct model). Workflow logic moves to `jelou/workflows/` files. Subagents inherit MCP tool access from the session.

**Tech Stack:** Claude Code skills (markdown), Agent tool with `model` parameter, MCP tool delegation.

**Spec:** `docs/superpowers/specs/2026-03-24-skill-model-isolation-design.md`

---

## File Structure

### Files to create (workflow extraction for Category B skills)
- `jelou/workflows/report-task.md` — extracted from `skills/report-task/SKILL.md`
- `jelou/workflows/post-slack.md` — extracted from `skills/post-slack/SKILL.md`
- `jelou/workflows/sync-clickup.md` — extracted from `skills/sync-clickup/SKILL.md`
- `jelou/workflows/refresh-skills.md` — extracted from `skills/refresh-skills/SKILL.md`
- `jelou/workflows/load-context.md` — extracted from `skills/load-context/SKILL.md`

### Files to modify (SKILL.md → launcher pattern)
- `skills/create-pr/SKILL.md` — replace body with launcher, dispatch model: sonnet
- `skills/close-task/SKILL.md` — replace body with launcher, dispatch model: sonnet
- `skills/report-task/SKILL.md` — replace body with launcher, dispatch model: sonnet
- `skills/post-slack/SKILL.md` — replace body with launcher, dispatch model: sonnet
- `skills/sync-clickup/SKILL.md` — replace body with launcher, dispatch model: sonnet
- `skills/refresh-skills/SKILL.md` — replace body with launcher, dispatch model: haiku
- `skills/execute-task/SKILL.md` — replace body with launcher, dispatch model: opus
- `skills/new-task/SKILL.md` — replace body with launcher, dispatch model: opus
- `skills/map-codebase/SKILL.md` — replace body with launcher, dispatch model: opus
- `skills/extend-phase/SKILL.md` — replace body with launcher, dispatch model: opus
- `skills/refine-task/SKILL.md` — replace body with launcher, dispatch model: opus
- `skills/load-context/SKILL.md` — replace body with launcher, dispatch model: opus

### Files to modify (agent model annotations in workflows)
- `jelou/workflows/create-pr.md` — annotate git-agent spawn with `model: "haiku"`
- `jelou/workflows/execute-task.md` — annotate all agent spawns with their models
- `jelou/workflows/map-codebase.md` — annotate 6 researcher + cross-validator spawns with `model: "opus"`
- `jelou/workflows/new-task.md` — annotate spec-interviewer and git-agent spawns
- `jelou/workflows/close-task.md` — no agent spawns (uses MCP directly)
- `jelou/workflows/load-context.md` — annotate summary-agent spawn with `model: "sonnet"`

---

## Phase 1: Non-Opus Skills (fixes the rate limit problem)

> **Rollout rationale:** These 6 skills are intended for Sonnet/Haiku but run on Opus, directly causing the rate limit problem. Fixing them first delivers immediate value.

### Task 1: Extract `report-task` workflow

**Files:**
- Create: `jelou/workflows/report-task.md`
- Modify: `skills/report-task/SKILL.md`

- [ ] **Step 1: Extract workflow from SKILL.md**

Copy everything below the frontmatter `---` from `skills/report-task/SKILL.md` into a new file `jelou/workflows/report-task.md`. Add a workflow header:

```markdown
# Workflow: report-task

> Orchestrator workflow for `/jlu:report-task [task-slug]`
> Executive summary with progress, blockers, and stale worktree detection.

---

<rest of the SKILL.md body unchanged>
```

- [ ] **Step 2: Convert SKILL.md to launcher**

Replace `skills/report-task/SKILL.md` with:

```markdown
---
name: Report Task
description: Executive summary with progress, blockers, and stale worktree detection
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Glob
  - Agent
---

You are the launcher for the `/jlu:report-task` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/report-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/report-task.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"sonnet"`
- **prompt**: Include the full content of the workflow file, the argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 3: Verify extracted workflow matches original**

Read both files and confirm the workflow content is identical (minus the added header).

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/report-task.md skills/report-task/SKILL.md
git commit -m "refactor(report-task): extract workflow and convert to launcher pattern"
```

---

### Task 2: Extract `post-slack` workflow

**Files:**
- Create: `jelou/workflows/post-slack.md`
- Modify: `skills/post-slack/SKILL.md`

- [ ] **Step 1: Extract workflow from SKILL.md**

Copy everything below the frontmatter `---` from `skills/post-slack/SKILL.md` into a new file `jelou/workflows/post-slack.md`. Add a workflow header:

```markdown
# Workflow: post-slack

> Orchestrator workflow for `/jlu:post-slack [date] #channel`
> Generate and post daily summary to Slack.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.

---

<rest of the SKILL.md body unchanged>
```

- [ ] **Step 2: Convert SKILL.md to launcher**

Replace `skills/post-slack/SKILL.md` with:

```markdown
---
name: Post Slack
description: Generate and post daily summary to Slack
argument-hint: "[date] #channel"
allowed-tools:
  - Read
  - Glob
  - Agent
---

You are the launcher for the `/jlu:post-slack` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/post-slack/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/post-slack.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"sonnet"`
- **prompt**: Include the full content of the workflow file, the argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 3: Verify extracted workflow matches original**

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/post-slack.md skills/post-slack/SKILL.md
git commit -m "refactor(post-slack): extract workflow and convert to launcher pattern"
```

---

### Task 3: Extract `sync-clickup` workflow

**Files:**
- Create: `jelou/workflows/sync-clickup.md`
- Modify: `skills/sync-clickup/SKILL.md`

- [ ] **Step 1: Extract workflow from SKILL.md**

Copy everything below the frontmatter `---` from `skills/sync-clickup/SKILL.md` into a new file `jelou/workflows/sync-clickup.md`. Add a workflow header:

```markdown
# Workflow: sync-clickup

> Orchestrator workflow for `/jlu:sync-clickup [task-slug]`
> Create or update ClickUp macro task and subtasks from user stories.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.

---

<rest of the SKILL.md body unchanged>
```

- [ ] **Step 2: Convert SKILL.md to launcher**

Replace `skills/sync-clickup/SKILL.md` with:

```markdown
---
name: Sync ClickUp
description: Create or update ClickUp macro task and subtasks from user stories
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Glob
  - Agent
---

You are the launcher for the `/jlu:sync-clickup` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/sync-clickup/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/sync-clickup.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"sonnet"`
- **prompt**: Include the full content of the workflow file, the argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 3: Verify extracted workflow matches original**

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/sync-clickup.md skills/sync-clickup/SKILL.md
git commit -m "refactor(sync-clickup): extract workflow and convert to launcher pattern"
```

---

### Task 4: Extract `refresh-skills` workflow

**Files:**
- Create: `jelou/workflows/refresh-skills.md`
- Modify: `skills/refresh-skills/SKILL.md`

- [ ] **Step 1: Extract workflow from SKILL.md**

Copy everything below the frontmatter `---` from `skills/refresh-skills/SKILL.md` into a new file `jelou/workflows/refresh-skills.md`. Add a workflow header:

```markdown
# Workflow: refresh-skills

> Orchestrator workflow for `/jlu:refresh-skills`
> Refresh the skill registry by scanning local and global skills.

---

<rest of the SKILL.md body unchanged>
```

- [ ] **Step 2: Convert SKILL.md to launcher**

Replace `skills/refresh-skills/SKILL.md` with:

```markdown
---
name: Refresh Skills
description: Refresh the skill registry by scanning local and global skills
allowed-tools:
  - Read
  - Glob
  - Agent
---

You are the launcher for the `/jlu:refresh-skills` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/refresh-skills/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/refresh-skills.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"haiku"`
- **prompt**: Include the full content of the workflow file, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 3: Verify extracted workflow matches original**

- [ ] **Step 4: Commit**

```bash
git add jelou/workflows/refresh-skills.md skills/refresh-skills/SKILL.md
git commit -m "refactor(refresh-skills): extract workflow and convert to launcher pattern"
```

---

### Task 5: Convert `create-pr` SKILL.md to launcher

**Files:**
- Modify: `skills/create-pr/SKILL.md`

This skill already has a separate workflow file at `jelou/workflows/create-pr.md`. Only the SKILL.md needs conversion.

- [ ] **Step 1: Replace SKILL.md with launcher**

Replace `skills/create-pr/SKILL.md` with:

```markdown
---
name: Create PR
description: Stage, commit, push, and create pull requests for all affected services
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Glob
  - Agent
---

You are the launcher for the `/jlu:create-pr` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/create-pr/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/create-pr.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"sonnet"`
- **prompt**: Include the full content of the workflow file, the argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 2: Verify workflow file exists at expected path**

Read `jelou/workflows/create-pr.md` and confirm it contains the full workflow.

- [ ] **Step 3: Commit**

```bash
git add skills/create-pr/SKILL.md
git commit -m "refactor(create-pr): convert to launcher pattern with model sonnet"
```

---

### Task 6: Convert `close-task` SKILL.md to launcher

**Files:**
- Modify: `skills/close-task/SKILL.md`

This skill already has a separate workflow file at `jelou/workflows/close-task.md`.

- [ ] **Step 1: Replace SKILL.md with launcher**

Replace `skills/close-task/SKILL.md` with:

```markdown
---
name: Close Task
description: Close task after PR merge — update ClickUp, artifacts, and observability
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Glob
  - Agent
---

You are the launcher for the `/jlu:close-task` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/close-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/close-task.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"sonnet"`
- **prompt**: Include the full content of the workflow file, the argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 2: Verify workflow file exists at expected path**

- [ ] **Step 3: Commit**

```bash
git add skills/close-task/SKILL.md
git commit -m "refactor(close-task): convert to launcher pattern with model sonnet"
```

---

## Phase 2: Workflow Agent Model Annotations

> **Rollout rationale:** Per the spec, annotations come before Opus skill conversion. These annotations ensure existing workflows (already being used by Opus skills) correctly propagate model overrides to their subagents.

### Task 7: Annotate agent spawns in `create-pr.md`

**Files:**
- Modify: `jelou/workflows/create-pr.md:138`

- [ ] **Step 1: Add model annotation to git-agent spawn**

At line 138, where the workflow says `Spawn `jlu-git-agent` in `SERVICE_CWD``, add the model parameter:

Change:
```
Spawn `jlu-git-agent` in `SERVICE_CWD` with this task:
```
To:
```
Spawn `jlu-git-agent` in `SERVICE_CWD` with model: **haiku** and this task:
```

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "annotate(create-pr): add model haiku to git-agent spawn"
```

---

### Task 8: Annotate agent spawns in `execute-task.md`

**Files:**
- Modify: `jelou/workflows/execute-task.md` (multiple locations)

- [ ] **Step 1: Annotate proposal-agent spawns (lines ~88, ~96)**

Add `model: **opus**` to both `jlu-proposal-agent` spawn instructions.

- [ ] **Step 2: Annotate user-story derivation sub-agent (line ~137)**

Add `model: **sonnet**` to the sub-agent spawn for user story derivation.

- [ ] **Step 3: Annotate test-writer spawns (lines ~217, ~241, ~276)**

Add `model: **sonnet**` to all `jlu-test-writer` spawn instructions.

- [ ] **Step 4: Annotate implementer spawns (lines ~247, ~269, ~307)**

Add `model: **sonnet**` to all `jlu-implementer` spawn instructions.

- [ ] **Step 5: Annotate qa-agent spawns (lines ~298, ~357)**

Add `model: **sonnet**` to both `jlu-qa-agent` spawn instructions (per-phase and final).

- [ ] **Step 6: Annotate tasks-agent spawn (line ~313)**

Add `model: **sonnet**` to the `jlu-tasks-agent` spawn.

- [ ] **Step 7: Annotate git-agent spawns (lines ~320, ~337)**

Add `model: **haiku**` to both `jlu-git-agent` spawn instructions.

- [ ] **Step 8: Annotate build-validator spawn (line ~328)**

Add `model: **sonnet**` to the `jlu-build-validator` spawn.

- [ ] **Step 9: Annotate summary-agent spawn (line ~390)**

Add `model: **sonnet**` to the `jlu-summary-agent` spawn.

- [ ] **Step 10: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "annotate(execute-task): add explicit model to all agent spawns"
```

---

### Task 9: Annotate agent spawns in `map-codebase.md`

**Files:**
- Modify: `jelou/workflows/map-codebase.md` (lines ~84-138, ~162)

- [ ] **Step 1: Annotate 6 researcher agent spawns**

Add `model: **opus**` to each of the 6 researcher agent spawn instructions:
- `jlu-architecture-researcher` (line ~84)
- `jlu-stack-researcher` (line ~93)
- `jlu-conventions-researcher` (line ~102)
- `jlu-integrations-researcher` (line ~111)
- `jlu-structure-researcher` (line ~120)
- `jlu-concerns-researcher` (line ~129)

- [ ] **Step 2: Annotate cross-validator spawn (line ~162)**

Add `model: **opus**` to the `jlu-cross-validator` spawn.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/map-codebase.md
git commit -m "annotate(map-codebase): add model opus to all researcher and cross-validator spawns"
```

---

### Task 10: Annotate agent spawns in `new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md` (lines ~212, ~385)

- [ ] **Step 1: Annotate git-agent spawn (line ~212)**

Add `model: **haiku**` to the background `jlu-git-agent` spawn.

- [ ] **Step 2: Verify spec-interviewer spawn already has model annotation**

Line ~385 already says `Spawn a single `jlu-spec-interviewer` agent with model: **opus**`. Verify this is present and correct.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "annotate(new-task): add model haiku to git-agent spawn"
```

---

### Task 11: Verify agent spawns in `refine-task.md`

**Files:**
- Modify: `jelou/workflows/refine-task.md` (line ~148)

- [ ] **Step 1: Verify spec-interviewer spawn already has model annotation**

Line ~148 already says `Spawn a single `jlu-spec-interviewer` agent with model: **opus**`. Verify this is present and correct.

- [ ] **Step 2: Commit (if changes needed)**

Only commit if changes were made:
```bash
git add jelou/workflows/refine-task.md
git commit -m "annotate(refine-task): verify model annotations on agent spawns"
```

---

## Phase 3: Opus Skills (consistency)

> **Rollout rationale:** These skills already match the typical session model (Opus), so converting them is lower priority. Done last for consistency — ensures the pattern works in both directions (e.g., running Opus skills from a Sonnet session).

### Task 12: Extract `load-context` workflow and convert to launcher

**Files:**
- Create: `jelou/workflows/load-context.md`
- Modify: `skills/load-context/SKILL.md`

`load-context` is the only Category B Opus skill — it embeds logic in SKILL.md and has no workflow file.

- [ ] **Step 1: Extract workflow from SKILL.md**

Copy everything below the frontmatter `---` from `skills/load-context/SKILL.md` into a new file `jelou/workflows/load-context.md`. Add a workflow header:

```markdown
# Workflow: load-context

> Orchestrator workflow for `/jlu:load-context [task-slug]`
> Load completed or in-progress task context into a fresh session for Q&A.

---

<rest of the SKILL.md body unchanged>
```

- [ ] **Step 2: Convert SKILL.md to launcher**

Replace `skills/load-context/SKILL.md` with:

```markdown
---
name: Load Context
description: Load completed or in-progress task context into a fresh session for Q&A
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Glob
  - Agent
---

You are the launcher for the `/jlu:load-context` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/load-context/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/load-context.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"opus"`
- **prompt**: Include the full content of the workflow file, the argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 3: Annotate summary-agent spawn in extracted workflow**

In Step 9 of `jelou/workflows/load-context.md`, where it says `Dispatch `jlu-summary-agent``, add model annotation:

```
Dispatch `jlu-summary-agent` with model: **sonnet**:
```

- [ ] **Step 4: Verify extracted workflow matches original**

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/load-context.md skills/load-context/SKILL.md
git commit -m "refactor(load-context): extract workflow and convert to launcher pattern"
```

---

### Task 13: Convert remaining 5 Category A Opus skills to launcher pattern

**Files:**
- Modify: `skills/execute-task/SKILL.md`
- Modify: `skills/new-task/SKILL.md`
- Modify: `skills/map-codebase/SKILL.md`
- Modify: `skills/extend-phase/SKILL.md`
- Modify: `skills/refine-task/SKILL.md`

These all follow the same pattern — they already have workflow files and use the "Locate Plugin → Execute Workflow" structure. Convert each to the launcher pattern with `model: "opus"`.

- [ ] **Step 1: Convert `execute-task/SKILL.md`**

Replace body with launcher template. Model: `"opus"`. Workflow: `execute-task.md`.

- [ ] **Step 2: Convert `new-task/SKILL.md`**

Replace body with launcher template. Model: `"opus"`. Workflow: `new-task.md`.

- [ ] **Step 3: Convert `map-codebase/SKILL.md`**

Replace body with launcher template. Model: `"opus"`. Workflow: `map-codebase.md`.

- [ ] **Step 4: Convert `extend-phase/SKILL.md`**

Replace body with launcher template. Model: `"opus"`. Workflow: `extend-phase.md`.

- [ ] **Step 5: Convert `refine-task/SKILL.md`**

Replace body with launcher template. Model: `"opus"`. Workflow: `refine-task.md`.

- [ ] **Step 6: Verify all 5 workflow files exist at expected paths**

Read each workflow file to confirm it exists:
- `jelou/workflows/execute-task.md`
- `jelou/workflows/new-task.md`
- `jelou/workflows/map-codebase.md`
- `jelou/workflows/extend-phase.md`
- `jelou/workflows/refine-task.md`

- [ ] **Step 7: Commit**

```bash
git add skills/execute-task/SKILL.md skills/new-task/SKILL.md skills/map-codebase/SKILL.md skills/extend-phase/SKILL.md skills/refine-task/SKILL.md
git commit -m "refactor: convert 5 opus skills to launcher pattern for model isolation consistency"
```

---

## Phase 4: Validation

### Task 14: Final verification

- [ ] **Step 1: Verify all 12 SKILL.md files follow launcher pattern**

For each skill directory in `skills/*/SKILL.md`, verify:
1. `allowed-tools` contains only `Read`, `Glob`, `Agent`
2. Body contains "Phase 1 — Resolve Plugin" and "Phase 2 — Dispatch Orchestrator"
3. Phase 2 specifies a `model` parameter

- [ ] **Step 2: Verify all 12 workflow files exist**

Confirm these files exist under `jelou/workflows/`:
- `create-pr.md`, `close-task.md`, `execute-task.md`, `new-task.md`, `map-codebase.md`, `extend-phase.md`, `refine-task.md` (existing)
- `report-task.md`, `post-slack.md`, `sync-clickup.md`, `refresh-skills.md`, `load-context.md` (newly created)

- [ ] **Step 3: Verify no workflow content was lost during extraction**

For each Category B skill, compare the extracted workflow file against the git history of the original SKILL.md to ensure no logic was dropped.

```bash
git diff HEAD~N -- skills/report-task/SKILL.md
git diff HEAD~N -- skills/post-slack/SKILL.md
git diff HEAD~N -- skills/sync-clickup/SKILL.md
git diff HEAD~N -- skills/refresh-skills/SKILL.md
git diff HEAD~N -- skills/load-context/SKILL.md
```

- [ ] **Step 4: Verify agent model annotations are complete**

Grep all workflow files for agent spawn patterns and confirm each has a model annotation:

```bash
grep -n "Spawn\|spawn\|Dispatch\|dispatch" jelou/workflows/*.md
```

Every spawn instruction should include `model: **<model>**`.
