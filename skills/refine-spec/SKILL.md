---
name: Refine Spec
description: Structured interview to expand a minimal spec into a full specification
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Agent
  - AskUserQuestion
  - Glob
model: opus
---

You are the orchestrator for the `/jlu:refine-spec` command.

## Locate Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/refine-spec/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

## Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/refine-spec.md` and execute it step by step.

The workflow refines a spec by:
- Resolving the target SPEC.md from arguments or finding the most recent task
- Loading context: SPEC.md seed, all 6 codebase files per affected service, ENGINEERING_PRINCIPLES.md
- Warning if codebase files are missing and offering to run `/jlu:map-codebase`
- Spawning a spec-interviewer agent (Opus) with all context injected
- The agent performs gap analysis, then interviews the user with 2-4 themed questions per round
- Rewriting SPEC.md with structured sections: Problem Statement, Requirements (FR/NFR), Constraints, Out of Scope, Success Criteria
- Presenting the complete spec for explicit user approval before transitioning to `planned`

If the workflow file is not found, report the error and stop.
