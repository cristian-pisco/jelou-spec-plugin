# Post-Slack Command Redesign

## Problem Statement

The `/jlu:post-slack` command doesn't work. The current implementation references infrastructure that doesn't exist (`.spec-workspace` observability logs, channel template registry) and delegates to a `jlu-slack-agent` that generates a generic format instead of the specific #dailyBrain standup structure required. The command needs to be rebuilt as a template-driven orchestrator that gathers real task data from workspace artifacts and interactively collects manual fields from the user.

## Requirements

### Functional

1. **FR-1**: Parse arguments `[date] #channel`. Date defaults to today (`dd-mm-yyyy`). Channel is mandatory; prompt if missing.
2. **FR-2**: Resolve workspace by reading `.spec-workspace.json` (search cwd then up to 5 parent levels), extract the `workspace` path field, and resolve it to an absolute path.
3. **FR-3**: Load channel-specific template from `<workspace>/registry/slack/<channel>.md`.
4. **FR-4**: If no template exists for the channel, inform the user and stop: `"No template found for #<channel>. Create one at <path>/registry/slack/<channel>.md"`.
5. **FR-5**: Scan `<workspace>/specs/<date>/` to discover task folders.
6. **FR-6**: For each task, read `SPEC.md` (title), `CLICKUP_TASK.json` (macroTask URL, subtask IDs, PR URLs).
7. **FR-7**: Calculate task completion percentage:
   - If `CLICKUP_TASK.json.subtasks` is an empty array (initial template state) or empty object, treat as no ClickUp subtasks and use the TASKS.md phase fallback.
   - Otherwise, query ClickUp via MCP (`clickup_get_task`) for each subtask. A subtask is "closed" when its `status.type == "closed"` (not string matching — this handles custom status names like "Done", "Complete", etc.).
   - `(closed / total) × 90%` = base progress.
   - If all stories closed: check PR merge via `gh pr view --json state`. Merged → 100%. Not merged → 90%.
   - No stories → 0%.
   - No ClickUp subtasks synced → fall back to TASKS.md phase progress: `(done phases / total phases) × 90%`.
8. **FR-8**: If a task has no ClickUp link, leave it blank and warn user: `"⚠ No ClickUp link for task <slug> — please add manually."`.
9. **FR-9**: Auto-fill automated template placeholders (`completed_goals`, `short_term_goals`) from task data. `completed_goals` lists all tasks from the date folder with their current progress percentage — it represents "progress on goals" rather than only fully completed tasks.
10. **FR-10**: For each manual field defined in the template frontmatter, prompt the user interactively one by one.
11. **FR-11**: Compose the full message by rendering the template with all placeholders filled.
12. **FR-12**: Save draft to `<workspace>/drafts/slack/<date>-<channel>.md` with YAML frontmatter (`channel`, `date`, `status: draft`). Create the `<workspace>/drafts/slack/` directory if it does not exist.
13. **FR-13**: If a draft already exists for this date+channel:
    - `draft` → ask user to resume or regenerate.
    - `published` → inform user, ask if they want to re-post.
14. **FR-14**: Present the composed draft to the user for review. Allow edits.
15. **FR-15**: On user approval, post via Slack MCP `mcp__claude_ai_Slack__slack_send_message` to the target channel. (If the `claude_ai_Slack` server is unavailable, try `mcp__plugin_slack_slack__slack_send_message` as fallback.)
16. **FR-16**: Update draft status to `published` with timestamp after successful post.

### Non-Functional

1. **NFR-1**: No agent delegation. The SKILL.md orchestrator handles the entire flow directly.
2. **NFR-2**: Channel templates are the extension point. Adding a new channel = creating a new template file.
3. **NFR-3**: Message content must use Slack-compatible mrkdwn (bold with `*`, no `**` headers).
4. **NFR-4**: Manual fields are inserted as-is into the rendered template, with no additional formatting applied by the skill.

## SKILL.md Frontmatter

```yaml
---
name: Post Slack
description: Generate and post daily summary to Slack
argument-hint: "[date] #channel"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
  - mcp__clickup__clickup_get_task
  - mcp__claude_ai_Slack__slack_send_message
  - mcp__plugin_slack_slack__slack_send_message
model: sonnet
---
```

Note: `Agent` is explicitly removed (per NFR-1). Both Slack MCP servers are listed to handle environment variations.

## Architecture

### Workspace Resolution

```
cwd → parent → parent → ... (up to 5 levels)
       ↓
  .spec-workspace.json found?
       ↓ yes
  Read "workspace" field → workspace root path
```

### Data Flow

```
1. Parse args (date, channel)
2. Resolve workspace
3. Load template: <workspace>/registry/slack/<channel>.md
4. Check existing draft: <workspace>/drafts/slack/<date>-<channel>.md
5. Scan task folders: <workspace>/specs/<date>/*/
6. For each task:
   ├── Read SPEC.md → title
   ├── Read CLICKUP_TASK.json → macroTask.url, subtasks, pr
   ├── Query ClickUp MCP → subtask statuses
   ├── Run gh pr view → merge status
   └── Calculate percentage
7. Auto-fill: completed_goals, short_term_goals
8. Prompt user: manual_fields (energy, meetings, etc.)
9. Render template → composed message
10. Save draft
11. Present for review
12. On approval → Slack MCP post → update draft status
```

