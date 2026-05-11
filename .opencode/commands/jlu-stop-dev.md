---
description: Stop the dev environment daemon and optionally close the TMUX window
agent: build
---
Resolve workflow path in this order:
1. `jelou/workflows/stop-dev.md` (project-local install)
2. `<HOME>/.config/opencode/jelou/workflows/stop-dev.md` (global install fallback; resolve `<HOME>` to an absolute path first)

If neither path exists, stop and report both checked paths.
Read the resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix.
