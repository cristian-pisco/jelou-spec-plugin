# Workflow: task-clickup

> Orchestrator workflow for `/jlu-task-clickup [task-slug]`
> Create or update a single ClickUp macro task from the workspace artifacts.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

You are the orchestrator for the `/jlu-task-clickup` command. You use the ClickUp MCP server directly — no API key, no WebFetch, no pm-agent.

## Step 0 — Verify ClickUp MCP

Call `clickup_get_workspace_hierarchy` with no arguments as a connectivity probe.

- If it **succeeds** → proceed to Step 1. Do not display any message on success.
- If it **fails for any reason** (tool not found, auth error, network error, any exception) → stop immediately, display the message below, do not retry automatically, and do not proceed under any circumstances.

```
⚠️ ClickUp MCP unavailable or returned an error.

Tool: `clickup_get_workspace_hierarchy`
Error: `<tool error message>`
Response body: `<returned body, or "none">`

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
4. Read `CLICKUP_TASK.json` (if it exists) for previous sync state.

## Step 2 — Resolve Target List

1. If `CLICKUP_TASK.json` has a `list_id` → use it.
2. Else:
   a. Use `clickup_get_workspace_hierarchy` to fetch available workspaces, spaces, folders, and lists.
   b. Present the list hierarchy to the user via question and let them pick the target list.
   c. Persist the chosen `list_id` in `CLICKUP_TASK.json` for future runs.

## Step 3 — Discover Custom Fields

1. Use `clickup_get_custom_fields` with `list_id: "<list-id>"` to get the field
   definitions (`id`, `type`, and `type_config.options` for drop_down/labels).
   `clickup_get_list` returns only the list's id, name, content, space and
   configured statuses — it does **not** return custom field definitions, so it
   cannot be used for this step.
2. Auto-map fields by name (case-insensitive, trims whitespace, removes diacritics for matching):

| Plugin Field | ClickUp Field Name | Type | Required | Notes |
|-------------|-------------------|------|----------|-------|
| Team | Equipo | labels | yes | |
| Responsible | Responsable | users | yes | Dual write — see Step 4d / 5b. |
| Requester | Solicitante | drop_down | yes | |
| Size | Talla | drop_down | yes | |
| Risk | Riesgo | drop_down | yes | |
| Project Type | Tipo proyecto | drop_down | yes | |
| Frontline | Front | drop_down | yes | |
| Needs Design | Necesita Diseno | drop_down | yes | |
| Sprint | Sprint | number | yes | |
| OKR | OKR (Tech) | labels | yes | Option resolved by KR-code prefix — see `references/okr-mapping.md`. |
| Design State | Estado del diseño | drop_down | conditional | Auto-set to "Solicitado" only when `Needs Design = Si`. |
| Project Area | Proyecto | drop_down | conditional | Inferred from affected services / SPEC context. Skip if no confident match. |
| QA Assignee | QA Asignado | users | opt-in | Set only when a QA assignee is provided (e.g., on hand-off to QA). |
| Client | Cliente | drop_down | yes | Infer from SPEC / task context; if no confident match, ASK the user — never skip (indispensable). See Step 4d. |

3. Persist discovered field IDs in `CLICKUP_TASK.json` under `field_mappings`
   for future runs. For `OKR (Tech)`, also persist the resolved KR-code → option
   UUID lookup table (keyed by KR code) the first time the field is discovered,
   so subsequent runs can write the OKR field without re-fetching list options.
4. If a **required** field is not found, warn and continue — do not block the
   entire sync. If a **conditional** or **opt-in** field is missing, skip
   silently. The following fields are **NEVER** auto-set by the workflow
   (human-only): `Fecha límite modificada`, `Fecha de entrega al Cliente`.
5. **Sprint Points / Story Points are NOT writable through this MCP server.**
   Two things are true at once and both were verified against the live
   workspace:
   - They are **not custom fields**. `clickup_get_custom_fields` on the target
     list returns no "Sprint points" / "Story points" field, so do not search
     for one — it will not be there.
   - They are **not a parameter on the MCP tools either**. Neither
     `clickup_create_task` nor `clickup_update_task` declares a `points`
     parameter in its JSONSchema, and `clickup_get_task` does not return a
     `points` key. The top-level `points` field documented in the ClickUp
     REST API v2 ([`/reference/createtask`](https://developer.clickup.com/reference/createtask))
     is simply not surfaced by this MCP server.

   Consequence: **never pass `points` to any MCP call** — it is not in the
   schema and is silently dropped. The Story Points value computed in Step 4b
   is still used for **Talla** (the `drop_down` custom field, which *is*
   writable) and is reported to the user in Step 8, but the numeric SP itself
   cannot be persisted to ClickUp on this tooling. If a human needs the number
   in ClickUp, they must set it in the UI.

   `time_estimate` (minutes, as a string) *is* a parameter on both MCP tools,
   but it means work hours, not relative size — this workflow never sets it
   (see Step 4b and the Rules section). Do not substitute it for Story Points.

## Step 4 — Infer Fields

Infer these fields inline (no pm-agent). Steps 4a–4b MUST run in order; later
steps depend on earlier ones (OKR selection feeds the description).

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
5. **Talla** is the size column from the same table (XS, S, M, L, XL). This is
   the **only** size signal this workflow can actually write to ClickUp — it
   is a `drop_down` custom field, set via `custom_fields` with the option
   UUID.
6. **Sprint Points = Story Points** (always equal) conceptually, but neither is
   writable through the ClickUp MCP server — see Step 3 note 5. Compute the SP
   value anyway: it drives the Talla choice and the Step 8 report.

Story Points measure relative size, not work hours. This workflow does **not**
set a `time_estimate` on any task — never pass `time_estimate` to any ClickUp
create or update call, even though the MCP schema accepts it.

### Step 4d — Other fields

| Field | Inference Logic |
|-------|----------------|
| **Priority / Riesgo** | From urgency, impact, cross-service dependencies |
| **Tipo proyecto** | From task intent: new feature, enhancement, bugfix, refactor |
| **Front** | "Reliability" for Issues, else "Enhancement" or "AI" |
| **Necesita Diseno** | "Si" for frontend tasks, "No" for backend |
| **Equipo, Solicitante** | From config defaults — ask user on first run via question, persist in CLICKUP_TASK.json |
| **Responsable** | From config defaults. Resolve the identity to a numeric user ID first with `clickup_resolve_assignees(assignees: ["<email-or-name-or-me>"])` → `{ "userIds": ["89213205"] }`. **Dual destination**: write that ID to (a) the top-level `assignees` parameter on `clickup_create_task` / `clickup_update_task` — a **flat array of ID strings** on both, and (b) the `Responsable` custom field (type `users`) as a JSON **string** `'{"add":["<user-id>"],"rem":[]}'`. See Step 5b/5c/5e — skipping (a) leaves `assignees: []` on the task, which is what hides it from boards and "assigned to me" filters. |
| **Sprint** | From TASKS.md sprint number |
| **OKR (Tech)** | From Step 4a's selected KR. Resolve the option UUID by matching the KR-code prefix against the `OKR (Tech)` field's option labels — see `references/okr-mapping.md`. Pass as a single-element JSON array **string** (labels encoding, Step 5e): `"[\"<option-uuid>\"]"`. Never hardcode UUIDs. |
| **Estado del diseño** | Conditional. If `Necesita Diseno = Si` and no prior design state is recorded → set to `Solicitado`. If `Necesita Diseno = No` → leave empty. On subsequent updates, do **not** overwrite an existing value (humans curate this field). |
| **Proyecto** | Inferred from the affected services in TASKS.md or the SPEC.md context. Use the following best-effort match against the `Proyecto` field options: service `chatbot-server` / runtime concerns → `Brain`; UI editor work → `Builder` (or `Builder (Legacy)` if pre-V3); marketplace features → `Marketplace`; module-specific tasks (e.g., "Nodo API", "AI Agent") → the matching option. If no confident match (single clear hit), skip — do not guess. |
| **QA Asignado** | Opt-in. Only set when a QA assignee is explicitly provided (via question on hand-off, or via a `qa_assignee` default in `CLICKUP_TASK.json`). Same dual-write contract as Responsable is **not** needed — QA Asignado is the custom field only, not the top-level `assignees`. |
| **Cliente** | **Required — never skip.** Try to infer from SPEC.md / task context by case-insensitive name match against the `Cliente` field options. If there is no confident single match, ASK the user via question (present the option labels) and persist the choice in `CLICKUP_TASK.json` `defaults.cliente` for future runs. Only fall back to the `Cliente interno` option if the user explicitly declines to pick one. |

### Step 4e — Task dates (start_date / due_date, REQUIRED)

Set the two **built-in** ClickUp task dates — the top-level `start_date` and
`due_date`. These are the task's schedule fields and are distinct from the
human-curated custom date fields `Fecha límite modificada` / `Fecha de entrega
al Cliente`, which are NEVER auto-set.

**Format — MCP contract, not REST.** On `clickup_create_task` and
`clickup_update_task`, `start_date` and `due_date` are **strings** in
`YYYY-MM-DD` or `YYYY-MM-DD HH:MM` format (the create tool enforces the
pattern `^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$`). They are **NOT** Unix
milliseconds — passing an epoch integer is a schema violation. There is
**no** `start_date_time` / `due_date_time` parameter on either tool; the
presence or absence of the ` HH:MM` suffix is what selects date-only vs
date-and-time. On `clickup_update_task` only, passing the literal `'none'`
clears a date; omitting the key leaves it unchanged. The raw REST API takes
epoch ms plus the `*_date_time` booleans — that is a different contract, do
not port it back here.

- **`start_date`** = today, date-only (the day work starts). Compute it
  deterministically with Bash: `date -d 'today 00:00' +%F` → `YYYY-MM-DD`.
- **`due_date`** = last day of the destination sprint, written as
  `<YYYY-MM-DD> 23:59` so it lands at end of day. Resolve the sprint end date
  in this order:
  1. Parse it from the sprint list name returned by `clickup_get_list` —
     sprint lists are named like `Sprint 68 (8/3-8/16)`; take the **second**
     date, interpret its month/day in the current year (roll to next year only
     if the end month is earlier than the start month), then format it with
     Bash: `date -d '<parsed-date>' +%F`. (`clickup_get_list` returns no
     `due_date` of its own — do not look for one.)
  2. Else fall back to `start_date` + 5 business days (one working week) so
     `due_date` is never empty.
- On **update** of an existing macro task, do NOT overwrite a `start_date`
  already persisted from a prior sync (`macroTask.start_date_ms` in
  `CLICKUP_TASK.json`); omit the key entirely. Only refresh `due_date` when
  the sprint changed.
- **Reads come back as ms.** `clickup_get_task` returns `start_date` /
  `due_date` as epoch-millisecond strings even though writes are
  `YYYY-MM-DD`. That is where `macroTask.start_date_ms` / `due_date_ms` in
  Step 7 come from — persist the values as returned by the read, and convert
  back to `YYYY-MM-DD` before any subsequent write.

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

First resolve the Responsable to a numeric user ID (Step 4d):

```
clickup_resolve_assignees(assignees: ["<email | username | me>"])
→ { "userIds": ["<user-id-str>"] }
```

Then create:

```
clickup_create_task(
  list_id: "<list-id>",
  name: "<task title>",
  markdown_description: "<from 5a>",
  assignees: ["<user-id-str>"],           # flat array of ID strings
  priority: "<urgent|high|normal|low>",   # enum string, not 1-4
  task_type: "<inferred type>",
  start_date: "<YYYY-MM-DD from step 4e>",
  due_date: "<YYYY-MM-DD HH:MM from step 4e>",
  custom_fields: [<all mapped fields from Step 3-4, values as strings — see 5e>]
)
```

Never pass `time_estimate` — this workflow does not set work hours on tasks.

Never pass `points` — the MCP tool has no such parameter (Step 3 note 5).
The Story Points value from Step 4b reaches ClickUp only as **Talla**, a
`drop_down` entry inside `custom_fields`.

There is no `start_date_time` / `due_date_time` parameter — the ` HH:MM`
suffix on the date string is what carries the time-of-day.

`assignees` is a **flat array of user-ID strings** (`items: {type: "string"}`)
— not `{add, rem}`, not integers. Use the IDs returned by
`clickup_resolve_assignees`; never guess or hardcode them.

The Responsable custom field (type `users`) is set in the same call inside
`custom_fields`, and on this MCP server its `value` is a **JSON string**, not
a nested object:

```
{ "id": "<responsable-field-id>",
  "value": "{\"add\":[\"<user-id-str>\"],\"rem\":[]}" }
