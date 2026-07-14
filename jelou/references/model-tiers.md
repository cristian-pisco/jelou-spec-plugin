# Model Assignment Policy

> Three-tier model policy for agent assignments (Decision #28). This document defines which Claude model tier each agent role uses by default, and the rules for escalation and override.

## Default Assignments by Role

### Tier 1: Opus — Strategic and High-Stakes Roles

| Agent | Justification |
|-------|---------------|
| **main-orchestrator** | Coordinates all agents, makes delegation decisions, mediates disputes, enforces lifecycle gates. Requires the strongest reasoning. |
| **spec-interviewer** | Conducts structured interviews, performs gap analysis against codebase, produces the foundational SPEC.md. Quality here determines everything downstream. |

### Tier 2: Sonnet — Implementation and Analysis Roles

| Agent | Justification |
|-------|---------------|
| **research agents** (codebase-analyzer-structural, codebase-analyzer-operational) | Analyze codebases, produce structured knowledge documents. Two consolidated agents replace the original six. |
| **proposal-agent** | Translates spec into execution-ready plan with phases, dependencies, risks. Structured document generation from clear inputs. |
| **code agents** (test-writer, implementer) | Write tests and implementation code. Need strong coding ability with awareness of conventions and patterns. |
| **tasks-agent** | Manages TASKS.md updates, tracks progress, handles execution state. Needs accuracy in structured updates. |
| **qa-agent** | Validates implementations against spec, reviews coverage, checks cross-service contracts. Needs thorough analytical ability. |

### Tier 3: Haiku — Lightweight Operational Roles

| Agent | Justification |
|-------|---------------|
| **project-management-agent (pm-agent)** | Formats ClickUp tasks, syncs status. Action is already decided by orchestrator; agent just executes the formatting and API calls. |
| **slack-agent** | Generates daily summaries from templates. Content structure is predefined; agent fills in the data. |
| **git-agent** | Stages, commits, pushes to predetermined branches. Actions are already decided; agent just executes git operations. |

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
| `operational` | haiku | git-agent, tasks-agent |

### Resolution Order

1. Check `.spec-workspace.json` → `models.<group>` for the agent's group
2. Fall back to the agent's frontmatter `model:` field
3. Fall back to the default for the group (table above)

Orchestrator workflows that spawn agents MUST check for model overrides before specifying the model parameter. Read `.spec-workspace.json` once at the start of the workflow and resolve each agent's model from the config.

## Cost Implications

No budget tracking is implemented in v1 (Decision #28). The tier policy is the primary cost control mechanism:

- Opus is reserved for roles where reasoning quality directly impacts all downstream work.
- Sonnet handles the bulk of implementation work.
- Haiku handles repetitive operational tasks where the decision has already been made.
