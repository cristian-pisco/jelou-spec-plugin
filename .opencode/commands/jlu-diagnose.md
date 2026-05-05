---
description: Diagnose a failing service in the JLU dev environment
agent: build
---
Execute this workflow exactly: @jelou/workflows/diagnose.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Use `task` for subagent dispatches (used to invoke jlu-dev-diagnoser).
Always reference commands with the `jlu-` prefix.
