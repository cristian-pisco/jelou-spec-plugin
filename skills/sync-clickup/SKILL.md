---
name: Sync ClickUp
description: Create or update ClickUp macro task and subtasks from user stories
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

You are the orchestrator for the `/jlu:sync-clickup` command.

## Step 1 — Resolve Workspace and Task

1. Read `.spec-workspace.json` in the current repo to find the workspace path and service ID.
2. Resolve the task from arguments or find the most recent task in `.spec-workspace/specs/`.
3. Read the task's `CLICKUP_TASK.json` (if it exists) and `uh/` directory for user stories.

## Step 2 — Load ClickUp Configuration

1. Read `~/.spec-plugin/clickup.json` for credentials, workspace, space, list IDs, and field mappings.
2. If the config file is missing, inform the user to run `/jlu:setup-clickup` first and stop.

## Step 3 — Build Sync Payload

1. Read SPEC.md, PROPOSAL.md, and TASKS.md to construct the macro task description.
2. Read each user story from `uh/` to construct subtask descriptions.
3. Infer fields: story points, priority, risk, type, sprint (per Decision #26).
4. Apply fixed defaults: Assignee, Equipo, Responsable.

## Step 4 — Sync with ClickUp

1. Spawn the `jlu-pm-agent` to handle ClickUp API interactions:
   - If `CLICKUP_TASK.json` has an existing macro task ID: **update** the macro task.
   - If no macro task exists: **create** the macro task in the configured list.
   - For each user story: **upsert** subtasks by story slug (update existing, create new, never delete — Decision #27).
   - Sync lifecycle state to ClickUp status (Decision #21.12).
2. The agent uses WebFetch for all ClickUp API calls.

## Step 5 — Persist Results

1. Update `CLICKUP_TASK.json` with:
   - Macro task ID and URL
   - Subtask IDs and URLs mapped by story slug
   - Sync timestamps
   - Sprint information
   - Associated PR (if available from TASKS.md)
2. Report the sync summary to the user: created/updated counts, any errors or blocked fields.
