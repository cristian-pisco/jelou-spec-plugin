---
description: Diagnose a failing service in the JLU dev environment
agent: build
---
Resolve workflow path in this order:
1. `jelou/workflows/diagnose.md` (project-local install)
2. `<HOME>/.config/opencode/jelou/workflows/diagnose.md` (global install fallback; resolve `<HOME>` to an absolute path first)

If neither path exists, stop and report both checked paths.
Read the resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Use `task` for subagent dispatches (used to invoke jlu-dev-diagnoser).
Always reference commands with the `jlu-` prefix.
