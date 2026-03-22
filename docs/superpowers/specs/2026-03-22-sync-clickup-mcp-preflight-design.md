# Design: sync-clickup MCP Preflight Check

**Date:** 2026-03-22
**Scope:** `skills/sync-clickup/SKILL.md`

## Problem

When the ClickUp MCP server is not configured or not authenticated, `jlu:sync-clickup` falls back to unauthenticated WebFetch calls to the ClickUp REST API. This fallback bypasses the `allowed-tools` constraint in the skill frontmatter — the model ignores the boundary at the behavior level when it cannot find the MCP tools it needs. The result is a confusing "API Error: Rate limit reached" error from ClickUp's rate-limiting of unauthenticated requests. The user has no way to know they need to configure the MCP server.

## Goal

- Detect missing/broken ClickUp MCP setup at the earliest possible moment.
- Show a clear, actionable error message and stop — no fallback, no cryptic errors.
- Eliminate any path that leads to WebFetch being used against the ClickUp API, even via model-level behavior override.

## Design

### Change 1 — Step 0: Preflight Check

Insert a new **Step 0 — Verify ClickUp MCP** as the first section of the skill body, before the existing Step 1.

**Logic:**
1. Call `clickup_get_workspace_hierarchy` with no arguments as a connectivity probe. This call is valid with zero arguments — it returns all workspaces the authenticated user can access.
2. If it succeeds → proceed to Step 1 as normal. Do not display any progress message on success.
3. If it fails for any reason → stop immediately and display the error message below. Do not proceed further under any circumstances.

**Error message to display on failure:**

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

### Change 2 — Rules Reinforcement

Append two rules to the end of the existing `## Rules` section:

- **NEVER use WebFetch, Bash, or any HTTP tool to call the ClickUp API. `WebFetch` is not in `allowed-tools` and must never be invoked via any other path. MCP tools only.**
- **If Step 0 fails or any ClickUp MCP tool is unavailable, do NOT attempt any fallback. Stop immediately and show the error message from Step 0.**

## Files Changed

| File | Change |
|------|--------|
| `skills/sync-clickup/SKILL.md` | Add Step 0 preflight + two new rules |

## Out of Scope

- Installing or configuring the ClickUp MCP server (handled by the user following the error message).
- Updating other skills that reference ClickUp.
- Changing how `~/.spec-plugin/clickup.json` is used (that config remains for legacy reference only; the skill does not read it).
