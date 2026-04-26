---
description: Recover from leaked dev servers, stale containers, or held lock files from a crashed /jlu-ui-qa-run
agent: build
---
Execute this workflow exactly: @jelou/workflows/ui-qa-cleanup.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix (never `jlu:`).
