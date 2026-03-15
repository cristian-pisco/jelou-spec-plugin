---
name: Post Slack
description: Generate and post daily summary to Slack
argument-hint: "[date] #channel"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Agent
  - AskUserQuestion
model: sonnet
---

You are the orchestrator for the `/jlu:post-slack` command.

## Step 1 — Parse Arguments

1. Parse the date and channel from arguments.
2. Date is optional — default to today (`dd-mm-yyyy` format).
3. Channel is mandatory — must start with `#`. If missing, ask the user.

## Step 2 — Load Channel Template

1. Read `.spec-workspace.json` to locate the workspace.
2. Check for a channel-specific template at `.spec-workspace/registry/slack/<channel>.md`.
3. If no template exists, use a free structured summary format.

## Step 3 — Gather Task Activity

1. Read observability logs from `/specs/observability/` in service repos for the target date.
2. Read `TASKS.md` files from active tasks in `.spec-workspace/specs/` for current status.
3. For each task with activity on the target date, collect:
   - Task name
   - Brief activity summary (phases completed, blockers hit, tests passed)
   - PM link from TASKS.md or CLICKUP_TASK.json

## Step 4 — Generate Draft

1. Spawn the `jlu-slack-agent` to generate the message content:
   - Apply the channel template if available, or generate a structured summary.
   - Include per-task activity summaries.
   - Include a meetings section placeholder for manual input.
2. Present the draft to the user for review.
3. Allow manual edits — the user can modify the content.

## Step 5 — Persist Draft

1. Save the draft to the task spec folder at `<workspace>/specs/<date>/<task-slug>/slack/<channel>.md`.
2. Mark the draft state as `draft` initially.
3. If a draft already exists for this date/channel, load and reuse it (allow updates).

## Step 6 — Publish

1. Ask the user for explicit confirmation before publishing.
2. On confirmation, use the Slack MCP server tool to post the message to the channel.
3. Update the draft state to `published` with a timestamp.
4. Report success or failure to the user.
