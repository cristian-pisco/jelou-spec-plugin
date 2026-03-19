# Slack Channel Template

This is the meta-template for creating channel-specific Slack message templates.
Copy this file to `<workspace>/registry/slack/<channel-name>.md` and customize.

## Template Format

The file has two parts:

1. **YAML frontmatter** — defines channel name, manual fields, and their prompts
2. **Body** — the message structure with `{{placeholder}}` syntax

## Placeholders

### Automated (filled from task data)
- `{{completed_goals}}` — task progress: `[percentage%] task-name\nclickup-url`
- `{{short_term_goals}}` — task deadlines: `[deadline] task-name clickup-url`

### Manual (user is prompted)
- Any placeholder listed in `manual_fields` triggers an interactive prompt
- The prompt text comes from `manual_prompts`
- User responses are inserted as-is with no formatting

## Example

```yaml
---
channel: "#channel-name"
manual_fields:
  - field_one
  - field_two
manual_prompts:
  field_one: "Prompt shown to the user for field one?"
  field_two: "Prompt shown to the user for field two?"
---
```

```
Section header

{{field_one}}

Another section

{{completed_goals}}

{{field_two}}

Goals section

{{short_term_goals}}
```
