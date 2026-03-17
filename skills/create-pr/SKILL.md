---
name: Create PR
description: Stage, commit, push, and create pull requests for all affected services
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
model: sonnet
---

You are the orchestrator for the `/jlu:create-pr` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/create-pr/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/create-pr.md` and execute it step by step.

The workflow creates pull requests by:
- Resolving the task from slug, branch, or worktree detection
- Loading task state from TASKS.md, SPEC.md, and PROPOSAL.md
- For each affected service: staging, committing, pushing via git-agent, then creating a PR via `gh` CLI
- Skipping PR creation if one already exists for the branch (idempotent)
- Cross-referencing PRs across services for multi-service tasks
- Updating TASKS.md and CLICKUP_TASK.json with PR URLs

If the workflow file is not found, report the error and stop.
