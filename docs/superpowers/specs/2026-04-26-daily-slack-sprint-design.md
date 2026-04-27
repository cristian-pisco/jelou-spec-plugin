# Daily Slack — Sprint-Scoped Rebuild

**Status:** Design — pending user review
**Replaces:** `/jlu-post-slack` (date-scoped)
**New command:** `/jlu-daily-slack <sprint> #channel`
**Spec date:** 2026-04-26

## Problem Statement

The current `/jlu-post-slack` command is date-scoped: it walks `<workspace>/specs/<date>/` for task folders worked that day. The real reporting need is sprint-scoped: the daily Slack post at 8 AM must reflect every task the user owns in the current sprint, not just the folder corresponding to a single date. Sprint tasks span multiple days; production merges often land the day after implementation; and some sprint tasks the user owns are not produced via this plugin at all (manual ClickUp entries). The command also lacks a "since last update" delta — every run re-emits the same flat list. The redesign rebuilds the command around sprint membership, persists per-task percentage snapshots in published drafts to drive a day-over-day delta, auto-categorizes tasks into achieved/not-achieved buckets, auto-extracts "why" reasons from ClickUp comments and PR state, and hard-guards the rendered output against invented ClickUp URLs.

## Requirements

### Functional

1. **FR-1**: Argument shape `/jlu-daily-slack <sprint> #channel`. Sprint is required (string, typically a number). Channel is required and must start with `#`. Prompt for either if missing.
2. **FR-2**: Resolve workspace via `.spec-workspace.json` (search cwd up to 5 parent levels), extract `workspace` field, resolve to absolute path.
3. **FR-3**: Resolve ClickUp user identity from `<workspace>/registry/clickup-user.json`. If missing or `user_id` is empty, prompt for email, call `clickup_get_workspace_members`, match case-insensitively, persist `{email, user_id, username}`. **The orchestrator MUST NOT use any value from prior conversations, memory, environment variables, or hardcoded constants for the email.**
4. **FR-4**: Verify ClickUp MCP via `clickup_get_workspace_hierarchy` connectivity probe. On failure, abort with the same message text used by `/jlu-sync-clickup` Step 0.
5. **FR-5**: Discover sprint tasks as the union of:
   - **Plugin tasks**: walk `<workspace>/specs/*/CLICKUP_TASK.json`. Include if `sprint == <arg>` (string comparison). Ownership is trusted — plugin tasks were created by the local user via `/jlu-new-task`, and `CLICKUP_TASK.json` does not persist assignee data anyway.
   - **ClickUp-only tasks**: query ClickUp for tasks where `Sprint` custom field == `<arg>` AND (assignees contains user_id OR `Responsable` custom field == user_id). Add any not already present in the plugin set.
   - Deduplicate by ClickUp task ID. Try the bare sprint value against the `Sprint` custom field first; if zero matches, retry with `Sprint <arg>` as a string fallback.
6. **FR-6**: Load channel template at `<workspace>/registry/slack/<channel>.md`. Abort with pointer to `jelou/templates/slack-channel.md` if missing.
7. **FR-7**: Build a per-task struct with: `source` (`plugin`|`clickup-only`), `clickup_id`, `clickup_url`, `name`, `slug`, `percentage`, `status_type`, `due_date`, `pr_urls`, `pr_states`, `latest_comments`, `date_updated`. Every URL is sourced only from `clickup_get_task` responses or `CLICKUP_TASK.json.macroTask.url` — never invented.
8. **FR-8**: Calculate `percentage`:
   - Plugin tasks: `(closed_subtasks / total_subtasks) × 90`; if all PRs merged via `gh pr view --json state`, upgrade to 100.
   - ClickUp-only tasks: `(closed_subtasks / total_subtasks) × 90`; no PR upgrade. If no subtasks, 0.
9. **FR-9**: Resolve cutoff timestamp:
   - Glob `<workspace>/drafts/slack/*-<channel>.md`, filter by `status: published` in frontmatter, pick latest `published_at`. The cutoff applies across sprints — a switch from sprint 23 to 24 still uses sprint 23's last published draft as the baseline.
   - **First-run case** (no prior published draft for this channel): cutoff = null. All tasks land in `not_achieved`. The `{{achieved_goals}}` empty-state string is overridden to the first-run banner (see FR-13).
10. **FR-10**: Bucket tasks against the cutoff snapshot. Order of operations: (a) call `clickup_get_task` for every task in the union set to populate percentage/status/due_date; (b) compute the bucket assignment below; (c) only then fetch comments + PR state for the stuck set (FR-11).
    - **Achieved**: `current.percentage > snapshot.percentage` OR (`snapshot.status_type != "closed"` AND `current.status_type == "closed"`). Tasks not in the snapshot but at percentage > 0 are achieved.
    - **Not achieved**: in snapshot AND `percentage` unchanged AND `status_type != "closed"`. Tasks not in the snapshot at percentage 0 also go here. Regressions (`current.percentage < snapshot.percentage`) go here.
    - Tasks in snapshot but no longer in current sprint set are dropped silently.
