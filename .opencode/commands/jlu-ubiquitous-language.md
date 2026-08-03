---
description: Curate the workspace domain glossary
agent: build
---
Resolve `<install-root>` first: walk up from THIS command file to the nearest ancestor directory
that contains a `jelou/` directory. The command lives at `<install-root>/.opencode/commands/` on a
project install and at `<install-root>/commands/` on a global one, so the depth is not fixed. Never
assume a literal path: `$OPENCODE_HOME` moves `<install-root>` anywhere.

Resolve workflow path in this order:
1. `<install-root>/jelou/workflows/ubiquitous-language.md` (install preferred)
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
