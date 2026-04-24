# Claude Code Runtime Contract

> Shared runtime contract for all `/jlu-*` skills when executed under **Claude Code**.
> Workflows in `jelou/workflows/*.md` were authored for OpenCode and use the names
> `question` and `task` generically. Claude Code uses different tool names and treats
> `AskUserQuestion` as a **deferred** tool. This contract translates and preloads.

## Tool Name Mapping

| Workflow says | Claude Code tool | Notes |
|---------------|------------------|-------|
| `question` | `AskUserQuestion` | Deferred — must be loaded before first call (see below). |
| `task` | `Agent` | Spawns subagents. |

Every literal mention of `question` in a workflow refers to `AskUserQuestion`.
Every literal mention of `task` (as a verb for dispatching an agent) refers to `Agent`.

## Preload Step — MANDATORY

Before executing **Step 1** of any workflow that uses `question` / `AskUserQuestion`,
invoke `ToolSearch` **once** to load the schema:

```
ToolSearch(query: "select:AskUserQuestion", max_results: 1)
```

This makes `AskUserQuestion` callable. Skipping this step causes silent failures:
the agent sees the tool name but cannot invoke it, and often proceeds to write
spec / code without asking the user — producing incomplete or wrong output.

If you are running **inline** (the main Claude Code session): run `ToolSearch`
yourself before Step 1.

If you are a **dispatched subagent** (spawned via `Agent`): your first action,
before Step 1 of the workflow, must be the `ToolSearch` call above.

## Usage Rules

- **Never output questions as plain text.** If the workflow says "ask the user X",
  invoke `AskUserQuestion`. Narrating a question without calling the tool leaves
  the user nothing to respond to and the workflow stalls or produces guesses.
- **Never skip a question.** If the workflow prescribes a confirmation or
  interview round, do not assume the answer.
- **Respect `allowed-tools`.** The skill declares `AskUserQuestion` and
  `ToolSearch` in its `allowed-tools`. Do not attempt to call tools outside
  that list.

## Error Handling

- If `ToolSearch` returns zero matches for `select:AskUserQuestion`: the tool
  is not available in this environment. Fall back to printing the question as
  plain text **and waiting for the user** — but warn the user that the skill
  cannot run correctly without `AskUserQuestion` and suggest re-running in a
  Claude Code version that exposes it.
- If `AskUserQuestion` invocation fails after a successful `ToolSearch`: retry
  once; if still failing, surface the error to the user and stop the workflow.
