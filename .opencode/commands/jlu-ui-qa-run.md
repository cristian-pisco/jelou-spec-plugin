---
description: Run the Playwright E2E suite against affected services with bounded auto-fix loop
agent: build
---
Resolve workflow path in this order:
1. `jelou/workflows/ui-qa-run.md` (project-local install)
2. `<HOME>/.config/opencode/jelou/workflows/ui-qa-run.md` (global install fallback; resolve `<HOME>` to an absolute path first)

If neither path exists, stop and report both checked paths.
Read the resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of AskUserQuestion).
Use `task` for subagent dispatches (OpenCode equivalent of the Task tool).
Always reference commands with the `jlu-` prefix (never `jlu:`).
