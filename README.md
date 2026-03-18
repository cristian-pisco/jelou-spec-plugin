# Jelou Spec Plugin — Spec-Driven Development for Claude Code

A Claude Code plugin that implements Spec-Driven Development with specialized agents, strict TDD, multi-service orchestration, and a shared workspace as the single source of documentary truth.

Follows the conventions established by [OpenSpec](https://github.com/Fission-AI/OpenSpec) (`/opsx:`) and [Get Shit Done](https://github.com/gsd-build/get-shit-done) (`/gsd:`), with the **`/jlu:`** command namespace.

## What It Does

- **Spec-driven workflow**: Write a minimal spec, refine it through structured interview, generate an execution-ready proposal, and implement via TDD — all orchestrated by specialized agents.
- **Multi-service coordination**: Manages tasks that span multiple repos/services with dependency-driven execution, coordinated branches, and cross-service validation.
- **Agent specialization**: The orchestrator never writes code. It delegates to purpose-built agents (spec-interviewer, proposal, test-writer, implementer, QA) and consolidates their output.
- **Strict TDD**: Red → Green → Refactor enforced per phase. Separate test-writer and implementer agents ensure discipline.
- **Integrations**: ClickUp task management, Slack dailies (via MCP), Git worktree management, and PR coordination.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured
- Git
- (Optional) ClickUp API key for task management integration
- (Optional) Slack MCP server for daily posts

## Quick Start

Inside a Claude Code session, run:

```
# 1. Register the marketplace (one-time)
/plugin marketplace add cristian-pisco/jelou-spec-plugin

# 2. Install the plugin
/plugin install jlu@jelou-spec-plugin
```

Then navigate to your project's parent directory and start using commands:

```
# Create a new task (will offer to set up .spec-workspace if missing)
/jlu:new-task

# (Optional) Map your codebase first
/jlu:map-codebase

# (Optional) Set up ClickUp integration
/jlu:setup-clickup
```

### Updating the Plugin

To pull the latest version inside a Claude Code session:

```
/plugin update jlu@jelou-spec-plugin
```

### Local Development / Manual Installation

```bash
# Option A: Load directly from a local directory
claude --plugin-dir /path/to/jelou-spec-plugin

# Option B: Fallback installer (copies skills/agents to ~/.claude/)
git clone https://github.com/cristian-pisco/jelou-spec-plugin.git
cd jelou-spec-plugin
./bin/install.sh
```

## Core Commands

| Command | Purpose |
|---------|---------|
| `/jlu:map-codebase` | Analyze a service and generate 6 codebase knowledge files |
| `/jlu:new-task` | Create a new task with spec, worktrees, and affected service detection |
| `/jlu:refine-spec` | Structured interview to expand a minimal spec into a full specification |
| `/jlu:execute-task` | Run TDD implementation (autonomous or step-by-step mode) |
| `/jlu:extend-phase` | Add scope to an in-progress task via focused mini-interview |
| `/jlu:sync-clickup` | Create/update ClickUp macro task and subtasks from user stories |
| `/jlu:publish-uh` | Push user stories to ClickUp as subtasks |
| `/jlu:report-task` | Executive summary with progress, blockers, and stale worktree detection |
| `/jlu:load-context` | Load task context into a fresh session for Q&A |
| `/jlu:create-pr [task-slug]` | Stage, commit, push, and create pull requests for all affected services |
| `/jlu:post-slack [date] #channel` | Generate and post daily summary to Slack |
| `/jlu:close-task` | Close task after PR merge — updates ClickUp, artifacts, observability |
| `/jlu:refresh-skills` | Refresh the skill registry |
| `/jlu:setup-clickup` | Interactive ClickUp credential and field mapping setup |

## Workspace Structure

The plugin uses `.spec-workspace/` in the parent directory of your services as the canonical root:

```
.spec-workspace/
  registry/
    services.yaml          # Service registry (id, path, stack)
  principles/
    ENGINEERING_PRINCIPLES.md
  services/
    <service-id>/
      codebase/            # 6 knowledge files per service
  specs/
    <dd-mm-yyyy>/
      <task-slug>/         # All task artifacts
        SPEC.md
        PROPOSAL.md
        TASKS.md
        services/
          <service-id>/
            CONTEXT.md
            phases/
            uh/
```

Each service repo only stores a minimal `.spec-workspace.json` pointer:

```json
{
  "workspace": "../.spec-workspace",
  "serviceId": "service-auth"
}
```

## Configuration

### ClickUp

Run `/jlu:setup-clickup` to interactively configure:
- API credentials
- Workspace, space, and list IDs
- Custom field mappings

Config is stored at `~/.spec-plugin/clickup.json`.

### Slack

Requires a Slack MCP server configured in your Claude Code settings. The plugin generates message content; the MCP server handles delivery.

Channel templates can be customized in `.spec-workspace/registry/slack/<channel>.md`.

### Engineering Principles

Global principles in `.spec-workspace/principles/ENGINEERING_PRINCIPLES.md` (philosophical).
Per-service concrete rules in each service's `CONVENTIONS.md`.

## Documentation

- **[Full Specification](./JELOU_SPEC_PROPOSAL.md)** — Complete design decisions, artifact schemas, and interview transcript
- **[Architecture Diagrams](./docs/architecture.excalidraw)** — Editable diagrams (open with [excalidraw.com](https://excalidraw.com))

## How It Works (Simplified)

1. **Spec** → Write a minimal seed, refine via structured interview
2. **Proposal** → Two-pass generation (global strategy + per-service details)
3. **Execute** → Dependency-driven, TDD-enforced implementation with specialized agents
4. **Validate** → Continuous QA per phase + final cross-service validation
5. **Deliver** → Create PRs (`/jlu:create-pr`), sync to ClickUp, post to Slack

All state is file-based. No external database required.

## Task Lifecycle

```mermaid
stateDiagram-v2
    [*] --> draft : /jlu:new-task
    draft --> refining : /jlu:refine-spec
    refining --> planned : spec approved
    planned --> implementing : /jlu:execute-task
    implementing --> validating : all phases done
    validating --> ready_to_publish : QA passed
    ready_to_publish --> done : closure approved
    done --> closed : /jlu:close-task

    implementing --> refining : /jlu:extend-phase (major)
    implementing --> planned : /jlu:extend-phase (minor)
    validating --> planned : /jlu:extend-phase

    state implementing {
        [*] --> proposal_generation
        proposal_generation --> phase_execution
        state phase_execution {
            [*] --> red_tests
            red_tests --> green_impl
            green_impl --> refactor
            refactor --> per_phase_qa
            per_phase_qa --> commit
            commit --> [*]
        }
        phase_execution --> final_validation
    }

    note right of implementing
        Session recovery: resume / re-validate / start over
    end note
```

## Agent Architecture

```mermaid
flowchart TB
    subgraph commands["User Commands"]
        new["/jlu:new-task"]
        map["/jlu:map-codebase"]
        refine["/jlu:refine-spec"]
        exec["/jlu:execute-task"]
        close["/jlu:close-task"]
    end

    subgraph opus["Orchestrator Tier — Opus"]
        spec_int["spec-interviewer"]
        proposal["proposal-agent"]
    end

    subgraph sonnet["Research & Implementation Tier — Sonnet"]
        direction TB
        subgraph researchers["6 Parallel Researchers"]
            arch["architecture"]
            stack["stack"]
            conv["conventions"]
            integ["integrations"]
            struct["structure"]
            concerns["concerns"]
        end
        cross["cross-validator"]
        tw["test-writer · Red"]
        impl["implementer · Green"]
        qa["qa-agent"]
        tasks_ag["tasks-agent"]
    end

    subgraph haiku["Operations Tier — Haiku"]
        pm["pm-agent · ClickUp"]
        slack["slack-agent"]
        git["git-agent"]
    end

    subgraph artifacts["Artifacts"]
        spec_file["SPEC.md"]
        prop_file["PROPOSAL.md"]
        phase_files["Phase files"]
        codebase["6 codebase files"]
        tasks_file["TASKS.md"]
    end

    map --> researchers
    researchers --> cross --> codebase
    refine --> spec_int --> spec_file
    exec --> proposal --> prop_file & phase_files
    exec --> tw --> impl --> qa
    qa --> tasks_ag --> tasks_file
    qa --> git
    close --> pm & git
```

## Full Specification

See [JELOU_SPEC_PROPOSAL.md](./JELOU_SPEC_PROPOSAL.md) for the complete, implementation-ready specification including all design decisions, artifact schemas, and the full interview transcript.
