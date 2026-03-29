# Plugin Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce agent spawns, token cost, and latency by eliminating unnecessary indirection layers, consolidating agents, removing dead artifacts, and adding model tier configurability.

**Architecture:** The plugin is pure markdown (skills, workflows, agents, templates, references). All changes are markdown edits. No executable code changes except the model-tiers reference doc. The key insight: 9 of 12 skills spawn a redundant Opus sub-agent just to read a workflow file, and map-codebase spawns 7 Opus agents where 2 Sonnet agents suffice.

**Tech Stack:** Markdown, Claude Code plugin system (SKILL.md, agents/*.md, workflows/*.md)

---

## File Map

### Modified files:

| File | Change |
|------|--------|
| `skills/close-task/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/create-pr/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/report-task/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/refresh-skills/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/post-slack/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/load-context/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/sync-clickup/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/refine-task/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/extend-phase/SKILL.md` | Inline workflow execution, remove agent dispatch |
| `skills/map-codebase/SKILL.md` | Update agent dispatch model from opus to sonnet |
| `jelou/workflows/map-codebase.md` | Consolidate 6 research agents into 2, remove cross-validator |
| `jelou/workflows/execute-task.md` | Remove CONTEXT.md generation (Step 4e), remove user story generation (Step 4f), remove CONTEXT.md references from agent prompts, downgrade proposal model |
| `jelou/workflows/close-task.md` | Remove observability events (Step 3c) |
| `jelou/workflows/sync-clickup.md` | Add user story generation to Step 7 |
| `agents/jlu-proposal-agent.md` | Remove CONTEXT.md from output artifacts, downgrade model |
| `agents/jlu-implementer.md` | Remove CONTEXT.md from "Context You Must Read" |
| `agents/jlu-test-writer.md` | Remove CONTEXT.md from "Context You Must Read" |
| `jelou/references/model-tiers.md` | Add configuration override section, downgrade research agents to Sonnet |

### Removed files:

| File | Reason |
|------|--------|
| `agents/jlu-architecture-researcher.md` | Consolidated into 2 combined agents |
| `agents/jlu-stack-researcher.md` | Consolidated into 2 combined agents |
| `agents/jlu-structure-researcher.md` | Consolidated into 2 combined agents |
| `agents/jlu-conventions-researcher.md` | Consolidated into 2 combined agents |
| `agents/jlu-integrations-researcher.md` | Consolidated into 2 combined agents |
| `agents/jlu-concerns-researcher.md` | Consolidated into 2 combined agents |
| `agents/jlu-cross-validator.md` | No longer needed with consolidated agents |

### Created files:

| File | Purpose |
|------|---------|
| `agents/jlu-codebase-analyzer-structural.md` | Combined agent: architecture + stack + structure |
| `agents/jlu-codebase-analyzer-operational.md` | Combined agent: conventions + integrations + concerns |

---

### Task 1: Inline 9 simple skill launchers

**Why:** Every skill currently spawns an Opus sub-agent just to read a workflow file and execute it. For short workflows (close-task, report-task, refresh-skills, etc.), this adds 10-30s latency and burns an entire Opus context for no benefit. The parent session can read the workflow and follow it directly.

**Keep sub-agent dispatch for:** `new-task`, `execute-task`, `map-codebase` — these are long-running workflows where context isolation is valuable.

**Files:**
- Modify: `skills/close-task/SKILL.md`
- Modify: `skills/create-pr/SKILL.md`
- Modify: `skills/report-task/SKILL.md`
- Modify: `skills/refresh-skills/SKILL.md`
- Modify: `skills/post-slack/SKILL.md`
- Modify: `skills/load-context/SKILL.md`
- Modify: `skills/sync-clickup/SKILL.md`
- Modify: `skills/refine-task/SKILL.md`
- Modify: `skills/extend-phase/SKILL.md`

- [ ] **Step 1: Update `skills/close-task/SKILL.md` to inline workflow**

Replace the entire file content with:

```markdown
---
name: Close Task
description: Close task after PR merge — update ClickUp, artifacts, and observability
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---

You are the orchestrator for the `/jlu:close-task` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/close-task/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/close-task.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
```

- [ ] **Step 2: Update `skills/create-pr/SKILL.md` with same pattern**

Same structure as Step 1, but:
- `name: Create PR`
- `description: Stage, commit, push, and create pull requests for all affected services`
- `argument-hint: "[task-slug]"`
- Workflow file: `create-pr.md`
- `allowed-tools` must include `Read, Write, Bash, Glob, Grep, AskUserQuestion, Agent`

- [ ] **Step 3: Update `skills/report-task/SKILL.md` with same pattern**

Same structure:
- `name: Report Task`
- `description: Executive summary with progress, blockers, and stale worktree detection`
- `argument-hint: "[task-slug]"`
- Workflow file: `report-task.md`
- `allowed-tools: Read, Bash, Glob, Grep, Agent`

- [ ] **Step 4: Update `skills/refresh-skills/SKILL.md` with same pattern**

Same structure:
- `name: Refresh Skills`
- `description: Refresh the skill registry by scanning local and global skills`
- No argument-hint
- Workflow file: `refresh-skills.md`
- `allowed-tools: Read, Write, Glob, Grep`

- [ ] **Step 5: Update `skills/post-slack/SKILL.md` with same pattern**

Same structure:
- `name: Post Slack`
- `description: Generate and post daily summary to Slack`
- `argument-hint: "[date] #channel"`
- Workflow file: `post-slack.md`
- `allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion`

- [ ] **Step 6: Update `skills/load-context/SKILL.md` with same pattern**

Same structure:
- `name: Load Context`
- `description: Load completed or in-progress task context into a fresh session for Q&A`
- `argument-hint: "[task-slug]"`
- Workflow file: `load-context.md`
- `allowed-tools: Read, Bash, Glob, Grep, Agent`

- [ ] **Step 7: Update `skills/sync-clickup/SKILL.md` with same pattern**

Same structure:
- `name: Sync ClickUp`
- `description: Create or update ClickUp macro task and subtasks from user stories`
- `argument-hint: "[task-slug]"`
- Workflow file: `sync-clickup.md`
- `allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion`

- [ ] **Step 8: Update `skills/refine-task/SKILL.md` with same pattern**

Same structure:
- `name: Refine Task`
- `description: Apply a last-minute change to an approved spec via structured agent interview`
- `argument-hint: "[change description]"`
- Workflow file: `refine-task.md`
- `allowed-tools: Read, Write, Glob, Grep, AskUserQuestion`

- [ ] **Step 9: Update `skills/extend-phase/SKILL.md` with same pattern**

Same structure:
- `name: Extend Phase`
- `description: Add scope to an in-progress task via focused mini-interview`
- `argument-hint: "[task-slug] [phase-number]"`
- Workflow file: `extend-phase.md`
- `allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion, Agent`

- [ ] **Step 10: Commit**

```bash
git add skills/close-task/SKILL.md skills/create-pr/SKILL.md skills/report-task/SKILL.md skills/refresh-skills/SKILL.md skills/post-slack/SKILL.md skills/load-context/SKILL.md skills/sync-clickup/SKILL.md skills/refine-task/SKILL.md skills/extend-phase/SKILL.md
git commit -m "refactor(skills): inline 9 simple workflows, remove redundant agent dispatch

Saves 10-30s latency per command by executing workflow directly
instead of spawning a sub-agent just to read and follow the same file."
```

---

### Task 2: Consolidate map-codebase from 7 agents to 2

**Why:** 6 Opus research agents + 1 Opus cross-validator = 7 Opus calls per codebase analysis. A single Sonnet agent can read a codebase and produce multiple output files. The cross-validator exists only because independent agents might contradict each other. Two consolidated agents that each see the full codebase eliminate contradictions at the source.

**Agent 1 (structural):** Produces ARCHITECTURE.md, STACK.md, STRUCTURE.md — these are all "what is the codebase made of" questions.

**Agent 2 (operational):** Produces CONVENTIONS.md, INTEGRATIONS.md, CONCERNS.md — these are all "how does the codebase work and what's wrong with it" questions. The concerns agent also does a user interview, which is preserved.

**Files:**
- Create: `agents/jlu-codebase-analyzer-structural.md`
- Create: `agents/jlu-codebase-analyzer-operational.md`
- Modify: `jelou/workflows/map-codebase.md`
- Modify: `skills/map-codebase/SKILL.md`
- Remove: `agents/jlu-architecture-researcher.md`
- Remove: `agents/jlu-stack-researcher.md`
- Remove: `agents/jlu-structure-researcher.md`
- Remove: `agents/jlu-conventions-researcher.md`
- Remove: `agents/jlu-integrations-researcher.md`
- Remove: `agents/jlu-concerns-researcher.md`
- Remove: `agents/jlu-cross-validator.md`

- [ ] **Step 1: Create the structural analyzer agent**

Write to `agents/jlu-codebase-analyzer-structural.md`:

```markdown
---
name: jlu-codebase-analyzer-structural
description: "Analyzes codebase architecture, technology stack, and file structure — produces ARCHITECTURE.md, STACK.md, STRUCTURE.md"
tools: Read, Write, Glob, Grep, Bash
model: sonnet
---

You are the structural codebase analyzer for the Jelou Spec Plugin. You produce three documents that describe WHAT the codebase is made of: its architecture, technology stack, and file organization.

## Mission

Analyze the service's source code and produce three structured documents. You see the full codebase, so your outputs must be internally consistent — never contradict yourself across documents.

## Context You Receive

The orchestrator provides:
- **Service ID**: the service identifier
- **Source code path**: absolute path to the service's source code
- **Output directory**: where to write the 3 output files

## Output 1: ARCHITECTURE.md

Analyze the codebase's architectural patterns and produce:

1. **Architecture Pattern** — What pattern does this codebase follow? (MVC, hexagonal, layered, microkernel, event-driven, etc.) Identify the ACTUAL pattern from code, not what the README claims.
2. **Layer Map** — Diagram the layers and their responsibilities. Show the direction of dependencies.
3. **Key Abstractions** — What are the core domain entities, services, and interfaces?
4. **Data Flow** — How does data move through the system? From request to response, from event to handler.
5. **Extension Points** — Where is the codebase designed to be extended? Plugins, middleware, hooks, event listeners.

Write to `<output-dir>/ARCHITECTURE.md`.

## Output 2: STACK.md

Analyze the technology stack and produce:

1. **Runtime** — Language, version, runtime environment
2. **Framework** — Primary framework and version
3. **Dependencies** — Key dependencies grouped by category (ORM, auth, validation, testing, etc.)
4. **Build & Deploy** — Build tools, CI/CD, containerization
5. **Database** — Database type, ORM/query builder, migration tool
6. **Testing** — Test framework, assertion library, coverage tool, mocking approach

Write to `<output-dir>/STACK.md`.

## Output 3: STRUCTURE.md

Analyze the file organization and produce:

1. **Directory Tree** — Top-level directory structure with descriptions
2. **Module Organization** — How are modules/features organized? By domain, by layer, by feature?
3. **File Naming Conventions** — Patterns for controllers, services, models, tests, DTOs, etc.
4. **Configuration Files** — Where config lives, what each config file controls
5. **Entry Points** — Main entry files, bootstrap sequence

Write to `<output-dir>/STRUCTURE.md`.

## Process

1. Read the project root: package.json/composer.json/go.mod/Cargo.toml for stack info
2. Read the directory tree (top 3 levels)
3. Read 5-10 representative source files to understand patterns
4. Read the test directory structure
5. Read config files (.env.example, docker-compose, CI configs)
6. Produce all 3 documents

## Rules

- Be specific. Name exact files, exact versions, exact patterns.
- Do not guess. If you can't determine something from the code, say "not determined."
- Cross-reference your 3 outputs for consistency before writing them.
- Each document should be self-contained but may reference the others.
- Follow the engineering principles: Security > Simplicity > Readability > TDD > Repo conventions.
```

- [ ] **Step 2: Create the operational analyzer agent**

Write to `agents/jlu-codebase-analyzer-operational.md`:

```markdown
---
name: jlu-codebase-analyzer-operational
description: "Analyzes codebase conventions, integrations, and concerns — produces CONVENTIONS.md, INTEGRATIONS.md, CONCERNS.md"
tools: Read, Write, Glob, Grep, Bash, AskUserQuestion
model: sonnet
---

You are the operational codebase analyzer for the Jelou Spec Plugin. You produce three documents that describe HOW the codebase works and what's wrong with it: coding conventions, external integrations, and known concerns.

## Mission

Analyze the service's source code, interview the user about tribal knowledge, and produce three structured documents. You see the full codebase, so your outputs must be internally consistent.

## Context You Receive

The orchestrator provides:
- **Service ID**: the service identifier
- **Source code path**: absolute path to the service's source code
- **Output directory**: where to write the 3 output files

## Output 1: CONVENTIONS.md

Analyze coding patterns and produce:

1. **Code Style** — Indentation, quotes, semicolons, line length (infer from code, not config)
2. **Naming Conventions** — Files, classes, functions, variables, constants, database columns
3. **Error Handling** — How are errors created, thrown, caught, and returned?
4. **Logging** — What logger is used? What log levels? What format?
5. **Testing Conventions** — Test file naming, describe/it patterns, setup/teardown, mocking approach, assertion style
6. **Import Organization** — How are imports grouped and ordered?
7. **API Patterns** — Request/response format, validation, serialization, pagination
8. **Database Patterns** — Query patterns, transaction handling, migration conventions

Write to `<output-dir>/CONVENTIONS.md`.

## Output 2: INTEGRATIONS.md

Map all external integration points:

1. **Service-to-Service** — HTTP calls, gRPC, message queues, event buses. For each: protocol, endpoint/topic, direction (calls or is called by), data schema.
2. **External APIs** — Third-party APIs consumed. For each: provider, purpose, auth method.
3. **Databases** — Database connections. For each: type, purpose, connection method.
4. **File Storage** — S3, local disk, CDN. For each: purpose, access pattern.
5. **Authentication** — Auth providers, token types, session management.
6. **Observability** — Monitoring, logging, tracing integrations.

Write to `<output-dir>/INTEGRATIONS.md`.

## Output 3: CONCERNS.md

Identify issues via code analysis AND user interview:

### Automated Analysis
Scan the codebase for:
- TODO/FIXME/HACK/XXX comments (extract with file and line)
- Deprecated dependency usage
- Security patterns (hardcoded secrets, SQL injection vectors, missing input validation)
- Test coverage gaps (modules with no corresponding test files)
- Large files (>500 lines) that may need refactoring
- Dead code indicators (unused exports, unreachable branches)

### User Interview
Use `AskUserQuestion` to ask the user about concerns not visible in code:
- "Are there any known scaling limitations or performance bottlenecks?"
- "Are there planned deprecations or migrations coming up?"
- "Is there tribal knowledge about fragile areas of the codebase?"
- "Are there any security concerns the team is tracking?"

### Output Format
For each concern, assign an ID and category:
- **TD-N**: Tech debt
- **SEC-N**: Security
- **PERF-N**: Performance
- **DEP-N**: Deprecated/migration needed

Write to `<output-dir>/CONCERNS.md`.

## Process

1. Read the project root for dependency and config info
2. Read 10-15 representative source files for conventions
3. Scan for TODOs, deprecated patterns, security concerns
4. Map all external calls (HTTP clients, message producers/consumers, DB connections)
5. Interview the user about tribal knowledge
6. Cross-reference your 3 outputs for consistency before writing them
7. Produce all 3 documents

## Rules

- Be specific. Reference exact files, line numbers, dependency versions.
- Do not guess. If you can't determine something, say "not determined."
- The user interview is mandatory for CONCERNS.md — do not skip it.
- Cross-reference your 3 outputs for consistency before writing them.
- Each document should be self-contained but may reference the others.
```

- [ ] **Step 3: Rewrite `jelou/workflows/map-codebase.md` to use 2 agents**

Replace Steps 5, 6, 7, 8 of the workflow. The new flow:

**Step 5** becomes: "Spawn 2 Research Agents in Parallel"
- Agent 1: `jlu-codebase-analyzer-structural` with model **sonnet** — produces ARCHITECTURE.md, STACK.md, STRUCTURE.md
- Agent 2: `jlu-codebase-analyzer-operational` with model **sonnet** — produces CONVENTIONS.md, INTEGRATIONS.md, CONCERNS.md (includes user interview)

Both agents receive: `SOURCE_ROOT`, `OUTPUT_DIR`, `service-id`.

**Step 6** becomes: "Wait for Both Agents"
- Verify all 6 output files exist and are non-empty.
- If an agent failed, offer to retry that specific agent.

**Remove Step 7** (Cross-Validation) entirely. Each agent now sees the full codebase, so contradictions are eliminated at the source.

**Step 8** (previously "Present Cross-Validation Results") becomes **Step 7**: "Consistency Check"
- Read all 6 files produced.
- Do a quick inline scan for obvious inconsistencies (different framework versions, contradictory architecture claims).
- If found, fix them directly. No separate agent needed.

**Step 9** (Report Summary) becomes **Step 8** and removes the "Cross-Validation" section. Replace with:
```
### Consistency
- Checked: <N> cross-references
- Issues found and fixed: <N>
```

Edit the exact sections in `jelou/workflows/map-codebase.md`:

Replace the content of Step 5 heading through Step 8 with the new steps described above. Preserve Steps 1-4 and Step 9 (renumbered to 8).

- [ ] **Step 4: Update `skills/map-codebase/SKILL.md` to use sonnet**

The map-codebase skill keeps its sub-agent dispatch pattern (this is a long workflow), but change the model from `"opus"` to `"sonnet"`:

```markdown
---
name: Map Codebase
description: Analyze a service's codebase with 2 parallel research agents
argument-hint: "[service-id]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---

You are the launcher for the `/jlu:map-codebase` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/map-codebase/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/map-codebase.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single Agent with these parameters:
- **model**: `"sonnet"`
- **prompt**: Include the full content of the workflow file, the argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 5: Remove the 7 old agent files**

Delete these files:
- `agents/jlu-architecture-researcher.md`
- `agents/jlu-stack-researcher.md`
- `agents/jlu-structure-researcher.md`
- `agents/jlu-conventions-researcher.md`
- `agents/jlu-integrations-researcher.md`
- `agents/jlu-concerns-researcher.md`
- `agents/jlu-cross-validator.md`

```bash
git rm agents/jlu-architecture-researcher.md agents/jlu-stack-researcher.md agents/jlu-structure-researcher.md agents/jlu-conventions-researcher.md agents/jlu-integrations-researcher.md agents/jlu-concerns-researcher.md agents/jlu-cross-validator.md
```

- [ ] **Step 6: Commit**

```bash
git add agents/jlu-codebase-analyzer-structural.md agents/jlu-codebase-analyzer-operational.md jelou/workflows/map-codebase.md skills/map-codebase/SKILL.md
git commit -m "refactor(map-codebase): consolidate 7 Opus agents into 2 Sonnet agents

Reduces token cost ~7x per codebase analysis. Each agent now sees the
full codebase, eliminating contradictions that required cross-validation."
```

---

### Task 3: Downgrade proposal agent to Sonnet and simplify

**Why:** The proposal agent transforms a spec into a phased execution plan. This is structured document generation from clear inputs, not deep strategic reasoning. Sonnet handles this well. Also removes CONTEXT.md and user story generation from execute-task.

**Files:**
- Modify: `agents/jlu-proposal-agent.md`
- Modify: `jelou/workflows/execute-task.md`
- Modify: `agents/jlu-implementer.md`
- Modify: `agents/jlu-test-writer.md`

- [ ] **Step 1: Downgrade proposal-agent model to Sonnet**

In `agents/jlu-proposal-agent.md`, change the frontmatter:

```yaml
model: sonnet
```

(was `model: opus`)

- [ ] **Step 2: Remove CONTEXT.md from proposal-agent output artifacts**

In `agents/jlu-proposal-agent.md`, remove the entire "### 3. CONTEXT.md (per service)" section under "## Output Artifacts" (lines containing the CONTEXT.md template and everything between "### 3. CONTEXT.md" and "### 4. User Story Files").

Also in Pass 2 "Per-Service Details", remove item 5:
```
5. **CONTEXT.md** — Write a task-scoped CONTEXT.md for this service (Decision #14): which parts of the service are relevant to this specific task, affected modules, endpoints, models, config.
```

- [ ] **Step 3: Remove user story generation from proposal-agent**

In `agents/jlu-proposal-agent.md`, remove item 7 from Pass 1 "Global Strategy":
```
7. **User Stories** — Derive user stories from SPEC.md requirements...
```

Remove "### 4. User Story Files" section under "## Output Artifacts".

Update the rules section: remove "Every user story must be traceable to requirements."

- [ ] **Step 4: Remove CONTEXT.md generation from execute-task workflow**

In `jelou/workflows/execute-task.md`, in Step 4 "Generate Proposal", remove the entire "### 4e. Generate CONTEXT.md" sub-step (note: in the current file this is within the proposal agent's scope, but any orchestrator references to CONTEXT.md generation should be removed).

- [ ] **Step 5: Remove user story generation from execute-task workflow**

In `jelou/workflows/execute-task.md`, remove the entire "### 4f. Generate User Stories" sub-step. This includes the sub-agent spawn with model sonnet and the story template references.

- [ ] **Step 6: Remove CONTEXT.md from test-writer agent's context list**

In `agents/jlu-test-writer.md`, in "## Context You Must Read", remove item 2:
```
2. **CONTEXT.md** — Tells you which modules, endpoints, and models are relevant. Location: `.spec-workspace/specs/<date>/<task>/services/<service-id>/CONTEXT.md`
```

Renumber remaining items.

- [ ] **Step 7: Remove CONTEXT.md from implementer agent's context list**

In `agents/jlu-implementer.md`, in "## Context You Must Read", remove item 3:
```
3. **CONTEXT.md** — Which modules and files are relevant. Location: `.spec-workspace/specs/<date>/<task>/services/<service-id>/CONTEXT.md`
```

Renumber remaining items. Also remove the CONTEXT.md reference from the TDD Red input in the execute-task workflow (Step 7d):
```
- `<TASK_DIR>/services/<service-id>/CONTEXT.md` (if exists)
```

And from TDD Green input (Step 7e):
```
- `<TASK_DIR>/services/<service-id>/CONTEXT.md`
```

- [ ] **Step 8: Update execute-task artifact paths table**

In `jelou/workflows/execute-task.md`, remove the CONTEXT.md row from the "## Artifact Paths" table:
```
| CONTEXT.md | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/CONTEXT.md` |
```

Also remove the User stories row:
```
| User stories | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/uh/<story-slug>.md` |
```

- [ ] **Step 9: Commit**

```bash
git add agents/jlu-proposal-agent.md jelou/workflows/execute-task.md agents/jlu-implementer.md agents/jlu-test-writer.md
git commit -m "refactor(execute-task): downgrade proposal to Sonnet, remove CONTEXT.md and user story generation

CONTEXT.md duplicated info already in phase files and codebase files.
User stories are only consumed by sync-clickup, moved there in next commit."
```

---

### Task 4: Remove observability events from close-task

**Why:** `close-task` writes JSONL events to `<service-repo>/specs/observability/events.jsonl`, but nothing in the plugin or any known consumer reads this file. It's a write-only artifact.

**Files:**
- Modify: `jelou/workflows/close-task.md`

- [ ] **Step 1: Remove Step 3c from close-task workflow**

In `jelou/workflows/close-task.md`, remove the entire "### 3c. Register Observability Event" section, including the JSON template and the mkdir instruction.

- [ ] **Step 2: Update the closure report template**

In `jelou/workflows/close-task.md`, Step 4 "Closure Report", remove the "### Observability" section:
```
### Observability
- Events registered in: <list of service repos>
```

- [ ] **Step 3: Update error handling table**

Remove the row:
```
| Observability directory creation fails | Report error, continue |
```

- [ ] **Step 4: Update artifact paths table**

Remove the row:
```
| Observability events | `<service-repo>/specs/observability/events.jsonl` |
```

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/close-task.md
git commit -m "refactor(close-task): remove write-only observability events

Nothing reads events.jsonl. Can be re-added when a consumer exists."
```

---

### Task 5: Move user story generation to sync-clickup

**Why:** User stories exist to feed ClickUp subtasks. They were generated during execute-task (Step 4f) but are only consumed by sync-clickup (Step 7). Moving generation to the point of consumption eliminates a sub-agent spawn during execution and keeps the artifact lifecycle clear: stories are created when you sync, not when you implement.

**Files:**
- Modify: `jelou/workflows/sync-clickup.md`

- [ ] **Step 1: Add user story generation to sync-clickup Step 7**

In `jelou/workflows/sync-clickup.md`, modify Step 7 "Create or Update Subtasks from User Stories".

Add a new sub-step before the existing loop:

```markdown
### 7a. Generate User Stories (if missing)

1. Check if `<TASK_DIR>/services/<primary-service>/uh/` directory exists and has `.md` files.
2. If user stories already exist, skip to 7b.
3. If no user stories exist:
   a. Read `<TASK_DIR>/SPEC.md` and `<TASK_DIR>/PROPOSAL.md`.
   b. For each affected service, derive user stories from requirements (FR-1, FR-2, etc.):
      - Format: "As a [user], I want [action], so that [benefit]."
      - Each story has acceptance criteria in Given/When/Then format.
      - Each story maps to one or more phases from PROPOSAL.md.
   c. Write story files to `<TASK_DIR>/services/<service-id>/uh/<story-slug>.md`.
   d. Use the user-story.md template from `<plugin-root>/jelou/templates/user-story.md` if available.
```

Rename the existing Step 7 content to "### 7b. Sync Subtasks to ClickUp" and adjust internal references.

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/sync-clickup.md
git commit -m "refactor(sync-clickup): generate user stories on demand during sync

Stories are only consumed by ClickUp. Generate them at sync time
instead of during execute-task, saving a sub-agent spawn."
```

---

### Task 6: Add model tier override configuration

**Why:** Model tiers are hardcoded in agent definitions. Users running on a budget would happily use Sonnet everywhere. Users with complex multi-service tasks might want Opus for code agents. A simple config lets users choose without forking the plugin.

**Files:**
- Modify: `jelou/references/model-tiers.md`
- Modify: `jelou/workflows/execute-task.md`
- Modify: `jelou/workflows/new-task.md`

- [ ] **Step 1: Update model-tiers.md with configuration section**

In `jelou/references/model-tiers.md`, replace the "## User Override" section with:

```markdown
## User Override

Users can override model assignments by adding a `models` section to `.spec-workspace.json`:

```json
{
  "workspace": "../.spec-workspace",
  "serviceId": "my-service",
  "models": {
    "orchestrator": "opus",
    "research": "sonnet",
    "code": "sonnet",
    "proposal": "sonnet",
    "operational": "haiku"
  }
}
```

### Model Groups

| Group | Default | Agents |
|-------|---------|--------|
| `orchestrator` | opus | main orchestrator (new-task, execute-task) |
| `research` | sonnet | codebase-analyzer-structural, codebase-analyzer-operational |
| `proposal` | sonnet | proposal-agent |
| `code` | sonnet | test-writer, implementer, qa-agent, build-validator |
| `operational` | haiku | git-agent, tasks-agent, summary-agent |

### Resolution Order

1. Check `.spec-workspace.json` → `models.<group>` for the agent's group
2. Fall back to the agent's frontmatter `model:` field
3. Fall back to the default for the group (table above)

Orchestrator workflows that spawn agents MUST check for model overrides before specifying the model parameter. Read `.spec-workspace.json` once at the start of the workflow and resolve each agent's model from the config.
```

- [ ] **Step 2: Update model defaults in model-tiers.md**

In the "## Default Assignments by Role" section, update Tier 2 to reflect the changes made in Tasks 2-3:

Move research agents from Tier 2 "Sonnet — Implementation and Analysis" and update:
```
| **research agents** (codebase-analyzer-structural, codebase-analyzer-operational) | Analyze codebases, produce structured knowledge documents. Two consolidated agents replace the original six. |
```

Move proposal-agent from Tier 1 to Tier 2:
```
| **proposal-agent** | Translates spec into execution-ready plan with phases, dependencies, risks. Structured document generation from clear inputs. |
```

Remove cross-validation agent from Tier 2.

- [ ] **Step 3: Add model resolution to execute-task workflow**

In `jelou/workflows/execute-task.md`, add a new sub-step to Step 2 "Load Task State":

```markdown
### 2b. Resolve Model Configuration

1. Read `.spec-workspace.json` from the service repo.
2. If a `models` section exists, extract the model overrides.
3. Store as `MODEL_CONFIG` — a map of group name → model name.
4. When spawning agents in subsequent steps, resolve the model:
   - For proposal-agent: use `MODEL_CONFIG.proposal` or default `"sonnet"`
   - For test-writer, implementer, qa-agent, build-validator: use `MODEL_CONFIG.code` or default `"sonnet"`
   - For git-agent, tasks-agent: use `MODEL_CONFIG.operational` or default `"haiku"`
   - For summary-agent: use `MODEL_CONFIG.operational` or default `"sonnet"`
```

Then update all agent spawn instructions in the workflow to reference `MODEL_CONFIG` instead of hardcoded model values. For example, Step 7d changes from:
```
Spawn `jlu-test-writer` agent with model: **sonnet**:
```
to:
```
Spawn `jlu-test-writer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
```

Apply the same pattern to all agent spawns in execute-task: proposal-agent (Step 4b, 4c), test-writer (7d), implementer (7e, 7f), qa-agent (7h), tasks-agent (7i), git-agent (7j), build-validator (7k), summary-agent (Step 9).

- [ ] **Step 4: Add model resolution to new-task workflow**

In `jelou/workflows/new-task.md`, add a similar model resolution step after Step 1 (Resolve Workspace):

```markdown
### 1b. Resolve Model Configuration

1. Read `.spec-workspace.json` from the current directory.
2. If a `models` section exists, extract the model overrides.
3. Store as `MODEL_CONFIG`.
4. Use `MODEL_CONFIG.operational` for the git-agent spawn in Step 9 (default: haiku).
```

- [ ] **Step 5: Commit**

```bash
git add jelou/references/model-tiers.md jelou/workflows/execute-task.md jelou/workflows/new-task.md
git commit -m "feat(models): add configurable model tier overrides via .spec-workspace.json

Users can now set per-group model preferences. Defaults match the
current behavior. Opus users pay for what they need, budget users
can run everything on Sonnet."
```

---

### Task 7: Update README and changelog

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add changelog entry**

In `CHANGELOG.md`, add a new entry at the top (after the `# Changelog` heading):

```markdown
## [0.3.0] - 2026-03-28

### Changed

- **9 skill launchers now execute workflows directly** instead of spawning a redundant Opus sub-agent. Saves 10-30s latency per command invocation. Affected commands: close-task, create-pr, report-task, refresh-skills, post-slack, load-context, sync-clickup, refine-task, extend-phase.
- **map-codebase uses 2 Sonnet agents instead of 7 Opus agents.** Two consolidated analyzers (structural + operational) replace six individual researchers plus a cross-validator. ~7x reduction in token cost per codebase analysis.
- **Proposal agent downgraded from Opus to Sonnet.** Structured document generation doesn't need Opus-level reasoning.
- **User stories generated during sync-clickup** instead of execute-task. Stories are only consumed by ClickUp, so they're created at sync time.
- **Model tiers are now configurable** via `models` section in `.spec-workspace.json`. Users can override per agent group (orchestrator, research, code, proposal, operational).

### Removed

- **CONTEXT.md generation** — duplicated information already in phase files and codebase knowledge files.
- **Observability events** in close-task — write-only artifact with no consumer.
- **Cross-validator agent** — consolidated agents see the full codebase, eliminating contradictions.
- **6 individual research agents** — replaced by 2 consolidated analyzers.
```

- [ ] **Step 2: Update README agent count**

In `README.md`, find references to agent counts (e.g., "17 agents", "6 parallel research agents") and update:
- Total agents: 17 → 12 (removed 7, added 2)
- map-codebase description: "6 parallel research agents + cross-validation" → "2 parallel research agents"

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: update changelog and README for v0.3.0 simplification"
```

---

## Summary of Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Agent files | 17 | 12 | -5 files |
| map-codebase agent spawns | 7 Opus | 2 Sonnet | ~7x cheaper, ~3x faster |
| Simple command latency | +10-30s (sub-agent hop) | Direct execution | -10-30s per command |
| execute-task sub-agent spawns per phase | 8 | 6 | -2 spawns (no CONTEXT.md, no user stories) |
| Proposal model | Opus | Sonnet | ~5x cheaper |
| Dead artifacts removed | 0 | 2 (CONTEXT.md, events.jsonl) | Cleaner workspace |
| Model configurability | None | Per-group override | User control over cost |
