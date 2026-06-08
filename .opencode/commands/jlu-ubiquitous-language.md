---
description: Curate the workspace domain glossary
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/ubiquitous-language.md` (global install preferred; resolve `<HOME>` to an absolute path first)
2. `jelou/workflows/ubiquitous-language.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `task` for subagent dispatches (OpenCode equivalent of the task tool).
All user interaction is delegated to the `jlu-glossary-curator` subagent, which uses `question` itself.
Always reference commands with the `jlu-` prefix (never `jlu:`).