11. **FR-11**: After bucketing, for tasks in the not-achieved bucket only: fetch via `clickup_get_task_comments` (latest 1-2 after cutoff, fallback to most recent overall) and `gh pr view <url> --json state,isDraft,mergeable` for plugin tasks with PRs. Skip on errors.
12. **FR-12**: Auto-extract a one-line "why" reason per stuck task by priority. Comments are user-generated text and may be in any language — they pass through verbatim (truncated). Only the canned strings are guaranteed Spanish.
    1. Latest ClickUp comment after cutoff (truncated to 200 chars, verbatim).
    2. PR state (Spanish canned): `esperando revisión` (open, not draft) / `aún en borrador` (draft) / `con conflictos de merge` (mergeable=false) / `CI fallando` (state=open with failing checks).
    3. Most recent ClickUp comment overall (truncated, verbatim).
    4. Fallback (Spanish canned): `sin actualizaciones recientes — agregar razón manual`.
13. **FR-13**: Render automated placeholders:
    - `{{achieved_goals}}` — one block per achieved task: `[<%>] <name>\n<url>`. Empty → `_Sin avances desde la última actualización._`. **First-run override**: when cutoff is null, render `_Primer reporte del sprint — sin línea base para comparar._` instead of either the achieved blocks or the standard empty string.
    - `{{not_achieved_goals}}` — one block per stuck task: `<name> — <reason>\n<url>`. Empty → `_Todas las tareas avanzaron._`
    - `{{short_term_goals}}` — one line per current sprint task with a due date: `[<YYYY-MM-DD>] <name> <url>`, sorted ascending. Tasks without due dates omitted.
14. **FR-14**: Prompt manual fields via `question` in order: `energy`, `meetings`, `planned_achievements`. The `planned_achievements` prompt shows the stuck-task list as helper context.
15. **FR-15**: Substitute placeholders into the template body via simple string replacement. Manual user input is inserted verbatim.
16. **FR-16**: Run URL safety scan over the composed body (after all substitutions, including manual user input):
    - Build `allowed_clickup_urls` = set of every `clickup_url` in the per-task structs plus every URL value read from `CLICKUP_TASK.json` files this run.
    - Regex: `https?://app\.clickup\.com/t/[^\s)]+`. Normalize each match (strip trailing punctuation, query strings).
    - Any match not in the allowlist → fatal abort: `Link safety check failed: rendered output contains unknown ClickUp URL: <url>. Aborting to prevent invented links.` No fallback, no retry.
    - The scan applies to manual-field input as well (intentional). If a user types an unknown ClickUp URL, the abort fires — they can correct or remove it and re-run.
17. **FR-17**: Check existing draft at `<workspace>/drafts/slack/<sprint>-<channel>.md`:
    - `draft` → ask resume or regenerate.
    - `published` → ask re-post or regenerate. Re-post sends the existing body unchanged.
18. **FR-18**: Save the draft to `<workspace>/drafts/slack/<sprint>-<channel>.md` with frontmatter:
    ```yaml
    channel: "#<channel>"
    sprint: <sprint>
    status: draft
    published_at:
    task_snapshots:
      <clickup-id>:
        name: "..."
        url: "..."
        percentage: <int>
        status_type: "..."
    ```
19. **FR-19**: Present composed body for user review with edit loop. On edit, persist updated body to the draft file and re-present.
20. **FR-20**: On approval, post via Slack MCP (`mcp__claude_ai_Slack__slack_send_message` first, fall back to `mcp__plugin_slack_slack__slack_send_message`, fall back to "save and post manually"). On success, set `status: published` and `published_at: <ISO-8601>`. Snapshot rolls forward — the just-published file becomes the next run's cutoff.

### Non-Functional

1. **NFR-1**: No agent delegation. Workflow runs in the orchestrator session.
2. **NFR-2**: Channel templates remain the extension point — adding a channel requires only a new file at `<workspace>/registry/slack/<channel>.md`.
3. **NFR-3**: Rendered output uses Slack mrkdwn (`*bold*`, no `**`, no `#` headers, no `[text](url)` markdown links).
4. **NFR-4**: Manual user input is inserted verbatim with no orchestrator rewriting.
5. **NFR-5**: Template body is in Spanish. Internal prompts, error messages, and code stay in English. Auto-rendered strings inserted into placeholders are in Spanish (since they end up in the body).
6. **NFR-6**: Single draft file per sprint+channel. The published file's `task_snapshots` is the source of truth for the next-day delta. No per-day file proliferation.

