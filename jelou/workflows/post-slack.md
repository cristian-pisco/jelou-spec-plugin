# Workflow: post-slack

> Orchestrator workflow for `/jlu:post-slack [date] #channel`
> Generate and post daily summary to Slack.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.

---

You are the orchestrator for the `/jlu:post-slack` command. You generate a Slack message from task data and channel templates, then post it after user approval.

## Step 1 — Parse Arguments

1. Parse the date and channel from arguments: `[date] #channel`.
2. Date is optional — default to today in `dd-mm-yyyy` format.
3. Channel is mandatory — must start with `#`. If missing, ask the user: "Which channel should I post to? (e.g., #dailies)"
4. Strip the `#` prefix for file lookups (e.g., `#dailies` → `dailies`).

## Step 2 — Resolve Workspace

1. Starting from the current working directory, search for `.spec-workspace.json` in the current directory and up to 5 parent directories.
2. Read the file and extract the `workspace` field.
3. Resolve it to an absolute path.
4. If `.spec-workspace.json` is not found, stop with: "No workspace found. Run /jlu:new-task first to initialize one."

## Step 3 — Load Channel Template

1. Read the channel template from `<workspace>/registry/slack/<channel>.md` (using the channel name without `#`).
2. Parse the YAML frontmatter to extract:
   - `manual_fields` — list of placeholder names that require user input
   - `manual_prompts` — map of field name → prompt text shown to the user
3. Parse the body (everything after the second `---`) as the message template.
4. If the template file does not exist, stop with: "No template found for #<channel>. Create one at `<workspace>/registry/slack/<channel>.md`. See `jelou/templates/slack-channel.md` for the format."

## Step 4 — Check for Existing Draft

1. Check for an existing draft at `<workspace>/drafts/slack/<date>-<channel>.md`.
2. If a draft exists, read its YAML frontmatter `status` field:
   - `draft` → Ask the user: "A draft already exists for #<channel> on <date>. Resume editing it, or regenerate from scratch?" If resume, load the draft content and skip to Step 9 (present for review). If regenerate, continue to Step 5.
   - `published` → Ask the user: "This message was already posted to #<channel> on <date>. Do you want to re-post it?" If yes, skip to Step 10 (publish). If no, stop.
3. If no draft exists, continue to Step 5.

## Step 5 — Gather Task Data

For each task folder in `<workspace>/specs/<date>/`:

### 5a. Read task title
- Read `SPEC.md` and extract the first `#` heading as the task name.

### 5b. Read ClickUp data
- Read `CLICKUP_TASK.json` and extract:
  - `macroTask.url` — the ClickUp link for the task. If `macroTask.url` is null or missing, warn the user: "⚠ No ClickUp link for task <slug> — please add manually." Leave the link blank in the rendered output.
  - `macroTask.id` — needed to query ClickUp for due date.
  - `subtasks` — map of story slugs to ClickUp info. If this is an empty array `[]` (initial template state) or empty object `{}`, treat as no ClickUp subtasks.
  - `pr` — map of service-id → PR URL.

### 5c. Calculate completion percentage

**If ClickUp subtasks exist** (subtasks is a non-empty object):
1. For each `(slug, info)` in `subtasks`, call `clickup_get_task` with `info.id`.
2. If any `clickup_get_task` call fails (error response, timeout, or MCP server unavailable), fall back to the TASKS.md phase-based calculation for this task and warn the user: "⚠ ClickUp query failed for <slug> — using phase progress as fallback."
3. A subtask is "closed" when its `status.type == "closed"` (this handles custom status names).
4. `percentage = round((closed_count / total_count) × 90)`

**If no ClickUp subtasks** (empty or array):
1. Read `TASKS.md` and parse the "Phase Progress" table.
2. Count phases with status `done` vs total phases.
3. `percentage = round((done_count / total_count) × 90)`

**PR merge upgrade** (only when percentage == 90):
1. Read PR URLs from `CLICKUP_TASK.json.pr` or the "External Links" table in `TASKS.md`.
2. For each PR URL, run: `gh pr view <url> --json state`
3. If ALL PRs have `state: "MERGED"`, set `percentage = 100`.
4. If any PR is not merged, keep at 90%.
5. If `gh` is unavailable or errors, keep at 90%.

### 5d. Get due date
- If `macroTask.id` exists, call `clickup_get_task` with the macro task ID and read the `due_date` field.
- If no due date is set, record as null (omit date prefix in short_term_goals rendering).

Collect all task data into a list:
- `name` — task title from SPEC.md
- `slug` — folder name
- `percentage` — calculated above
- `clickup_url` — macroTask.url or blank
- `due_date` — from ClickUp or null

## Step 6 — Render Automated Placeholders

**Formatting rule (NFR-3):** All rendered text must use Slack-compatible mrkdwn. Use `*bold*` (single asterisk), never `**bold**`. Do not use `#` markdown headers — use bold text for section labels instead. Do not use markdown links `[text](url)` — paste URLs directly.

### `{{completed_goals}}`

For each task, render one block:
```
[<percentage>%] <task-name>
<clickup-url>
```

If the task has no ClickUp URL, render only:
```
[<percentage>%] <task-name>
```

Separate multiple tasks with a blank line.

### `{{short_term_goals}}`

For each task, render one line:
- With due date: `[<due-date>] <task-name> <clickup-url>`
- Without due date: `<task-name> <clickup-url>`
- Without ClickUp URL: `[<due-date>] <task-name>` or just `<task-name>`

One task per line.

## Step 7 — Prompt Manual Fields

For each field name in the template's `manual_fields` list (in order):

1. Read the prompt text from `manual_prompts.<field-name>`.
2. Ask the user using AskUserQuestion with the prompt text.
3. Store the user's response as the value for `{{<field-name>}}`.

Manual field values are inserted as-is into the template with no additional formatting (NFR-4).

## Step 8 — Compose and Save Draft

1. Take the template body and replace every `{{placeholder}}` with its rendered value (both automated and manual).
2. Create the directory `<workspace>/drafts/slack/` if it does not exist:
   ```bash
   mkdir -p <workspace>/drafts/slack
   ```
3. Write the draft file to `<workspace>/drafts/slack/<date>-<channel>.md`:
   ```markdown
   ---
   channel: "#<channel>"
   date: <date>
   status: draft
   published_at:
   ---

   <composed message content>
   ```

## Step 9 — Present for Review

1. Display the composed message to the user (the content after the YAML frontmatter).
2. Ask: "Here's the draft for #<channel>. Ready to post, or do you want to edit anything?"
3. If the user requests edits:
   - Apply their changes to the draft content.
   - Re-save the draft file with the updated content.
   - Re-present for review.
4. If the user approves, continue to Step 10.

## Step 10 — Publish to Slack

1. Post the message using `mcp__claude_ai_Slack__slack_send_message` to the `#<channel>` channel.
   - If the `claude_ai_Slack` server is unavailable, try `mcp__plugin_slack_slack__slack_send_message` as fallback.
   - If both are unavailable, inform the user: "Slack MCP is not available. The draft has been saved at `<path>` — you can post it manually."
2. On successful post:
   - Update the draft file: set `status: published` and `published_at: <ISO-8601 timestamp>`.
   - Report: "Message posted to #<channel>."
3. On failure:
   - Report the error to the user.
   - Keep the draft as `status: draft` so they can retry.
