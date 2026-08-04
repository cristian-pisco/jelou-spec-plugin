# Slack Channel Template

This is the meta-template for creating channel-specific Slack message templates.
Copy this file to `<workspace>/registry/slack/<channel-name>.md` and customize.

## Template Format

The file has two parts:

1. **YAML frontmatter** — defines channel name, manual fields, and their prompts
2. **Body** — the message structure with `{{placeholder}}` syntax

The published draft also stores `task_snapshots` in its frontmatter; that field
is managed automatically by the workflow — do not edit it by hand.

## Markdown convention (IMPORTANT)

The daily-slack pipeline posts via `mcp__plugin_slack_slack__slack_send_message`,
which uses **standard markdown** (not Slack mrkdwn). So the template body MUST
use:

- `**bold**` for headings (single `*text*` renders as italic in this tool)
- `~~strike~~` for strikethrough (the renderer emits this for closed items)
- `_italic_` for italic (works in both formats)

The renderer (`bin/daily-slack-render.mjs`) emits `**bold**` and `~~strike~~`
verbatim; the compose script preserves the template body literally; the URL
allowlist scan handles the `<url|name>` Slack hyperlink form.

## Spacing convention

For Slack readability, leave a blank line BEFORE and AFTER each question heading
in the body. Slack collapses adjacent blank lines, but the structure makes the
rendered message easier to scan and prevents adjacent placeholders from visually
running together.

```
**Question one?**

{{value_one}}


**Question two?**

{{value_two}}
```

## Placeholders

### Automated (filled from sprint task data)
- `{{achieved_goals}}` — tasks whose percentage rose since the last published draft, OR whose `date_closed` falls within the cutoff window, split into sub-buckets:
  - `- :ladybug: Issues` for tasks whose ClickUp `task_type` is `"Issue"` (case-insensitive).
  - `- :clipboard: Tareas` for every other task (including ones with no `task_type`).
  - `- :calendar: Meets` for the lines in the `meetings` manual field (one bullet per line). `meetings` is auto-filled from Google Calendar when the MCP is reachable (see daily-slack Step 11.0); the user is only prompted on fallback.

  Each task bullet is `` `[<%>]` <url|name> ``; meet bullets are the user's text verbatim. Sub-buckets with no items are omitted entirely. The percentage is **always numeric** — never a status string. Mapping rules: closed → 100, anything in `status_percentages` (e.g. "pending to production" → 90, "in qa" → 80) → mapped value, in-progress → subtask ratio. Because `meetings` is folded into this placeholder, the template body MUST NOT also include a separate `{{meetings}}` placeholder — that would duplicate the input.
- `{{not_achieved_goals}}` — tasks whose percentage did not advance. Format per task: `<name> — <auto-extracted reason>\n<url>`
- `{{short_term_goals}}` — sprint tasks with a due date. Format per task: `` `[<YYYY-MM-DD>]` <url|name> ``. Closed-like tasks render with the **entire line** wrapped in `~~...~~` (date and link together). Open tasks may include a status note: `` `[<YYYY-MM-DD>]` <url|name> — _<status note>_ `` (e.g., "pendiente a producción · PR repo#123 abierto").
- `{{tasks_by_status}}` — **every** sprint task owned by you, grouped by current status. Renders a bold header per status (`**Internal QA**`, `**In Progress**`, `**Pending To Production**`, …) followed by `` `[<%>]` <url|name> `` for each task in that group. Groups are sorted by descending max percentage; within a group, tasks sort by descending percentage then by name. Use this section when you want a static "status board" view in addition to the delta-driven `{{achieved_goals}}` / `{{not_achieved_goals}}`. Tasks without a `status_name` are omitted (the renderer cannot label them). When `max_closed_shown` is set (see below), the `Closed`/closed-like group is instead ranked by recency (`date_closed` descending) and trimmed to that many tasks; open / in-progress groups are never capped.

On the very first run for a channel (no prior published draft), `{{achieved_goals}}`
renders the first-run banner instead of an empty string.

