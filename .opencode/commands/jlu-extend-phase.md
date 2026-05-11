---
description: Extend in-progress task phase
agent: build
---
Resolve workflow path in this order:
1. `jelou/workflows/extend-phase.md` (project-local install)
2. `<HOME>/.config/opencode/jelou/workflows/extend-phase.md` (global install fallback; resolve `<HOME>` to an absolute path first)

Resolution rules:
- Select the first existing path only.
- Do not read or execute the fallback path if the project-local path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of question).
Use `task` for subagent dispatches (OpenCode equivalent of task tool).
Always reference commands with the `jlu-` prefix (never `jlu:`).
Phase 1 portability mode: skip ClickUp and Slack execution steps if encountered; report them as deferred to Phase 2.
