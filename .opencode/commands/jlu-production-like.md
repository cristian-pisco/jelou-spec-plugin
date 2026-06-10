---
description: Run the full production-like test suite for a task — auto-detect fullstack vs full-backend, boot dev infra once, delegate to ui-qa-run + test-suite against the live stack, then tear down
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/production-like.md` (global install preferred; resolve `<HOME>` to an absolute path first)
2. `jelou/workflows/production-like.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of AskUserQuestion).
Use `task` for subagent dispatches (OpenCode equivalent of the Task tool).
Always reference commands with the `jlu-` prefix (never `jlu:`).