## Architecture

### User Identity Resolution

```
Read <workspace>/registry/clickup-user.json
   ↓
Has user_id? ──yes──→ use it
   ↓ no
Ask via question: "What's your ClickUp email?"
   ↓
clickup_get_workspace_members → match by email (case-insensitive)
   ↓ no match
Abort: "No ClickUp member found for <email>."
   ↓ match
Persist {email, user_id, username} → clickup-user.json
```

The plugin code never reads the email from any other source.

### Sprint Task Discovery

```
Plugin tasks:
  walk <workspace>/specs/*/CLICKUP_TASK.json
  filter: sprint == <arg> AND (assignees contains user_id OR responsable == user_id)
  
ClickUp tasks:
  query: Sprint custom field == <arg>
  filter: assignees contains user_id OR Responsable == user_id
  if zero matches and <arg> is bare number, retry "Sprint <arg>"

Union (dedupe by clickup_id):
  plugin task data is preferred when present (has slug, PR URLs, local artifacts)
  ClickUp-only tasks contribute name, percentage from subtask ratio, due_date, url
```

### Delta Engine

```
cutoff = latest published draft for this channel (any sprint).published_at
prior_snapshot = that draft's frontmatter.task_snapshots

for each task in current set:
  prior = prior_snapshot[clickup_id]  # or null
  
  if prior is null:
    bucket = "achieved" if current.percentage > 0 else "not_achieved"
  elif current.status_type == "closed" and prior.status_type != "closed":
    bucket = "achieved"
  elif current.percentage > prior.percentage:
    bucket = "achieved"
  else:
    bucket = "not_achieved"  # includes regression and stagnation

new_snapshot = { clickup_id: {name, url, percentage, status_type} for current set }
```

The new snapshot is written to the draft on save. After publish, the published draft's snapshot becomes the next run's `prior_snapshot` — single file rolls forward.

### Data Flow

```
1.  Resolve plugin root + runtime contract
2.  Parse args (sprint, channel)
3.  Resolve workspace
4.  Load channel template (abort if missing)
5.  Resolve user identity (prompt + persist on first run)
6.  Verify ClickUp MCP (abort if down)
7.  Discover sprint tasks (plugin walk → ClickUp gap-fill → union)
8.  Resolve cutoff (latest published draft, this channel)
9.  Build per-task structs:
    - clickup_get_task per task
    - gh pr view for plugin tasks with PRs (stuck candidates only)
    - clickup_get_task_comments for stuck candidates only
10. Bucket: achieved vs not_achieved
11. Render automated placeholders (Spanish strings, struct-driven)
12. Check existing draft (<sprint>-<channel>.md): resume / regenerate / re-post
13. Prompt manual fields (energy, meetings, planned_achievements)
14. Substitute placeholders → composed body
15. URL safety scan → fatal abort on unknown ClickUp URL
16. Save draft with task_snapshots
17. Present for review → edit loop
18. On approval → Slack MCP send → mark published
```

## Channel Template

### Frontmatter

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

### Body (Spanish, default `dailies.md`)

```
#dailyBrain
¿Cómo está tu energía hoy? :large_red_square::large_yellow_square::large_green_square:
{{energy}}

¿Qué objetivos has logrado desde tu última actualización?

{{achieved_goals}}

Reuniones

{{meetings}}

¿Qué objetivos no has logrado desde tu última actualización? ¿Y por qué?

{{not_achieved_goals}}

¿Qué logros importantes tienes planeados para hoy y para la próxima actualización diaria?

{{planned_achievements}}

¿Cuáles son tus metas a corto plazo (y ETA)?

{{short_term_goals}}
```

### Placeholder Reference

| Placeholder | Type | Source |
|---|---|---|
| `{{energy}}` | manual | user prompt |
| `{{meetings}}` | manual | user prompt |
| `{{planned_achievements}}` | manual | user prompt (with stuck-task helper) |
| `{{achieved_goals}}` | auto | tasks where % rose since cutoff |
| `{{not_achieved_goals}}` | auto | stuck tasks + extracted reasons |
| `{{short_term_goals}}` | auto | sprint tasks with due dates |

### Spanish Rendered Strings

| Context | String |
|---|---|
| `{{achieved_goals}}` empty | `_Sin avances desde la última actualización._` |
| `{{not_achieved_goals}}` empty | `_Todas las tareas avanzaron._` |
| First-run banner (no prior draft) | `_Primer reporte del sprint — sin línea base para comparar._` |
| PR open, not draft | `esperando revisión` |
| PR draft | `aún en borrador` |
| PR mergeable=false | `con conflictos de merge` |
| PR with failing checks | `CI fallando` |
| Reason fallback | `sin actualizaciones recientes — agregar razón manual` |

