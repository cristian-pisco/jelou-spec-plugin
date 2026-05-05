# Slack Channel Template

This is the meta-template for creating channel-specific Slack message templates.
Copy this file to `<workspace>/registry/slack/<channel-name>.md` and customize.

## Template Format

The file has two parts:

1. **YAML frontmatter** — defines channel name, manual fields, and their prompts
2. **Body** — the message structure with `{{placeholder}}` syntax

The published draft also stores `task_snapshots` in its frontmatter; that field
is managed automatically by the workflow — do not edit it by hand.

## Spacing convention

For Slack readability, leave a blank line BEFORE and AFTER each question heading
in the body. Slack mrkdwn collapses adjacent blank lines, but the structure makes
the rendered message easier to scan and prevents adjacent placeholders from
visually running together.

```
*Question one?*

{{value_one}}


*Question two?*

{{value_two}}
```

## Placeholders

### Automated (filled from sprint task data)
- `{{achieved_goals}}` — tasks whose percentage rose since the last published draft. Format per task: `` `[<%>]` <url|name> `` (Slack hyperlink)
- `{{not_achieved_goals}}` — tasks whose percentage did not advance. Format per task: `<name> — <auto-extracted reason>\n<url>`
- `{{short_term_goals}}` — sprint tasks with a due date. Format per task: `` `[<YYYY-MM-DD>]` <url|name> ``. Closed tasks render as `` `[<YYYY-MM-DD>]` ~<url|name>~ `` (strikethrough)

On the very first run for a channel (no prior published draft), `{{achieved_goals}}`
renders the first-run banner instead of an empty string.

### Manual (user is prompted)
- Any placeholder listed in `manual_fields` triggers an interactive prompt via `question`
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
- `bin/daily-slack-render.mjs` strikes through the link in
  `{{short_term_goals}}`.

### `preview_channel` (string)

Where the workflow posts a *preview* of the composed body before publishing
to the real channel. Accepts any Slack target the chat-post tool can address
(e.g., `#preview-dailies`, `@username` for a DM, or a channel ID). When set,
Step 14 of the workflow posts the rendered body there with a banner like
`*[PREVIEW — sprint <N> for #<channel>]*`, asks the user to confirm the
formatting renders correctly in Slack, and only then publishes to the real
channel. Leave the field unset to skip the preview round-trip.

## Example: dailies (Spanish dailyBrain)

```yaml
---
channel: "#dailies"
preview_channel: "@cristian.pisco"
closed_like_statuses:
  - "pending to production"
  - "in review"
  - "ready to merge"
manual_fields:
  - energy
  - meetings
  - planned_achievements
manual_prompts:
  energy: "How's your energy today? (red / yellow / green emoji)"
  meetings: "Any meetings to mention? (e.g., Daily, 1:1, planning)"
  planned_achievements: "What do you plan to achieve before the next daily?"
---
```

```
*#dailyBrain*

*¿Cómo está tu energía hoy?* :large_red_square::large_yellow_square::large_green_square:

{{energy}}


*¿Qué objetivos has logrado desde tu última actualización?*

{{achieved_goals}}


*Reuniones*

{{meetings}}


*¿Qué objetivos no has logrado desde tu última actualización? ¿Y por qué?*

{{not_achieved_goals}}


*¿Qué logros importantes tienes planeados para hoy y para la próxima actualización diaria?*

{{planned_achievements}}


*¿Cuáles son tus metas a corto plazo (y ETA)?*

{{short_term_goals}}
```
