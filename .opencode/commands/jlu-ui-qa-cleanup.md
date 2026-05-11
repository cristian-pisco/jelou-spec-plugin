---
description: Recover from leaked dev servers, stale containers, or held lock files from a crashed /jlu-ui-qa-run
agent: build
---
Resolve workflow path in this order:
1. `jelou/workflows/ui-qa-cleanup.md` (project-local install)
2. `<HOME>/.config/opencode/jelou/workflows/ui-qa-cleanup.md` (global install fallback; resolve `<HOME>` to an absolute path first)

If neither path exists, stop and report both checked paths.
Read the resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix (never `jlu:`).