```

Both writes are mandatory. Skipping the top-level `assignees` is what
produced `"assignees": []` on the task even though the custom field looked
set.

### 5c. Update (existing macro task)

**Update takes the same shapes as Create on this MCP server.** The raw REST
Update Task body differs from Create — it switches `assignees` / `watchers` /
`group_assignees` to `{add, rem}` and rejects `custom_fields`, directing
custom-field writes to a separate endpoint
([`/reference/setcustomfieldvalue`](https://developer.clickup.com/reference/setcustomfieldvalue),
`POST /api/v2/task/{task_id}/field/{field_id}`). **None of that applies
here.** `clickup_update_task` declares `assignees` as a flat `string[]`
exactly like Create, declares no `watchers` / `group_assignees` at all, and
*does* accept a `custom_fields` array of `{ id, value }` which the server fans
out to the per-field endpoint for you. There is no
`clickup_set_task_custom_field_value` tool and none is needed.

```
clickup_update_task(
  task_id: "<macro-task-id>",
  start_date: "<YYYY-MM-DD from step 4e>",       # omit if macroTask.start_date_ms already set
  due_date: "<YYYY-MM-DD HH:MM from step 4e>",   # refresh when the sprint changed
  status: "<mapped-status>",
  assignees: ["<user-id-str>"],                  # flat array, same as Create
  custom_fields: [ { id: "<custom-field-uuid>", value: "<string — see Step 5e>" }, ... ],
  ...other changed fields
)
```

Never pass `time_estimate` — this workflow does not set work hours on tasks.

Never pass `points` — not a parameter on this tool (Step 3 note 5).

There is no `start_date_time` / `due_date_time` parameter here either. To
*clear* a date pass the literal string `'none'`; to leave it unchanged omit
the key. The same `'none'` convention applies to `priority` and `task_type`.

Include in `custom_fields` only the fields that actually changed. Do **not**
reach for a per-field setter tool — none exists on this MCP server.

### 5e. Custom-field value encodings (MCP tool contract)

> **This table documents the ClickUp MCP tool's contract, which is NOT the raw
> REST API's.** On `clickup_create_task` / `clickup_update_task` the
> `custom_fields[].value` property is declared as `type: "string"` — **every**
> value is a string, including numbers, booleans, arrays and objects, which are
> passed as their JSON text. The REST API `/docs/customfields` page documents
> native JSON types (real numbers, real booleans, real arrays/objects) for the
> per-field endpoint. Both are correct for their own transport. Do **not**
> "fix" this table back to the REST shapes — the MCP server rejects or
> mis-parses them.

| Type | `value` encoding (string) | Example |
|------|---------------------------|---------|
| `text`, `short_text`, `email`, `url` | the value directly | `"hello"` |
| `phone` | international format | `"+1 234 567 8901"` |
| `number`, `currency`/`money`, `rating` | the number **as a string** | `"42"` |
| `checkbox`, `button` | `'true'` / `'false'` | `"true"` |
| `date` | `YYYY-MM-DD` or `YYYY-MM-DD HH:MM` (auto-converted to a timestamp) | `"2026-08-16"` |
| `drop_down` | the option **UUID** (`type_config.options[].id`), not the index | `"a1b2…"` |
| `labels` | JSON **array string** of option UUIDs — overwrites | `"[\"uuid1\",\"uuid2\"]"` |
| `users`, `relationships`/`tasks`, `files` | JSON **object string** with add/rem arrays | `"{\"add\":[\"89213205\"],\"rem\":[]}"` |
| `progress` | JSON object string with `current` | `"{\"current\":50}"` |
| `location` | JSON object string with `location` + `formatted_address` | `"{\"location\":{\"lat\":-28,\"lng\":153},\"formatted_address\":\"…\"}"` |
| `formula`, `automatic_progress` | read-only — do not attempt to set | — |

The Responsable custom field is type `users`; the Equipo and OKR (Tech)
fields are `labels`; Talla, Riesgo, Tipo proyecto, Front, Necesita Diseno,
Solicitante, Estado del diseño, Proyecto, Cliente are `drop_down`; QA
Asignado is `users` (same add/rem object-string encoding as Responsable, but
written to the custom field only — no top-level `assignees` dual-write);
Sprint is `number`, so it is written as a quoted digit string. Use the right
encoding for each.

Example payload covering the extended field set — note every `value` is a
string:

```json
"custom_fields": [
  { "id": "<equipo-field-id>",              "value": "[\"<team-label-uuid>\"]" },
  { "id": "<okr-tech-field-id>",            "value": "[\"<okr-option-uuid-matching-KR-code>\"]" },
  { "id": "<responsable-field-id>",         "value": "{\"add\":[\"<user-id-str>\"],\"rem\":[]}" },
  { "id": "<qa-asignado-field-id>",         "value": "{\"add\":[\"<qa-user-id-str>\"],\"rem\":[]}" },
  { "id": "<talla-field-id>",               "value": "<talla-option-uuid>" },
  { "id": "<sprint-field-id>",              "value": "<sprint-number-as-string>" },
  { "id": "<estado-del-diseno-field-id>",   "value": "<solicitado-option-uuid>" },
  { "id": "<proyecto-field-id>",            "value": "<proyecto-option-uuid>" },
  { "id": "<cliente-field-id>",             "value": "<cliente-option-uuid>" }
]
```

Omit any entry whose source field is not present in `field_mappings` or
whose value the inference step in Step 4d resolved as empty. Never write
`Fecha límite modificada` or `Fecha de entrega al Cliente` — those are
human-curated.

### 5d. Verify dates and Cliente landed

Immediately after create or update, call `clickup_get_task(task_id=<id>)` and
confirm the required Step-4e / Cliente fields landed:

- `returned.start_date` and `returned.due_date` are both non-null. If either
  is missing, re-send it once via `clickup_update_task`, re-fetch, and — if
  still missing — record it in `syncHistory.details` and warn in Step 9.
- The `Cliente` custom field is set (non-empty) on the returned task. If it
  is empty, resolve it per Step 4d (infer or ASK) and set it before
  continuing — the sync must not finish with an empty Cliente.

Do **not** abort the rest of the sync on a warning — partial fields are better
than nothing.

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
2. If PRs exist: Use `clickup_create_comment(entity_type="task", entity_id=<macro-task-id>, comment_text=<formatted PR links>)`.
3. Format:
   ```
   Pull Requests:
   - <service-id>: <pr-url>
   - <service-id-2>: <pr-url-2>
   ```

## Step 7 — Persist to CLICKUP_TASK.json

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
    "Sprint": "<field-id>",
    "OKR (Tech)": "<field-id>",
    "Estado del diseño": "<field-id>",
    "Proyecto": "<field-id>",
    "QA Asignado": "<field-id>",
    "Cliente": "<field-id>"
  },
  "okr_option_map": {
    "1.1": "<option-uuid>",
    "1.2": "<option-uuid>",
    "2.1": "<option-uuid>",
    "...": "..."
  },
  "defaults": {
    "equipo": "<value>",
    "responsable": "<value>",
    "solicitante": "<value>",
    "qa_assignee": "<value-or-null>",
    "cliente": "<value-or-null>"
  },
  "macroTask": {
    "id": "<clickup-task-id>",
    "url": "<clickup-url>",
    "status": "<current-status>",
    "start_date_ms": "<milliseconds>",
    "due_date_ms": "<milliseconds>",
    "lastSynced": "<ISO-8601>"
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

## Step 8 — Report Summary

Present the sync results to the user:

```
## ClickUp Sync — <task-slug>

