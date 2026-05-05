---
description: Launch all registered services in a TMUX window for the active task
agent: build
---
Execute this workflow exactly: @jelou/workflows/start-dev.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Use `task` for subagent dispatches (not used in this workflow).
Always reference commands with the `jlu-` prefix (never `jlu:`).
