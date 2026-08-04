# Workflow: daily-slack

> Orchestrator workflow for `/jlu-daily-slack <sprint> #channel`
> Generate and post a sprint-scoped daily summary to Slack.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

> **Cache-file writes**: Every artifact written under `<workspace>/.cache/` in this workflow MUST be written via `Bash` (heredoc, `printf`, or shell redirect), NOT via the `Write` tool. `Write` refuses to overwrite a file that has not been read in the current session, so on every run after the first it errors with `File has not been read yet`. `Bash` has no such constraint, and cache files are ephemeral machine-generated artifacts that don't need the `Write` tool's safety net. The phrasing "Write `<workspace>/.cache/X`" below means "store to disk via Bash" — never invoke the `Write` tool against a `.cache/` path. (Outputs under `drafts/` and `registry/` continue to use the `Write` tool because the user reviews them and the read-before-write check protects against accidental data loss.)

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
   - `max_closed_shown` (optional number) — cap the `Closed`/closed-like group in `{{tasks_by_status}}` to the N most-recently-closed tasks (by `date_closed`). Absent ⇒ no cap (full status board, as before).
   - `preview_channel` (optional Slack channel or DM target like `#preview-dailies` or `@username`)

   Parse the body as the message template.
3. If missing, stop with: "No template found for #<channel>. Create one at `<workspace>/registry/slack/<channel>.md`. See `jelou/templates/slack-channel.md` for the format."
4. Write four cache files for downstream scripts:
   - `<workspace>/.cache/closed-like-statuses.json` — JSON array of `closed_like_statuses` values (use `[]` if the key is absent).
   - `<workspace>/.cache/status-percentages.json` — JSON object of `status_percentages` (use `{}` if absent).
   - `<workspace>/.cache/cutoff-ms.txt` — single-line file with the epoch-ms cutoff = `Date.now() − cutoff_hours·3600000`.
   - `<workspace>/.cache/max-closed-shown.txt` — single-line file with the `max_closed_shown` number, or an empty file when the key is absent (the renderer reads empty/non-numeric as "no cap").
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

The available ClickUp MCP exposes `clickup_filter_tasks(list_ids, ...)`, which filters server-side by `assignees`, `statuses`, and date ranges — but **not** by custom field. So the assignee half of `OR(assignees, Responsable)` is answerable straight from the list payload (it includes `assignees`), while the Responsable half still requires per-task hydration (6b.4) and post-filtering.

**6b.1 — Resolve the sprint list ID.**
- First, scan the plugin tasks collected in 6a: take the `list_id` from any one of their `CLICKUP_TASK.json` files. All tasks in the same sprint share the same list, so the first hit is sufficient.
- If 6a produced no plugin tasks, call `clickup_get_workspace_hierarchy` and find the list whose name matches `^Sprint <sprint-arg>\b` (case-insensitive). If exactly one match, use its id. If zero or multiple, ask via `question`: "Which ClickUp list is sprint `<sprint-arg>`? Paste the list ID or full name." and resolve from the response.

**6b.2 — Resolve the `Responsable` custom-field UUID.**
- From the same `CLICKUP_TASK.json` used in 6b.1, read `field_mappings.Responsable`.
- If unavailable (no plugin task), call `clickup_get_list(listId=<sprint-list-id>)` and find the custom field whose `name == "Responsable"`; use its `id`.

**6b.3 — Page through the sprint list.**
Call `clickup_filter_tasks(list_ids=[<sprint-list-id>], subtasks=false, include_closed=true, page=<n>)` starting at `page: 0`. Concatenate the results from each page into a single array. Stop when a page returns fewer items than the previous page or returns an empty array. Pass `include_closed=true` and do **not** pass a `statuses` filter — we want both open and closed tasks.

The list payload includes `id`, `name`, `url`, `status` (bare string), `assignees`, `due_date`, and `date_closed`, but omits `custom_fields`. It therefore answers the assignee half of ownership directly; the Responsable half is resolved by the targeted hydration in 6b.4.

**6b.4 — Hydrate only the non-assignee tasks.**
Write the concatenated 6b.3 list verbatim to `<workspace>/.cache/sprint-list-tasks.json`. This light dump already carries `id`, `name`, `url`, `status` (a bare string, e.g. `"Closed"` — **not** a `{status, type}` object), `assignees`, `due_date`, and `date_closed` for every sprint task.

