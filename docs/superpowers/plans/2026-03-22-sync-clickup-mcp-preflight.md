# sync-clickup MCP Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Step 0 preflight check to `skills/sync-clickup/SKILL.md` that calls the ClickUp MCP server immediately on startup, stops with a clear setup message on failure, and adds two rules that explicitly prohibit WebFetch fallback.

**Architecture:** Single-file edit to a Markdown skill document. Insert a new `## Step 0` section before the existing `## Step 1`, and append two rules to the existing `## Rules` section. No code, no tests — this is an LLM instruction file; correctness is verified by reading the final diff.

**Tech Stack:** Markdown, git

---

### Task 1: Insert Step 0 — Verify ClickUp MCP

**Files:**
- Modify: `skills/sync-clickup/SKILL.md` — insert Step 0 section before Step 1

The skill body currently starts at the line:

```
You are the orchestrator for the `/jlu:sync-clickup` command. You use the ClickUp MCP server directly — no API key, no WebFetch, no pm-agent.
```

Step 1 follows directly. Insert the new Step 0 section between the opening paragraph and `## Step 1`.

- [ ] **Step 1: Open `skills/sync-clickup/SKILL.md` and read the current content**

  Confirm the file structure: frontmatter block, opening paragraph, then `## Step 1 — Resolve Workspace and Task`.

- [ ] **Step 2: Insert Step 0 section**

  Insert the following block **between** the opening paragraph and `## Step 1 — Resolve Workspace and Task`.
  The block to insert (copy exactly as shown, at the top level — no leading indentation):

  ---
  ```
  ## Step 0 — Verify ClickUp MCP

  Call `clickup_get_workspace_hierarchy` with no arguments as a connectivity probe.

  - If it **succeeds** → proceed to Step 1. Do not display any message on success.
  - If it **fails for any reason** (tool not found, auth error, network error, any exception) → stop immediately, display the message below, and do not proceed under any circumstances.

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
  ```
  ---

  Note: the inner fenced block (the error message shown to the user) uses triple backticks at column 0.
  The outer fenced block wrapper above is only for display in this plan — do not include it in the file.

- [ ] **Step 3: Verify the insertion looks correct**

  Read the file back and confirm:
  - `## Step 0` appears before `## Step 1`
  - The opening paragraph is still intact above Step 0
  - The error message is a fenced block whose opening ` ``` ` is at column 0 (no leading spaces)

---

### Task 2: Append Rules to the Rules Section

**Files:**
- Modify: `skills/sync-clickup/SKILL.md` — append two rules to `## Rules`

The current `## Rules` section ends with:

```
- Sprint is **mandatory** — if not set in TASKS.md, ask the user via AskUserQuestion.
```

- [ ] **Step 1: Append two new rules after the last existing rule**

  Add the following two lines at the end of the `## Rules` section:

  ```markdown
  - **NEVER use WebFetch, Bash, or any HTTP tool to call the ClickUp API. `WebFetch` is not in `allowed-tools` and must never be invoked via any other path. MCP tools only.**
  - **If Step 0 fails or any ClickUp MCP tool is unavailable, do NOT attempt any fallback.** Stop immediately and show the error message from Step 0.
  ```

- [ ] **Step 2: Verify the rules section**

  Read the `## Rules` section and confirm:
  - The two new rules appear at the end
  - No existing rules were modified or removed
  - There are now 9 rules total (7 original + 2 new)

---

### Task 3: Verify Full Diff and Commit

- [ ] **Step 1: Review the full diff**

  Run:
  ```bash
  git -C /home/cristianp/personal-projects/jelou-spec-plugin diff skills/sync-clickup/SKILL.md
  ```

  Confirm:
  - Only `skills/sync-clickup/SKILL.md` is modified
  - Step 0 section is present and correctly placed
  - Two new rules are appended at the end of `## Rules`
  - No other content was changed

- [ ] **Step 2: Commit**

  ```bash
  git -C /home/cristianp/personal-projects/jelou-spec-plugin add skills/sync-clickup/SKILL.md
  git -C /home/cristianp/personal-projects/jelou-spec-plugin commit -m "Add MCP preflight check to sync-clickup skill"
  ```
