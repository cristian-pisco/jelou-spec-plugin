# Workflow: daily-slack

> Orchestrator workflow for `/jlu-daily-slack <sprint> #channel`
> Generate and post a sprint-scoped daily summary to Slack.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

You are the orchestrator for the `/jlu-daily-slack` command. You generate a Slack message from sprint task data and a channel template, then post it after user approval.

## Step 1 — Parse Arguments

1. Parse `<sprint> #channel` from arguments.
2. Sprint is required. If missing, ask via `question`: "Which sprint number should I report on?"
3. Channel is required and must start with `#`. If missing, ask: "Which channel should I post to? (e.g., #dailies)"
4. Strip the `#` prefix for file lookups (e.g., `#dailies` → `dailies`).

## Step 2 — Resolve Workspace

1. Search for `.spec-workspace.json` in cwd and up to 5 parent directories.
2. Read the file and extract the `workspace` field. Resolve to an absolute path.
3. If not found, stop with: "No workspace found. Run /jlu-new-task first to initialize one."

## Step 3 — Load Channel Template

1. Read `<workspace>/registry/slack/<channel>.md`.
2. Parse YAML frontmatter for `manual_fields` and `manual_prompts`. Parse the body as the message template.
3. If missing, stop with: "No template found for #<channel>. Create one at `<workspace>/registry/slack/<channel>.md`. See `jelou/templates/slack-channel.md` for the format."

## Step 4 — Resolve User Identity

1. Read `<workspace>/registry/clickup-user.json`. If it exists with a non-empty `user_id`, skip to Step 5.
2. Otherwise, ask via `question`: "What's your ClickUp email?". Do NOT pre-fill, do NOT default. Do NOT use any value from prior conversations, memory, or environment.
3. Call `clickup_get_workspace_members` and case-insensitively match the email.
4. If zero matches, stop with: "No ClickUp member found for `<email>`. Check the address and try again."
5. Write `<workspace>/registry/clickup-user.json`:
   ```json
   { "email": "<email>", "user_id": "<id>", "username": "<name>" }
   ```

## Step 5 — Verify ClickUp MCP

Call `clickup_get_workspace_hierarchy` as a connectivity probe. On any failure, stop with the same message used by `/jlu-sync-clickup` Step 0.

## Step 6 — Discover Sprint Tasks

### 6a. Plugin tasks (sprint-filtered, ownership trusted)
Walk `<workspace>/specs/*/CLICKUP_TASK.json`. Include a task if `sprint == <sprint-arg>` (string comparison). Ownership is trusted: plugin tasks in a sprint folder were created by you via `/jlu-new-task`, so they're inherently yours.

For each included task, record `clickup_id` (= `macroTask.id`), `source: "plugin"`, `slug` (folder name), `clickup_url` (= `macroTask.url`), and `pr_urls` (= values of the `pr` map).

### 6b. ClickUp gap-fill

The available ClickUp MCP exposes only `clickup_get_tasks(listId|listName, ...)` — there is no workspace-wide filter and no native `assignees` / `custom_fields` filter on this tool. The OR over (assignees, Responsable) MUST therefore be enforced after fetching the full sprint list and post-filtering.

**6b.1 — Resolve the sprint list ID.**
- First, scan the plugin tasks collected in 6a: take the `list_id` from any one of their `CLICKUP_TASK.json` files. All tasks in the same sprint share the same list, so the first hit is sufficient.
- If 6a produced no plugin tasks, call `clickup_get_workspace_hierarchy` and find the list whose name matches `^Sprint <sprint-arg>\b` (case-insensitive). If exactly one match, use its id. If zero or multiple, ask via `question`: "Which ClickUp list is sprint `<sprint-arg>`? Paste the list ID or full name." and resolve from the response.

**6b.2 — Resolve the `Responsable` custom-field UUID.**
- From the same `CLICKUP_TASK.json` used in 6b.1, read `field_mappings.Responsable`.
- If unavailable (no plugin task), call `clickup_get_list(listId=<sprint-list-id>)` and find the custom field whose `name == "Responsable"`; use its `id`.

