---
description: Append a regex to a service's log_failure_patterns and reload the daemon
agent: build
---
Execute this workflow exactly: @jelou/workflows/add-failure-pattern.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix (never `jlu:`).
