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
2. Parse YAML frontmatter for:
   - `manual_fields` and `manual_prompts` (required for the user-prompted sections)
   - `closed_like_statuses` (optional array of ClickUp status names treated as done)
   - `status_percentages` (optional object mapping status name → 0-100 percentage; e.g. `"pending to production": 90`, `"in qa": 80`)
   - `cutoff_hours` (optional number, default `24`) — how far back to look for tasks closed within the recent window when surfacing `achieved`
   - `preview_channel` (optional Slack channel or DM target like `#preview-dailies` or `@username`)

   Parse the body as the message template.
3. If missing, stop with: "No template found for #<channel>. Create one at `<workspace>/registry/slack/<channel>.md`. See `jelou/templates/slack-channel.md` for the format."
4. Write three cache files for downstream scripts:
   - `<workspace>/.cache/closed-like-statuses.json` — JSON array of `closed_like_statuses` values (use `[]` if the key is absent).
   - `<workspace>/.cache/status-percentages.json` — JSON object of `status_percentages` (use `{}` if absent).
   - `<workspace>/.cache/cutoff-ms.txt` — single-line file with the epoch-ms cutoff = `Date.now() − cutoff_hours·3600000`.
5. **Markdown sanity check.** The body MUST use standard markdown (`**bold**`, `~~strike~~`, `_italic_`) — the plugin Slack tool renders single-asterisk as italic, not bold. If the body still uses single-asterisk headings (`*Question?*`), warn the user via `question`: "The template uses Slack mrkdwn (`*bold*`) which renders italic via the plugin Slack tool. Convert to standard markdown (`**bold**`)?". On confirm, rewrite the file in-place; on decline, continue.

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
Fire one `clickup_get_task` per task in the union **in parallel** — issue all calls in a single multi-tool message rather than awaiting each before sending the next. From each response, extract:
- `name` (from ClickUp; for plugin tasks, override with the SPEC.md first heading if available)
- `status.type` (record as `status_type`)
- `status.status` (record as `status_name` — the human-readable status string used by `closed_like_statuses` and `status_percentages`)
- `due_date`
- `date_closed` (epoch ms; `null` for non-closed tasks) — used by the bucketer's cutoff logic
- `date_updated` (epoch ms) — useful for status-transition heuristics
- `subtasks` (for percentage calculation)

Calculate `percentage` (in-progress fallback only — `bin/daily-slack-bucket.mjs` re-normalizes against `closed_like_statuses` and `status_percentages` downstream, so the order is: closed-like → 100, mapped-status → mapped value, else this fallback):
- Plugin tasks: `(closed_subtasks / total_subtasks) × 100`. If `gh pr view <url> --json state` reports all PRs merged, the bucketer's status mapping for the resulting "closed" status will land at 100 anyway. Issue every `gh pr view` invocation in parallel — fan all of them out from a single Bash command using `xargs -P` (or `&`/`wait`), never one PR at a time.
- ClickUp-only tasks: `(closed_subtasks / total_subtasks) × 100`; no PR upgrade. If no subtasks, 0.

Note: closed-like tasks (`status_type === 'closed'` OR `status_name` listed in `closed_like_statuses`) are normalized to `percentage: 100` downstream. Tasks whose `status_name` matches a key in `status_percentages` are normalized to the mapped value (e.g. "pending to production" → 90, "in qa" → 80). The orchestrator's per-task calculation here is the in-progress fallback; the bucketer enforces the status-driven invariants.

Build `<workspace>/.cache/current-tasks.json`: an array of `{clickup_id, name, url, percentage, status_type, status_name, due_date, date_closed, date_updated, source, slug, pr_urls}`.

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
  --snapshot <workspace>/.cache/snapshot-<sprint>-<channel>.json \
  --closed-like-statuses <workspace>/.cache/closed-like-statuses.json \
  --status-percentages <workspace>/.cache/status-percentages.json \
  --cutoff-ms "$(cat <workspace>/.cache/cutoff-ms.txt)"
```

Capture stdout JSON: `{achieved, not_achieved, new_snapshot, first_run}`.

The flags:
- `--closed-like-statuses` — treat the listed status names as 100%-done in addition to `status_type === 'closed'`.
- `--status-percentages` — map non-closed statuses to a target percentage (e.g. "pending to production" → 90, "in qa" → 80). Ensures `{{achieved_goals}}` always shows a numeric `[N%]`, never a status string.
- `--cutoff-ms` — surface tasks closed within the recent window (default last 24h) as `achieved` even when the prior snapshot already had them at 100%. This makes "achieved since yesterday" robust to multiple daily updates per calendar day.

## Step 9 — Fetch Reasons + Short-Term Status Notes

Per-task work fans out, so issue all calls in parallel — never one-task-at-a-time. The wall-clock saving compounds with Step 6c.

1. **Identify the comment-needing set.** Union of:
   - Every task in `not_achieved` (so we can populate `reason` for `{{not_achieved_goals}}`).
   - Every **non-closed-like** task with a `due_date` (so we can populate `status_note` for `{{short_term_goals}}` — the daily reader needs to see *why* an item is still on the radar: pending prod, on hold, in QA).

2. **Parallel batch A — comments.** Issue every `clickup_get_task_comments(task_id)` for the union in a single multi-tool message. From each response, extract the latest 1-2 comments with `date_iso > cutoff`. If none after cutoff, take the most recent overall.

3. **Parallel batch B — PR states.** For plugin tasks with PR URLs, issue every `gh pr view <url> --json state,isDraft,mergeable,statusCheckRollup` in parallel via Bash (use `&` and `wait`, or `xargs -P`). Map `statusCheckRollup` to `checks: "failing"` if any check failed.

4. Write `<workspace>/.cache/task-<clickup_id>.json` per task:
   ```json
   { "cutoff": "<iso-or-null>", "comments": [{"date_iso": "...", "text": "..."}], "pr_states": {"<url>": {"state": "...", "isDraft": <bool>, "mergeable": <bool>, "checks": "..."}} }
   ```

5. Run reason extraction for every `not_achieved` task (independent CLI invocations, safe to run sequentially since each is sub-second):
   ```bash
   node <plugin-root>/bin/daily-slack-extract-reason.mjs --task <workspace>/.cache/task-<clickup_id>.json
   ```
   Capture stdout as `reason` for that task.

6. **Build `status_note` for each non-closed-like short-term task.** Reason from status + comments. Suggested patterns:
   - Status `pending to production` (or variant) → `pendiente a producción · PR <repo>#<n> abierto` (cite the PR URL the task references).
   - Status `on hold` / `paused` / `blocked` → read the comments for the blocker reason; emit a one-line summary like `on hold · esperando respuesta de cliente X` or `blocked · waiting on infra ticket DEVOPS-42`.
   - QA-related status (`in qa`, `qa review`, `qa approved`) → `en QA` (with PR if relevant).
   - `in progress` with subtask progress → `<closed>/<total> subtareas listas`.
   - Other → italicized status name as fallback.

   Keep notes short (≤80 chars). Don't fabricate — if comments don't reveal a reason for `on hold`, fall back to `_on hold_` rather than guessing.

