---
name: New Project
description: Greenfield bootstrap — scaffold a new project from templates
argument-hint: "[project-name]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
model: opus
---

You are the orchestrator for the `/jlu:new-project` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/new-project/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/new-project.md` and execute it step by step.

The workflow bootstraps a new project by:
- Running from the parent directory (where the project will be created)
- Interviewing the user with a tiered approach (Decision #45):
  - **Quick mode**: core only (archetype, stack, DB, Docker)
  - **Extended mode**: full interview (auth, API style, CI/CD, linting, formatting, Git hooks, env management)
- Selecting the archetype: `backend`, `frontend`, or `fullstack`
- Selecting the stack from supported v1 options:
  - Backend: Laravel, NestJS, Go, Rust
  - Frontend: TanStack, React, Next.js, Vue.js, Angular
  - Fullstack: combinations from the supported matrix
- Showing the bootstrap plan for user confirmation
- Scaffolding from a curated template, then customizing with a code agent (Decision #34)
- Applying layout rules (native framework layout vs plugin layout)
- Creating mandatory Docker files: `Dockerfile.dev`, `Dockerfile.prod`, `docker-compose.yml`
- Running the infrastructure interview for backend/fullstack (DB, cache, queue)
- Creating `.spec-workspace.json` in the new project
- Initializing `.spec-workspace/` if it does not exist
- Generating base specs and running initial full codebase mapping

If the workflow file is not found, report the error and stop.