Ownership is `OR(assignee, Responsable)`. The **assignee** half is already answered by the light dump (its `assignees` array — no fetch needed). The **Responsable** half needs `custom_fields`, which only `clickup_get_task(<id>, include:["custom_fields"])` returns — and each such call is ~150K chars (it bundles every dropdown's full `type_config`), so it exceeds the MCP token limit and the harness auto-dumps the payload to a file under the session `tool-results/` directory, returning only a short error to you. That dump is expected and fine — Step 6c reads the files directly; never try to read these payloads into context.

Therefore hydrate **only the tasks where `user_id` is NOT already in `assignees`** — those are the only ones whose ownership is still unknown. Fan out one `clickup_get_task(<id>, include:["custom_fields"])` per such task, all in a single multi-tool message, never one-at-a-time. Do **not** hydrate tasks the user already assigns: that per-task fetch is the single biggest time sink in this workflow, and their ownership is already settled by the light dump.

> **Trade-off (deliberate).** Assignee-owned tasks are not hydrated, so their `task_type` resolves to `null` (→ Tareas bucket) and their `percentage` comes from the status invariants (closed-like → 100, `status_percentages` → mapped, else 0) rather than a subtask ratio. This is the intended cost of skipping the heavy fetch for tasks the user already owns; closed and status-mapped tasks — the vast majority — are unaffected. If you need the granular subtask ratio for an in-progress assignee task, hydrate it too and it flows through unchanged.

### 6c. Assemble `current-tasks.json` via `bin/daily-slack-assemble.mjs`
**Do not hand-build this file.** Ad-hoc inline `node`/`jq` assembly is where the status-shape bug (`[0%]` on closed tasks) and `process.env`-not-exported failures came from. The assembler is deterministic and unit-tested.

First, build `<workspace>/.cache/plugin-tasks.json`: a JSON array of the **plugin** task objects from 6a, each already shaped as a current-task entry — `{clickup_id, name, url, percentage, status_type, status_name, task_type, due_date, date_closed, date_updated, source: "plugin", slug, pr_urls}`. For plugin tasks compute `percentage` as `(closed_subtasks / total_subtasks) × 100`, upgraded to `100` when `gh pr view <url> --json state` reports all PRs merged (fan every `gh pr view` out in parallel from one Bash command via `xargs -P` or `&`/`wait`). Override `name` with the SPEC.md first heading when available. Plugin tasks that are absent from the sprint list (rare) still belong here.

Resolve the `Tipo Proyecto` custom-field UUID (`--tipo-field-id`) the same way as 6b.2: from a plugin task's `field_mappings` if present, else via `clickup_get_custom_fields(list_id=<sprint-list-id>)` matching the field named `Tipo Proyecto`. Omit the flag entirely if the field doesn't exist.

```bash
node <plugin-root>/bin/daily-slack-assemble.mjs \
  --list <workspace>/.cache/sprint-list-tasks.json \
  --hydrated-dir <tool-results-dir-from-the-6b.4-dump-paths> \
  --user-id <user_id-from-step-4> \
  --responsable-field-id <responsable-field-uuid-from-6b.2> \
  --tipo-field-id <tipo-proyecto-field-uuid> \
  --plugin-tasks <workspace>/.cache/plugin-tasks.json \
  --closed-like-statuses <workspace>/.cache/closed-like-statuses.json \
  --status-percentages <workspace>/.cache/status-percentages.json \
  > <workspace>/.cache/current-tasks.json
```

The assembler applies `OR(assignee, Responsable)` (assignees from `--list`, Responsable from the hydrated payloads), normalizes the bare-string `status` into `{status_name, status_type}` (deriving `closed`/`open`/`custom` from the name when no `status.type` object is present), resolves `task_type` from the `Tipo Proyecto` dropdown, computes the in-progress `percentage` fallback (closed-like → 100, `status_percentages` → mapped, subtask ratio, else 0), excludes plugin ids from the clickup-only set, and appends the plugin tasks verbatim. `--hydrated-dir` is the session `tool-results/` directory the 6b.4 dump paths point at; the assembler reads only the `get_task` payloads there (newest per id) and ignores everything else. If a small sprint returned the `get_task` payloads inline instead of dumping them, write them to one array and pass `--hydrated <file>` (alone or alongside `--hydrated-dir`).

> **Why hydrate before assembling.** The light `clickup_filter_tasks` payload omits `custom_fields`, so ownership-by-Responsable can't be evaluated from it — every Responsable-only task would be silently dropped. 6b.4 hydrates exactly the non-assignee tasks so the OR filter actually sees Responsable.

## Step 7 — Resolve Cutoff and Snapshot

1. Glob `<workspace>/drafts/slack/*-<channel>.md`.
2. For each file, read frontmatter; filter by `status: published`.
3. Pick the entry with the latest `published_at`. Its `published_at` is the cutoff timestamp regardless of which snapshot you end up using below.
4. Choose the baseline snapshot: use the latest published report's `task_snapshots` map. **If that map is empty or missing** (a known gap from older runs that published without persisting it), fall back to the most recent published report whose `task_snapshots` map is non-empty, and use ITS map as the baseline (keep the latest report's `published_at` as the cutoff). Write the chosen map to `<workspace>/.cache/snapshot-<sprint>-<channel>.json`.
5. Only when NO published report carries a non-empty `task_snapshots` map: create no snapshot file and treat the run as first-run (cutoff = null). Do not let an empty snapshot from the latest report alone trigger first-run — that would collapse every closed task into `achieved`.

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