Attach `reason` to each task in `not_achieved`. Attach `status_note` to each non-closed short-term task.

## Step 10 — Render Automated Placeholders

Build `<workspace>/.cache/render-data.json`:
```json
{
  "first_run": <bool>,
  "achieved": [{"name": "...", "url": "...", "percentage": <int>}, ...],
  "not_achieved": [{"name": "...", "url": "...", "reason": "..."}, ...],
  "short_term": [{"name": "...", "url": "...", "due_date": "<iso-or-null>", "status_type": "<closed|open|custom|...>", "status_name": "<human status string>", "status_note": "<short note for non-closed items>"}, ...]
}
```

`short_term` is built from the union task set (any task with a `due_date`). Pass through:
- `status_type` and `status_name` so the renderer can strike through closed tasks AND any custom status listed in `closed_like_statuses` (the strikethrough wraps the **entire line** — date and link together).
- `status_note` (only for non-closed items) so the renderer appends ` — _<note>_` to give the reader context (pending prod, on hold reason, in QA, etc.). Closed-like items ignore `status_note`.

```bash
node <plugin-root>/bin/daily-slack-render.mjs \
  --data <workspace>/.cache/render-data.json \
  --closed-like-statuses <workspace>/.cache/closed-like-statuses.json
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

1. Write the compose inputs to disk so the script can read them deterministically:
   - `<workspace>/.cache/template-body.md` — the template body parsed in Step 3 (no frontmatter).
   - `<workspace>/.cache/render-output.json` — the `{achieved_goals, not_achieved_goals, short_term_goals}` JSON captured from Step 10.
   - `<workspace>/.cache/manual-fields.json` — a flat `{<field>: "<user-response>"}` object built from Step 12 answers.

2. Run the deterministic compose script. Do NOT substitute placeholders by LLM rewriting — the script preserves the rendered standard markdown (`**bold**` headers, `~~strike~~`, backticks around `[N%]` / `[YYYY-MM-DD]`, `<url|text>` hyperlinks, italic `_text_`) literally:
   ```bash
   node <plugin-root>/bin/daily-slack-compose.mjs \
     --template <workspace>/.cache/template-body.md \
     --render <workspace>/.cache/render-output.json \
     --manual <workspace>/.cache/manual-fields.json \
     > <workspace>/.cache/composed-body.md
   ```
   Do NOT post-process the composed file. Read it as-is for the next steps.

3. Build the allowlist file `<workspace>/.cache/url-allowlist.txt`: one URL per line for every `clickup_url` in the union task set, plus every URL value read from the involved `CLICKUP_TASK.json` files this run.

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
4. On approval, continue to Step 14b.

## Step 14b — Preview Round-Trip (when `preview_channel` is set)

If the channel template's frontmatter declares `preview_channel`, post the body to that target first so the user can verify the live Slack rendering before the real publish. Skip this step entirely when `preview_channel` is absent or empty.

1. Compose the preview payload as the body prefixed with a single banner line and a blank line:
   ```
   *[PREVIEW — sprint <sprint> for #<channel>]*

   <composed body>
   ```
2. Post via `mcp__claude_ai_Slack__slack_send_message` to `<preview_channel>`.
   - On unavailable, fall back to `mcp__plugin_slack_slack__slack_send_message`.
   - On both unavailable, ask via `question`: "Slack MCP is not available. Skip preview and publish directly, or abort? [skip-preview / abort]". On `abort`, stop and keep `status: draft`.
3. Ask via `question`: "Posted preview to `<preview_channel>`. Verify the formatting in Slack — does it render correctly? [yes / edit]".
4. On `edit`, return to Step 14 (the user provides feedback; we re-compose and re-preview). On `yes`, continue to Step 15.
5. Do NOT mutate the draft frontmatter for the preview post. The `published_at` and `status: published` transition belongs only to the real channel.

## Step 15 — Publish to Slack

1. Post via `mcp__claude_ai_Slack__slack_send_message` to `#<channel>`.
   - On unavailable, fall back to `mcp__plugin_slack_slack__slack_send_message`.
   - On both unavailable, tell the user: "Slack MCP is not available. The draft has been saved at `<path>` — you can post it manually."
2. On success: update the draft frontmatter to `status: published` and `published_at: <ISO-8601>`. The snapshot remains in frontmatter and rolls forward to the next run.
3. On failure: report the error, keep `status: draft`.
