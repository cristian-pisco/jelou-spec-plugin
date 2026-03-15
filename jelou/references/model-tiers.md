# Model Assignment Policy

> Three-tier model policy for agent assignments (Decision #28). This document defines which Claude model tier each agent role uses by default, and the rules for escalation and override.

## Default Assignments by Role

### Tier 1: Opus — Strategic and High-Stakes Roles

| Agent | Justification |
|-------|---------------|
| **main-orchestrator** | Coordinates all agents, makes delegation decisions, mediates disputes, enforces lifecycle gates. Requires the strongest reasoning. |
| **spec-interviewer** | Conducts structured interviews, performs gap analysis against codebase, produces the foundational SPEC.md. Quality here determines everything downstream. |
| **proposal-agent** | Translates spec into execution-ready plan with phases, dependencies, risks, and testing strategy. Architectural reasoning required. |

### Tier 2: Sonnet — Implementation and Analysis Roles

| Agent | Justification |
|-------|---------------|
| **research agents** (architecture, stack, conventions, integrations, structure, concerns) | Analyze codebases in depth, produce structured knowledge documents. Need strong code comprehension. |
| **code agents** (test-writer, implementer) | Write tests and implementation code. Need strong coding ability with awareness of conventions and patterns. |
| **tasks-agent** | Manages TASKS.md updates, tracks progress, handles execution state. Needs accuracy in structured updates. |
| **qa-agent** | Validates implementations against spec, reviews coverage, checks cross-service contracts. Needs thorough analytical ability. |
| **cross-validation agent** | Reads all 6 codebase files and flags contradictions. Needs strong analytical reasoning. |

### Tier 3: Haiku — Lightweight Operational Roles

| Agent | Justification |
|-------|---------------|
| **project-management-agent (pm-agent)** | Formats ClickUp tasks, syncs status. Action is already decided by orchestrator; agent just executes the formatting and API calls. |
| **slack-agent** | Generates daily summaries from templates. Content structure is predefined; agent fills in the data. |
| **git-agent** | Stages, commits, pushes to predetermined branches. Actions are already decided; agent just executes git operations. |

### Special Case: /jlu:new-project

| Phase | Model |
|-------|-------|
| Interview and planning | Opus |
| Bootstrap and scaffold generation | Sonnet |

## Escalation Rules

Lightweight agents (Haiku tier) must escalate to the orchestrator when they detect:

- **Ambiguity**: The action is not clearly defined. Example: git-agent encounters merge conflicts that require judgment.
- **Risk**: The action could have unintended consequences. Example: pm-agent detects a field mapping that doesn't match expected schema.
- **Missing context**: The agent lacks information to complete the task. Example: slack-agent cannot resolve a template placeholder.

On escalation, the orchestrator decides whether to:
1. Resolve the issue and re-delegate to the same agent.
2. Delegate to a higher-tier agent.
3. Escalate to the user.

## User Override

Users can override model assignments at two levels:

- **Per task**: Specify model overrides in the task configuration (e.g., use Opus for code agents on a particularly complex task).
- **Per agent invocation**: Override at execution time when the orchestrator presents the execution plan.

Override decisions are logged in the task's observability events.

## Cost Implications

No budget tracking is implemented in v1 (Decision #28). The tier policy is the primary cost control mechanism:

- Opus is reserved for roles where reasoning quality directly impacts all downstream work.
- Sonnet handles the bulk of implementation work.
- Haiku handles repetitive operational tasks where the decision has already been made.
