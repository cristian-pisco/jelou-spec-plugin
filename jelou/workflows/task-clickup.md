# Workflow: task-clickup

> Orchestrator workflow for `/jlu-task-clickup [task-slug]`
> Create or update ClickUp macro task and subtasks from user stories.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

You are the orchestrator for the `/jlu-task-clickup` command. You use the ClickUp MCP server directly — no API key, no WebFetch, no pm-agent.

## Step 0 — Verify ClickUp MCP

Call `clickup_get_workspace_hierarchy` with no arguments as a connectivity probe.

- If it **succeeds** → proceed to Step 1. Do not display any message on success.
- If it **fails for any reason** (tool not found, auth error, network error, any exception) → stop immediately, display the message below, do not retry automatically, and do not proceed under any circumstances.

```
⚠️ ClickUp MCP unavailable or returned an error.

/jlu-task-clickup requires the official ClickUp MCP server to be running and authenticated.

If MCP is not yet configured:
1. Add the ClickUp MCP server to your Claude Code settings or .mcp.json:
   {
     "mcpServers": {
       "clickup": {
         "command": "npx",
         "args": ["-y", "@clickup/mcp"],
         "env": { "CLICKUP_CLIENT_ID": "<your-client-id>", "CLICKUP_CLIENT_SECRET": "<your-client-secret>" }
       }
     }
   }
   Full setup docs: https://clickup.com/integrations/mcp
2. Restart Claude Code or reload your MCP configuration so the server starts.
3. Re-run /jlu-task-clickup.

If MCP is already configured, this may be a transient ClickUp API error. Try re-running the command.
```

## Step 1 — Resolve Workspace and Task

1. Read `.spec-workspace.json` in the current repo to find the workspace path and service ID.
2. Resolve the task from arguments or find the most recent task in `.spec-workspace/specs/`.
3. Read the task artifacts:
   - `SPEC.md` — task title, problem statement, requirements
   - `PROPOSAL.md` — strategy, phases, risks
   - `TASKS.md` — current status, sprint number, affected services, phase progress
   - `uh/` directory — user story files for subtasks
4. Read `CLICKUP_TASK.json` (if it exists) for previous sync state.

## Step 2 — Resolve Target List

1. If `CLICKUP_TASK.json` has a `list_id` → use it.
2. Else:
   a. Use `clickup_get_workspace_hierarchy` to fetch available workspaces, spaces, folders, and lists.
   b. Present the list hierarchy to the user via question and let them pick the target list.
   c. Persist the chosen `list_id` in `CLICKUP_TASK.json` for future runs.

## Step 3 — Discover Custom Fields

1. Use `clickup_get_list` with the target list ID to get list details including custom field definitions.
2. Auto-map fields by name (case-insensitive match):

| Plugin Field | ClickUp Field Name |
|-------------|-------------------|
| Team | Equipo |
| Responsible | Responsable |
| Requester | Solicitante |
| Size | Talla |
| Risk | Riesgo |
| Project Type | Tipo proyecto |
| Frontline | Front |
| Needs Design | Necesita Diseno |
| Sprint | Sprint |