## Step 10 — Check Existing Draft

Look for `<workspace>/drafts/slack/<sprint>-<channel>.md`:
- `status: draft` → ask via `question`: "A draft exists for sprint <sprint> on #<channel>. Resume editing it, or regenerate?". On resume, load the body and skip to Step 14.
- `status: published` → ask: "This sprint already has a published report on #<channel>. Re-post it, or regenerate?". On re-post, skip to Step 15. On regenerate, continue to Step 11.

## Step 11 — Manual Fields (calendar auto-fill + prompts)

Manual fields resolve **before** the render step so the renderer can fold the `meetings` answer directly into `{{achieved_goals}}` as the `:calendar: Meets` sub-bucket.

### 11.0 — Auto-fill `meetings` from Google Calendar

Runs only when `meetings` is present in `manual_fields`. On success the `meetings` prompt in 11.1 is skipped entirely — the calendar is the source of truth (full automatic replacement, per design 2026-08-04).

1. `ToolSearch` for `select:mcp__claude_ai_Google_Calendar__list_events` (lazy — only here, never at bootstrap). Zero matches → fallback (point 6).
2. Compute the window (previous business day — Monday reports Friday, weekend runs report Friday):
   ```bash
   node <plugin-root>/bin/daily-slack-meetings-window.mjs
   ```
   Capture stdout JSON `{timeMin, timeMax}`.
3. Call `mcp__claude_ai_Google_Calendar__list_events` with `startTime=<timeMin>`, `endTime=<timeMax>`, `orderBy: "startTime"`, `pageSize: 100`, no `calendarId` (primary calendar). If the response carries `nextPageToken`, keep calling with `pageToken` and concatenate the event arrays until exhausted.
4. Write the concatenated events as a JSON array to `<workspace>/.cache/calendar-events.json` (via Bash — cache-file rule). Do NOT filter, dedupe, or drop any event: every event in the window is included by design.
5. Format deterministically and store the result:
   ```bash
   node <plugin-root>/bin/daily-slack-format-meetings.mjs \
     --events <workspace>/.cache/calendar-events.json
   ```
   Store stdout verbatim as the `meetings` answer (empty stdout ⇒ `meetings: ""`, which makes the renderer omit the Meets sub-bucket — do not re-prompt). Do NOT hand-format event lines; the formatter owns the `<summary> (HH:MM–HH:MM)` shape.
6. **Fallback.** On ToolSearch miss, any `list_events` error (including mid-pagination — discard partial pages), or a non-zero exit from either bin: print one line — `[daily-slack] Google Calendar unavailable — falling back to manual meetings prompt` — and let 11.1 prompt `meetings` manually as before. Never block or abort the workflow because of Calendar.

### 11.1 — Prompt the remaining manual fields

For each field in `manual_fields` (in order), skipping `meetings` when 11.0 succeeded:
1. Read prompt from `manual_prompts.<field>`.
2. For `planned_achievements`, append helper context to the prompt: a comma-separated list of stuck task names from Step 8. Example: `(in progress: Migration, API node)`.
3. Ask via `question` and store the response.

Write the flat answers map (including the auto-filled `meetings`) to `<workspace>/.cache/manual-fields.json` before continuing to Step 12 — the renderer reads `meetings` from this file.

