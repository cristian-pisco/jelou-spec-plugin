# Workflow: sync-clickup

> Orchestrator workflow for `/jlu:sync-clickup [task-slug]`
> Create or update ClickUp macro task and subtasks from user stories.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.

---

You are the orchestrator for the `/jlu:sync-clickup` command. You use the ClickUp MCP server directly — no API key, no WebFetch, no pm-agent.

## Step 0 — Verify ClickUp MCP

Call `clickup_get_workspace_hierarchy` with no arguments as a connectivity probe.

- If it **succeeds** → proceed to Step 1. Do not display any message on success.
- If it **fails for any reason** (tool not found, auth error, network error, any exception) → stop immediately, display the message below, do not retry automatically, and do not proceed under any circumstances.

```
⚠️ ClickUp MCP unavailable or returned an error.

/jlu:sync-clickup requires the official ClickUp MCP server to be running and authenticated.

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
3. Re-run /jlu:sync-clickup.

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
   b. Present the list hierarchy to the user via AskUserQuestion and let them pick the target list.
   c. Persist the chosen `list_id` in `CLICKUP_TASK.json` for future runs.

## Step 3 — Discover Custom Fields

1. Use `clickup_get_list` with the target list ID to get list details including custom field definitions.
2. Auto-map fields by name (case-insensitive match):

| Plugin Field | ClickUp Field Name |
|-------------|-------------------|
| Team | Equipo |
| Responsible | Responsable |
| Requester | Solicitante |
| Story Points | Story points |
| Size | Talla |
| Risk | Riesgo |
| Project Type | Tipo proyecto |
| Frontline | Front |
| Needs Design | Necesita Diseno |
| Sprint | Sprint |

3. Persist discovered field IDs in `CLICKUP_TASK.json` under `field_mappings` for future runs.
4. If a required field is not found, warn and continue — do not block the entire sync.

## Step 4 — Infer Fields

Infer these fields inline (no pm-agent):

### time_estimate (REQUIRED)

- Per phase: ~2h for simple (1 service, few requirements), ~4h for medium, ~8h for complex
- Total task = sum of phase estimates
- Subtask estimate = proportional to requirements covered
- The ClickUp API expects `time_estimate` in **milliseconds** (integer). Convert hours → ms: `hours × 3,600,000` (e.g., 2h = `7200000`, 4h = `14400000`, 8h = `28800000`)
- Display to user as natural language (e.g., "1h 30m")

### Other Fields

| Field | Inference Logic |
|-------|----------------|
| **Story Points / Talla** | From number of phases, services, requirements, codebase complexity |
| **Priority / Riesgo** | From urgency, impact, cross-service dependencies |
| **Tipo proyecto** | From task intent: new feature, enhancement, bugfix, refactor |
| **Front** | "Reliability" for Issues, else "Enhancement" or "AI" |
| **Necesita Diseno** | "Si" for frontend tasks, "No" for backend |
| **Equipo, Responsable, Solicitante** | From config defaults — ask user on first run via AskUserQuestion, persist in CLICKUP_TASK.json |
| **Sprint** | From TASKS.md sprint number |

## Step 5 — Create or Update Macro Task

### Create (no existing macro task in CLICKUP_TASK.json)

1. Use `clickup_create_task` with:
   - `name`: Task title from SPEC.md
   - `description`: Problem statement + strategy summary
   - `assignees`: From config defaults
   - `priority`: Inferred priority (1=urgent, 2=high, 3=normal, 4=low)
   - `custom_fields`: ALL mapped fields from Step 3-4
2. **Immediately after create**: Use `clickup_update_task` to set `time_estimate` (not available on create).

### Update (existing macro task)

1. Use `clickup_update_task` with changed fields + `time_estimate` + status mapping.

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

For each user story file in `uh/`:

1. Match existing subtasks by slug via CLICKUP_TASK.json.
2. **Create new**: Use `clickup_create_task` with `parent` = macro task ID.
3. **Subtasks inherit ALL parent custom fields**: Riesgo, Equipo, Tipo proyecto, Solicitante, Front, Talla, Responsable, Sprint, Story Points, Necesita Diseno.
4. **Update existing**: Use `clickup_update_task`.
5. Set `time_estimate` on each subtask (proportional to phase scope) — use `clickup_update_task` after create.
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
    "Story points": "<field-id>",
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
- Time Estimate: <human-readable>
- Status: <clickup-status>

### Subtasks
- Created: <N>
- Updated: <N>
- Unchanged: <N>

### PR Comments
- <Attached / No PRs found>

### Custom Fields Set
- <list of fields that were successfully mapped and set>

### Warnings
- <any unmapped fields or errors>
```

## Rules

- Sync is **idempotent** — running it multiple times produces the same result.
- Never delete ClickUp tasks or subtasks. Only create and update.
- `time_estimate` is **REQUIRED** on every task and subtask. Never skip it.
- All user interaction MUST use `AskUserQuestion`. Never output questions as plain text.
- If a ClickUp MCP tool returns an error, report it clearly. Do not retry silently.
- If there's a duplicate custom field name, ask for resolution once via AskUserQuestion and persist the choice.
- Sprint is **mandatory** — if not set in TASKS.md, ask the user via AskUserQuestion.
- **NEVER use WebFetch, Bash, or any HTTP tool to call the ClickUp API. `WebFetch` is not in `allowed-tools` and must never be invoked via any other path. MCP tools only.**
- **If Step 0 fails, do NOT attempt any fallback.** Stop immediately and display the error message defined in Step 0.
