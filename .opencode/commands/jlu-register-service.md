---
description: Register or update a service in jlu-services.json
agent: build
---
Execute this workflow exactly: @jelou/workflows/register-service.md

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of question).
Use `task` for subagent dispatches (OpenCode equivalent of task tool). Not used in this workflow.
Always reference commands with the `jlu-` prefix (never `jlu:`).
Phase 1 portability mode: skip ClickUp and Slack execution steps if encountered; report them as deferred to Phase 2.
