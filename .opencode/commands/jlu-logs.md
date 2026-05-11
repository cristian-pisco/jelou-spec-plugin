---
description: Print the last N lines from a service's TMUX pane on demand
agent: build
---
Resolve workflow path in this order:
1. `jelou/workflows/logs.md` (project-local install)
2. `<HOME>/.config/opencode/jelou/workflows/logs.md` (global install fallback; resolve `<HOME>` to an absolute path first)

Resolution rules:
- Select the first existing path only.
- Do not read or execute the fallback path if the project-local path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix.