## Draft Persistence

### Path

`<workspace>/drafts/slack/<sprint>-<channel>.md`

Example: `<workspace>/drafts/slack/24-dailies.md`

### Format

```markdown
---
channel: "#dailies"
sprint: 24
status: published
published_at: 2026-04-26T13:00:00Z
task_snapshots:
  86e11tyb3:
    name: "API node Firefox"
    url: "https://app.clickup.com/t/86e11tyb3"
    percentage: 90
    status_type: "in_progress"
  86e11nkdg:
    name: "Decouple sprint from date"
    url: "https://app.clickup.com/t/86e11nkdg"
    percentage: 100
    status_type: "closed"
---

<composed message body>
```

### Lifecycle

1. **First run of a sprint**: no file → all tasks bucketed as not-achieved with first-run banner; on publish, snapshot written.
2. **Subsequent runs of same sprint**: file exists with `status: published` → its snapshot is the cutoff; new run computes deltas, generates new body, overwrites file with new snapshot when published.
3. **Cross-sprint cutoff**: cutoff is the latest published draft for the channel regardless of sprint. Switching sprints mid-week works — the new sprint's first run uses the previous sprint's last snapshot for comparison.

## Files Changed

### Renamed

- `skills/post-slack/SKILL.md` → `skills/daily-slack/SKILL.md`
- `jelou/workflows/post-slack.md` → `jelou/workflows/daily-slack.md`
- `.opencode/commands/jlu-post-slack.md` → `.opencode/commands/jlu-daily-slack.md`

### Modified

- `skills/daily-slack/SKILL.md` — rename to `daily-slack`, point at renamed workflow, update description and triggers to mention "sprint", set `argument-hint: "<sprint> #channel"`. `allowed-tools` adds `mcp__clickup__clickup_get_task_comments` and `mcp__clickup__clickup_get_workspace_members`.
- `jelou/workflows/daily-slack.md` — full rewrite per the data-flow spec above.
- `jelou/templates/slack-channel.md` — replace `{{completed_goals}}` reference with `{{achieved_goals}}` and `{{not_achieved_goals}}`. Document the auto-managed `task_snapshots` frontmatter. Update example to Spanish dailyBrain shape.
- `README.md` — rename references; update one-liner to mention sprint argument.
- `CHANGELOG.md` — add `feat(daily-slack): rename and rebuild as sprint-scoped daily report` under unreleased.
- Any other doc that references `/jlu-post-slack` (search at implementation time).

### Created

- `<workspace>/registry/slack/dailies.md` — first-time install by user, copied from updated `jelou/templates/slack-channel.md`. Plugin does not auto-create.
- `<workspace>/registry/clickup-user.json` — created on first workflow run. Not part of plugin distribution.

### Deleted

- None.

## Constraints

- **ClickUp MCP required.** Step 6 abort matches `/jlu-sync-clickup` Step 0 message.
- **`gh` optional.** Missing → PR-state strings degrade; the comment-based fallback is used.
- **Slack MCP fallback chain** — `mcp__claude_ai_Slack__slack_send_message` → `mcp__plugin_slack_slack__slack_send_message` → save draft + tell user to post manually.
- **Email must resolve to exactly one ClickUp member.** Ambiguity or zero matches → abort.
- **Sprint argument is treated as a string.** Bare value tried first against the `Sprint` custom field; `Sprint <arg>` retried only if zero matches. No fuzzy matching.
- **Single workspace per project.** No multi-workspace support.

## Out of Scope

- Auto-detecting the current sprint from a calendar or ClickUp space settings.
- Cron / scheduled posting at 8 AM.
- Editing or appending a published draft post-hoc; the snapshot rollover handles per-day evolution.
- Multi-user reports.
- Sprints split across multiple ClickUp lists/spaces with inconsistent `Sprint` custom-field configuration.

## Success Criteria

1. `/jlu-daily-slack 24 #dailies` produces a Spanish dailyBrain message scoped to sprint 24, with achieved/not-achieved buckets driven by the snapshot in the latest published draft.
2. A new task that wasn't in the last snapshot but advanced to >0% appears in `{{achieved_goals}}` on its first appearance.
3. A stuck task with no recent ClickUp comments and no PR shows the Spanish fallback string and is editable during review.
4. URL safety scan refuses to publish if any rendered `app.clickup.com` URL wasn't sourced from MCP or `CLICKUP_TASK.json`.
5. Re-running the same sprint+channel after publish picks up the just-published snapshot as the new cutoff.
6. First-run identity prompt blocks until the user supplies an email and it resolves to exactly one workspace member; the email is never inferred from any other source.
7. Adding a new channel still requires only a new template file at `<workspace>/registry/slack/<channel>.md`.