## Step 12 — Render Automated Placeholders

Build `<workspace>/.cache/render-data.json`:
```json
{
  "first_run": <bool>,
  "achieved": [{"name": "...", "url": "...", "percentage": <int>, "task_type": "<Issue|Improvement|Task|...>"}, ...],
  "not_achieved": [{"name": "...", "url": "...", "reason": "..."}, ...],
  "short_term": [{"name": "...", "url": "...", "due_date": "<iso-or-null>", "status_type": "<closed|open|custom|...>", "status_name": "<human status string>", "status_note": "<short note for non-closed items>"}, ...],
  "all_tasks": [{"name": "...", "url": "...", "percentage": <int>, "status_type": "...", "status_name": "...", "date_closed": <epoch-ms-or-null>}, ...],
  "meetings": "<raw multi-line text from manual-fields.json, one meet per line>"
}
```

`achieved` carries `task_type` through from the bucketer so the renderer can split items into the `:ladybug: Issues` and `:clipboard: Tareas` sub-buckets under `{{achieved_goals}}`. Anything whose `task_type` matches `"issue"` (case-insensitive) lands under Issues; everything else — including tasks with no `task_type` at all — lands under Tareas.

`short_term` is built from the union task set (any task with a `due_date`). Pass through:
- `status_type` and `status_name` so the renderer can detect closed tasks AND any custom status listed in `closed_like_statuses`. With `--drop-completed` (below) those completed items are **dropped** from the short-term list entirely — short-term goals are "what's still pending", recent completions already show under `{{achieved_goals}}` and the board, and dropping them keeps the message under Slack's ~5000-char budget.
- `status_note` (only for non-closed items) so the renderer appends ` — _<note>_` to give the reader context (pending prod, on hold reason, in QA, etc.). Closed-like items ignore `status_note`.

`all_tasks` is the **entire** union (every task in the sprint that survived discovery), regardless of `due_date` or bucket. It drives the `{{tasks_by_status}}` placeholder which groups tasks by their current `status_name` and shows the daily reader where every sprint item lives — not just deltas. Use the normalized `percentage` from Step 8 (post `status_percentages` and `closed_like_statuses` mapping) so each badge stays a numeric `[N%]`. Pass `date_closed` through (epoch-ms or null) so the renderer can rank the closed group by recency when `max_closed_shown` is set.

`meetings` is the verbatim string from `manual-fields.json` (one meet per line, e.g. `:repeat: Daily`). When the field is missing, empty, or whitespace-only the renderer omits the Meets sub-bucket entirely. The renderer parses lines itself — do **not** pre-format. Because meetings are folded into `{{achieved_goals}}`, the template body MUST NOT include a separate `{{meetings}}` placeholder; rendering it twice would duplicate the user's input.

```bash
node <plugin-root>/bin/daily-slack-render.mjs \
  --data <workspace>/.cache/render-data.json \
  --closed-like-statuses <workspace>/.cache/closed-like-statuses.json \
  --max-closed "$(cat <workspace>/.cache/max-closed-shown.txt)" \
  --drop-completed
```

`--max-closed` caps the `Closed`/closed-like group in `{{tasks_by_status}}` to the N most recently closed tasks (by `date_closed`). An empty or non-numeric value means no cap, so channels without `max_closed_shown` keep the full board.

`--drop-completed` removes closed-like items from `{{short_term_goals}}` instead of striking them through. Short-term is the pending-work list, so completed items are noise there — and on a sprint with many closed tasks the struck-through lines alone would blow the ~5000-char Slack budget (forcing a recompose). Recent completions still surface under `{{achieved_goals}}` and `{{tasks_by_status}}`.

Capture stdout JSON: `{achieved_goals, not_achieved_goals, short_term_goals, tasks_by_status}`.

## Step 13 — Compose, Save, and Scan

1. Write the compose inputs to disk so the script can read them deterministically:
   - `<workspace>/.cache/template-body.md` — the template body parsed in Step 3 (no frontmatter).
   - `<workspace>/.cache/render-output.json` — the `{achieved_goals, not_achieved_goals, short_term_goals, tasks_by_status}` JSON captured from Step 12.
   - `<workspace>/.cache/manual-fields.json` — the flat `{<field>: "<user-response>"}` object already written in Step 11.

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
