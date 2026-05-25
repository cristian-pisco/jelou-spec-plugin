---
description: Inspect the workspace trace store (per-agent / per-phase / per-task / trends)
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/trace-report.md` (global install preferred; resolve `<HOME>` to an absolute path first)
2. `jelou/workflows/trace-report.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the workspace working directory.

Use `question` for user prompts (OpenCode equivalent of question).