### Task Progress Calculation

```
subtasks = CLICKUP_TASK.json.subtasks
# If subtasks is [] (initial template state) or {}, treat as no subtasks
if subtasks is empty array or empty object:
    stories_total = 0
else:
    # Iterate over object values: for (slug, info) in subtasks
    # Query clickup_get_task(info.id) for each, check status.type
    stories_closed = count where status.type == "closed"
    stories_total  = count of subtasks

if stories_total == 0:
    # Fallback: use TASKS.md phase progress
    phases_done  = count of phases with status "done"
    phases_total = total phases
    percentage   = round((phases_done / phases_total) * 90)
else:
    percentage = round((stories_closed / stories_total) * 90)

if percentage == 90:
    # All stories closed, check PR(s)
    # If task has multiple PRs (multi-service), ALL must be merged for 100%
    pr_map = CLICKUP_TASK.json.pr or TASKS.md External Links
    all_merged = true
    for each (service_id, pr_url) in pr_map:
        if not (gh pr view pr_url --json state).state == "MERGED":
            all_merged = false
    if pr_map is not empty and all_merged:
        percentage = 100
```

## Channel Template Format

Templates live at `<workspace>/registry/slack/<channel>.md`.

### Frontmatter

```yaml
---
channel: "#dailies"
manual_fields:
  - energy
  - meetings
  - incomplete_goals
  - planned_achievements
manual_prompts:
  energy: "How's your energy today?"
  meetings: "Any meetings to report? (short description you can autocomplete)"
  incomplete_goals: "What goals haven't you completed since your last update? And why?"
  planned_achievements: "What important achievements do you have planned for today and for the next daily update?"
---
```

### Body

The message structure with placeholders:

```markdown
#dailyBrain
{{energy}}

What goals have you completed since your last update?

{{completed_goals}}

Meetings

{{meetings}}

What goals haven't you completed since your last update? And why?

{{incomplete_goals}}

What important achievements do you have planned for today and for the next daily update?

{{planned_achievements}}

What are your short-term goals (and ETA)?

{{short_term_goals}}
```

### Automated Placeholder Rendering

**`completed_goals`** — one block per task:
```
[90%] Decouple sprint from date
https://app.clickup.com/t/abc123
```

**`short_term_goals`** — one line per task with deadline:
```
[2026-03-25] Decouple sprint from date https://app.clickup.com/t/abc123
```

Deadline is sourced from the ClickUp macroTask `due_date` field (queried via MCP `clickup_get_task`). If the task has no due date set in ClickUp, omit the date prefix and render as:
```
Decouple sprint from date https://app.clickup.com/t/abc123
```

## Draft Persistence

### Location

`<workspace>/drafts/slack/<date>-<channel>.md`

Example: `<workspace>/drafts/slack/19-03-2026-dailies.md`

### Format

```markdown
---
channel: "#dailies"
date: 19-03-2026
status: draft
published_at:
---

<composed message content>
```

### States

- `draft` — initial generation, can be edited or regenerated
- `published` — posted to Slack, `published_at` timestamp set

## Files Changed

### Modified

- `skills/post-slack/SKILL.md` — full rewrite with new orchestration logic

### Deleted

- `agents/jlu-slack-agent.md` — replaced by direct orchestration in SKILL.md

### Created

- `jelou/templates/slack-channel.md` — meta-template for creating new channel templates. Content mirrors the Channel Template Format section: YAML frontmatter with `channel`, `manual_fields`, `manual_prompts`, and a body with `{{placeholder}}` syntax. Serves as documentation and copy-paste starting point.
- First concrete template created at install time by the user: `<workspace>/registry/slack/dailies.md`

## Constraints

- Workspace must exist (`.spec-workspace.json` reachable from cwd).
- ClickUp MCP must be available for subtask status queries. If unavailable, fall back to phase-based progress.
- Slack MCP must be available for posting. If unavailable, save draft and inform user to post manually.
- `gh` CLI must be available for PR merge checks. If unavailable, assume not merged (cap at 90%).

## Out of Scope

- Creating or managing `.spec-workspace.json` (handled by `/jlu:new-task`).
- ClickUp sync (handled by `/jlu:sync-clickup`).
- Multi-workspace support (one workspace per project).
- Scheduling recurring posts (manual invocation only).

## Success Criteria

1. Running `/jlu:post-slack #dailies` produces a correctly formatted #dailyBrain standup message populated with real task data from the workspace.
2. Percentage calculation matches the closed-stories + PR-merge logic.
3. User is prompted for each manual field before the draft is composed.
4. Draft is saved and can be resumed on re-run.
5. Message is posted to Slack via MCP after user confirmation.
6. Adding a new channel requires only creating a new template file — no code changes.