3. Persist discovered field IDs in `CLICKUP_TASK.json` under `field_mappings` for future runs.
4. If a required field is not found, warn and continue — do not block the entire sync.
5. **Sprint Points / Story Points are NOT custom fields.** Per the ClickUp
   REST API v2
   ([`/reference/createtask`](https://developer.clickup.com/reference/createtask),
   [`/reference/updatetask`](https://developer.clickup.com/reference/updatetask)),
   they are exposed as a top-level `points` (number) parameter on both
   create and update bodies. The Sprint Points ClickApp must be enabled in
   the workspace ([help.clickup.com — Use Sprint Points](https://help.clickup.com/hc/en-us/articles/6303883602327-Use-Sprint-Points)).
   Do not search the list's custom fields for "Sprint points" / "Story
   points" — they will not be there.

## Step 4 — Infer Fields

Infer these fields inline (no pm-agent). Steps 4a–4c MUST run in order; later
steps depend on earlier ones (Story Points calibrates the time_estimate, OKR
selection feeds the description).

### Step 4a — Select OKR

Read `<plugin-root>/jelou/references/okr-mapping.md`. Pick exactly one Key
Result based on the task's primary intent (use the "Selección rápida por tipo
de tarea" table). If two KRs both fit, pick the one closer to the task's
primary user-visible outcome.

Persist the choice in memory for Step 5 — it will be appended to the macro
task's `markdown_description` as:

```markdown
## OKR

**KR <number>** — <KR description>
```

### Step 4b — Story Points / Talla / Sprint Points (CUE + AI-first)

Read `<plugin-root>/jelou/references/story-points-estimation.md` and apply the
**CUE framework with the AI-first adjustment**:

1. Score the task across **C** (complexity — capas/servicios), **U**
   (uncertidumbre — claridad del scope), and **E** (esfuerzo humano que la IA
   no hace sola — coordinación, validación manual, deploys, decisiones).
2. **Do not let N (file/PR/repo count) inflate SP.** With Claude Code, N is
   irrelevant unless it implies coordinated deploys across services or
   teams. If the only growth axis is "more files" but scope is clear, the
   task is XS (1 SP).
3. Pick the SP value from the reference's escala (1, 2, 3, 5, 8). 13/21 means
   **DIVIDIR before syncing** — abort and tell the user the task must be
   split.
4. Add QA-modifier: +1 for QA de seguridad; +1–2 for QA cross-equipo. Other
   QA flavors do not move the SP.
5. **Talla** is the size column from the same table (XS, S, M, L, XL).
6. **Sprint Points = Story Points** (always equal). Both fields take the same
   integer.

### Step 4c — time_estimate (REQUIRED)

Calibrated from Step 4b's Story Points using the SP→ms table in
`story-points-estimation.md`:

| SP  | hours | ms             |
|-----|-------|----------------|
| 1   | 8     | 28,800,000     |
| 2   | 16    | 57,600,000     |
| 3   | 24    | 86,400,000     |
| 5   | 40    | 144,000,000    |
| 8   | 64    | 230,400,000    |

Override only when there is **specific evidence** the task will take less time
than its SP suggests (e.g., a fix that's 15 min of coding plus a half-day of
manual validation should still be SP 2 / 16h, not 1h). Document the override
reason in `syncHistory.details`.

For subtasks: divide the macro `time_estimate` proportionally to the
requirement coverage. Round to the nearest 3,600,000 ms (1 hour). Never set a
subtask below 3,600,000 ms (1 hour).

`time_estimate` is in **milliseconds** and must be passed as a JSON
**integer**, not a string. Per the ClickUp API
([`/reference/createtask`](https://developer.clickup.com/reference/createtask),
[`/reference/updatetask`](https://developer.clickup.com/reference/updatetask)),
the field is typed `integer`; `"120"` (string) and `120` (integer minutes)
both end up stored as `120` ms — effectively zero. The value sent to the MCP
must be the same number that lives under `time_estimate_ms` in
`CLICKUP_TASK.json` (no minute conversion, no string wrapping). Display to
the user as natural language (e.g., "1d 4h").

### Step 4d — Other fields

| Field | Inference Logic |
|-------|----------------|
| **Priority / Riesgo** | From urgency, impact, cross-service dependencies |
| **Tipo proyecto** | From task intent: new feature, enhancement, bugfix, refactor |
| **Front** | "Reliability" for Issues, else "Enhancement" or "AI" |
| **Necesita Diseno** | "Si" for frontend tasks, "No" for backend |
| **Equipo, Responsable, Solicitante** | From config defaults — ask user on first run via question, persist in CLICKUP_TASK.json |
| **Sprint** | From TASKS.md sprint number |

## Step 5 — Create or Update Macro Task

### 5a. Build markdown_description

Compose the description from the artifacts in this order:

1. Problem statement (SPEC.md "Problem Statement").
2. Strategy summary (PROPOSAL.md "Strategy" section, condensed).
3. Acceptance criteria checklist (from FRs in SPEC.md).
4. References block (PR URLs from TASKS.md, parent task if applicable).
5. **OKR block from Step 4a** — append at the end as:
   ```markdown
   ## OKR

   **KR <number>** — <KR description>
   ```

### 5b. Create (no existing macro task in CLICKUP_TASK.json)

Pass `time_estimate` **directly in the create call** — the official ClickUp
MCP `clickup_create_task` accepts `time_estimate` (milliseconds) as an
optional parameter. Do NOT use a follow-up `clickup_update_task` only to set
the estimate; it has historically been a source of "1m" defaults when the
follow-up was skipped.

```
clickup_create_task(
  list_id: "<list-id>",
  name: "<task title>",
  markdown_description: "<from 5a>",
  assignees: ["<user-id>"],
  priority: <1-4>,
  task_type: "<inferred type>",
  time_estimate: <milliseconds-from-step-4c>,
  points: <story-points-from-step-4b>,
  custom_fields: [<all mapped fields from Step 3-4>]
)
```

`points` is the documented top-level Sprint Points / Story Points field
(see Step 3 note 5). Same numeric value used for both — do not duplicate it
into `custom_fields`.

### 5c. Update (existing macro task)

```
clickup_update_task(
  task_id: "<macro-task-id>",
  time_estimate: <milliseconds-from-step-4c>,
  points: <story-points-from-step-4b>,
  status: "<mapped-status>",
  ...other changed fields
)
```

### 5d. Verify time_estimate landed

Immediately after create or update, call `clickup_get_task(task_id=<id>)` and
read the returned `time_estimate` field.

- If `returned.time_estimate == sent.time_estimate` **and**
  `returned.time_estimate >= 3,600,000` (≥ 1 h) → continue.
- If `returned.time_estimate == 60000` (the ClickUp "1m" default), `null`,
  `< 3,600,000` ms (smells like wrong-unit conversion: e.g., 120 ms means
  someone sent `"120"` thinking minutes), or differs from
  `sent.time_estimate` by more than 1000 ms → call
  `clickup_update_task(task_id=<id>, time_estimate=<sent>)` once as a
  fallback, then re-fetch and re-verify.
- If still mismatched after the fallback → record the mismatch in
  `syncHistory.details` ("time_estimate verification failed: sent=<x> got=<y>")
  and surface a warning in the Step 9 summary. Do **not** abort the rest of
  the sync — partial fields are better than nothing.

Persist `time_estimate_ms` in `CLICKUP_TASK.json` only after verification
passes; do not write the persisted value if the verification step ended in
warning state (use the actual `returned.time_estimate` instead, so future
runs reflect reality, not intent).

### Status Mapping

| Internal State | ClickUp Status |
|---------------|---------------|
| draft | — (not synced) |
| refining | — (not synced) |
| planned | IN PROGRESS |
| implementing | IN PROGRESS |
| validating | IN PROGRESS |
| ready_to_publish | PENDING TO PRODUCTION |
| done | PENDING TO PRODUCTION |
| closed | CLOSED |

## Step 6 — Attach PR Links as Task Comment

1. Read PR URLs from TASKS.md "External Links" section or CLICKUP_TASK.json `pr` field.
2. If PRs exist: Use `clickup_create_task_comment` on the macro task with formatted PR links.
3. Format:
   ```
   Pull Requests:
   - <service-id>: <pr-url>
   - <service-id-2>: <pr-url-2>
   ```

## Step 7 — Create or Update Subtasks from User Stories

### 7a. Generate User Stories (if missing)

1. Check if `<TASK_DIR>/services/<primary-service>/uh/` directory exists and has `.md` files.
2. If user stories already exist, skip to 7b.
3. If no user stories exist:
   a. Read `<TASK_DIR>/SPEC.md` and `<TASK_DIR>/PROPOSAL.md`.
   b. For each affected service, derive user stories from requirements (FR-1, FR-2, etc.):
      - Format: "As a [user], I want [action], so that [benefit]."
      - Each story has acceptance criteria in Given/When/Then format.
      - Each story maps to one or more phases from PROPOSAL.md.
   c. Write story files to `<TASK_DIR>/services/<service-id>/uh/<story-slug>.md`.
   d. Use the user-story.md template from `<plugin-root>/jelou/templates/user-story.md` if available.

### 7b. Sync Subtasks to ClickUp

For each user story file in `uh/`:

1. Match existing subtasks by slug via CLICKUP_TASK.json.
2. **Create new**: Use `clickup_create_task` with `parent` = macro task ID.
   Pass `time_estimate` **in the same create call** (do not split into
   create + update — the same "1m" default risk applies to subtasks).
   ```
   clickup_create_task(
     list_id: "<list-id>",
     parent: "<macro-task-id>",
     name: "<subtask name>",
     markdown_description: "<story body>",
     time_estimate: <subtask-ms-from-step-4c>,
     custom_fields: [<inherited fields>]
   )
   ```
3. **Subtasks inherit ALL parent custom fields**: Riesgo, Equipo, Tipo
   proyecto, Solicitante, Front, Talla, Responsable, Sprint, Necesita
   Diseno. Sprint / Story Points are passed via the top-level `points`
   parameter, not as a custom field — same value as the parent (or a
   proportional fraction for subtasks).
4. **Update existing**: Use `clickup_update_task` with `time_estimate` and any changed fields in a single call.
5. **Verify** `time_estimate` on every subtask using the same protocol as
   Step 5d (call `clickup_get_task`, fall back to `clickup_update_task` once,
   record mismatches). Subtasks must never end the sync at the ClickUp "1m"
   default.
6. **Never delete subtasks** (Decision #27).

## Step 8 — Persist to CLICKUP_TASK.json

Write the updated sync state:

```json
{
  "list_id": "<list-id>",
  "field_mappings": {
    "Equipo": "<field-id>",
    "Responsable": "<field-id>",
    "Solicitante": "<field-id>",
    "Talla": "<field-id>",
    "Riesgo": "<field-id>",
    "Tipo proyecto": "<field-id>",
    "Front": "<field-id>",
    "Necesita Diseno": "<field-id>",
    "Sprint": "<field-id>"
  },
  "defaults": {
    "equipo": "<value>",
    "responsable": "<value>",
    "solicitante": "<value>"
  },
  "macroTask": {
    "id": "<clickup-task-id>",
    "url": "<clickup-url>",
    "status": "<current-status>",
    "time_estimate_ms": "<milliseconds>",
    "lastSynced": "<ISO-8601>"
  },
  "subtasks": {
    "<story-slug>": {
      "id": "<clickup-task-id>",
      "url": "<clickup-url>",
      "time_estimate_ms": "<milliseconds>",
      "lastSynced": "<ISO-8601>"
    }
  },
  "sprint": "<sprint-name>",
  "pr": {
    "<service-id>": "<pr-url>"
  },
  "syncHistory": [
    {
      "timestamp": "<ISO-8601>",
      "action": "created|updated",
      "details": "<brief>"
    }
  ]
}
```

## Step 9 — Report Summary

Present the sync results to the user:

```
## ClickUp Sync — <task-slug>

### Macro Task
- Action: created / updated
- URL: <clickup-url>
- Story Points: <SP> (Talla: <talla>)
- OKR: KR <n.n> — <description>
- Time Estimate: <human-readable> (sent: <ms>, verified: <ms>)
- Status: <clickup-status>

### Subtasks
- Created: <N>
- Updated: <N>
- Unchanged: <N>
- Time-estimate mismatches: <N> (see Warnings if non-zero)

### PR Comments
- <Attached / No PRs found>

### Custom Fields Set
- <list of fields that were successfully mapped and set>

### Warnings
- <any unmapped fields or time_estimate verification failures>
```

## Rules

- Sync is **idempotent** — running it multiple times produces the same result.
- Never delete ClickUp tasks or subtasks. Only create and update.
- `time_estimate` is **REQUIRED** on every task and subtask. Never skip it.
  Pass it directly in the create/update call (Step 5b/5c/7b), never as a
  trailing-only update — the trailing-only pattern has historically left
  tasks at the ClickUp "1m" default when the trailing call was skipped.
- **Verify time_estimate** after every create or update via Step 5d. Persist
  the verified value (not the intended value) to `CLICKUP_TASK.json`.
- **OKR is mandatory** in the macro task description. Pick exactly one KR
  from `jelou/references/okr-mapping.md` per Step 4a. Subtasks do not repeat
  the OKR block.
- **Story Points / Talla** must follow the CUE + AI-first framework in
  `jelou/references/story-points-estimation.md`. N (files / PRs / repos)
  does not inflate SP. SP ≥ 13 means **DIVIDIR before syncing**.
- All user interaction MUST use `question`. Never output questions as plain text.
- If a ClickUp MCP tool returns an error, report it clearly. Do not retry silently.
- If there's a duplicate custom field name, ask for resolution once via question and persist the choice.
- Sprint is **mandatory** — if not set in TASKS.md, ask the user via question.
- **NEVER use WebFetch, Bash, or any HTTP tool to call the ClickUp API. `WebFetch` is not in `allowed-tools` and must never be invoked via any other path. MCP tools only.**
- **If Step 0 fails, do NOT attempt any fallback.** Stop immediately and display the error message defined in Step 0.
