---
name: Setup ClickUp
description: Interactive ClickUp credential and field mapping setup
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
  - WebFetch
model: sonnet
---

You are the orchestrator for the `/jlu:setup-clickup` command.

## Step 1 — Gather Credentials

1. Check if `~/.spec-plugin/clickup.json` already exists.
2. If it exists, ask the user whether to reconfigure or keep existing settings.
3. Ask the user for their ClickUp API token using AskUserQuestion.
4. Validate the token by fetching the authenticated user info via the ClickUp API (`GET https://api.clickup.com/api/v2/user`).

## Step 2 — Select Workspace

1. Fetch available workspaces via `GET https://api.clickup.com/api/v2/team`.
2. Present the list to the user and let them select one.
3. Record the workspace (team) ID.

## Step 3 — Select Space and List

1. Fetch spaces in the selected workspace via `GET https://api.clickup.com/api/v2/team/<team_id>/space`.
2. Let the user select a space.
3. Fetch folders and lists in the selected space.
4. Let the user select the target list where tasks will be created.
5. Record space ID and list ID.

## Step 4 — Configure Custom Field Mappings

1. Fetch custom fields for the selected list via `GET https://api.clickup.com/api/v2/list/<list_id>/field`.
2. Map the required fields to ClickUp custom fields:
   - `Story Points` — find matching field by name
   - `Talla` (size) — find matching field by name
   - `Priority` — map to ClickUp native priority
   - `Riesgo` (risk) — find matching field by name
   - `Tipo proyecto` — find matching field by name
   - `Front` — find matching field by name
   - `Necesita Diseno` — find matching field by name
   - `Equipo` — find matching field by name
   - `Responsable` — find matching field by name
3. If a required field is not found, warn the user and ask them to provide the field name or skip it.
4. If duplicate field names exist, ask the user to pick the correct one and persist the choice.

## Step 5 — Configure Defaults

1. Ask the user for fixed defaults:
   - Default assignee
   - Default team (`Equipo`)
   - Default responsible (`Responsable`)
2. These will be applied to all tasks created by the plugin.

## Step 6 — Write Configuration

1. Ensure `~/.spec-plugin/` directory exists.
2. Write the configuration to `~/.spec-plugin/clickup.json`:
   ```json
   {
     "apiToken": "<token>",
     "teamId": "<workspace-id>",
     "spaceId": "<space-id>",
     "listId": "<list-id>",
     "fieldMappings": {
       "storyPoints": "<field-id>",
       "talla": "<field-id>",
       "riesgo": "<field-id>",
       "tipoProyecto": "<field-id>",
       "front": "<field-id>",
       "necesitaDiseno": "<field-id>",
       "equipo": "<field-id>",
       "responsable": "<field-id>"
     },
     "defaults": {
       "assignee": "<user-id>",
       "equipo": "<team-value>",
       "responsable": "<responsible-value>"
     }
   }
   ```

## Step 7 — Verify Connectivity

1. Verify the full configuration by fetching the target list details.
2. Confirm to the user that ClickUp integration is ready.
3. Report any warnings (missing optional fields, etc.).
