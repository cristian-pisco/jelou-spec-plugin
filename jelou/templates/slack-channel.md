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

## Example: dailies (Spanish dailyBrain)

```yaml
---
channel: "#dailies"
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