### Manual (user is prompted)
- Any placeholder listed in `manual_fields` triggers an interactive prompt via `question` — except `meetings`, which is auto-filled from Google Calendar when available and only falls back to a prompt (daily-slack Step 11.0)
- The prompt text comes from `manual_prompts`
- User responses are inserted as-is with no formatting

## Optional frontmatter fields

### `closed_like_statuses` (array of strings)

Some teams use ClickUp custom statuses ("pending to production", "in review",
"ready to merge") that mean "done" even though the API reports
`status_type === "custom"`. Declare those status names here (case-insensitive)
and the workflow will treat any task in one of them as 100% complete:
- `bin/daily-slack-bucket.mjs` normalizes `percentage` to 100 and counts
  transitions into the list as `achieved`.
- `bin/daily-slack-render.mjs` strikes through the entire line (date + link)
  in `{{short_term_goals}}`.

### `status_percentages` (object: status name → 0-100)

For statuses that are *progressing* but not yet done, declare a target
percentage so `{{achieved_goals}}` always shows a number rather than a status
string. Example: `"pending to production": 90`, `"in qa": 80`. Status names
match case-insensitively. Closed-like statuses (above) take precedence and
always evaluate to 100.

### `cutoff_hours` (number, default 24)

How far back to look when surfacing tasks for `{{achieved_goals}}` based on
`date_closed`. The workflow computes `cutoff_ms = now − cutoff_hours·3600000`
and passes it to the bucketer; any task with `date_closed >= cutoff_ms` is
included in `achieved` even when the prior snapshot already had it at 100%.
This is what makes "achieved since yesterday" robust to multiple daily
updates per calendar day. Set to a smaller value (e.g. `12`) for teams that
publish a midday and an EOD daily.

### `max_closed_shown` (number)

Caps the `Closed`/closed-like group in `{{tasks_by_status}}` to the N
most-recently-closed tasks (ranked by `date_closed` descending). The full sprint
backlog can accumulate dozens of closed items over a sprint; this keeps the
status board scannable by showing only the latest completions. Open and
in-progress groups are never trimmed. Leave the field unset for no cap (the
group keeps every closed task, sorted by percentage then name — the prior
behavior).

### `preview_channel` (string)

Where the workflow can post a *preview* of the composed body before publishing
to the real channel. Accepts any Slack target the chat-post tool can address
(e.g., `#preview-dailies`, `@username` for a DM, or a channel ID). When set,
Step 14 of the workflow offers the preview as one option alongside publishing
directly to the real channel — the preview is a convenience, never a gate. On
`preview`, the body is posted to this target with a banner like
`*[PREVIEW — sprint <N> for #<channel>]*` and the user confirms the formatting
renders correctly before the real publish; on `publish`, the workflow goes
straight to the channel. Leave the field unset to drop the preview option
entirely.

## Example: dailies (Spanish dailyBrain)

```yaml
---
channel: "#dailies"
preview_channel: "@cristian.pisco"
cutoff_hours: 24
max_closed_shown: 3
closed_like_statuses:
  - "pending to production por feature flag"
status_percentages:
  "pending to production": 90
  "in qa": 80
  "qa review": 80
manual_fields:
  - energy
  - meetings
  - uncompleted_goals
  - planned_goals
manual_prompts:
  energy: "How's your energy today? (red / yellow / green emoji)"
  meetings: "Any meetings to mention? (e.g., Daily, 1:1, planning)"
  uncompleted_goals: "What didn't you finish since the last update? Why?"
  planned_goals: "What do you plan to achieve before the next daily?"
---
```

```
**#dailyBrain**

**¿Cómo está tu energía hoy?** :large_red_square::large_yellow_square::large_green_square:

{{energy}}


**¿Qué objetivos has logrado desde tu última actualización?**

{{achieved_goals}}


**¿Qué objetivos no has logrado desde tu última actualización? ¿Y por qué?**

{{uncompleted_goals}}


**¿Qué logros importantes tienes planeados para hoy y para la próxima actualización diaria?**

{{planned_goals}}


**¿Cuáles son tus metas a corto plazo (y ETA)?**

{{short_term_goals}}
```
