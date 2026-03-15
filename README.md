# Jelou Spec Plugin — Spec-Driven Development for Claude Code

A Claude Code plugin that implements Spec-Driven Development with specialized agents, strict TDD, multi-service orchestration, and a shared workspace as the single source of documentary truth.

Follows the conventions established by [OpenSpec](https://github.com/Fission-AI/OpenSpec) (`/opsx:`) and [Get Shit Done](https://github.com/gsd-build/get-shit-done) (`/gsd:`), with the **`/jlu:`** command namespace.

## What It Does

- **Spec-driven workflow**: Write a minimal spec, refine it through structured interview, generate an execution-ready proposal, and implement via TDD — all orchestrated by specialized agents.
- **Multi-service coordination**: Manages tasks that span multiple repos/services with dependency-driven execution, coordinated branches, and cross-service validation.
- **Agent specialization**: The orchestrator never writes code. It delegates to purpose-built agents (spec-interviewer, proposal, test-writer, implementer, QA) and consolidates their output.
- **Strict TDD**: Red → Green → Refactor enforced per phase. Separate test-writer and implementer agents ensure discipline.
- **Integrations**: ClickUp task management, Slack dailies (via MCP), Git worktree management, and PR coordination.
- **Greenfield bootstrap**: Scaffold new projects from curated templates with stack-appropriate structure, Docker, and infrastructure configuration.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured
- Git
- (Optional) ClickUp API key for task management integration
- (Optional) Slack MCP server for daily posts

## Quick Start

```bash
# 1. Register the marketplace (one-time)
claude plugins add-marketplace cristian-pisco/jelou-spec-plugin

# 2. Install the plugin
claude plugins install jlu@jelou-spec-plugin

# 3. Navigate to your project's parent directory (where your service repos live)
cd /path/to/your/services

# 4. Start Claude and use the commands
claude
> /jlu:new-task
# The plugin will detect there's no .spec-workspace and offer to create one

# 5. (Optional) Map your codebase first
> /jlu:map-codebase

# 6. (Optional) Set up ClickUp integration
> /jlu:setup-clickup
```

### Manual Installation

If you prefer to install manually:

```bash
git clone <repo-url> jelou-spec-plugin
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
| `/jlu:post-slack [date] #channel` | Generate and post daily summary to Slack |
| `/jlu:close-task` | Close task after PR merge — updates ClickUp, artifacts, observability |
| `/jlu:refresh-skills` | Refresh the skill registry |
| `/jlu:setup-clickup` | Interactive ClickUp credential and field mapping setup |
| `/jlu:new-project` | Greenfield bootstrap — scaffold a new project from templates |

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

Detailed guides are available in the `docs/` directory:

- **Command Reference** — Detailed usage for each command
- **Workflow Guide** — End-to-end task lifecycle walkthrough
- **Multi-Service Guide** — Working with tasks that span multiple repos
- **Configuration Guide** — All configuration options explained
- **Bootstrap Guide** — Creating new projects with `/jlu:new-project`
- **Troubleshooting** — Common issues and solutions

## How It Works (Simplified)

1. **Spec** → Write a minimal seed, refine via structured interview
2. **Proposal** → Two-pass generation (global strategy + per-service details)
3. **Execute** → Dependency-driven, TDD-enforced implementation with specialized agents
4. **Validate** → Continuous QA per phase + final cross-service validation
5. **Deliver** → Sync to ClickUp, post to Slack, coordinate PRs

All state is file-based. No external database required.

## Full Specification

See [JELOU_SPEC_PROPOSAL.md](./JELOU_SPEC_PROPOSAL.md) for the complete, implementation-ready specification including all design decisions, artifact schemas, and the full interview transcript.
