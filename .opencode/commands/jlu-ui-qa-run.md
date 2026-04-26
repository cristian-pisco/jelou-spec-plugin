---
description: Run the Playwright E2E suite against affected services with bounded auto-fix loop
agent: build
---
Execute this workflow exactly: @jelou/workflows/ui-qa-run.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of AskUserQuestion).
Use `task` for subagent dispatches (OpenCode equivalent of the Task tool).
Always reference commands with the `jlu-` prefix (never `jlu:`).
