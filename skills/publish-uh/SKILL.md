---
name: Publish User Stories
description: Push user stories to ClickUp as subtasks of the macro task
argument-hint: "[task-slug]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Agent
  - AskUserQuestion
  - WebFetch
model: sonnet
---

You are the orchestrator for the `/jlu:publish-uh` command.

## Step 1 — Resolve Workspace and Task

1. Read `.spec-workspace.json` in the current repo to find the workspace path and service ID.
2. Resolve the task from arguments or find the most recent task in `.spec-workspace/specs/`.
3. Read the task's `uh/` directory to list all user story files.

## Step 2 — Verify Prerequisites

1. Read `CLICKUP_TASK.json` in the task folder and verify it has a macro task ID.
2. If no macro task ID exists, inform the user to run `/jlu:sync-clickup` first and stop.
3. Read `~/.spec-plugin/clickup.json` for credentials and configuration.
4. If the config file is missing, inform the user to run `/jlu:setup-clickup` first and stop.

## Step 3 — Prepare User Stories

1. Read each user story markdown file from the `uh/` directory.
2. Parse the story statement, acceptance criteria (Given/When/Then), and phase mapping.
3. Build the subtask payload for each story including:
   - Title from the story slug
   - Description from story content + acceptance criteria
   - Phase mapping reference
   - Inherited fields from macro task: type, state, priority, size, story points, sprint

## Step 4 — Push to ClickUp

1. Spawn the `jlu-pm-agent` to push each user story as a subtask:
   - Match existing subtasks by story slug (Decision #27: upsert, never delete).
   - Create new subtasks for stories not yet in ClickUp.
   - Update existing subtasks with current content.
2. The agent uses WebFetch for all ClickUp API calls.

## Step 5 — Update Artifacts

1. Update `CLICKUP_TASK.json` with:
   - Subtask IDs and URLs mapped by story slug
   - Sync timestamps for each story
   - Publication status
2. Report results to the user: how many stories were created, updated, or unchanged.