### Macro Task
- Action: created / updated
- URL: <clickup-url>
- Story Points: <SP> (Talla: <talla>) — SP is reported here only; it is not
  writable via the ClickUp MCP server, only Talla is synced
- OKR: KR <n.n> — <description>
- Dates: <start YYYY-MM-DD> → <due YYYY-MM-DD> (sprint end)
- Client: <Cliente option chosen, or "asked user">
- Status: <clickup-status>

### PR Comments
- <Attached / No PRs found>

### Custom Fields Set
- <list of fields that were successfully mapped and set>

### Warnings
- <any unmapped fields or verification failures>
```

## Rules

- Sync is **idempotent** — running it multiple times produces the same result.
- **Only the macro task is created — no subtasks.** This workflow never creates
  subtasks and never derives user stories for ClickUp. One task per spec.
- Never delete ClickUp tasks. Only create and update.
- **Never set `time_estimate` (work hours)** on any task. Story Points / Talla
  express relative size; do not translate them into an hour estimate and never
  pass `time_estimate` to any create or update call, even though the MCP
  schema accepts it (minutes, as a string).
- **Never pass `points`.** The ClickUp MCP tools declare no `points`
  parameter and there is no Sprint/Story Points custom field on the target
  list — the number cannot be written from this workflow. Talla is the only
  size field that syncs. See Step 3 note 5.
- **Payload shapes follow the MCP tool schemas, not the ClickUp REST docs.**
  Dates are `YYYY-MM-DD` strings (no `*_date_time` booleans, no epoch ms),
  `assignees` is a flat array of ID strings on **both** create and update, and
  every `custom_fields[].value` is a **string** with the per-type encoding in
  Step 5e. If a ClickUp REST doc disagrees, the tool schema wins.
- **OKR is mandatory** in **both** the macro task description **and** the
  `OKR (Tech)` custom field. Pick exactly one KR from
  `jelou/references/okr-mapping.md` per Step 4a; resolve its option UUID by
  matching the KR-code prefix on the field's option labels (see Step 5e and
  `references/okr-mapping.md`).
- **`start_date` and `due_date` are REQUIRED** on the macro task (Step 4e):
  `start_date` = today, `due_date` = destination sprint end. These are the
  **built-in** task dates — set them on create/update. Do not confuse them
  with the human-curated custom fields below.
- **Cliente is REQUIRED — never skip it.** Infer from SPEC / task context;
  if there is no confident match, ASK the user via question and persist the
  choice in `defaults.cliente`. Never leave the task without a Cliente.
- **Never auto-set human-curated fields**: `Fecha límite modificada` and
  `Fecha de entrega al Cliente` are owned by people, not the workflow. Leave
  them untouched even if they appear in the list's field definitions.
- **Story Points / Talla** must follow the CUE + AI-first framework in
  `jelou/references/story-points-estimation.md`. N (files / PRs / repos)
  does not inflate SP. SP ≥ 13 means **DIVIDIR before syncing**.
- All user interaction MUST use `question`. Never output questions as plain text.
- If any ClickUp MCP tool returns an error, print `Tool: <tool-name>`, `Error: <error message>`, and `Response body: <returned body, or "none">`. Do not retry automatically.
- If there's a duplicate custom field name, ask for resolution once via question and persist the choice.
- Sprint is **mandatory** — if not set in TASKS.md, ask the user via question.
- **NEVER use WebFetch, Bash, or any HTTP tool to call the ClickUp API. `WebFetch` is not in `allowed-tools` and must never be invoked via any other path. MCP tools only.**
- **If Step 0 fails, do NOT attempt any fallback.** Stop immediately and display the error message defined in Step 0.
