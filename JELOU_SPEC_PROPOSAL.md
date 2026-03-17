# Spec-Driven Multi-Service Plugin — Consolidated Specification

> Consolidated from the original spec plus all 46 design decisions from 14 interview rounds (32 core questions + 2 follow-up rounds).

---

## 1. Summary

Build a `Claude Code first` plugin for implementing software with Spec Driven Development, specialized agents, strict TDD, multi-service integration, and a shared workspace as the single source of documentary truth. The main orchestrator never implements code or writes tests; it delegates, consolidates summaries, applies gates, and delivers executive summaries.

The system must support:

- Existing repos
- Single-service and multi-service tasks
- Operational integration with ClickUp, Slack, Git, and PRs
- Skill selection per project and per user

### 1.1 Industry Context

This plugin follows the conventions established by industry spec-driven development frameworks for AI coding assistants:

- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** — The most adopted SDD framework. Uses `openspec/` as workspace root, artifact-guided workflow (proposal → specs → design → tasks → apply), namespaced commands (`/opsx:propose`, `/opsx:apply`, `/opsx:archive`), CLI tooling (`openspec init`, `openspec update`), customizable schemas via `config.yaml`, and skill-based installation for multi-tool support.
- **[Get Shit Done (GSD)](https://github.com/gsd-build/get-shit-done)** — A lightweight meta-prompting and context engineering system. Uses `.planning/` as workspace root, phase-based execution (discuss → plan → execute → verify), namespaced commands (`/gsd:new-project`, `/gsd:plan-phase`, `/gsd:execute-phase`), parallel subagent orchestration, wave-based execution with dependency graphs, and separated agent definitions (`agents/`) from command definitions (`commands/`).

### 1.2 Plugin Conventions

Following the namespacing pattern established by OpenSpec (`/opsx:`) and GSD (`/gsd:`), all Jelou commands use the **`/jlu:`** prefix:

- **Namespace**: `jlu` — short, memorable, avoids collision with other plugins
- **Command format**: `/jlu:<command>` (e.g., `/jlu:refine-spec`, `/jlu:execute-task`)
- **Implementation**: Commands are defined as Claude Code custom slash commands in `.claude/commands/jlu/` following the YAML frontmatter convention (`name`, `description`, `argument-hint`, `allowed-tools`)
- **Agent definitions**: Separated from commands in `.claude/agents/` (e.g., `jlu-spec-interviewer.md`, `jlu-executor.md`)
- **Installation**: Via CLI installer (`install.sh`) that writes commands and agents to the appropriate `.claude/` directory (global or local)

### 1.3 Key Differentiators from Existing Frameworks

| Aspect | OpenSpec | GSD | Jelou (`/jlu:`) |
|---|---|---|---|
| Workspace root | `openspec/` | `.planning/` | `.spec-workspace/` (shared across repos) |
| Multi-service | Single repo | Single repo | Native multi-service with dependency ordering |
| TDD enforcement | None | None | Strict Red → Green → Refactor with separate test/impl agents |
| Codebase mapping | Not built-in | `map-codebase` (7 docs) | `map-codebase` (6 docs) + cross-validation agent |
| Spec workflow | `propose` generates all artifacts at once | `new-project` questionnaire | Minimal seed → structured interview → approval gate |
| Execution model | `apply` (single pass) | Wave-based parallel plans | Phase-based with dependency ordering + configurable autonomous/step-by-step |
| Integrations | None | None | ClickUp, Slack, Git worktrees, PR coordination |
| Agent separation | Skills-based | Dedicated agent files | Separated commands + agents with orchestrator delegation |

---

## 2. Workspace Standard

Use `.spec-workspace` in the parent directory of the microservices as the canonical root of the plugin.

### 2.1 Base Structure

```text
.spec-workspace/
  registry/
    services.yaml
    slack/
      <channel>.md
  principles/
    ENGINEERING_PRINCIPLES.md
  services/
    <service-id>/
      codebase/
        ARCHITECTURE.md
        STACK.md
        CONVENTIONS.md
        INTEGRATIONS.md
        STRUCTURE.md
        CONCERNS.md
  specs/
    <dd-mm-yyyy>/
      <task-slug>/
        SPEC.md
        PROPOSAL.md
        TASKS.md
        SKILLS_RESOLUTION.json
        CLICKUP_TASK.json
        services/
          <service-id>/
            CONTEXT.md
            phases/
              01-<phase>.md
            uh/
              <story-slug>.md
        slack/
          <channel>.md
```

### 2.2 Standard Rules

- Everything documentary about the plugin lives in `.spec-workspace`
- Each repo stores only local execution artifacts:
  - `.spec-workspace.json`
  - `/.worktrees`
  - `.claude/skill-registry.json`
  - `/specs/observability/`

### 2.3 .spec-workspace.json Schema

**Decision #18: Minimal pointer** — Just the path to `.spec-workspace` and the `service-id`. Enough to link the repo to the shared workspace.

```json
{
  "workspace": "../.spec-workspace",
  "serviceId": "service-auth"
}
```

### 2.4 Missing Workspace Handling

**Decision #20: Search + fallback** — When a user runs `/jlu:new-task` from a repo that has `.spec-workspace.json` but the `.spec-workspace` directory is missing (e.g., repo cloned on a new machine): search parent directories for `.spec-workspace`. If not found, offer to create one. If found at a different path, offer to update the config.

---

## 3. Stable Codebase Knowledge

Each service maintains in `.spec-workspace/services/<service-id>/codebase/`:

- `ARCHITECTURE.md`
- `STACK.md`
- `CONVENTIONS.md`
- `INTEGRATIONS.md`
- `STRUCTURE.md`
- `CONCERNS.md`

### 3.1 CONCERNS.md

Uses exactly the agreed template for: tech debt, bugs, security, performance, fragile areas, scaling limits, dependencies at risk, missing critical features, and test coverage gaps.

**Decision #30: Interview + code** — The concerns agent analyzes code first (TODO comments, known vulnerability patterns, test coverage gaps, deprecated deps), then presents findings and asks the user about known concerns not visible in code (planned deprecations, scaling limits, tribal knowledge).

### 3.2 Map Conflicts

**Decision #44: Cross-validation pass** — After all 6 research agents finish writing their files in parallel, a validation agent reads all outputs and flags contradictions. The orchestrator presents contradictions to the user for resolution.

---

## 4. Global Principles and Precedence

Persist global principles in `.spec-workspace/principles/ENGINEERING_PRINCIPLES.md` and inject them into prompts for planning, code, and QA agents.

### 4.1 Precedence

1. Security
2. Simplicity
3. Readability
4. TDD and minimum necessary code
5. Repo conventions only if they don't contradict the above

### 4.2 Principles Style

**Decision #43: Layered — global + per-service** — Global principles in `ENGINEERING_PRINCIPLES.md` are philosophical (simplicity over complexity, readability, security). Per-service `CONVENTIONS.md` can add concrete rules that implement those principles for that specific stack (e.g., "max cyclomatic complexity 10", "no function longer than 50 lines").

---

## 5. Artifact Schemas

### 5.1 SPEC.md

**Decision #37: Minimal seed + interview** — SPEC.md starts as a minimal seed (even one sentence). The `/jlu:refine-spec` interview expands it into a full structured spec through conversation with the user.

The refined SPEC.md should contain structured sections:
- Problem Statement
- Requirements (functional + non-functional)
- Constraints
- Out of Scope
- Success Criteria

But none of these are required upfront — the spec-interviewer agent builds them during `/jlu:refine-spec`.

**Purpose**: What needs to be built and why.

### 5.2 PROPOSAL.md

**Decision #7: Bridge between SPEC.md and implementation**

PROPOSAL.md turns the user's need into an execution-ready plan so subagents do not have to invent the strategy on their own.

PROPOSAL.md is used to:

- Define the implementation strategy
- Break the work into phases
- Identify affected services
- Order dependencies between services
- Define the testing approach
- Capture risks and mitigations
- Prepare how user stories and the ClickUp task will be built
- Give code and QA agents clear operational context

**Purpose**: How it will be approached.

#### Multi-Service Proposal Generation

**Decision #21: Two-pass — global + local**

For multi-service tasks, the proposal process happens in two passes:

1. **Global strategy pass** — One proposal agent builds the cross-service strategy: affected services, dependency order, contract boundaries, risks, testing strategy, and phase structure.
2. **Local detail pass** — One proposal agent per affected service expands the service-specific execution details: local scope, relevant modules, service-level phases or notes, and implementation constraints under the global strategy.

Then the orchestrator consolidates the result into a single PROPOSAL.md.

Recommended structure:
- One global PROPOSAL.md
- Per-service detail sections or supporting artifacts derived from the second pass

### 5.3 TASKS.md

**Decision #8: Operational execution tracker**

TASKS.md is the operational execution file. Its purpose is to track the real work being carried out after the plan is already defined in PROPOSAL.md.

TASKS.md is used to:

- Track task status and lifecycle
- List implementation steps and execution progress
- Track phase progress
- Track per-service progress
- Record testing status
- Track unit, integration, and E2E coverage
- Show success, error, and edge-case validation
- Store links or references to external artifacts like ClickUp and PRs
- Make it clear what is blocked, pending, in progress, or done

**Purpose**: What is happening right now during execution.

### 5.4 CONTEXT.md (Per-Service, Per-Task)

**Decision #14: Task-scoped context** — Summarizes which parts of the service are relevant to this specific task: affected modules, endpoints, models, config. A focused lens for code agents. This is distinct from the stable codebase knowledge (the 6 codebase files) — CONTEXT.md provides the task-specific view.

### 5.5 Phase Files

Location: `specs/<date>/<task>/services/<service-id>/phases/01-<phase>.md`

**Decision #19: Input + output sections** — Each phase file has an immutable "requirements" section (from PROPOSAL.md) and a mutable "execution" section where agents record outcomes, artifacts, and deviations.

```markdown
# Phase 01: <Phase Name>

## Requirements (immutable)
<!-- Generated from PROPOSAL.md. Do not modify. -->
- ...

## Execution (mutable)
<!-- Updated by agents during implementation -->
### Status: pending | in_progress | done | blocked
### Agent Output
- ...
### Artifacts
- ...
### Deviations
- ...
```

### 5.6 User Stories (uh/)

**Decision #10: Auto-generated from spec**

The proposal-agent derives user stories from SPEC.md + PROPOSAL.md. Each story maps to one or more phases. User approves the set.

**Decision #38: Hybrid format** — Classic "As a [user], I want [action], so that [benefit]" for the story statement, with acceptance criteria written as Given/When/Then scenarios.

```markdown
# <story-slug>

## Story
As a [user], I want [action], so that [benefit].

## Acceptance Criteria

### Scenario: <scenario-name>
- Given <precondition>
- When <action>
- Then <expected-result>

### Scenario: <scenario-name>
- Given <precondition>
- When <action>
- Then <expected-result>

## Phase Mapping
- Phase 01: <phase-name>
- Phase 02: <phase-name>
```

### 5.7 SKILLS_RESOLUTION.json

Captures which skills were selected for a task.

**Decision #22: Orchestrator approves dynamic skills** — During execution, agents can request additional skills. The orchestrator evaluates whether the skill is needed based on the spec, and either approves or escalates to the user. Approved additions are logged in SKILLS_RESOLUTION.json.

---

## 6. Commands

### 6.1 Core Commands

- `/jlu:map-codebase`
- `/jlu:new-task`
- `/jlu:refine-spec`
- `/jlu:execute-task`
- `/jlu:sync-clickup`
- `/jlu:publish-uh`
- `/jlu:extend-phase`
- `/jlu:refresh-skills`
- `/jlu:report-task`
- `/jlu:post-slack [date] #channel`
- `/jlu:close-task`
- `/jlu:setup-clickup` *(new — Decision #41)*

---

## 7. Task Flow

### 7.1 /jlu:map-codebase

- Maps the current service
- Detects stack as part of the same process
- Writes the 6 codebase files
- Runs only when the user requests it
- Uses 6 research agents in parallel (architecture, stack, conventions, integrations, structure, concerns)
- After all 6 finish, a cross-validation agent flags contradictions (Decision #44)
- CONCERNS.md combines code analysis + user interview (Decision #30)

### 7.2 /jlu:new-task

- Starts from the current repo as the primary service
- Uses or creates SPEC.md
- If codebase map is missing, offers to run `/jlu:map-codebase`
- Creates the task in `.spec-workspace/specs/<date>/<task>/`
- Creates local worktree
- Proposes affected services using `services.yaml` + INTEGRATIONS.md
- Requests confirmation of affected services
- Creates worktrees in confirmed repos
- Checks for skill staleness and warns if detected (Decision #23)

**Decision #2: Date is sprint/week** — The `<dd-mm-yyyy>` in the path represents the sprint or week the task belongs to, not the creation date. Tasks can be moved between date folders.

**Decision #39: Warn on unregistered references** — If the spec or codebase docs reference a service not in the registry, warn the user and offer to register it.

### 7.3 /jlu:refine-spec

**Decision #6: Structured + codebase** — Agent reads the codebase first, then generates a structured questionnaire targeting gaps between the spec and existing code/patterns.

- Interviews in depth
- Resolves non-obvious ambiguities
- Rewrites SPEC.md
- Requires human approval to move to `planned`

**Decision #37: Minimal seed + interview** — SPEC.md can start as a minimal seed (even one sentence). The interview expands it into a full structured spec.

#### 7.3.1 Orchestrator Responsibilities

The orchestrator handles context loading before spawning the spec-interviewer agent:

1. **Locate the task** — Resolve the target SPEC.md from arguments, or find the most recent task in `.spec-workspace/specs/`
2. **Load context files** — Read and concatenate:
   - `SPEC.md` (the seed — required)
   - All 6 codebase files from `.spec-workspace/services/<service-id>/codebase/` per affected service
   - `.spec-workspace/principles/ENGINEERING_PRINCIPLES.md`
3. **Warn on missing codebase** — If codebase files don't exist for a service, warn the user and offer to run `/jlu:map-codebase` first. Proceed if the user chooses to continue without them.
4. **Spawn the spec-interviewer agent** — Pass all loaded context + the agent prompt (section 7.3.2) to a sub-agent with model: Opus
5. **Confirm result** — After the agent completes, confirm the SPEC.md path and whether the user approved the transition to `planned`

#### 7.3.2 Spec-Interviewer Agent Prompt

This is the prompt the orchestrator passes to the spec-interviewer sub-agent. The orchestrator prepends the SPEC.md content and all codebase files before this prompt.

```markdown
You are the spec-interviewer agent. Your job is to take the SPEC.md seed above and expand it into a complete, implementation-ready specification through a structured interview.

The codebase knowledge files and engineering principles have been provided above as context.

## Step 1 — Gap Analysis (do this silently before your first question)

Analyze the SPEC.md seed against the codebase knowledge. Identify:
- Ambiguities or missing details in the spec
- Conflicts between the spec and existing architecture, conventions, or integration patterns
- Implicit assumptions that need explicit confirmation
- Edge cases, error scenarios, and security implications not addressed
- Integration points with other services or systems referenced in INTEGRATIONS.md
- Non-functional requirements (performance, scalability, observability) not mentioned
- Known concerns from CONCERNS.md that intersect with this task

Prioritize gaps by impact: architectural decisions > behavioral requirements > edge cases > cosmetic details.

## Step 2 — Structured Interview

Using AskUserQuestion, interview the user to resolve all identified gaps.

Rules:
- **2-4 questions per round**, grouped by theme — never random
- **Themes to cover** (in rough priority order):
  1. Architecture & design decisions (how does this fit into the existing system?)
  2. Behavioral requirements (what exactly should happen in each scenario?)
  3. Edge cases & error handling (what happens when things go wrong?)
  4. Security & authorization (who can do what? what's sensitive?)
  5. Performance & scalability (volume expectations, latency constraints?)
  6. Integration points (what other services/systems are affected?)
  7. UX/UI implications (if applicable — user-facing behavior)
  8. Constraints & out-of-scope (what should we explicitly NOT do?)
- **Ask non-obvious questions** — informed by what you found in the codebase, not generic. Reference specific files, patterns, or conventions you observed.
  - Good: "INTEGRATIONS.md shows this service communicates with service-payments via async events. Should the new feature use the same event bus, or does it need a synchronous call?"
  - Bad: "What technology should we use?"
- **Go deep** — don't accept vague answers. If the user says "it should be fast", ask "what's the latency budget? p95 under 200ms?"
- **Continue until complete** — keep interviewing until you can confidently fill all 5 output sections. You decide when you have enough information.
- **Respect the user** — if the user says "that's enough" or "move on", stop the interview and write the spec with what you have.

## Step 3 — Write the Spec

After the interview is complete, rewrite SPEC.md with these structured sections:

# <Task Title>

## Problem Statement
What problem this solves and why it matters. Include business context.

## Requirements

### Functional
- FR-1: <requirement>
- FR-2: <requirement>
...

### Non-Functional
- NFR-1: <requirement> (e.g., performance, security, scalability, observability)
...

## Constraints
Technical, business, or timeline constraints that bound the solution.

## Out of Scope
Explicitly excluded from this task — things that might seem related but are NOT part of this work.

## Success Criteria
How to verify the task is complete. Concrete, testable conditions.
- SC-1: <criterion>
- SC-2: <criterion>
...

Rules for writing:
- Preserve the user's original intent from the seed
- Add precision and detail from interview answers
- Number requirements and criteria for traceability (FR-1, NFR-1, SC-1)
- Make every requirement concrete enough that a developer could implement it and a QA agent could verify it
- The spec must be directly usable by the proposal-agent to generate PROPOSAL.md

Write the result to the SPEC.md file, overwriting the seed.

## Step 4 — Present for Approval

After writing, present the complete rewritten SPEC.md to the user and ask for review. The user must explicitly approve before the task transitions to `planned` state. If the user wants changes, make them and re-present.
```

#### 7.3.3 Design Rationale

| Aspect | Design Choice | Why |
|---|---|---|
| Context loading | Orchestrator injects codebase files into agent prompt (not self-read) | Agent gets full context immediately; no tool-call overhead for file discovery |
| Question batching | 2-4 related questions per round, grouped by theme | Reduces interview fatigue; keeps conversation focused |
| Interview termination | Agent judges completeness (no hard cap) | Different specs need different depth; agent decides when all 5 sections can be filled with confidence |
| Codebase-informed questions | Agent references specific files, patterns, conventions from injected context | Produces non-obvious, contextual questions instead of generic ones |
| Structured output | 5 mandatory sections with numbered requirements | Downstream traceability for proposal-agent, test-writer, and QA |
| Approval gate | Explicit user approval before `planned` transition | Spec is the foundation — user must own it before execution begins |

### 7.4 /jlu:execute-task

- Uses SPEC.md, PROPOSAL.md, TASKS.md, SKILLS_RESOLUTION.json, phases, and uh/
- Implements by dependencies, not arbitrary order
- Enforces TDD `Red -> Green -> Refactor`
- Iterates until all green

**Decision #29: Configurable execution mode** — When the user runs `/jlu:execute-task`, they choose the execution mode:
- **Autonomous mode** (default): Phases run automatically after `planned -> implementing` approval. User is interrupted only on failures, blocks, or approval-required transitions.
- **Step-by-step mode**: The orchestrator pauses before each phase and waits for user approval to continue.

**Decision #4: Separate test + impl agents** — The orchestrator spawns a test-writer agent first, waits for red tests, then spawns an implementer agent to make them green. Two agents per TDD cycle.

**Decision #5: Orchestrator mediates test disputes** — If the impl agent realizes a test is wrong, it flags the issue. The orchestrator spawns a fresh test agent with both the original spec and the impl agent's objection to re-evaluate.

**Decision #28: No budget tracking for v1** — Just the model tier policy (Opus/Sonnet/Haiku by role) as defined in section 12.

### 7.5 /jlu:extend-phase

**Decision #24: Mini interview** — A focused interview specifically about the extension: what's changing, why, which services are affected. Shorter than `/jlu:refine-spec`.

- Interviews the user
- Analyzes impact on already-implemented phases
- Reopens to `refining` or `planned` depending on impact

**Decision #15: Preserve existing code as baseline** — Existing code stays. New/modified phases build on top of what's already done. Only re-run affected tests.

### 7.6 /jlu:publish-uh

**Decision #27 (branched from original): ClickUp subtasks** — `/jlu:publish-uh` formats and pushes user stories to ClickUp as subtasks of the macro task.

### 7.7 /jlu:report-task

- Default output: executive summary, blockers, recent relevant events
- Shows stale worktrees (tasks in `done` or `closed` state) with a prompt to clean up (Decision #17)

**Decision #36: Progress file + milestones** — During execution, write real-time progress to TASKS.md. Output milestone summaries to the user's terminal at key moments (phase starts, completions, test results, blocks).

### 7.8 /jlu:close-task

- Precondition: associated PR in `merged` state (taken from local draft/state)
- Effects: move ClickUp from `PENDING TO PRODUCTION` to `CLOSED`, update local artifacts, register observability
- No additional confirmation if PR is already merged

### 7.9 /jlu:setup-clickup (new)

**Decision #41: Dedicated setup command** — A separate `/jlu:setup-clickup` command interactively configures credentials, workspace, space, list IDs, and field mappings. Must run before first sync.

---

## 9. Multi-Service Model

A task can affect one or more services.

For multi-service:

- One task folder under `.spec-workspace/specs/<date>/<task>/`
- Each affected service has its own CONTEXT.md, phases, and uh/
- Each repo maintains its own `/.worktrees/<task-slug>`

In fullstack monorepo:

- Backend and frontend are logically separate services
- They share repo and worktree
- They maintain documentary separation by service within the spec

### 9.1 Multi-Service Execution Order

**Decision #9: Dependency-driven** — PROPOSAL.md defines inter-service dependencies. The orchestrator follows that dependency graph: parallel where services are independent, sequential where one depends on another (e.g., backend API must exist before frontend can consume it).

### 9.2 services.yaml Schema

**Decision #11: Layered discovery** — `services.yaml` has `id` + `path` + `stack` only. Detailed relationships are discovered dynamically by reading each service's `INTEGRATIONS.md`.

```yaml
services:
  - id: service-auth
    path: ../service-auth
    stack: nestjs

  - id: service-frontend
    path: ../service-frontend
    stack: react

  - id: service-payments
    path: ../service-payments
    stack: laravel
```

### 9.3 Branch Strategy

**Decision #40: Task branch + service branches** — One logical branch name (`spec/<task-slug>`) per task, used across all service repos. Each repo has `spec/<task-slug>`. Single PR per repo, but coordinated across services.

---

## 10. Skill Registry

Persist per repo in `.claude/skill-registry.json`.

Must index:

- Local project skills
- Global user skills

### 10.1 Precedence

- Project over user

### 10.2 Selection

- Heuristic by metadata
- Minimum metadata: name, description, origin, capabilities

### 10.3 Refresh

**Decision #23: Warn + offer refresh** — Skills are refreshed explicitly with `/jlu:refresh-skills`. But on `/jlu:new-task` or `/jlu:execute-task`, the plugin checks if skill files have been modified since last refresh. If stale, it warns and offers to run `/jlu:refresh-skills` inline.

### 10.4 Multi-Service Tasks

- Temporal merge at runtime
- Persist selection in `SKILLS_RESOLUTION.json`

### 10.5 Manual Overrides

- Per task
- Per agent

---

## 11. Agents and Summaries

### 11.1 Roles

- `main-orchestrator`
- Research agents: architecture, stack, conventions, integrations, structure, concerns
- `spec-interviewer`
- `proposal-agent`
- Code agents (test-writer + implementer)
- `tasks-agent`
- `qa-agent`
- `project-management-agent`
- Git agent/skill
- Slack agent
- Cross-validation agent (for `/jlu:map-codebase`)

### 11.2 Orchestrator Constraints

The orchestrator:

- Never writes code
- Never writes tests
- Does not write planning artifacts directly
- Only delegates, consolidates, evaluates, and summarizes

### 11.3 Code Agent Model

**Decision #4: Separate test + impl agents** — Per TDD cycle, the orchestrator spawns a test-writer agent first (to write a failing test), then spawns an implementer agent (to make it green). Two agents per cycle.

**Decision #5: Orchestrator mediates test disputes** — If the impl agent realizes the test is wrong, it flags the issue. The orchestrator spawns a fresh test agent with both the original spec and the impl agent's objection to re-evaluate.

### 11.4 Agent Failure Recovery

**Decision #1: Fresh agent + context** — Kill the failed agent and spawn a new one with the failure summary injected, giving it a clean slate but an informed perspective.

### 11.5 QA Agent Scope

**Decision #13: Continuous + final** — Lightweight check after each phase (tests pass, no regressions). Full validation pass at the end including coverage analysis, edge case review, and cross-service contracts.

### 11.6 Subagent Summary Contract

Internal contract (subagent -> orchestrator):

- JSON structured
- Same schema for updates and closure
- Emitted at least at the end of each delegation
- Runtime-only
- Minimum fields:
  - agent
  - task
  - service
  - status: `pending | in_progress | success | blocked | failed`
  - outcome
  - risks with `low | medium | high | critical`
  - next_actions with owner
  - artifact paths / key outputs

### 11.7 Output to User

**Decision #12: Configurable verbosity** — Default is dashboard-style (status per service/phase, pass/fail indicators, blockers, next actions). User can request detailed mode that includes code highlights, test results, and agent reasoning.

---

## 12. Claude Model Policy

### 12.1 Defaults by Role

**Decision #28: Three-tier model policy**

- **Opus** — orchestrator, spec-interviewer, proposal-agent
- **Sonnet** — research agents, code agents, tasks-agent, qa-agent
- **Haiku** — project-management-agent, Slack agent, git agent (when the action is already decided)

### 12.2 Rules

- Lightweight agents must escalate if they detect ambiguity or risk
- User can override models manually

---

## 13. Git, PR, and Branches

### 13.1 Git Agent/Skill

Handles: stage, commit, push.

### 13.2 Restrictions

- Only to the task's active branch
- Never to `main`, `master`, or `alpha`
- If the worktree has unexpected or unrelated changes: block and escalate
- Use the project's commit convention; fallback to conventional commits

### 13.3 Branch Strategy

**Decision #40: Task branch + service branches** — One logical branch name (`spec/<task-slug>`) per task. Used across all service repos. Each repo gets `spec/<task-slug>`. Single PR per repo, coordinated.

### 13.4 Worktree Management

Worktrees created in each service repo at `/.worktrees/<task-slug>`.

**Decision #17: Manual + stale detection** — No automatic cleanup. `/jlu:report-task` shows stale worktrees (tasks in `done` or `closed` state) with a prompt to clean up. Worktrees persist until `/jlu:close-task` is explicitly run or the user manually cleans up.

---

## 14. TDD and Gates

### 14.1 Mandatory TDD Cycle

1. Write test
2. Confirm it fails (Red)
3. Implement the minimum
4. Make it green (Green)
5. Refactor without breaking green (Refactor)

### 14.2 Coverage per Service

- Unit
- Integration
- E2E when applicable
- Success paths
- Error paths
- Edge cases

### 14.3 Multi-Service Closure

- All required test suites green
- Cross-service contracts/integrations green
- All artifacts complete

---

## 15. Lifecycle

### 15.1 Main Task States

- `draft`
- `refining`
- `planned`
- `implementing`
- `validating`
- `ready_to_publish`
- `done`
- `closed`

### 15.2 Exceptional States

- `blocked`
- `awaiting_user`
- `cancelled`

### 15.3 Lightweight Sub-States per Service

- `planned`
- `implementing`
- `validating`
- `done`

### 15.4 Transitions

- `draft -> refining`
- `refining -> planned`: spec ready + human approval
- `planned -> implementing`: human approval
- `implementing -> validating`: current scope implementation complete
- `validating -> ready_to_publish`: all green + artifacts ready
- `ready_to_publish -> done`: manual closure approval
- `done -> closed`: via `/jlu:close-task`

### 15.5 Blocks

- `blocked` when an agent cannot continue without external resolution
- `awaiting_user` for approvals or missing data
- On unblock, return to the last operational state
- Retries only in history, not as a separate state

### 15.6 Approval UX

**Decision #25: Summary + link to artifacts** — Short executive summary of what's being approved, with clear references to the full artifacts the user should review. One-click approve.

---

## 16. Execution Modes

**Decision #29: Configurable per task**

When the user runs `/jlu:execute-task`, they choose:

- **Autonomous mode** (default): Phases run automatically after `planned -> implementing` approval. The user is interrupted only on failures, blocks, or approval-required transitions.
- **Step-by-step mode**: The orchestrator pauses before each phase and waits for user approval to continue.

---

## 17. Session Recovery

**Decision #35: User chooses**

If a session ends mid-execution (timeout, crash, terminal closed), TASKS.md preserves the state (e.g., "2/5 phases done"). When the user reruns `/jlu:execute-task`, the orchestrator presents the current state and asks:

1. **Resume** from the next incomplete phase
2. **Re-validate** completed phases first, then resume
3. **Start over** from scratch

---

## 18. Progress Reporting

**Decision #36: Progress file + milestones**

- Write real-time progress to TASKS.md (file-based, always up to date)
- Output milestone summaries to the user's terminal at key moments: phase starts, phase completions, test results, blocks

---

## 19. Observability

### 19.1 Persistence

Local per repo in `/specs/observability/`.

### 19.2 Format

JSONL

### 19.3 Event Payload

- inputs
- decision
- outputs

### 19.4 Mandatory Audit

- git
- publish
- approvals
- overrides

### 19.5 Multi-Service Model

- Events per repo
- Consolidated summary in the task spec folder

**Decision #16: Hybrid consolidation — transitions + report** — Auto-consolidate on lifecycle transitions for automated accuracy (e.g., `implementing -> validating`). Also consolidate on-demand via `/jlu:report-task` for ad-hoc checks.

### 19.6 Retention

Indefinite in v1.

---

## 20. Slack Dailies

### 20.1 Commands

- `/jlu:post-slack #channel`
- `/jlu:post-slack <dd-mm-yyyy> #channel`

### 20.2 Rules

- Date optional, default today
- Channel mandatory
- Templates per channel in `.spec-workspace/registry/slack/`
- Template format: Markdown with placeholders
- If no template: free structured summary

### 20.3 Delivery Method

**Decision #42: MCP Slack server** — Delegate to a Slack MCP server tool. The plugin generates the content, MCP handles delivery. Decoupled architecture.

### 20.4 Task Selection

- By plugin observability on that date
- Compatibility reading also local `/specs` if they exist

### 20.5 Content per Task

- Main task name
- Very short activity summary
- PM link from TASKS.md

### 20.6 Meetings

- Manual input in preview

### 20.7 Flow

- Build draft
- Persist draft in the day/task spec folder
- Allow manual editing
- Reuse draft on a subsequent execution
- Publish only after confirmation

### 20.8 Draft States

- `draft`
- `ready`
- `published`

---

## 21. ClickUp

### 21.1 Commands

- `/jlu:sync-clickup` — generates or updates a persisted draft, creates or syncs macro task and subtasks
- `/jlu:setup-clickup` (Decision #41) — dedicated interactive setup for credentials, workspace, and field mappings

### 21.2 Draft

`CLICKUP_TASK.json` contains:

- macro task
- subtasks derived from `uh/`
- sync metadata
- external IDs
- sprint
- associated PR
- timestamps and sync state

### 21.3 Publication Unit

- 1 macro task per initiative
- User stories are subtasks of that macro task

### 21.4 Sync

- Idempotent
- Accepts existing task by URL or ID
- Task exists from planning and is updated during execution

**Decision #27: Upsert by story slug** — Match stories to subtasks by slug/ID. Update existing, create new, never delete. Stale subtasks stay but could be flagged.

### 21.5 Content Construction

- Macro description from SPEC.md + PROPOSAL.md + TASKS.md
- Subtask description from uh/ + phase + acceptance criteria

### 21.6 Fixed Defaults

- `Assignee`
- `Equipo`
- `Responsable`

### 21.7 Automatically Inferred Fields

**Decision #26: Spec + codebase signals** — Estimation combines spec complexity with codebase signals (files likely touched, test coverage of affected areas, cyclomatic complexity).

- `Story points` and `Talla` using the estimation table
- `Priority` by urgency + impact + blocking
- `Riesgo` by client impact + complexity + dependencies
- ClickUp native type by primary intent
- `Tipo proyecto` by change classification
- `Front`:
  - If `Issue` => `Reliability`
  - Otherwise => `Enhancement` or `AI` depending on nature
- `Necesita Diseno`:
  - `Si` for frontend tasks
  - `No` by default for pure backend

### 21.8 Macro Task

- Initial state: `IN PROGRESS`
- Priority: inferred

### 21.9 Subtasks

Inherit a controlled subset:
- type, state, priority, size, story points, sprint

### 21.10 Sprint

- Mandatory
- Persisted in `CLICKUP_TASK.json`

### 21.11 ClickUp Config

- Global user config at `~/.spec-plugin/clickup.json`
- Destination per workspace
- Custom fields resolved by name at runtime
- If a required field is missing: block
- If there's a duplicate: ask for resolution once, persist the choice

### 21.12 ClickUp State Sync

- Deterministic sync from internal lifecycle
- On reaching `done` internally, macro task becomes `PENDING TO PRODUCTION`
- Does not move to `CLOSED` yet (that's `/jlu:close-task`)

---

## 22. Post-Production Closure

### 22.1 Command

`/jlu:close-task`

### 22.2 Precondition

- Associated PR in `merged` state (taken from local draft/state)

### 22.3 Effects

- Move ClickUp from `PENDING TO PRODUCTION` to `CLOSED`
- Update local artifacts
- Register observability

No additional confirmation required if the PR is already merged.

---

## 23. State Management

**Decision #32: File-based state** — All state lives in the filesystem (`.spec-workspace` files, `.spec-workspace.json`, TASKS.md, phase files). Each skill reads and writes these files. No external database or state service.

---

## 24. Skill Architecture

### 24.1 Organization

**Decision #31: Hierarchical — core + commands** — One core skill defines the entire system. Individual commands are lightweight triggers that invoke specific sections of the core skill.

### 24.2 Prompt Size Management

**Decision #33: Tiered prompts** — Three tiers:

1. **Ultra-compact orchestrator rules** — Always loaded. Contains the fundamental system rules, lifecycle, agent roles.
2. **Command-specific details** — Loaded per command invocation. Contains the specific flow, templates, and contracts for that command.
3. **Reference docs on demand** — Read from the workspace filesystem when needed (SPEC.md, PROPOSAL.md, codebase files, etc.).

---

## 25. Distribution and Installation

**Decision: Git repo + install.sh script** — The plugin lives in a Git repository. An `install.sh` script copies skills to the right directories, creates config templates, and validates the setup.

---

## 26. Documentation Model

**Decision: README + docs/** — README covers overview, prerequisites, and quick start (clone repo, run `install.sh`, init workspace). Detailed documentation (command reference, workflow guides, configuration, troubleshooting) lives in a `docs/` directory with individual guides.

---

## 27. Concurrency

**Decision #3: Multiple tasks, no guardrails** — Multiple tasks can be active simultaneously. Conflicts are handled at git merge time. The plugin does not try to prevent concurrent task conflicts.

---

## 28. Test Plan

- Map codebase of a service and verify the 6 artifacts.
- Create single-service and multi-service tasks under `.spec-workspace/specs/<date>/<task>/`.
- Validate detection and confirmation of affected services.
- Validate skill selection and `SKILLS_RESOLUTION.json`.
- Validate JSON summaries between subagents and orchestrator consolidation.
- Validate full lifecycle through `closed`.
- Validate strict TDD and blocking on red tests.
- Validate `/jlu:sync-clickup` with:
  - New task
  - Existing task by URL/ID
  - Macro task + subtasks
  - PR update when it exists
  - Blocking on missing field
- Validate `/jlu:post-slack` with persisted drafts and confirmed publication.
- Validate `/jlu:close-task` with merged PR and final ClickUp closure.
- Validate `/jlu:report-task` with JSONL events and consolidated summary.
- Validate session recovery (resume, re-validate, start over).
- Validate autonomous and step-by-step execution modes.
- Validate cross-validation pass in `/jlu:map-codebase`.
- Validate two-pass proposal generation for multi-service tasks.
- Validate skill staleness warnings.
- Validate `/jlu:extend-phase` mini interview and baseline preservation.
- Validate worktree stale detection in `/jlu:report-task`.

---

## 29. Assumptions

- `.spec-workspace` is the only canonical documentary source for the plugin.
- Local `/specs` are only read for compatibility and local observability.
- The user can manually modify models and drafts.
- Protected branches never receive automatic push.
- Final ClickUp closure only occurs via `/jlu:close-task`.
- Slack templates and ClickUp configuration may vary by workspace or channel, but the plugin contract remains stable.
- All state is file-based; no external state service is required.
- The plugin is distributed as a Git repo with an install script.

---

## Appendix A: Complete Decision Registry

All 46 design decisions from the interview, indexed for traceability:

| # | Topic | Decision |
|---|-------|----------|
| 1 | Agent failure recovery | Fresh agent + context (kill failed agent, spawn new with failure summary) |
| 2 | Task dating | Sprint/week-based, not creation date |
| 3 | Concurrency | Multiple tasks allowed, no plugin-level guardrails (git handles conflicts) |
| 4 | Code agent model | Separate test-writer and implementer agents per TDD cycle |
| 5 | Test ownership disputes | Orchestrator mediates — spawns fresh test agent with impl agent's objection |
| 6 | Spec interview style | Structured questionnaire after reading codebase |
| 7 | PROPOSAL.md | Bridge between SPEC.md and implementation — defines strategy, phases, deps, risks, testing approach |
| 8 | TASKS.md | Operational execution tracker — lifecycle, progress, testing status, external links |
| 9 | Multi-service execution | Dependency-driven (parallel where independent, sequential where dependent) |
| 10 | User stories | Auto-generated from spec, hybrid format (classic statement + Given/When/Then AC) |
| 11 | services.yaml | Layered discovery (id + path + stack; relationships via INTEGRATIONS.md) |
| 12 | Summary verbosity | Configurable (default dashboard, detailed mode available) |
| 13 | QA agent | Continuous + final (lightweight after each phase, full validation at end) |
| 14 | CONTEXT.md | Task-scoped context (focused lens on what parts of the service matter for THIS task) |
| 15 | Extend impact | Preserve existing code as baseline, build on top |
| 16 | Event consolidation | Hybrid (auto on lifecycle transitions + on-demand via /jlu:report-task) |
| 17 | Worktree cleanup | Manual + stale detection (no auto-cleanup, /jlu:report-task shows stale worktrees) |
| 18 | Workspace JSON | Minimal pointer (path to .spec-workspace + service-id) |
| 19 | Phase files | Input + output sections (immutable requirements + mutable execution section) |
| 20 | Missing workspace | Search parent dirs + fallback to create new |
| 21 | Proposal generation | Two-pass (global strategy agent -> per-service detail agents -> orchestrator merges) |
| 22 | Dynamic skills | Orchestrator approves mid-execution skill requests |
| 23 | Skill staleness | Warn + offer refresh on /jlu:new-task or /jlu:execute-task |
| 24 | Extend UX | Mini interview (focused on the extension, shorter than /jlu:refine-spec) |
| 25 | Approval UX | Executive summary + links to artifacts, one-click approve |
| 26 | Story points | Spec + codebase signals combined |
| 27 | ClickUp sync delta | Upsert by story slug (update existing, create new, never delete) |
| 28 | Cost control | No budget tracking — just the model tier policy (Opus/Sonnet/Haiku by role) |
| 29 | Execution flow | Configurable per task (autonomous default, step-by-step optional) |
| 30 | Concerns source | Interview + code analysis combined |
| 31 | Skill architecture | Hierarchical (core + lightweight command triggers) |
| 32 | State management | File-based (all state in filesystem) |
| 33 | Prompt size | Tiered prompts (compact orchestrator rules -> command-specific -> reference docs on demand) |
| 35 | Session recovery | User chooses (resume, re-validate, or start over) |
| 36 | Live progress | Progress file (TASKS.md updates) + milestone summaries to terminal |
| 37 | SPEC.md format | Minimal seed + interview expands to structured |
| 38 | Story format | Hybrid (classic "As a..." + Given/When/Then acceptance criteria) |
| 39 | Service discovery | Warn on references to unregistered services |
| 40 | Branch strategy | One logical branch name (spec/task-slug) per task, used across all service repos |
| 41 | ClickUp setup | Dedicated /jlu:setup-clickup command |
| 42 | Slack delivery | MCP Slack server |
| 43 | Principles style | Layered (global philosophical + per-service concrete via CONVENTIONS.md) |
| 44 | Map conflicts | Cross-validation pass (validation agent flags contradictions after all 6 agents finish) |
| 46 | Delivery | Overwrite JELOU_SPEC_PROPOSAL.md |

---

## Appendix B: Interview Transcript (Full Q&A)

### Round 1 — Architecture & Agent Model

**Q1 (Agent failure):** When /jlu:execute-task runs and a code agent fails mid-phase (e.g., tests won't go green after implementation, or a dependency between services creates a circular block), what's the expected recovery model? Should the orchestrator retry the same agent, spawn a fresh agent with the failure context, escalate to the user immediately, or attempt an automated rollback of the phase?

**A1:** Fresh agent + context — Kill the failed agent and spawn a new one with the failure summary injected, giving it a clean slate but informed perspective.

**Q2 (Task identity):** The spec mentions that tasks are organized by date (dd-mm-yyyy). What happens when a task spans multiple days or weeks? Does the date represent creation date only, or does it shift? And if two tasks are created on the same day with the same slug, how is that handled?

**A2:** Date is sprint/week — Date represents the sprint or week the task belongs to, not the creation date. Tasks can be moved between date folders.

**Q3 (Concurrency):** Can multiple tasks be active simultaneously (e.g., two developers working on different features in the same workspace)? If so, how do you handle conflicts when both tasks touch the same service or even the same files?

**A3:** Multiple, no guardrails — Multiple tasks can be active. Conflicts are handled at git merge time — the plugin doesn't try to prevent them.

**Q4 (Code agents):** The spec says the orchestrator 'never writes code' and delegates to code agents. But Claude Code's Agent tool has limitations — subagents can't spawn their own subagents. How do you envision the code agent handling a phase that requires both writing tests AND implementation? Single agent doing both in sequence, or separate test-writer and implementer agents coordinated by the orchestrator?

**A4:** Separate test + impl — Orchestrator spawns a test-writer agent first, waits for red tests, then spawns an implementer agent to make them green. Two agents per cycle.

---

### Round 2 — Agent Orchestration & Spec Refinement

**Q5 (Test ownership):** With the separate test + impl agent model: the test agent writes a failing test, then the impl agent makes it green. But what if the impl agent realizes the test itself is wrong (e.g., testing the wrong behavior, or the assertion doesn't match the spec)? Can the impl agent modify tests, or must it escalate back to the orchestrator to re-spawn a test agent?

**A5:** Orchestrator mediates — Impl agent flags the issue. Orchestrator spawns a fresh test agent with both the original spec and the impl agent's objection to re-evaluate.

**Q6 (Spec interview):** For /jlu:refine-spec, the spec says 'interview in depth' and 'resolve non-obvious ambiguities'. How deep should this go? Should the spec-interviewer agent generate a structured questionnaire based on the initial SPEC.md, or should it be a freeform conversational interview? And should it have access to the codebase to ask contextual questions?

**A6:** Structured + codebase — Agent reads the codebase first, then generates a structured questionnaire targeting gaps between the spec and existing code/patterns.

**Q7 (PROPOSAL.md):** The PROPOSAL.md is mentioned but never defined. What should it contain? Is it the orchestrator's implementation plan (architecture decisions, approach, tradeoffs), or is it a user-facing document summarizing the refined spec in a more digestible format?

**A7:** PROPOSAL.md is the bridge between SPEC.md and implementation. Its purpose is to turn the user's need into an execution-ready plan so subagents do not have to invent the strategy on their own.

In this design, PROPOSAL.md is used to:
- define the implementation strategy
- break the work into phases
- identify affected services
- order dependencies between services
- define the testing approach
- capture risks and mitigations
- prepare how user stories and the ClickUp task will be built
- give code and QA agents clear operational context

Practical difference:
- SPEC.md: what is needed and why
- PROPOSAL.md: how it will be approached
- TASKS.md: what is being executed and what its current status is

**Q8 (TASKS.md):** TASKS.md is mentioned as an input to /jlu:execute-task but its structure isn't defined. Is it a flat list of implementation tasks, a dependency graph, or something else? Who generates it — the tasks-agent after the proposal is approved, or is it part of the proposal itself?

**A8:** TASKS.md is the operational execution file. Its purpose is to track the real work being carried out after the plan is already defined in PROPOSAL.md.

In this design, TASKS.md is used to:
- track task status and lifecycle
- list implementation steps and execution progress
- track phase progress
- track per-service progress
- record testing status
- track unit, integration, and E2E coverage
- show success, error, and edge-case validation
- store links or references to external artifacts like ClickUp and PRs
- make it clear what is blocked, pending, in progress, or done

Practical difference:
- SPEC.md: what needs to be built
- PROPOSAL.md: how it should be built
- TASKS.md: what is happening right now during execution

So TASKS.md is the working control layer of the task.

---

### Round 3 — Multi-Service Coordination & Edge Cases

**Q9 (Multi-svc order):** In multi-service tasks, the orchestrator needs to coordinate code agents across different repos/worktrees. Should execution be sequential (finish service A's phase before starting service B), parallel (agents in both services simultaneously), or dependency-driven (e.g., backend API must exist before frontend can consume it)?

**A9:** Dependency-driven — PROPOSAL.md defines inter-service dependencies. Orchestrator follows that graph — parallel where independent, sequential where dependent.

**Q10 (User stories):** The uh/ (user stories) directory is referenced but the format and generation process aren't specified. Are these generated automatically from the spec by an agent, manually written by the user, or collaboratively refined? And what's the relationship between a user story and a phase?

**A10:** Auto-generated from spec — The proposal-agent derives user stories from SPEC.md + PROPOSAL.md. Each story maps to one or more phases. User approves the set.

**Q11 (services.yaml):** The services.yaml registry is central to multi-service detection, but its schema isn't defined. What minimum fields should each service entry have? Think about what the orchestrator needs to propose affected services for a new task.

**A11:** Layered discovery — services.yaml has id + path + stack only. Detailed relationships are discovered dynamically by reading each service's INTEGRATIONS.md.

**Q12 (Summary depth):** When the orchestrator consolidates subagent summaries into an executive summary for the user, how verbose should this be? The spec says 'executive summary in Markdown' but doesn't define the level of detail. Should it be a high-level status dashboard, or include enough detail for the user to understand what code was written and why?

**A12:** Configurable verbosity — Default is dashboard-style. User can request detailed mode that includes code highlights, test results, and agent reasoning.

---

### Round 4 — Operational Details

**Q13 (QA agent scope):** The QA agent is listed but its role is unclear beyond 'validating'. When does it run? After each phase, after all phases, or continuously? And what's its scope — does it only run existing tests, or can it write additional tests it thinks are missing (edge cases, security, regression)?

**A13:** Continuous + final — Lightweight check after each phase (tests pass, no regressions). Full validation pass at the end including coverage analysis, edge case review, and cross-service contracts.

**Q14 (CONTEXT.md role):** The spec mentions CONTEXT.md per service within a task, but doesn't define what goes in it. Given that codebase knowledge already lives in the 6 codebase files, what unique value does CONTEXT.md provide? Is it task-specific context (what parts of this service are relevant to THIS task)?

**A14:** Task-scoped context — Summarizes which parts of the service are relevant to this specific task: affected modules, endpoints, models, config. A focused lens for code agents.

**Q15 (Extend impact):** For /jlu:extend-phase (adding scope to an in-progress task), the spec says it 'analyzes impact on already-implemented phases' and may reopen to refining or planned. But what about code that's already been written and tested? Is it preserved, rolled back, or does the extended spec treat it as a baseline to build on?

**A15:** Preserve as baseline — Existing code stays. New/modified phases build on top of what's already done. Only re-run affected tests.

**Q16 (Event consolidation):** The observability system uses JSONL per repo. For a multi-service task, events are scattered across repos with a 'consolidated summary' in the spec folder. How is this consolidation triggered — eagerly (after every event), lazily (only when /jlu:report-task runs), or on lifecycle transitions?

**A16:** Hybrid: transitions + report — Auto-consolidate on lifecycle transitions for automated accuracy. Also consolidate on-demand via /jlu:report-task for ad-hoc checks.

---

### Round 5 — Git & Cross-Cutting

**Q18 (Branch strategy):** The git agent is described as handling stage/commit/push with safety rails (no push to main, block on unexpected changes). But who creates the worktree branches? What's the branch naming convention? And does each phase get its own branch, or is there one branch per task?

**A18:** Task branch + service branches — One logical task branch name used across all repos. Each repo has spec/task-slug. Single PR per repo, but coordinated.

**Q19 (Publish UH):** The spec mentions /jlu:publish-uh but doesn't define where user stories are published TO. Is this pushing stories to ClickUp as subtasks (which /jlu:sync-clickup already does), generating a formatted document, or something else entirely?

**A19:** ClickUp subtasks — /jlu:publish-uh formats and pushes stories to ClickUp.

**Q20 (Map dependency):** When the spec-interviewer identifies that the codebase map is missing or outdated for a service, and offers to run /jlu:map-codebase, should the mapping be a blocking prerequisite for planning? Or can planning proceed with partial/stale codebase knowledge and map later?

**A20:** Required for execution only — Planning can proceed without a map. But /jlu:execute-task will block if any affected service lacks an up-to-date codebase map.

---

### Round 6 — Integrations & Conflict Resolution

**Q21 (ClickUp setup):** The ClickUp sync uses a global config at ~/.spec-plugin/clickup.json. This config needs API credentials, workspace/space/list IDs, and custom field mappings. How should initial setup work? Should there be a dedicated setup command, or should /jlu:sync-clickup guide the user through setup on first run?

**A21:** Dedicated setup command — A separate /jlu:setup-clickup command that interactively configures credentials, workspace, and field mappings. Must run before first sync.

**Q22 (Slack delivery):** The Slack agent posts dailies using templates from .spec-workspace/registry/slack/. But Slack messages have character limits, formatting quirks, and threading. Should the agent post via Slack API directly (requires bot token), generate a message for the user to copy-paste, or integrate with an existing Slack MCP server?

**A22:** MCP Slack server — Delegate to a Slack MCP server tool. The plugin generates the content, MCP handles delivery. Decoupled architecture.

**Q23 (Principles style):** The spec says ENGINEERING_PRINCIPLES.md is injected into prompts for planning, code, and QA agents. But principles like 'simplicity over complexity' are subjective. How should agents interpret and apply them? Should principles have concrete rules (e.g., 'no function longer than 50 lines') or remain philosophical with agents using judgment?

**A23:** Layered: global + per-service — Global principles are philosophical. Per-service CONVENTIONS.md can add concrete rules that implement those principles for that stack.

**Q24 (Map conflicts):** When /jlu:map-codebase runs with the 6 research agents in parallel, each writing one file (ARCHITECTURE.md, STACK.md, etc.), what happens if two agents discover contradictory information? E.g., the architecture agent says 'event-driven' but the integrations agent finds only synchronous HTTP calls. Who resolves the conflict?

**A24:** Cross-validation pass — After all 6 agents finish, a validation agent reads all outputs and flags contradictions. Orchestrator presents them to the user.

---

### Round 7 — Worktree, Config & Phase Structure

**Q25 (Worktree cleanup):** Worktrees are created in each service repo at /.worktrees/<task-slug>. But worktrees consume disk space and can accumulate. When are they cleaned up? On /jlu:close-task only, or should there be automatic cleanup of stale worktrees (e.g., tasks that have been 'done' for N days)?

**A25:** Manual + stale detection — No automatic cleanup, but /jlu:report-task shows stale worktrees (tasks in 'done' or 'closed' state) with a prompt to clean up.

**Q26 (Workspace JSON):** The .spec-workspace.json file is mentioned as living in each repo, but its contents aren't defined. What should it contain? It needs to at least link the repo to its .spec-workspace location, but what else?

**A26:** Minimal pointer — Just the path to .spec-workspace and the service-id. Enough to link the repo to the shared workspace.

**Q27 (Phase file content):** Phase files live at specs/<date>/<task>/services/<service-id>/phases/01-<phase>.md. What's inside a phase file? Is it a plan document, an execution log, or a living document that evolves as agents work on it?

**A27:** Input + output sections — Has an immutable 'requirements' section (from PROPOSAL.md) and a mutable 'execution' section where agents record outcomes, artifacts, and deviations.

**Q28 (Missing workspace):** When a user runs /jlu:new-task from a repo that already has a .spec-workspace.json but the .spec-workspace directory has been moved or deleted, what should happen? This is a real-world scenario (repo cloned on a new machine, workspace not synced).

**A28:** Search + fallback — Search parent directories for .spec-workspace. If not found, offer to create one. If found at a different path, offer to update the config.

---

### Round 8 — Proposal Workflow & Skill Mechanics

**Q29 (Proposal scope):** The proposal-agent needs to read SPEC.md, all relevant codebase docs, and ENGINEERING_PRINCIPLES.md to generate PROPOSAL.md. But for a multi-service task, that's potentially a massive amount of context. Should the proposal-agent work per-service (generating per-service proposals that the orchestrator merges), or holistically (one agent sees everything)?

**A29:** Two-pass: global + local

For multi-service tasks, the proposal process should happen in two passes:

1. Global strategy pass — one proposal agent builds the cross-service strategy: affected services, dependency order, contract boundaries, risks, testing strategy, and phase structure.
2. Local detail pass — one proposal agent per affected service expands the service-specific execution details: local scope, relevant modules, service-level phases or notes, and implementation constraints under the global strategy.

Then the orchestrator consolidates the result into a single PROPOSAL.md.

Why this is the best choice:
- preserves cross-service architectural thinking
- avoids forcing one agent to absorb too much raw repo context
- gives each service enough focused planning depth
- fits the existing split between global task artifacts and per-service CONTEXT.md / phases

Recommended structure:
- one global PROPOSAL.md
- per-service detail sections or supporting artifacts derived from the second pass

Short version: first plan the system-level strategy, then fill in service-level details, orchestrator merges into one final proposal.

**Q30 (Dynamic skills):** SKILLS_RESOLUTION.json captures which skills were selected for a task. But during execution, an agent might discover it needs a skill that wasn't pre-selected (e.g., a database migration skill when the plan didn't anticipate schema changes). Can agents request new skills mid-execution?

**A30:** Orchestrator approves — Agents request skills. The orchestrator evaluates whether the skill is needed based on the spec, and either approves or escalates to the user.

**Q31 (Skill staleness):** The spec lists /jlu:refresh-skills as explicit-only. But skills could become stale if new skills are installed or updated between tasks. Should the plugin at least WARN when it detects potential skill staleness (e.g., registry file modified after last refresh)?

**A31:** Warn + offer refresh — Detect stale skills on /jlu:new-task or /jlu:execute-task. Warn and offer to run /jlu:refresh-skills inline.

**Q32 (Extend UX):** The /jlu:extend-phase command reopens a task to add scope. But what's the UX for defining the extension? Is it a new interview (like /jlu:refine-spec), a diff-based edit to the existing spec, or does the user just describe the extension in natural language and the agent figures out the impact?

**A32:** Mini interview — A focused interview specifically about the extension: what's changing, why, which services are affected. Shorter than /jlu:refine-spec.

---

### Round 9 — Approval, Estimation & Cost

**Q33 (Approval UX):** The lifecycle has several human approval gates (refining->planned, planned->implementing, ready_to_publish->done). How should the orchestrator present these approvals? Is it a simple yes/no confirmation, or should it present a checklist of what's being approved (e.g., 'You are approving: 3 phases, 2 services, 5 user stories, estimated scope X')?

**A33:** Summary + link to artifacts — Short executive summary of what's being approved, with clear references to the full artifacts the user should review. One-click approve.

**Q34 (Story points):** The ClickUp sync infers story points and talla (size) using a table. The spec references 'your table' but doesn't include it. What's the mapping? And is the estimation based on the spec content alone, or does it factor in codebase complexity (lines changed, files touched)?

**A34:** Spec + codebase signals — Combines spec complexity with codebase signals: number of files likely touched, test coverage of affected areas, cyclomatic complexity.

**Q35 (Sync delta):** When /jlu:sync-clickup creates subtasks from user stories, and later /jlu:extend-phase adds new scope (which generates new or modified stories), how does the sync handle the delta? Does it update existing subtasks, create new ones, or recreate all subtasks?

**A35:** Upsert by story slug — Match stories to subtasks by slug/ID. Update existing, create new, never delete. Stale subtasks stay but could be flagged.

**Q36 (Cost control):** The spec mentions that the orchestrator model is Opus and code agents use Sonnet. But Opus has a significantly higher cost. For a typical multi-service task with many agent invocations, have you thought about the cost implications? Should there be a cost-awareness mechanism (e.g., estimating token usage before execution, setting budget limits)?

**A36:** Three-tier model policy, no budget tracking:
- Opus for orchestration, spec refinement, and proposal work
- Sonnet for code, tests, QA, and research
- Haiku for lightweight operational tasks

---

### Round 10 — Execution, Concerns & State

**Q37 (Execution flow):** When the user runs /jlu:execute-task and the task has multiple phases, should each phase require an explicit 'continue' from the user, or should execution flow automatically with the user only intervening on failures/blocks? This fundamentally changes the UX from interactive to autonomous.

**A37:** Configurable per task — When the user runs /jlu:execute-task, they should choose the execution mode for that task:
- Autonomous mode: phases run automatically after planned -> implementing approval. The user is interrupted only on failures, blocks, or approval-required transitions.
- Step-by-step mode: the orchestrator pauses before each phase and waits for user approval to continue.
Default should be autonomous.

**Q38 (Concerns source):** The spec mentions CONCERNS.md with a specific template for tech debt, bugs, security, etc. Should /jlu:map-codebase discover these concerns automatically by analyzing the code, or should it interview the user about known concerns? Real concerns often live in developers' heads, not in code.

**A38:** Interview + code — Agent analyzes code first, then presents findings and asks the user about known concerns not visible in code (planned deprecations, scaling limits, tribal knowledge).

**Q39 (Skill architecture):** This plugin will be implemented as Claude Code skills/commands. Each skill needs its own .md file with a prompt. Given the complexity of the orchestration logic, should skills be self-contained (each skill has its full prompt), or should they share a common base prompt that's injected?

**A39:** Hierarchical: core + commands — One core skill defines the entire system. Individual commands are lightweight triggers that invoke specific sections of the core skill.

**Q40 (State management):** The spec positions this as a Claude Code plugin with skills. But implementing it requires persistent state (task lifecycle, active worktrees, sync metadata). Claude Code skills don't have built-in state management — they're stateless prompts. How should state be managed between command invocations?

**A40:** File-based state — All state lives in the filesystem (.spec-workspace files, .spec-workspace.json, TASKS.md). Each skill reads/writes these files.

---

### Round 11 — User Stories, SPEC.md & Service Discovery

**Q41 (Story format):** User stories in uh/ are auto-generated from the spec and mapped to phases. What format should they follow? Classic 'As a [user], I want [action], so that [benefit]' with acceptance criteria? Or a more technical format focused on behavior (Given/When/Then)?

**A41:** Hybrid — Classic format for the story statement, with acceptance criteria written as Given/When/Then scenarios. Best of both worlds.

**Q42 (SPEC.md format):** SPEC.md is the starting artifact that drives everything. Should it have a required template structure (sections like Problem, Requirements, Constraints, Out of Scope), or should it be freeform text that the spec-interviewer agent structures during /jlu:refine-spec?

**A42:** Minimal seed + interview — SPEC.md starts as a minimal seed (even one sentence). The /jlu:refine-spec interview expands it into a full structured spec through conversation.

**Q43 (Service discovery):** When /jlu:new-task proposes affected services using services.yaml, it reads each service's INTEGRATIONS.md for relationship discovery. But what if the task affects a service that isn't registered in services.yaml yet (e.g., a new microservice that was recently created)? Should the plugin auto-detect repos or require explicit registration?

**A43:** Warn on references — If a spec or codebase doc references a service not in the registry, warn the user and offer to register it.

**Q44 (Live progress):** The spec says the orchestrator outputs 'only executive summaries in Markdown'. But during a long autonomous execution, the user might want to see what's happening in real-time. Should the orchestrator stream progress updates (e.g., 'Phase 2 started on service-auth'), or only report at the end?

**A44:** Progress file + milestones — Write real-time progress to a file (e.g., TASKS.md updates). Output milestone summaries to the user's terminal.

---

### Round 12 — Prompt Architecture & Session Recovery

**Q45 (Prompt size):** The hierarchical skill architecture means one core skill defines the system, with lightweight command triggers. But Claude Code skills have a context window limit. The core skill prompt with all orchestration logic, agent contracts, file conventions, templates, and lifecycle rules could be massive. How should this be handled?

**A45:** Tiered prompts — Three tiers: (1) ultra-compact orchestrator rules, (2) command-specific details loaded per command, (3) reference docs read on demand from workspace.

**Q47 (Session recovery):** The spec doesn't mention how the plugin handles session continuity. If the user starts /jlu:execute-task, execution progresses through 2 of 5 phases, then the Claude Code session ends (timeout, crash, user closes terminal). When they restart and run /jlu:execute-task again, should it resume from phase 3?

**A47:** User chooses — Present the current state (2/5 phases done) and ask the user: resume from phase 3, re-validate phases 1-2 first, or start over.

**Q48 (Delivery):** Last question: what's the delivery format for this spec? Should I write the consolidated spec as an updated version of JELOU_SPEC_PROPOSAL.md (replacing the current content), or as a new file (e.g., JELOU_SPEC_V2.md)?

**A48:** Overwrite existing — Replace JELOU_SPEC_PROPOSAL.md with the fully consolidated spec.

---

### Follow-Up Round 1 — Scope

**Q49:** To clarify: you want me to not just write the consolidated spec document, but also plan the actual code implementation of the plugin (skill files, prompts, templates, etc.)? Or do you want me to first write the spec and then plan the implementation as a follow-up?

**A49:** Spec first, then implement.

---

### Follow-Up Round 2 — Distribution & Documentation

**Q50 (Distribution):** Claude Code currently has no plugin marketplace. Skills are just .md files placed in directories. How do you envision distributing this plugin? This affects the spec's installation section and the README.

**A50:** Install script — Git repo with an install.sh that copies skills to the right directories, creates config templates, and validates the setup.

**Q51 (README scope):** The README scope — should it cover just installation and setup, or also serve as user documentation (command reference, workflow guides, troubleshooting)?

**A51:** README + docs/ — README covers overview and quick start. Detailed docs (commands, workflows, config) live in a docs/ directory with individual guides.
