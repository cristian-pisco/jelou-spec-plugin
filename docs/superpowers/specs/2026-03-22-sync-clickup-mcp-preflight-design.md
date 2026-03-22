# Design: sync-clickup MCP Preflight Check

**Date:** 2026-03-22
**Scope:** `skills/sync-clickup/SKILL.md`

## Problem

When the ClickUp MCP server is not configured or not authenticated, `jlu:sync-clickup` falls back to unauthenticated WebFetch calls to the ClickUp REST API. This produces a confusing "API Error: Rate limit reached" error instead of a clear setup message. The user has no way to know they need to configure the MCP server.

## Goal

- Detect missing/broken ClickUp MCP setup at the earliest possible moment.
- Show a clear, actionable setup message and stop — no fallback, no cryptic errors.
- Eliminate any path that leads to WebFetch being used against the ClickUp API.

## Design

### Change 1 — Step 0: Preflight Check

Insert a new **Step 0 — Verify ClickUp MCP** as the first section of the skill body, before the existing Step 1.

**Logic:**
1. Call `clickup_get_workspace_hierarchy` with no arguments as a connectivity probe.
2. If it succeeds → proceed to Step 1 as normal.
3. If it fails for any reason (tool not found, auth error, network error) → stop immediately and display the setup block below. Do not proceed.

**Setup message to display on failure:**

```
⚠️ ClickUp MCP is not configured or not authenticated.

To use /jlu:sync-clickup you need the official ClickUp MCP server running and connected.

Setup steps:
1. Open Claude Code settings (or .mcp.json in your project)
2. Add the ClickUp MCP server — official docs: https://clickup.com/integrations/mcp
3. Authenticate via the OAuth flow when prompted
4. Re-run /jlu:sync-clickup
```

### Change 2 — Rules Reinforcement

Add two explicit rules to the existing `## Rules` section:

- **NEVER use WebFetch, Bash, or any HTTP tool to call the ClickUp API. MCP tools only.**
- **If any ClickUp MCP tool is unavailable or returns an error, do NOT attempt fallback. Stop and show the setup instructions from Step 0.**

## Files Changed

| File | Change |
|------|--------|
| `skills/sync-clickup/SKILL.md` | Add Step 0 preflight + two new rules |

## Out of Scope

- Installing or configuring the ClickUp MCP server (handled by the user following the setup message).
- Updating other skills that reference ClickUp.
- Changing how `~/.spec-plugin/clickup.json` is used (that config remains for legacy reference only; the skill does not read it).