**6b.3 — Page through the sprint list.**
Call `clickup_get_tasks(listId=<sprint-list-id>, subtasks=false, page=<n>)` starting at `page: 0`. Concatenate the results from each page into a single array. Stop when a page returns fewer items than the previous page or returns an empty array. Do **not** pass a `statuses` filter — we want both open and closed tasks.

Write the concatenated array to `<workspace>/.cache/sprint-list-tasks.json`.

**6b.4 — Post-filter via the discover script.**
Build `<workspace>/.cache/plugin-task-ids.json`: a JSON array of every `clickup_id` collected in 6a.

```bash
node <plugin-root>/bin/daily-slack-discover.mjs \
  --tasks <workspace>/.cache/sprint-list-tasks.json \
  --user-id <user_id-from-step-4> \
  --responsable-field-id <responsable-field-uuid-from-6b.2> \
  --plugin-ids <workspace>/.cache/plugin-task-ids.json
```

The script returns a JSON array of clickup-only stubs (`{clickup_id, name, url, source: "clickup-only", slug: null, pr_urls: []}`) for tasks where `assignees` contains `user_id` OR the Responsable custom field references `user_id`, with plugin IDs already excluded. Append these stubs to the union task set.

### 6c. Per-task data fetch
For every task in the union, call `clickup_get_task` to get:
- `name` (from ClickUp; for plugin tasks, override with the SPEC.md first heading if available)
- `status.type`
- `due_date`
- `subtasks` (for percentage calculation)

Calculate `percentage`:
- Plugin tasks: `(closed_subtasks / total_subtasks) × 90`. If exactly 90, run `gh pr view <url> --json state` for each PR URL; if all merged, upgrade to 100.
- ClickUp-only tasks: `(closed_subtasks / total_subtasks) × 90`; no PR upgrade. If no subtasks, 0.

Note: tasks with `status_type === 'closed'` are normalized to `percentage: 100` downstream by `bin/daily-slack-bucket.mjs`, regardless of subtask count. The orchestrator's calculation here can be left as-is; the bucketer enforces the closed-as-done invariant.

Build `<workspace>/.cache/current-tasks.json`: an array of `{clickup_id, name, url, percentage, status_type, due_date, source, slug, pr_urls}`.

## Step 7 — Resolve Cutoff and Snapshot

1. Glob `<workspace>/drafts/slack/*-<channel>.md`.
2. For each file, read frontmatter; filter by `status: published`.
3. Pick the entry with the latest `published_at`.
4. If found, write its `task_snapshots` map to `<workspace>/.cache/snapshot-<sprint>-<channel>.json`. Cutoff timestamp = `published_at`.
5. If none found, no snapshot file is created. Cutoff = null (first-run).

## Step 8 — Bucket via `bin/daily-slack-bucket.mjs`

```bash
node <plugin-root>/bin/daily-slack-bucket.mjs \
  --current <workspace>/.cache/current-tasks.json \
  --snapshot <workspace>/.cache/snapshot-<sprint>-<channel>.json
```

Capture stdout JSON: `{achieved, not_achieved, new_snapshot, first_run}`.

## Step 9 — Fetch Reasons for Stuck Tasks

For each task in `not_achieved`:
1. Call `clickup_get_task_comments(task_id)`. Extract latest 1-2 with `date_iso > cutoff`. If none after cutoff, take the most recent overall.
2. For plugin tasks with PR URLs: run `gh pr view <url> --json state,isDraft,mergeable,statusCheckRollup`. Map `statusCheckRollup` to `checks: "failing"` if any check failed.
3. Write `<workspace>/.cache/task-<clickup_id>.json`:
   ```json
   { "cutoff": "<iso-or-null>", "comments": [{"date_iso": "...", "text": "..."}], "pr_states": {"<url>": {"state": "...", "isDraft": <bool>, "mergeable": <bool>, "checks": "..."}} }
   ```
4. Run:
   ```bash
   node <plugin-root>/bin/daily-slack-extract-reason.mjs --task <workspace>/.cache/task-<clickup_id>.json
   ```
   Capture stdout as `reason` for that task.

Attach `reason` to each task in `not_achieved`.

## Step 10 — Render Automated Placeholders

Build `<workspace>/.cache/render-data.json`:
```json
{
  "first_run": <bool>,
  "achieved": [{"name": "...", "url": "...", "percentage": <int>}, ...],
  "not_achieved": [{"name": "...", "url": "...", "reason": "..."}, ...],
  "short_term": [{"name": "...", "url": "...", "due_date": "<iso-or-null>", "status_type": "<closed|open|...>"}, ...]
}
```

`short_term` is built from the union task set (any task with a `due_date`). Pass through `status_type` from `current-tasks.json` so the renderer can apply strikethrough to closed tasks.

```bash
node <plugin-root>/bin/daily-slack-render.mjs --data <workspace>/.cache/render-data.json
```

Capture stdout JSON: `{achieved_goals, not_achieved_goals, short_term_goals}`.

## Step 11 — Check Existing Draft

Look for `<workspace>/drafts/slack/<sprint>-<channel>.md`:
- `status: draft` → ask via `question`: "A draft exists for sprint <sprint> on #<channel>. Resume editing it, or regenerate?". On resume, load the body and skip to Step 14.
- `status: published` → ask: "This sprint already has a published report on #<channel>. Re-post it, or regenerate?". On re-post, skip to Step 15. On regenerate, continue to Step 12.

## Step 12 — Prompt Manual Fields

For each field in `manual_fields` (in order):
1. Read prompt from `manual_prompts.<field>`.
2. For `planned_achievements`, append helper context to the prompt: a comma-separated list of stuck task names from Step 8. Example: `(in progress: Migration, API node)`.
3. Ask via `question` and store the response.

## Step 13 — Compose, Save, and Scan

1. Substitute every `{{placeholder}}` in the template body with the rendered value (automated from Step 10, manual from Step 12). Use plain string replacement; do not LLM-rewrite the result.
2. Build the allowlist file `<workspace>/.cache/url-allowlist.txt`: one URL per line for every `clickup_url` in the union task set, plus every URL value read from the involved `CLICKUP_TASK.json` files this run.
3. Write the composed body to `<workspace>/.cache/composed-body.md`.
4. Run the URL safety scan:
   ```bash
   node <plugin-root>/bin/daily-slack-scan-urls.mjs \
     --body <workspace>/.cache/composed-body.md \
     --allowlist <workspace>/.cache/url-allowlist.txt
   ```
5. If exit code is 1, abort with: `Link safety check failed: rendered output contains unknown ClickUp URL. Aborting to prevent invented links.` plus the script's stderr message. DO NOT save the draft. The user must investigate the unknown URL and re-run.
6. On exit 0, save the draft to `<workspace>/drafts/slack/<sprint>-<channel>.md`:
   ```yaml
   ---
   channel: "#<channel>"
   sprint: <sprint>
   status: draft
   published_at:
   task_snapshots:
     <id>:
       name: "..."
       url: "..."
       percentage: <int>
       status_type: "..."
   ---
   <body>
   ```
   The `task_snapshots` map is `new_snapshot` from Step 8.

## Step 14 — Present for Review

1. Display the composed body to the user.
2. Ask via `question`: "Here's the draft for #<channel> (sprint <sprint>). Ready to post, or do you want to edit anything?"
3. If edits requested:
   - Apply changes to the body.
   - Re-run the URL safety scan from Step 13. Abort if it fires.
   - Re-save the draft.
   - Re-present.
4. On approval, continue to Step 15.

## Step 15 — Publish to Slack

1. Post via `mcp__claude_ai_Slack__slack_send_message` to `#<channel>`.
   - On unavailable, fall back to `mcp__plugin_slack_slack__slack_send_message`.
   - On both unavailable, tell the user: "Slack MCP is not available. The draft has been saved at `<path>` — you can post it manually."
2. On success: update the draft frontmatter to `status: published` and `published_at: <ISO-8601>`. The snapshot remains in frontmatter and rolls forward to the next run.
3. On failure: report the error, keep `status: draft`.
